"""
MCP Runtime Client for AgentCore Runtime (MCP Protocol)

Connects to AgentCore Runtimes that use MCP protocol (e.g., 3LO Gmail server).
Similar to Gateway MCP client but targets Runtime invocation URLs.
"""

import logging
import os
import boto3
from typing import Optional, List, Dict, Any
from urllib.parse import quote
from mcp.client.streamable_http import streamablehttp_client
from agent.gateway.mcp_client import FilteredMCPClient

logger = logging.getLogger(__name__)

# Build SSM parameter paths from environment (matches CDK stack output)
_PROJECT_NAME = os.environ.get("PROJECT_NAME", "strands-agent-chatbot")
_ENVIRONMENT = os.environ.get("ENVIRONMENT", "dev")

# MCP Runtime configurations: tool_prefix -> SSM parameter for Runtime ARN
# Gmail, Calendar, Notion, and GitHub all share the same 3LO MCP runtime server.
MCP_RUNTIME_CONFIGS: Dict[str, Dict[str, str]] = {
    "gmail": {
        "runtime_arn_ssm": f"/{_PROJECT_NAME}/{_ENVIRONMENT}/mcp/mcp-3lo-runtime-arn",
        "description": "MCP 3LO Server (Gmail/Calendar/Notion/GitHub)",
    },
    "github": {
        "runtime_arn_ssm": f"/{_PROJECT_NAME}/{_ENVIRONMENT}/mcp/mcp-3lo-runtime-arn",
        "description": "MCP 3LO Server (Gmail/Calendar/Notion/GitHub)",
    },
}

# SSM parameter for OAuth2 callback URL (required for 3LO flows)
OAUTH2_CALLBACK_URL_SSM = f"/{_PROJECT_NAME}/{_ENVIRONMENT}/mcp/oauth2-callback-url"

# Cache for OAuth2 callback URL
_oauth2_callback_url_cache: Optional[str] = None


def get_oauth2_callback_url(region: str = "us-west-2") -> Optional[str]:
    """Retrieve OAuth2 callback URL from SSM Parameter Store."""
    global _oauth2_callback_url_cache
    if _oauth2_callback_url_cache:
        return _oauth2_callback_url_cache

    try:
        ssm = boto3.client("ssm", region_name=region)
        response = ssm.get_parameter(Name=OAUTH2_CALLBACK_URL_SSM)
        url = response["Parameter"]["Value"]
        _oauth2_callback_url_cache = url
        logger.debug(f"OAuth2 callback URL from SSM: {url}")
        return url
    except Exception as e:
        logger.debug(f"Failed to get OAuth2 callback URL from SSM: {e}")
        return None

# Cache for Runtime ARNs
_runtime_arn_cache: Dict[str, str] = {}


def get_runtime_arn_from_ssm(
    ssm_param: str,
    region: str = "us-west-2",
) -> Optional[str]:
    """Retrieve and cache Runtime ARN from SSM Parameter Store."""
    if ssm_param in _runtime_arn_cache:
        return _runtime_arn_cache[ssm_param]

    try:
        ssm = boto3.client("ssm", region_name=region)
        response = ssm.get_parameter(Name=ssm_param)
        arn = response["Parameter"]["Value"]
        _runtime_arn_cache[ssm_param] = arn
        logger.debug(f"MCP Runtime ARN from SSM ({ssm_param}): {arn}")
        return arn
    except Exception as e:
        logger.debug(f"Failed to get MCP Runtime ARN from SSM ({ssm_param}): {e}")
        return None


def build_runtime_invocation_url(arn: str, region: str) -> str:
    """Build AgentCore Runtime invocation URL from ARN."""
    escaped_arn = quote(arn, safe="")
    return f"https://bedrock-agentcore.{region}.amazonaws.com/runtimes/{escaped_arn}/invocations?qualifier=DEFAULT"


