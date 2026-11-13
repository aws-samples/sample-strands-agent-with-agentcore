"""Tests for the Keenable search gateway lambda."""
import json

from conftest import load_lambda

lf = load_lambda("keenable-search")
lambda_handler = lf.lambda_handler


class MockClientContext:
    def __init__(self, tool_name: str = "unknown"):
        self.custom = {"bedrockAgentCoreToolName": tool_name}


class MockContext:
    def __init__(self, tool_name: str = "unknown"):
        self.client_context = MockClientContext(tool_name)


class _Resp:
    def __init__(self, status_code, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.text = text or json.dumps(self._payload)

    def json(self):
        return self._payload


def _body(result):
    return json.loads(result["body"])


def _reset(monkeypatch):
    monkeypatch.delenv("KEENABLE_API_KEY", raising=False)
    monkeypatch.delenv("KEENABLE_API_KEY_SECRET_NAME", raising=False)
    lf._api_key_cache = None
    lf._api_key_loaded = False


def test_unknown_tool(monkeypatch):
    _reset(monkeypatch)
    result = lambda_handler({"query": "q"}, MockContext("other_tool"))
    assert result["statusCode"] == 400
    assert "Unknown tool" in _body(result)["error"]


def test_missing_query(monkeypatch):
    _reset(monkeypatch)
    result = lambda_handler({}, MockContext("keenable_search"))
    assert result["statusCode"] == 400
    assert "query parameter required" in _body(result)["error"]


def test_keyless_public_endpoint(monkeypatch):
    _reset(monkeypatch)
    captured = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        captured["url"] = url
        captured["json"] = json
        captured["headers"] = headers
        return _Resp(200, {
            "query": "agent search",
            "results": [
                {"title": "Docs", "url": "https://docs.keenable.ai/", "snippet": "Search API"},
            ],
        })

    monkeypatch.setattr(lf.requests, "post", fake_post)
    result = lambda_handler(
        {"query": "agent search", "num_results": 3},
        MockContext("keenable_search"),
    )
    assert result["statusCode"] == 200
    assert captured["url"] == "https://api.keenable.ai/v1/search/public"
    assert captured["headers"]["X-Keenable-Title"] == "sample-strands-agent-with-agentcore"
    assert "X-API-Key" not in captured["headers"]
    assert captured["json"] == {"query": "agent search", "max_results": 3}
    text = _body(result)["content"][0]["text"]
    assert "https://docs.keenable.ai/" in text
    assert "Search API" in text


def test_keyed_endpoint(monkeypatch):
    _reset(monkeypatch)
    monkeypatch.setenv("KEENABLE_API_KEY", "keen_test")
    captured = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        captured["url"] = url
        captured["headers"] = headers
        return _Resp(200, {"query": "q", "results": []})

    monkeypatch.setattr(lf.requests, "post", fake_post)
    result = lambda_handler({"query": "q"}, MockContext("keenable_search"))
    assert result["statusCode"] == 200
    assert captured["url"] == "https://api.keenable.ai/v1/search"
    assert captured["headers"]["X-API-Key"] == "keen_test"


def test_http_error(monkeypatch):
    _reset(monkeypatch)

    def fake_post(url, json=None, headers=None, timeout=None):
        return _Resp(502, text="bad gateway")

    monkeypatch.setattr(lf.requests, "post", fake_post)
    result = lambda_handler({"query": "q"}, MockContext("prefix___keenable_search"))
    assert result["statusCode"] == 400
    assert "502" in _body(result)["error"]
