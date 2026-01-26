"""
Prompt Builder Module

Centralized system prompt construction for ChatbotAgent and VoiceChatbotAgent.
Handles dynamic tool guidance loading and prompt assembly.

This module provides:
- SystemContentBlock-based prompt construction for text mode (supports caching)
- String-based prompt construction for voice mode (BidiAgent compatibility)
- Tool guidance loading from local config or DynamoDB
"""

import logging
import os
import json
from datetime import datetime
from typing import List, Dict, Optional, TypedDict
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


# =============================================================================
# Type Definitions
# =============================================================================

class SystemContentBlock(TypedDict, total=False):
    """Content block for system prompt - can contain text or cache point."""
    text: str
    cachePoint: Dict[str, str]


# =============================================================================
# Constants - Base Prompts
# =============================================================================

BASE_TEXT_PROMPT = """You are an intelligent AI agent with dynamic tool capabilities. You can perform various tasks based on the combination of tools available to you.

Key guidelines:
- Use available tools when they genuinely enhance your response
- You can ONLY use tools that are explicitly provided to you
- Select the most appropriate tool for the task - avoid redundant tool calls
- If you don't have the right tool for a task, clearly inform the user

Your goal is to be helpful, accurate, and efficient."""

BASE_VOICE_PROMPT = """You are a voice assistant. Respond in 1-3 short sentences unless the user asks for detail. Use natural spoken language only - no markdown, lists, or code. When using tools, say briefly what you're doing."""


# =============================================================================
# Utility Functions
# =============================================================================

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


def _get_dynamodb_table_name() -> str:
    """Get the DynamoDB table name from environment or default"""
    project_name = os.environ.get('PROJECT_NAME', 'strands-chatbot')
    return f"{project_name}-users-v2"


def _is_tool_group_enabled(tool_group_id: str, tool_group: Dict, enabled_tools: List[str]) -> bool:
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


# =============================================================================
# Tool Guidance Loading
# =============================================================================

