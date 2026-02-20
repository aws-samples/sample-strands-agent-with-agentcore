#!/usr/bin/env python3
"""
MCP Server with AgentCore Identity 3LO Integration

Main entry point that registers Gmail, Calendar, and Notion tools to a single FastMCP instance.
- Google services (Gmail, Calendar) use google-oauth-provider
- Notion uses notion-oauth-provider

Runs as a FastMCP server on AgentCore Runtime.
"""
import os
import sys
import asyncio
import logging
import uvicorn
from mcp.server.fastmcp import FastMCP
from starlette.responses import JSONResponse
from starlette.routing import Route

from agentcore_context_middleware import AgentCoreContextMiddleware
from gmail_tools import register_gmail_tools
from calendar_tools import register_calendar_tools
from notion_tools import register_notion_tools
from github_tools import register_github_tools

# Setup logger
logger = logging.getLogger(__name__)

# Set UTF-8 encoding for stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='ignore')
elif hasattr(sys.stdout, 'buffer'):
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'ignore')


# ── FastMCP Server ─────────────────────────────────────────────────────

mcp = FastMCP(host="0.0.0.0", port=8000, stateless_http=True)

# Register Gmail tools (10 tools)
register_gmail_tools(mcp)

# Register Calendar tools (8 tools)
register_calendar_tools(mcp)

# Register Notion tools (8 tools)
register_notion_tools(mcp)

# Register GitHub tools (11 tools)
register_github_tools(mcp)


# ── Entrypoint ─────────────────────────────────────────────────────


class PingRequestFilter(logging.Filter):
    """Filter out noisy PingRequest and session termination logs."""

    def filter(self, record):
        msg = record.getMessage()
        if "PingRequest" in msg or "Terminating session" in msg:
            return False
        return True


async def main():
    # Set logging level
    log_level = os.environ.get("LOG_LEVEL", "INFO").upper()
    logging.basicConfig(
        level=getattr(logging, log_level, logging.INFO),
        format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
    )

    # Set our logger to always show warnings
    logger.setLevel(logging.WARNING)

    # Add filter to suppress PingRequest noise
    ping_filter = PingRequestFilter()
    logging.getLogger().addFilter(ping_filter)
    logging.getLogger("mcp").addFilter(ping_filter)
    logging.getLogger("mcp.server").addFilter(ping_filter)

    # Enable debug logging for AgentCore Identity to see OAuth token flow
    logging.getLogger("bedrock_agentcore").setLevel(logging.DEBUG)
    logging.getLogger("bedrock_agentcore.identity").setLevel(logging.DEBUG)

    if log_level == "WARNING":
        logging.getLogger("mcp").setLevel(logging.WARNING)
        logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

    logger.warning("MCP Server (Gmail + Calendar + Notion + GitHub) with 3LO starting...")
    logger.warning("[Tools] Gmail: list_labels, list_emails, search_emails, read_email, send_email, draft_email, delete_email, bulk_delete_emails, modify_email, get_email_thread")
    logger.warning("[Tools] Calendar: list_calendars, list_events, get_event, create_event, update_event, delete_event, quick_add_event, check_availability")
    logger.warning("[Tools] Notion: notion_search, notion_list_databases, notion_query_database, notion_get_page, notion_create_page, notion_update_page, notion_get_block_children, notion_append_blocks")
    logger.warning("[Tools] GitHub: github_search_repos, github_get_repo, github_list_issues, github_get_issue, github_list_pulls, github_get_pull, github_get_file, github_search_code, github_create_branch, github_push_files, github_create_pull_request")

    # Build Starlette app from FastMCP with health check
    app = mcp.streamable_http_app()
    app.routes.insert(0, Route("/ping", lambda r: JSONResponse({"status": "ok"}), methods=["GET"]))

    # Add AgentCore context middleware to extract WorkloadAccessToken from headers
    # This is REQUIRED for OAuth token retrieval to work on AgentCore Runtime
    app.add_middleware(AgentCoreContextMiddleware)

    config = uvicorn.Config(app, host="0.0.0.0", port=8000, log_level="warning")
    server = uvicorn.Server(config)
    await server.serve()


if __name__ == "__main__":
    asyncio.run(main())
