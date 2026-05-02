"""
MCP Runtime Client for AgentCore Runtime (MCP Protocol)

Connects to AgentCore Runtimes that use MCP protocol (e.g., 3LO Gmail server).
Endpoint discovery via AgentCore Registry.
"""

import logging
import os
from typing import Optional, List, Dict

from mcp.client.streamable_http import streamablehttp_client
from agent.gateway.mcp_client import FilteredMCPClient

logger = logging.getLogger(__name__)


def _get_mcp_runtime_url() -> Optional[str]:
    from registry.client import get_registry_client

    client = get_registry_client()
    if not client:
        return None
    return client.get_mcp_runtime_url()


def _get_oauth2_callback_url() -> Optional[str]:
    project_name = os.environ.get("PROJECT_NAME", "strands-agent-chatbot")
    environment = os.environ.get("ENVIRONMENT", "dev")
    region = os.environ.get("AWS_REGION", "us-west-2")

    try:
        import boto3
        ssm = boto3.client("ssm", region_name=region)
        response = ssm.get_parameter(
            Name=f"/{project_name}/{environment}/mcp/oauth2-callback-url"
        )
        return response["Parameter"]["Value"]
    except Exception as e:
        logger.debug(f"Failed to get OAuth2 callback URL from SSM: {e}")
        return None


_oauth2_callback_url_cache: Optional[str] = None


def get_oauth2_callback_url() -> Optional[str]:
    global _oauth2_callback_url_cache
    if _oauth2_callback_url_cache:
        return _oauth2_callback_url_cache
    _oauth2_callback_url_cache = _get_oauth2_callback_url()
    return _oauth2_callback_url_cache


def create_mcp_runtime_client(
    enabled_tool_ids: List[str],
    prefix: str = "mcp",
    auth_token: Optional[str] = None,
    elicitation_bridge=None,
) -> Optional[FilteredMCPClient]:
    mcp_tool_ids = [tid for tid in enabled_tool_ids if tid.startswith(f"{prefix}_")]
    if not mcp_tool_ids:
        logger.debug("No MCP runtime tools enabled")
        return None

    invocation_url = _get_mcp_runtime_url()
    if not invocation_url:
        logger.debug("MCP Runtime URL not available from Registry.")
        return None

    logger.info(f"MCP Runtime invocation URL: {invocation_url}")

    headers: Dict[str, str] = {}

    if auth_token:
        token = auth_token.removeprefix("Bearer ").strip() if auth_token.startswith("Bearer ") else auth_token
        headers["Authorization"] = f"Bearer {token}"
        logger.info(f"MCP Runtime: JWT Bearer auth enabled (token length={len(token)})")
    else:
        logger.warning("MCP Runtime: No auth_token provided! JWT inbound auth will fail.")

    oauth2_callback_url = get_oauth2_callback_url()
    if oauth2_callback_url:
        headers["OAuth2CallbackUrl"] = oauth2_callback_url
        logger.info(f"MCP Runtime: OAuth2CallbackUrl set ({oauth2_callback_url[:50]}...)")
    else:
        logger.warning("MCP Runtime: No OAuth2CallbackUrl! 3LO OAuth flow will fail.")

    captured_headers = dict(headers)
    captured_url = invocation_url

    client = FilteredMCPClient(
        lambda: streamablehttp_client(captured_url, headers=captured_headers),
        enabled_tool_ids=mcp_tool_ids,
        prefix=prefix,
        elicitation_callback=elicitation_bridge.elicitation_callback if elicitation_bridge else None,
    )

    logger.info(f"MCP Runtime client created: {invocation_url}")
    return client


MCP_RUNTIME_ENABLED = os.environ.get("MCP_RUNTIME_ENABLED", "true").lower() == "true"


def get_mcp_runtime_client_if_enabled(
    enabled_tool_ids: Optional[List[str]] = None,
    auth_token: Optional[str] = None,
    elicitation_bridge=None,
) -> Optional[FilteredMCPClient]:
    if not MCP_RUNTIME_ENABLED:
        logger.debug("MCP Runtime is disabled via MCP_RUNTIME_ENABLED=false")
        return None

    if not auth_token:
        logger.info("MCP Runtime skipped: no auth_token provided")
        return None

    if enabled_tool_ids:
        return create_mcp_runtime_client(
            enabled_tool_ids, auth_token=auth_token, elicitation_bridge=elicitation_bridge
        )
    return None
