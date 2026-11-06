"""Fetch public HTTP(S) pages without allowing redirects or DNS to bypass policy.

Kept identical in research-agent/src and gateway-tools/lambda-functions/web-search
because the two runtimes are packaged independently. Tests check both copies.
"""

import http.client
import ipaddress
import socket
import ssl
from urllib.parse import quote, urljoin, urlsplit


MAX_REDIRECTS = 5
MAX_RESPONSE_BYTES = 5 * 1024 * 1024
USER_AGENT = "Mozilla/5.0 (compatible; StrandsAgent/1.0; +https://strands.ai)"


class PublicURLFetchError(ValueError):
    """A rejected destination or an unsuccessful HTTP response."""

    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code


def _is_public(address):
    ip = ipaddress.ip_address(address)
    # Exclude transition mechanisms as well as private, link-local, loopback,
    # unspecified, multicast, reserved and shared address space.
    return (
        ip.is_global
        and not ip.is_multicast
        and not ip.is_reserved
        and not (ip.version == 6 and (ip.ipv4_mapped or ip.sixtofour or ip.teredo))
    )


def _resolve_public(url):
    # urlsplit can silently strip control characters. Reject them before parsing.
    if not isinstance(url, str) or any(ord(c) <= 32 or ord(c) == 127 for c in url):
        raise PublicURLFetchError("URL must not contain whitespace or control characters")
    try:
        parsed = urlsplit(url)
        if parsed.scheme not in ("http", "https") or not parsed.hostname:
            raise ValueError("URL must use http:// or https:// and include a host")
        if parsed.username is not None or parsed.password is not None:
            raise ValueError("URL credentials are not allowed")
        if "%" in parsed.hostname or "\\" in parsed.netloc:
            raise ValueError("Encoded or scoped hosts are not allowed")
        host = parsed.hostname.encode("idna").decode("ascii")
        port = parsed.port
        if port is None:
            port = 443 if parsed.scheme == "https" else 80
        if not 1 <= port <= 65535:
            raise ValueError("Invalid URL port")
    except (ValueError, UnicodeError) as exc:
        raise PublicURLFetchError(str(exc)) from exc

    addresses = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    if not addresses or any(not _is_public(item[4][0]) for item in addresses):
        raise PublicURLFetchError("URL destination must resolve only to public IP addresses")
    return parsed, host, port, addresses


class _PinnedConnection(http.client.HTTPConnection):
    """Connect only to the numeric addresses already checked by the policy."""

    def __init__(self, host, port, addresses, *, use_tls, timeout):
        super().__init__(host, port, timeout=timeout)
        self._addresses = addresses
        self._use_tls = use_tls

    def connect(self):
        last_error = None
        for family, socktype, proto, _, sockaddr in self._addresses:
            sock = socket.socket(family, socktype, proto)
            try:
                sock.settimeout(self.timeout)
                # No second DNS lookup, environment proxy, or implicit redirect.
                sock.connect(sockaddr)
                if self._use_tls:
                    # Preserve certificate verification and SNI for the URL host.
                    context = ssl.create_default_context()
                    context.minimum_version = ssl.TLSVersion.TLSv1_2
                    sock = context.wrap_socket(sock, server_hostname=self.host)
                self.sock = sock
                return
            except OSError as exc:
                sock.close()
                last_error = exc
        raise last_error or OSError("No public destination addresses")


def fetch_public_url(url, timeout=30):
    """Return (text, content_type, status) after validating every redirect hop.

Only public destinations are supported. Ambient proxy settings are intentionally
ignored so that a proxy cannot resolve a checked host to an unchecked address.
"""
    for hop in range(MAX_REDIRECTS + 1):
        parsed, host, port, addresses = _resolve_public(url)
        connection = _PinnedConnection(
            host, port, addresses, use_tls=parsed.scheme == "https", timeout=timeout
        )
        try:
            target = quote(parsed.path or "/", safe="/%:@!$&'()*+,;=-._~")
            if parsed.query:
                target += "?" + quote(parsed.query, safe="/%?:@!$&'()*+,;=-._~")
            connection.request("GET", target, headers={
                "User-Agent": USER_AGENT,
                "Accept-Encoding": "identity",
            })
            response = connection.getresponse()
            if response.status in (301, 302, 303, 307, 308):
                location = response.getheader("Location")
                if not location:
                    raise PublicURLFetchError("Redirect response has no Location")
                if hop == MAX_REDIRECTS:
                    raise PublicURLFetchError("Too many redirects")
                if any(ord(c) <= 32 or ord(c) == 127 for c in location):
                    raise PublicURLFetchError("Invalid redirect Location")
                url = urljoin(url, location)
                continue
            if not 200 <= response.status < 300:
                raise PublicURLFetchError(
                    f"HTTP error {response.status}: {response.reason}", response.status
                )
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise PublicURLFetchError("Response exceeds the 5 MiB limit")
            encoding = response.headers.get_content_charset() or "utf-8"
            try:
                text = body.decode(encoding, errors="replace")
            except LookupError:
                text = body.decode("utf-8", errors="replace")
            return (
                text,
                response.getheader("Content-Type", ""),
                response.status,
            )
        finally:
            connection.close()
