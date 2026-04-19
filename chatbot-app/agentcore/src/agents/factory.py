"""Agent factory — only skill mode (text) and voice mode remain."""

import logging
from typing import Optional, List

from agents.base import BaseAgent
from agents.skill_chat_agent import SkillChatAgent

logger = logging.getLogger(__name__)


def create_agent(
    request_type: Optional[str],
    session_id: str,
    user_id: Optional[str] = None,
    enabled_skills: Optional[List[str]] = None,
    model_id: Optional[str] = None,
    temperature: Optional[float] = None,
    system_prompt: Optional[str] = None,
    caching_enabled: Optional[bool] = None,
    compaction_enabled: Optional[bool] = None,
    api_keys: Optional[dict] = None,
    auth_token: Optional[str] = None,
    **kwargs,
) -> BaseAgent:
    """Create an agent.

    request_type:
      - "skill" (default) — SkillChatAgent with progressive skill disclosure.
      - "voice"           — VoiceAgent with Nova Sonic bidirectional audio.

    enabled_skills:
      Optional whitelist of skill names. None = all discovered skills.
      Used by both agents as an allow-list filter over Registry skills.
    """
    request_type = request_type or "skill"

    logger.debug(
        f"[AgentFactory] type={request_type}, session={session_id}, user={user_id or session_id}"
    )

    if request_type == "skill":
        return SkillChatAgent(
            session_id=session_id,
            user_id=user_id,
            enabled_skills=enabled_skills,
            model_id=model_id,
            temperature=temperature,
            system_prompt=system_prompt,
            caching_enabled=caching_enabled,
            compaction_enabled=compaction_enabled,
            api_keys=api_keys,
            auth_token=auth_token,
        )

    if request_type == "voice":
        from agent.voice_agent import VoiceAgent

        # Voice mode is hardcoded to web-search tools: Nova Sonic's tool call
        # surface is narrow and only these are reliably useful in conversation.
        voice_tools = [
            "gateway_ddg_web_search",
            "gateway_fetch_url_content",
        ]
        return VoiceAgent(
            session_id=session_id,
            user_id=user_id,
            enabled_tools=voice_tools,
            system_prompt=system_prompt,
            auth_token=auth_token,
            api_keys=api_keys,
        )

    raise ValueError(
        f"Unknown request_type: {request_type}. Valid: skill, voice"
    )
