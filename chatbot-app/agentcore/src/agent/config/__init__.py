"""Configuration module for prompts, constants, and agent settings."""

from agent.config.constants import (
    DEFAULT_AGENT_ID,
    VOICE_AGENT_ID,
    SWARM_AGENT_ID,
    GATEWAY_PREFIX,
    A2A_PREFIX,
    DEFAULT_MODEL_ID,
    DEFAULT_TEMPERATURE,
    DEFAULT_AWS_REGION,
)
from agent.config.prompt_builder import (
    build_text_system_prompt,
    build_voice_system_prompt,
    system_prompt_to_string,
    load_tool_guidance,
    get_current_date_pacific,
    SystemContentBlock,
)

__all__ = [
    # Constants
    "DEFAULT_AGENT_ID",
    "VOICE_AGENT_ID",
    "SWARM_AGENT_ID",
    "GATEWAY_PREFIX",
    "A2A_PREFIX",
    "DEFAULT_MODEL_ID",
    "DEFAULT_TEMPERATURE",
    "DEFAULT_AWS_REGION",
    # Prompt builder
    "build_text_system_prompt",
    "build_voice_system_prompt",
    "system_prompt_to_string",
    "load_tool_guidance",
    "get_current_date_pacific",
    "SystemContentBlock",
]
