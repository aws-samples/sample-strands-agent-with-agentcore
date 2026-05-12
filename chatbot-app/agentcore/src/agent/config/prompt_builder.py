"""Prompt builder — base prompts + date stamps.

Historically this module also loaded per-tool `systemPromptGuidance` from
`tools-config.json` / DynamoDB. That lived-in-two-places knob has been folded
into each skill's SKILL.md, so the guidance-loading code is gone. SkillChatAgent
loads SKILL.md via progressive disclosure; ChatAgent (now only a superclass)
falls back to the base prompt + date.
"""

import logging
from datetime import datetime
from typing import List, Dict, TypedDict

# Import timezone support (zoneinfo for Python 3.9+, fallback to pytz)
try:
    from zoneinfo import ZoneInfo  # noqa: F401
    TIMEZONE_AVAILABLE = True
except ImportError:
    try:
        import pytz  # noqa: F401
        TIMEZONE_AVAILABLE = True
    except ImportError:
        TIMEZONE_AVAILABLE = False

logger = logging.getLogger(__name__)


class SystemContentBlock(TypedDict, total=False):
    """Content block for system prompt - text or cache point."""
    text: str
    cachePoint: Dict[str, str]


# =============================================================================
# Base Prompts
# =============================================================================

BASE_TEXT_PROMPT = """You are an intelligent AI agent with dynamic tool capabilities. You can perform various tasks based on the combination of tools available to you.

<tool_usage>
- Use available tools when they genuinely enhance your response
- You can ONLY use tools that are explicitly provided to you — available tools may change between turns within the same conversation, so always refer to the current set of tools
- Select the most appropriate tool for the task - avoid redundant tool calls
- If you don't have the right tool for a task, clearly inform the user
</tool_usage>

<communication_style>
- For casual, emotional, empathetic, or advice-driven conversations, keep your tone natural, warm, and empathetic
- In casual conversation or chit chat, respond in sentences or paragraphs - avoid using lists
- It's fine for casual responses to be short, just a few sentences long
- For reports, documents, technical documentation, and explanations, write in prose and paragraphs without bullet points or numbered lists - write lists in natural language like "some things include: x, y, and z"
- If you use bullet points, each should be at least 1-2 sentences long unless requested otherwise
- Give concise responses to simple questions, but provide thorough responses to complex and open-ended questions
- Tailor your response format to suit the conversation topic
- Avoid starting responses with flattery like "great question" or "excellent idea" - respond directly
- If you cannot or will not help with something, state what you can't or won't do at the start, keep it brief (1-2 sentences), and offer helpful alternatives if possible
</communication_style>

<response_approach>
- For every query, attempt to give a substantive answer using your knowledge or tools
- Infer user intent from context rather than asking clarifying questions. When users share content (screenshots, messages, documents) with a brief instruction, figure out what they need and act on it immediately
- If the user's intent is reasonably clear from context, just do it. Only ask for clarification when the request is genuinely ambiguous and you cannot make a reasonable assumption
- Provide direct answers while acknowledging uncertainty when needed
- Explain difficult concepts clearly with examples, thought experiments, or metaphors when helpful
- When asking questions, avoid overwhelming with more than one question per response
- If corrected, think through the issue carefully before acknowledging, as users sometimes make errors themselves
</response_approach>

Your goal is to be helpful, accurate, and efficient."""

BASE_VOICE_PROMPT = """You are a voice assistant.

<voice_style>
- Respond in 1-3 short sentences unless asked for detail
- Use natural spoken language only - no markdown, lists, or code
- Keep tone warm and conversational
- Avoid flattery - respond directly
- If you can't help, state it briefly and offer alternatives
</voice_style>

<tool_usage>
- Use tools when they enhance your response
- When using tools, say briefly what you're doing
- Only use tools explicitly provided to you
</tool_usage>"""


# =============================================================================
# Utilities
# =============================================================================

def get_current_date_pacific() -> str:
    """Get current date and hour in US Pacific timezone."""
    try:
        if TIMEZONE_AVAILABLE:
            try:
                from zoneinfo import ZoneInfo
                pacific_tz = ZoneInfo("America/Los_Angeles")
                now = datetime.now(pacific_tz)
                tz_abbr = now.strftime("%Z")
            except (ImportError, NameError):
                import pytz
                pacific_tz = pytz.timezone("America/Los_Angeles")
                now = datetime.now(pacific_tz)
                tz_abbr = now.strftime("%Z")
            return now.strftime(f"%Y-%m-%d (%A) %H:00 {tz_abbr}")
        now = datetime.utcnow()
        return now.strftime("%Y-%m-%d (%A) %H:00 UTC")
    except Exception as e:
        logger.warning(f"Failed to get Pacific time: {e}, using UTC")
        now = datetime.utcnow()
        return now.strftime("%Y-%m-%d (%A) %H:00 UTC")


# =============================================================================
# System Prompt Builders
# =============================================================================

def build_text_system_prompt() -> List[SystemContentBlock]:
    """Base + date for text mode."""
    current_date = get_current_date_pacific()
    return [
        {"text": BASE_TEXT_PROMPT},
        {"text": f"Current date: {current_date}"},
    ]


def build_voice_system_prompt() -> str:
    """Voice system prompt as a single string (Nova Sonic BidiAgent)."""
    current_date = get_current_date_pacific()
    return f"{BASE_VOICE_PROMPT}\n\nCurrent date: {current_date}"


def system_prompt_to_string(system_prompt: List[SystemContentBlock]) -> str:
    """Concatenate content blocks into a plain string."""
    parts = []
    for block in system_prompt or []:
        text = block.get("text") if isinstance(block, dict) else None
        if text:
            parts.append(text)
    return "\n\n".join(parts)
