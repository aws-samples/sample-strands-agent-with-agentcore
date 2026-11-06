"""Public URL policy regressions for both independently packaged runtimes.

All network responses are in-memory. No AWS endpoints or real credentials are
used, and an unexpected connection fails the test.
"""

import asyncio
import importlib.util
import io
import json
import socket
import ssl
import sys
from pathlib import Path
from unittest.mock import Mock

import pytest


AGENTCORE = Path(__file__).resolve().parents[2]
RESEARCH = AGENTCORE / "a2a-agents/research-agent/src"
GATEWAY = AGENTCORE / "gateway-tools/lambda-functions/web-search"


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture(params=[RESEARCH, GATEWAY], ids=["research", "gateway"])
def fetcher(request):
    return load_module("public_url_under_test", request.param / "public_url.py")


def address(ip, port=80):
    family = socket.AF_INET6 if ":" in ip else socket.AF_INET
    sockaddr = (ip, port, 0, 0) if family == socket.AF_INET6 else (ip, port)
    return family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr


@pytest.fixture
def network(monkeypatch):
    # Preserve the real HTTP request/response parser while replacing the socket.
    # Any DNS lookup or socket creation not explicitly prepared below fails.
    resolver = Mock(side_effect=AssertionError("Unexpected DNS lookup"))
    sockets = Mock(side_effect=AssertionError("Unexpected socket connection"))
    monkeypatch.setattr(socket, "getaddrinfo", resolver)
    monkeypatch.setattr(socket, "socket", sockets)
    return resolver, sockets


def response_socket(body=b"article text", status="200 OK", headers=()):
    sock = Mock()
    wire = (f"HTTP/1.1 {status}\r\nContent-Length: {len(body)}\r\n"
            + "".join(f"{k}: {v}\r\n" for k, v in headers) + "\r\n").encode() + body
    sock.makefile.return_value = io.BytesIO(wire)
    return sock


def test_deployed_helpers_are_identical():
    assert (RESEARCH / "public_url.py").read_bytes() == (GATEWAY / "public_url.py").read_bytes()


@pytest.mark.parametrize("ip", [
    "127.0.0.1", "0.0.0.0", "10.0.0.1", "172.16.0.1", "192.168.1.1",
    "169.254.169.254", "169.254.170.2", "100.100.100.200", "192.0.0.8",
    "192.0.2.1", "224.0.0.1", "240.0.0.1", "::", "::1", "fc00::1",
    "fe80::1", "ff02::1", "::ffff:127.0.0.1", "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::", "2001:db8::1",
])
def test_internal_destinations_blocked_before_connect(fetcher, network, ip):
    resolver, sockets = network
    resolver.side_effect = None
    resolver.return_value = [address(ip)]
    host = f"[{ip}]" if ":" in ip else ip
    with pytest.raises(fetcher.PublicURLFetchError, match="public IP"):
        fetcher.fetch_public_url(f"http://{host}/")
    sockets.assert_not_called()


@pytest.mark.parametrize("url", [
    "file:///etc/passwd", "ftp://example.org/", "http:///missing-host",
    "http://user:password@example.org/", "http://example.org:0/",
    "http://example.org:65536/", "http://[fe80::1%25eth0]/",
    "http://example.org\\@127.0.0.1/", "http://exam\nple.org/",
    " http://example.org/", "http://%31%32%37.0.0.1/",
])
def test_malformed_urls_rejected_before_dns(fetcher, network, url):
    resolver, sockets = network
    with pytest.raises(fetcher.PublicURLFetchError):
        fetcher.fetch_public_url(url)
    resolver.assert_not_called()
    sockets.assert_not_called()


def test_mixed_public_private_dns_answers_are_blocked(fetcher, network):
    resolver, sockets = network
    resolver.side_effect = None
    resolver.return_value = [address("93.184.216.34"), address("::1")]
    with pytest.raises(fetcher.PublicURLFetchError):
        fetcher.fetch_public_url("https://example.org/")
    sockets.assert_not_called()


def test_public_fetch_pins_dns_and_ignores_proxy_environment(fetcher, network, monkeypatch):
    resolver, sockets = network
    # A second DNS resolution would produce a private address (DNS rebinding).
    resolver.side_effect = [[address("93.184.216.34")], [address("127.0.0.1")]]
    sock = response_socket()
    sockets.side_effect = [sock]
    monkeypatch.setenv("HTTP_PROXY", "http://127.0.0.1:8888")
    monkeypatch.setenv("HTTPS_PROXY", "http://127.0.0.1:8888")
    monkeypatch.setenv("ALL_PROXY", "http://127.0.0.1:8888")
    assert fetcher.fetch_public_url("http://example.org/article?q=test")[0] == "article text"
    resolver.assert_called_once()
    sock.connect.assert_called_once_with(("93.184.216.34", 80))
    request = b"".join(call.args[0] for call in sock.sendall.call_args_list)
    assert b"GET /article?q=test HTTP/1.1" in request
    assert b"Host: example.org\r\n" in request
    sock.close.assert_called_once()


@pytest.mark.parametrize("status", [301, 302, 303, 307, 308])
def test_redirect_to_internal_host_is_blocked(fetcher, network, status):
    resolver, sockets = network
    resolver.side_effect = [[address("93.184.216.34")], [address("169.254.170.2")]]
    sock = response_socket(status=f"{status} Redirect", headers=[
        ("Location", "http://169.254.170.2/internal-sentinel"),
    ])
    sockets.side_effect = [sock]
    with pytest.raises(fetcher.PublicURLFetchError, match="public IP"):
        fetcher.fetch_public_url("http://example.org/article")
    assert sockets.call_count == 1
    sock.close.assert_called_once()


