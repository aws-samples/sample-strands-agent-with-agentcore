"""Keep Research Agent packaging and its Strands tool on the public URL policy."""

import asyncio
import json
import socket
from pathlib import Path
from unittest.mock import Mock

import public_url


def test_public_url_policy_matches_gateway_package():
    agentcore = Path(__file__).resolve().parents[3]
    gateway = agentcore / "gateway-tools/lambda-functions/web-search/public_url.py"
    assert Path(public_url.__file__).read_bytes() == gateway.read_bytes()


def test_strands_tool_rejects_internal_destination(monkeypatch):
    from tools.web_search_tools import fetch_url_content

    resolver = Mock(return_value=[
        (socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", ("127.0.0.1", 80)),
    ])
    # Set up asyncio before replacing sockets so only outbound connections fail.
    with asyncio.Runner() as runner:
        runner.get_loop()
        with monkeypatch.context() as patch:
            patch.setattr(socket, "getaddrinfo", resolver)
            connect = Mock(side_effect=AssertionError("Internal destination reached"))
            patch.setattr(socket, "socket", connect)
            result = json.loads(runner.run(fetch_url_content("http://127.0.0.1/")))
            assert result["success"] is False
            assert "public IP" in result["error"]
            connect.assert_not_called()