def load_tool_guidance(enabled_tools: Optional[List[str]]) -> List[str]:
    """
    Load tool-specific system prompt guidance based on enabled tools.

    - Local mode: Load from tools-config.json (required)
    - Cloud mode: Load from DynamoDB {PROJECT_NAME}-users-v2 table (required)

    Also loads shared guidance (e.g., citation instructions) when any tool
    with usesCitation=true is enabled.

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
    needs_citation = False  # Track if any citation-enabled tool is active
    shared_guidance = {}  # Store shared guidance for later use

    # Local mode: load from tools-config.json (required)
    if not is_cloud:
        config_path = Path(__file__).parent.parent.parent.parent / "frontend" / "src" / "config" / "tools-config.json"
        logger.debug(f"Loading tool guidance from local: {config_path}")

        if not config_path.exists():
            logger.error(f"TOOL CONFIG NOT FOUND: {config_path}")
            return []

        with open(config_path, 'r') as f:
            tools_config = json.load(f)

        # Load shared guidance
        shared_guidance = tools_config.get('shared_guidance', {})

        # Check all tool categories for systemPromptGuidance
        for category in ['local_tools', 'builtin_tools', 'browser_automation', 'gateway_targets', 'agentcore_runtime_a2a']:
            if category in tools_config:
                for tool_group in tools_config[category]:
                    tool_id = tool_group.get('id')

                    # Check if any enabled tool matches this group
                    if tool_id and _is_tool_group_enabled(tool_id, tool_group, enabled_tools):
                        guidance = tool_group.get('systemPromptGuidance')
                        if guidance:
                            guidance_sections.append(guidance)
                            logger.debug(f"Added guidance for tool group: {tool_id}")

                        # Check if this tool needs citation
                        if tool_group.get('usesCitation'):
                            needs_citation = True
                            logger.debug(f"Tool {tool_id} requires citation")

    # Cloud mode: load from DynamoDB (required)
    else:
        dynamodb_table = _get_dynamodb_table_name()
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

            # Load shared guidance
            shared_guidance = tool_registry.get('shared_guidance', {})

            # Check all tool categories
            for category in ['local_tools', 'builtin_tools', 'browser_automation', 'gateway_targets', 'agentcore_runtime_a2a']:
                if category in tool_registry:
                    for tool_group in tool_registry[category]:
                        tool_id = tool_group.get('id')

                        # Check if any enabled tool matches this group
                        if tool_id and _is_tool_group_enabled(tool_id, tool_group, enabled_tools):
                            guidance = tool_group.get('systemPromptGuidance')
                            if guidance:
                                guidance_sections.append(guidance)
                                logger.debug(f"Added guidance for tool group: {tool_id}")

                            # Check if this tool needs citation
                            if tool_group.get('usesCitation'):
                                needs_citation = True
                                logger.debug(f"Tool {tool_id} requires citation")

        except ClientError as e:
            logger.error(f"DynamoDB error loading tool guidance: {e}")
            return []

    # Add citation instructions if any citation-enabled tool is active
    if needs_citation and 'citation_instructions' in shared_guidance:
        guidance_sections.append(shared_guidance['citation_instructions'])
        logger.info("Added citation instructions (citation-enabled tool active)")
    elif needs_citation:
        logger.warning("Citation needed but citation_instructions not found in shared_guidance")

    logger.info(f"Loaded {len(guidance_sections)} tool guidance sections")
    return guidance_sections


# =============================================================================
# System Prompt Builders
# =============================================================================

def build_text_system_prompt(
    enabled_tools: Optional[List[str]] = None
) -> List[SystemContentBlock]:
    """
    Build system prompt for text mode as list of SystemContentBlock.

    Each section is a separate content block for:
    - Better tracking of each prompt section
    - Flexible cache point insertion
    - Modular prompt management

    Args:
        enabled_tools: List of enabled tool IDs (optional)

    Returns:
        List of SystemContentBlock for Strands Agent
    """
    system_prompt_blocks: List[SystemContentBlock] = []

    # Block 1: Base system prompt
    system_prompt_blocks.append({"text": BASE_TEXT_PROMPT})

    # Blocks 2-N: Tool-specific guidance (each tool guidance as separate block)
    tool_guidance_list = load_tool_guidance(enabled_tools)
    for i, guidance in enumerate(tool_guidance_list):
        system_prompt_blocks.append({"text": guidance})
        logger.debug(f"Added tool guidance block {i+1}: {guidance[:50]}...")

    # Final block: Current date
    current_date = get_current_date_pacific()
    system_prompt_blocks.append({"text": f"Current date: {current_date}"})

    # Log summary
    total_chars = sum(len(block.get("text", "")) for block in system_prompt_blocks)
    logger.debug(f"System prompt: {len(system_prompt_blocks)} content blocks "
                f"(1 base + {len(tool_guidance_list)} tool guidance + 1 date)")
    logger.debug(f"System prompt total length: {total_chars} characters")

    return system_prompt_blocks


def build_voice_system_prompt(enabled_tools: Optional[List[str]] = None) -> str:
    """
    Build system prompt for voice mode as a single string.

    BidiAgent (Nova Sonic) requires string system prompt, not content blocks.
    Voice prompts are optimized for concise spoken responses.

    Args:
        enabled_tools: List of enabled tool IDs (optional)

    Returns:
        Complete system prompt string for voice mode
    """
    # Build prompt sections
    prompt_sections = [BASE_VOICE_PROMPT]

    # Load tool guidance if tools are enabled
    tool_guidance = load_tool_guidance(enabled_tools) if enabled_tools else []

    if tool_guidance:
        # Add compact tool section
        tool_section = "Tools available:\n" + "\n\n".join(tool_guidance)
        prompt_sections.append(tool_section)

    # Add current date/time
    current_date = get_current_date_pacific()
    prompt_sections.append(f"Current date: {current_date}")

    return "\n\n".join(prompt_sections)


def system_prompt_to_string(system_prompt: List[SystemContentBlock]) -> str:
    """
    Convert system prompt content blocks to a single string.

    Useful for logging, API responses, or compatibility with string-based interfaces.

    Args:
        system_prompt: List of SystemContentBlock

    Returns:
        Concatenated string of all text blocks
    """
    if isinstance(system_prompt, str):
        return system_prompt
    elif isinstance(system_prompt, list):
        text_parts = [block.get("text", "") for block in system_prompt if "text" in block]
        return "\n\n".join(text_parts)
    return ""
