"""
Agent module - Unified agent architecture

All agents inherit from BaseAgent and provide consistent interface:
- ChatAgent: Text-based conversation with streaming
- SwarmAgent: Multi-agent orchestration with specialist agents
- VoiceAgent: Bidirectional audio streaming (Nova Sonic)
"""

from agents.base import BaseAgent
from agents.chat_agent import ChatAgent
from agents.swarm_agent import SwarmAgent
from agents.factory import create_agent, get_agent_type_description

# VoiceAgent is in agent.voice_agent module (separate due to different imports)
# Import it here for consistency
try:
    from agent.voice_agent import VoiceAgent
    _VOICE_AGENT_AVAILABLE = True
except ImportError:
    _VOICE_AGENT_AVAILABLE = False
    VoiceAgent = None

__all__ = [
    "BaseAgent",
    "ChatAgent",
    "SwarmAgent",
    "create_agent",
    "get_agent_type_description",
]

if _VOICE_AGENT_AVAILABLE:
    __all__.append("VoiceAgent")