def test_relative_public_redirect_is_revalidated(fetcher, network):
    resolver, sockets = network
    resolver.side_effect = [[address("93.184.216.34")], [address("93.184.216.34")]]
    first = response_socket(status="302 Found", headers=[("Location", "/final")])
    second = response_socket()
    sockets.side_effect = [first, second]
    assert fetcher.fetch_public_url("http://example.org/start")[0] == "article text"
    assert resolver.call_count == 2
    assert b"GET /final HTTP/1.1" in second.sendall.call_args.args[0]


def test_same_host_redirect_does_not_bypass_dns_policy(fetcher, network):
    resolver, sockets = network
    resolver.side_effect = [[address("93.184.216.34")], [address("127.0.0.1")]]
    sockets.side_effect = [response_socket(status="302 Found", headers=[("Location", "/final")])]
    with pytest.raises(fetcher.PublicURLFetchError):
        fetcher.fetch_public_url("http://example.org/start")
    assert sockets.call_count == 1


def test_redirect_limit(fetcher, network):
    resolver, sockets = network
    resolver.side_effect = None
    resolver.return_value = [address("93.184.216.34")]
    sockets.side_effect = lambda *args: response_socket(status="302 Found", headers=[("Location", "/loop")])
    with pytest.raises(fetcher.PublicURLFetchError, match="Too many redirects"):
        fetcher.fetch_public_url("http://example.org/loop")
    assert sockets.call_count == 6


@pytest.mark.parametrize("valid_certificate", [True, False])
def test_https_uses_original_hostname_and_verifies_certificate(fetcher, network, monkeypatch, valid_certificate):
    resolver, sockets = network
    resolver.side_effect = None
    resolver.return_value = [address("93.184.216.34", 443)]
    raw_socket, tls_socket = Mock(), response_socket()
    sockets.side_effect = [raw_socket]
    # Verify the helper requests a secure default context, not an unverified one.
    context = ssl.create_default_context()
    # Verify the policy even if the environment's default permits older TLS.
    context.minimum_version = ssl.TLSVersion.MINIMUM_SUPPORTED
    context.wrap_socket = Mock(return_value=tls_socket)
    monkeypatch.setattr(ssl, "create_default_context", Mock(return_value=context))
    if not valid_certificate:
        context.wrap_socket.side_effect = ssl.SSLCertVerificationError("untrusted certificate")
        with pytest.raises(ssl.SSLCertVerificationError):
            fetcher.fetch_public_url("https://example.org/")
        raw_socket.close.assert_called_once()
    else:
        assert fetcher.fetch_public_url("https://example.org/")[0] == "article text"
        tls_socket.close.assert_called_once()
    raw_socket.connect.assert_called_once_with(("93.184.216.34", 443))
    context.wrap_socket.assert_called_once_with(raw_socket, server_hostname="example.org")
    assert context.minimum_version == ssl.TLSVersion.TLSv1_2


def test_response_size_limit(fetcher, network, monkeypatch):
    resolver, sockets = network
    resolver.side_effect = None
    resolver.return_value = [address("93.184.216.34")]
    sockets.side_effect = [response_socket(b"too large")]
    monkeypatch.setattr(fetcher, "MAX_RESPONSE_BYTES", 3)
    with pytest.raises(fetcher.PublicURLFetchError, match="limit"):
        fetcher.fetch_public_url("http://example.org/")


@pytest.fixture(params=["research", "gateway"])
def tool_fetch(request, monkeypatch):
    root = RESEARCH if request.param == "research" else GATEWAY
    helper = load_module("public_url", root / "public_url.py")
    monkeypatch.setitem(sys.modules, "public_url", helper)
    if request.param == "research":
        # Gateway CI doesn't install Strands. Only its decorator is substituted;
        # the actual shipped URL function and transport run without modification.
        import types
        monkeypatch.setitem(sys.modules, "strands", types.SimpleNamespace(tool=lambda fn: fn))
        module = load_module("research_web_search", root / "tools/web_search_tools.py")
        # Create the loop before the network fixture replaces Internet sockets.
        with asyncio.Runner() as runner:
            runner.get_loop()
            yield lambda url, **kwargs: json.loads(runner.run(module.fetch_url_content(url, **kwargs)))
    else:
        module = load_module("gateway_web_search", root / "lambda_function.py")
        yield lambda url, **kwargs: module.lambda_handler({"name": "fetch_url_content", "url": url, **kwargs}, None)


def test_tool_returns_public_article(tool_fetch, network):
    resolver, sockets = network
    resolver.side_effect = None
    resolver.return_value = [address("93.184.216.34")]
    sockets.side_effect = [response_socket(b"<p>Public article</p>")]
    result = tool_fetch("http://example.org/", include_html=True)
    assert result["success"] is True
    assert result["status_code"] == 200
    assert "Public article" in result["text_content"]
    assert result["html_content"] == "<p>Public article</p>"


def test_tool_does_not_return_redirected_internal_body(tool_fetch, network):
    resolver, sockets = network
    resolver.side_effect = [[address("93.184.216.34")], [address("127.0.0.1")]]
    sockets.side_effect = [response_socket(status="302 Found", headers=[("Location", "http://127.0.0.1/internal")])]
    result = tool_fetch("http://example.org/")
    assert result["success"] is False
    assert "public IP" in result["error"]
    assert "text_content" not in result
    assert sockets.call_count == 1


def test_http_error_preserves_status(tool_fetch, network):
    resolver, sockets = network
    resolver.side_effect = None
    resolver.return_value = [address("93.184.216.34")]
    sockets.side_effect = [response_socket(status="404 Not Found")]
    result = tool_fetch("http://example.org/")
    assert result["success"] is False
    assert result["status_code"] == 404
