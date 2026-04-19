"""Agent module.

- ChatAgent: base text-streaming agent (used as a superclass).
- SkillChatAgent: progressive skill disclosure (the default for text requests).
- VoiceAgent: Nova Sonic bidirectional audio.
"""

from agents.base import BaseAgent
from agents.chat_agent import ChatAgent
from agents.skill_chat_agent import SkillChatAgent
from agents.factory import create_agent

try:
    from agent.voice_agent import VoiceAgent
    _VOICE_AGENT_AVAILABLE = True
except ImportError:
    _VOICE_AGENT_AVAILABLE = False
    VoiceAgent = None

__all__ = [
    "BaseAgent",
    "ChatAgent",
    "SkillChatAgent",
    "create_agent",
]

if _VOICE_AGENT_AVAILABLE:
    __all__.append("VoiceAgent")