def create_mcp_runtime_client(
    enabled_tool_ids: List[str],
    prefix: str = "mcp",
    region: Optional[str] = None,
    auth_token: Optional[str] = None,
    elicitation_bridge=None,
) -> Optional[FilteredMCPClient]:
    """
    Create MCP client for AgentCore Runtime (MCP protocol) with tool filtering.

    Discovers which MCP runtimes are needed based on enabled tool IDs,
    then creates a FilteredMCPClient connected to the runtime.

    Args:
        enabled_tool_ids: List of tool IDs enabled by user (e.g., ["mcp_search_emails"])
        prefix: Prefix for MCP runtime tools (default: "mcp")
        region: AWS region
        auth_token: Cognito JWT Bearer token for MCP Runtime inbound auth

    Returns:
        FilteredMCPClient or None if no MCP runtime tools enabled
    """
    mcp_tool_ids = [tid for tid in enabled_tool_ids if tid.startswith(f"{prefix}_")]
    if not mcp_tool_ids:
        logger.debug("No MCP runtime tools enabled")
        return None

    if not region:
        region = os.environ.get("AWS_REGION", "us-west-2")

    # Route by tool ID prefix (e.g. "mcp_github_*" → "github" config).
    # Fall back to "gmail" config since all current tools share one 3LO runtime.
    tool_prefix = next(
        (key for key in MCP_RUNTIME_CONFIGS if any(tid.startswith(f"{prefix}_{key}_") for tid in mcp_tool_ids)),
        "gmail",
    )
    config = MCP_RUNTIME_CONFIGS.get(tool_prefix)
    if not config:
        logger.warning(f"No MCP runtime config found for prefix '{tool_prefix}'")
        return None

    runtime_arn = get_runtime_arn_from_ssm(config["runtime_arn_ssm"], region)
    if not runtime_arn:
        logger.debug("MCP Runtime ARN not available. MCP runtime tools will not be loaded.")
        return None

    invocation_url = build_runtime_invocation_url(runtime_arn, region)
    logger.info(f"MCP Runtime invocation URL: {invocation_url}")

    # Build headers for MCP Runtime authentication
    headers: Dict[str, str] = {}

    if auth_token:
        # Use Cognito JWT Bearer token for inbound auth (required for 3LO user identity)
        # Strip "Bearer " prefix if present - streamablehttp_client adds it via the header
        token = auth_token.removeprefix("Bearer ").strip() if auth_token.startswith("Bearer ") else auth_token
        headers["Authorization"] = f"Bearer {token}"
        logger.info(f"MCP Runtime: JWT Bearer auth enabled (token length={len(token)})")
    else:
        logger.warning("MCP Runtime: No auth_token provided! JWT inbound auth will fail.")

    # Get OAuth2 callback URL for 3LO flows
    oauth2_callback_url = get_oauth2_callback_url(region)
    if oauth2_callback_url:
        headers["OAuth2CallbackUrl"] = oauth2_callback_url
        logger.info(f"MCP Runtime: OAuth2CallbackUrl set ({oauth2_callback_url[:50]}...)")
    else:
        logger.warning("MCP Runtime: No OAuth2CallbackUrl! 3LO OAuth flow will fail.")

    # Capture headers in closure to avoid late binding issues
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


# Environment variable control
MCP_RUNTIME_ENABLED = os.environ.get("MCP_RUNTIME_ENABLED", "true").lower() == "true"


def get_mcp_runtime_client_if_enabled(
    enabled_tool_ids: Optional[List[str]] = None,
    auth_token: Optional[str] = None,
    elicitation_bridge=None,
) -> Optional[FilteredMCPClient]:
    """
    Get MCP Runtime client if enabled via environment variable.

    Args:
        enabled_tool_ids: List of enabled tool IDs for filtering
        auth_token: Cognito JWT for MCP Runtime Bearer auth
        elicitation_bridge: OAuthElicitationBridge for MCP elicitation protocol

    Returns:
        FilteredMCPClient or None if disabled or no tools enabled
    """
    if not MCP_RUNTIME_ENABLED:
        logger.debug("MCP Runtime is disabled via MCP_RUNTIME_ENABLED=false")
        return None

    # MCP Runtime requires JWT auth for 3LO user identity.
    # Skip client creation when no auth_token (e.g., local dev without Cognito).
    if not auth_token:
        logger.info("MCP Runtime skipped: no auth_token provided (local dev or unauthenticated)")
        return None

    if enabled_tool_ids:
        return create_mcp_runtime_client(
            enabled_tool_ids, auth_token=auth_token, elicitation_bridge=elicitation_bridge
        )
    return None
