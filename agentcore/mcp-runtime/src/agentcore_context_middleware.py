"""
AgentCore Context Middleware for FastMCP Servers

Bridges AgentCore Runtime request headers into BedrockAgentCoreContext.
Required when using FastMCP on AgentCore Runtime, since FastMCP does not
process AgentCore headers automatically (unlike BedrockAgentCoreApp).

Usage:
    from agentcore_context_middleware import AgentCoreContextMiddleware

    mcp = FastMCP()
    # ... define tools ...

    app = mcp.streamable_http_app()
    app.add_middleware(AgentCoreContextMiddleware)
"""

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from bedrock_agentcore.runtime import BedrockAgentCoreContext


class AgentCoreContextMiddleware(BaseHTTPMiddleware):
    """Bridges AgentCore Runtime request headers into BedrockAgentCoreContext.

    AgentCore Runtime sends these headers on every invocation:
      - WorkloadAccessToken: per-user identity token
      - OAuth2CallbackUrl: OAuth redirect URL for 3LO flows
      - X-Amzn-Bedrock-AgentCore-Runtime-Session-Id: session ID

    BedrockAgentCoreApp (FastAPI) handles this automatically, but FastMCP does not.
    This middleware fills that gap.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        token = request.headers.get("WorkloadAccessToken")
        if token:
            BedrockAgentCoreContext.set_workload_access_token(token)

        callback_url = request.headers.get("OAuth2CallbackUrl")
        if callback_url:
            BedrockAgentCoreContext.set_oauth2_callback_url(callback_url)

        session_id = request.headers.get("X-Amzn-Bedrock-AgentCore-Runtime-Session-Id")
        if session_id:
            BedrockAgentCoreContext.set_request_context(
                request_id=request.headers.get("X-Amzn-Request-Id", ""),
                session_id=session_id,
            )

        return await call_next(request)
