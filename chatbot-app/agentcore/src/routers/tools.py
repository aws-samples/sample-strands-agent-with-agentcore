"""
Tools API Router

Provides tool listing and configuration endpoint for frontend.
Combines local_tools, builtin_tools, gateway_targets, and agentcore_runtime_a2a tools.
"""

from fastapi import APIRouter, Depends
from typing import Dict, Any, List
import logging
import json
from pathlib import Path

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["tools"])


def load_tools_config() -> Dict[str, Any]:
    """Load tools configuration from tools-config.json"""
    try:
        # Path to tools config: routers/tools.py -> src -> agentcore -> chatbot-app -> frontend
        # __file__ is: /path/to/chatbot-app/agentcore/src/routers/tools.py
        # parent: routers -> src -> agentcore -> chatbot-app
        config_path = Path(__file__).parent.parent.parent.parent / "frontend" / "src" / "config" / "tools-config.json"

        if not config_path.exists():
            logger.warning(f"Tools config not found at {config_path}")
            return {
                "local_tools": [],
                "builtin_tools": [],
                "gateway_targets": [],
                "agentcore_runtime_a2a": []
            }

        with open(config_path, 'r') as f:
            config = json.load(f)
            logger.debug(f" Loaded tools config from {config_path}")
            logger.info(f"   - local_tools: {len(config.get('local_tools', []))}")
            logger.info(f"   - builtin_tools: {len(config.get('builtin_tools', []))}")
            logger.info(f"   - gateway_targets: {len(config.get('gateway_targets', []))}")
            logger.info(f"   - agentcore_runtime_a2a: {len(config.get('agentcore_runtime_a2a', []))}")
            return config

    except Exception as e:
        logger.error(f"Failed to load tools config: {e}")
        import traceback
        logger.error(traceback.format_exc())
        return {
            "local_tools": [],
            "builtin_tools": [],
            "gateway_targets": [],
            "agentcore_runtime_a2a": []
        }


@router.get("/tools")
async def get_tools() -> Dict[str, Any]:
    """
    Get all available tools (local, builtin, gateway, agentcore runtime).

    Returns:
        {
            "tools": [...],  // Combined list of all tools
            "mcp_servers": []  // Empty for backward compatibility
        }
    """
    try:
        config = load_tools_config()

        # Combine all tool categories
        all_tools = []

        # Add local tools
        all_tools.extend(config.get("local_tools", []))

        # Add builtin tools (Code Interpreter, Browser, etc.)
        all_tools.extend(config.get("builtin_tools", []))

        # Add gateway targets (MCP via Gateway)
        all_tools.extend(config.get("gateway_targets", []))

        # Add agentcore runtime A2A tools (A2A agents)
        all_tools.extend(config.get("agentcore_runtime_a2a", []))

        logger.info(f"Tools API: Returning {len(all_tools)} tools")
        logger.debug(f"  - local_tools: {len(config.get('local_tools', []))}")
        logger.debug(f"  - builtin_tools: {len(config.get('builtin_tools', []))}")
        logger.debug(f"  - gateway_targets: {len(config.get('gateway_targets', []))}")
        logger.debug(f"  - agentcore_runtime_a2a: {len(config.get('agentcore_runtime_a2a', []))}")

        return {
            "tools": all_tools,
            "mcp_servers": []  # Empty for backward compatibility
        }

    except Exception as e:
        logger.error(f"Failed to get tools: {e}")
        return {
            "tools": [],
            "mcp_servers": []
        }
