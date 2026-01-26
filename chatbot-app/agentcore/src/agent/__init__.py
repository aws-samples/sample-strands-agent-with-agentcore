"""Agent module - Refactored Structure

Submodules:
    - config/: Constants, prompts, swarm configuration
    - factory/: Session manager and agent factories
    - gateway/: MCP client and SigV4 authentication
    - processor/: File and multimodal content processing
    - session/: Session managers and message stores
    - hooks/: Agent lifecycle hooks

Usage:
    from agent.agent import ChatbotAgent, get_global_stream_processor
    from agent.voice_agent import VoiceChatbotAgent
    from agent.swarm_agents import create_chatbot_swarm
    from agent.stop_signal import get_stop_signal_provider

    from agent.config.constants import DEFAULT_AGENT_ID
    from agent.config.prompt_builder import build_text_system_prompt
    from agent.session.compacting_session_manager import CompactingSessionManager
    from agent.gateway.mcp_client import get_gateway_client_if_enabled
"""
