"""Gateway module for MCP client and authentication."""

from agent.gateway.mcp_client import (
    FilteredMCPClient,
    create_gateway_mcp_client,
    create_filtered_gateway_client,
    get_gateway_client_if_enabled,
    get_gateway_url_from_ssm,
)
from agent.gateway.sigv4_auth import (
    SigV4HTTPXAuth,
    get_sigv4_auth,
    get_gateway_region_from_url,
)

__all__ = [
    # MCP client
    "FilteredMCPClient",
    "create_gateway_mcp_client",
    "create_filtered_gateway_client",
    "get_gateway_client_if_enabled",
    "get_gateway_url_from_ssm",
    # Auth
    "SigV4HTTPXAuth",
    "get_sigv4_auth",
    "get_gateway_region_from_url",
]
