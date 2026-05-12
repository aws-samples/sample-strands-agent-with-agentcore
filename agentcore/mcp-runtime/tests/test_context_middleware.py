"""
Tests for AgentCoreContextMiddleware.

Verifies that AgentCore Runtime headers are correctly bridged into
BedrockAgentCoreContext on each request.
"""
from unittest.mock import patch
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import PlainTextResponse
from starlette.routing import Route
from starlette.testclient import TestClient


# ============================================================
# App factory
# ============================================================

def _make_app():
    async def handler(request: Request):
        return PlainTextResponse("ok")

    with patch("agentcore_context_middleware.BedrockAgentCoreContext"):
        from agentcore_context_middleware import AgentCoreContextMiddleware

        app = Starlette(routes=[Route("/test", handler)])
        app.add_middleware(AgentCoreContextMiddleware)
        return app


# ============================================================
# Header bridging
# ============================================================

class TestAgentCoreContextMiddleware:
    def test_workload_access_token_header_is_set(self):
        with patch("agentcore_context_middleware.BedrockAgentCoreContext") as mock_ctx:
            from agentcore_context_middleware import AgentCoreContextMiddleware

            app = Starlette(routes=[Route("/test", lambda r: PlainTextResponse("ok"))])
            app.add_middleware(AgentCoreContextMiddleware)
            client = TestClient(app, raise_server_exceptions=True)

            client.get("/test", headers={"WorkloadAccessToken": "wlat-xyz"})

            mock_ctx.set_workload_access_token.assert_called_once_with("wlat-xyz")

    def test_oauth2_callback_url_header_is_set(self):
        with patch("agentcore_context_middleware.BedrockAgentCoreContext") as mock_ctx:
            from agentcore_context_middleware import AgentCoreContextMiddleware

            app = Starlette(routes=[Route("/test", lambda r: PlainTextResponse("ok"))])
            app.add_middleware(AgentCoreContextMiddleware)
            client = TestClient(app, raise_server_exceptions=True)

            client.get("/test", headers={"OAuth2CallbackUrl": "https://cb.example.com"})

            mock_ctx.set_oauth2_callback_url.assert_called_once_with("https://cb.example.com")

    def test_session_id_header_sets_request_context(self):
        with patch("agentcore_context_middleware.BedrockAgentCoreContext") as mock_ctx:
            from agentcore_context_middleware import AgentCoreContextMiddleware

            app = Starlette(routes=[Route("/test", lambda r: PlainTextResponse("ok"))])
            app.add_middleware(AgentCoreContextMiddleware)
            client = TestClient(app, raise_server_exceptions=True)

            client.get("/test", headers={
                "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": "session-42",
                "X-Amzn-Request-Id": "req-abc",
            })

            mock_ctx.set_request_context.assert_called_once_with(
                request_id="req-abc",
                session_id="session-42",
            )

    def test_missing_headers_do_not_call_setters(self):
        with patch("agentcore_context_middleware.BedrockAgentCoreContext") as mock_ctx:
            from agentcore_context_middleware import AgentCoreContextMiddleware

            app = Starlette(routes=[Route("/test", lambda r: PlainTextResponse("ok"))])
            app.add_middleware(AgentCoreContextMiddleware)
            client = TestClient(app, raise_server_exceptions=True)

            client.get("/test")

            mock_ctx.set_workload_access_token.assert_not_called()
            mock_ctx.set_oauth2_callback_url.assert_not_called()
            mock_ctx.set_request_context.assert_not_called()

    def test_request_id_defaults_to_empty_string_when_absent(self):
        with patch("agentcore_context_middleware.BedrockAgentCoreContext") as mock_ctx:
            from agentcore_context_middleware import AgentCoreContextMiddleware

            app = Starlette(routes=[Route("/test", lambda r: PlainTextResponse("ok"))])
            app.add_middleware(AgentCoreContextMiddleware)
            client = TestClient(app, raise_server_exceptions=True)

            client.get("/test", headers={
                "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": "sess-99",
            })

            mock_ctx.set_request_context.assert_called_once_with(
                request_id="",
                session_id="sess-99",
            )

    def test_response_passes_through_unchanged(self):
        with patch("agentcore_context_middleware.BedrockAgentCoreContext"):
            from agentcore_context_middleware import AgentCoreContextMiddleware

            app = Starlette(routes=[Route("/test", lambda r: PlainTextResponse("hello"))])
            app.add_middleware(AgentCoreContextMiddleware)
            client = TestClient(app)

            resp = client.get("/test")
            assert resp.status_code == 200
            assert resp.text == "hello"

    def test_all_headers_processed_in_single_request(self):
        with patch("agentcore_context_middleware.BedrockAgentCoreContext") as mock_ctx:
            from agentcore_context_middleware import AgentCoreContextMiddleware

            app = Starlette(routes=[Route("/test", lambda r: PlainTextResponse("ok"))])
            app.add_middleware(AgentCoreContextMiddleware)
            client = TestClient(app, raise_server_exceptions=True)

            client.get("/test", headers={
                "WorkloadAccessToken": "wlat-full",
                "OAuth2CallbackUrl": "https://cb.full.com",
                "X-Amzn-Bedrock-AgentCore-Runtime-Session-Id": "sess-full",
                "X-Amzn-Request-Id": "req-full",
            })

            mock_ctx.set_workload_access_token.assert_called_once_with("wlat-full")
            mock_ctx.set_oauth2_callback_url.assert_called_once_with("https://cb.full.com")
            mock_ctx.set_request_context.assert_called_once_with(
                request_id="req-full",
                session_id="sess-full",
            )
