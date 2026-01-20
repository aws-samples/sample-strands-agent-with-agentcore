"""
Tool Guidance Module

Shared utility for loading tool-specific system prompt guidance.
Used by both ChatbotAgent and VoiceChatbotAgent to maintain consistency.
"""

import logging
import os
import json
from datetime import datetime
from typing import List, Dict, Optional
from pathlib import Path

# Import timezone support (zoneinfo for Python 3.9+, fallback to pytz)
try:
    from zoneinfo import ZoneInfo
    TIMEZONE_AVAILABLE = True
except ImportError:
    try:
        import pytz
        TIMEZONE_AVAILABLE = True
    except ImportError:
        TIMEZONE_AVAILABLE = False

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


def get_current_date_pacific() -> str:
    """Get current date and hour in US Pacific timezone (America/Los_Angeles)"""
    try:
        if TIMEZONE_AVAILABLE:
            try:
                # Try zoneinfo first (Python 3.9+)
                from zoneinfo import ZoneInfo
                pacific_tz = ZoneInfo("America/Los_Angeles")
                now = datetime.now(pacific_tz)
                tz_abbr = now.strftime("%Z")
            except (ImportError, NameError):
                # Fallback to pytz
                import pytz
                pacific_tz = pytz.timezone("America/Los_Angeles")
                now = datetime.now(pacific_tz)
                tz_abbr = now.strftime("%Z")

            return now.strftime(f"%Y-%m-%d (%A) %H:00 {tz_abbr}")
        else:
            # Fallback to UTC if no timezone library available
            now = datetime.utcnow()
            return now.strftime("%Y-%m-%d (%A) %H:00 UTC")
    except Exception as e:
        logger.warning(f"Failed to get Pacific time: {e}, using UTC")
        now = datetime.utcnow()
        return now.strftime("%Y-%m-%d (%A) %H:00 UTC")


def get_dynamodb_table_name() -> str:
    """Get the DynamoDB table name from environment or default"""
    project_name = os.environ.get('PROJECT_NAME', 'strands-chatbot')
    return f"{project_name}-users-v2"


def is_tool_group_enabled(tool_group_id: str, tool_group: Dict, enabled_tools: List[str]) -> bool:
    """
    Check if a tool group is enabled based on enabled_tools list.

    For dynamic tool groups (isDynamic=true), checks if any sub-tool is enabled.
    For static tool groups, checks if the group ID itself is enabled.
    """
    if not enabled_tools:
        return False

    # Check if group ID itself is in enabled tools
    if tool_group_id in enabled_tools:
        return True

    # For dynamic tool groups, check if any sub-tool is enabled
    if tool_group.get('isDynamic') and 'tools' in tool_group:
        for sub_tool in tool_group['tools']:
            if sub_tool.get('id') in enabled_tools:
                return True

    return False


def load_tool_guidance(enabled_tools: Optional[List[str]]) -> List[str]:
    """
    Load tool-specific system prompt guidance based on enabled tools.

    - Local mode: Load from tools-config.json (required)
    - Cloud mode: Load from DynamoDB {PROJECT_NAME}-users-v2 table (required)

    Args:
        enabled_tools: List of enabled tool IDs

    Returns:
        List of guidance strings for each enabled tool group
    """
    if not enabled_tools or len(enabled_tools) == 0:
        return []

    # Get environment variables
    aws_region = os.environ.get('AWS_REGION', 'us-west-2')
    # Determine mode by MEMORY_ID presence (consistent with agent.py)
    memory_id = os.environ.get('MEMORY_ID')
    is_cloud = memory_id is not None

    guidance_sections = []

    # Local mode: load from tools-config.json (required)
    if not is_cloud:
        config_path = Path(__file__).parent.parent.parent.parent / "frontend" / "src" / "config" / "tools-config.json"
        logger.debug(f"Loading tool guidance from local: {config_path}")

        if not config_path.exists():
            logger.error(f"TOOL CONFIG NOT FOUND: {config_path}")
            return []

        with open(config_path, 'r') as f:
            tools_config = json.load(f)

        # Check all tool categories for systemPromptGuidance
        for category in ['local_tools', 'builtin_tools', 'browser_automation', 'gateway_targets', 'agentcore_runtime_a2a']:
            if category in tools_config:
                for tool_group in tools_config[category]:
                    tool_id = tool_group.get('id')

                    # Check if any enabled tool matches this group
                    if tool_id and is_tool_group_enabled(tool_id, tool_group, enabled_tools):
                        guidance = tool_group.get('systemPromptGuidance')
                        if guidance:
                            guidance_sections.append(guidance)
                            logger.debug(f"Added guidance for tool group: {tool_id}")

    # Cloud mode: load from DynamoDB (required)
    else:
        dynamodb_table = get_dynamodb_table_name()
        logger.debug(f"Loading tool guidance from DynamoDB table: {dynamodb_table}")

        dynamodb = boto3.resource('dynamodb', region_name=aws_region)
        table = dynamodb.Table(dynamodb_table)

        try:
            # Load tool registry from DynamoDB (userId='TOOL_REGISTRY', sk='CONFIG')
            response = table.get_item(Key={'userId': 'TOOL_REGISTRY', 'sk': 'CONFIG'})

            if 'Item' not in response:
                logger.error(f"TOOL_REGISTRY NOT FOUND in DynamoDB table: {dynamodb_table}")
                return []

            if 'toolRegistry' not in response['Item']:
                logger.error(f"toolRegistry field NOT FOUND in TOOL_REGISTRY record")
                return []

            tool_registry = response['Item']['toolRegistry']
            logger.debug(f"Loaded tool registry from DynamoDB: {dynamodb_table}")

            # Check all tool categories
            for category in ['local_tools', 'builtin_tools', 'browser_automation', 'gateway_targets', 'agentcore_runtime_a2a']:
                if category in tool_registry:
                    for tool_group in tool_registry[category]:
                        tool_id = tool_group.get('id')

                        # Check if any enabled tool matches this group
                        if tool_id and is_tool_group_enabled(tool_id, tool_group, enabled_tools):
                            guidance = tool_group.get('systemPromptGuidance')
                            if guidance:
                                guidance_sections.append(guidance)
                                logger.debug(f"Added guidance for tool group: {tool_id}")

        except ClientError as e:
            logger.error(f"DynamoDB error loading tool guidance: {e}")
            return []

    logger.info(f"Loaded {len(guidance_sections)} tool guidance sections")
    return guidance_sections


def build_voice_system_prompt(enabled_tools: Optional[List[str]] = None) -> str:
    """
    Build system prompt optimized for voice interaction.

    Combines voice-specific guidelines with tool guidance (if tools are enabled).

    Args:
        enabled_tools: List of enabled tool IDs (optional)

    Returns:
        Complete system prompt for voice mode
    """
    # Base voice prompt - optimized for concise spoken responses
    base_prompt = """You are a voice assistant. Respond in 1-3 short sentences unless the user asks for detail. Use natural spoken language only - no markdown, lists, or code. When using tools, say briefly what you're doing."""

    # Build prompt sections
    prompt_sections = [base_prompt]

    # Load tool guidance if tools are enabled
    tool_guidance = load_tool_guidance(enabled_tools) if enabled_tools else []

    if tool_guidance:
        # Add compact tool section
        tool_section = "Tools available:\n" + "\n\n".join(tool_guidance)
        prompt_sections.append(tool_section)

    # Add current date/time (same as text agent)
    current_date = get_current_date_pacific()
    prompt_sections.append(f"Current date: {current_date}")

    return "\n\n".join(prompt_sections)
