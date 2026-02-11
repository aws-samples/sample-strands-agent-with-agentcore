"""Pydantic models for AgentCore Runtime API

This module defines the API contract between frontend and backend.
All models follow AgentCore Runtime standard format.
"""

from pydantic import BaseModel
from typing import Optional, List, Dict, Any


class FileContent(BaseModel):
    """File content (base64 encoded) for multimodal input

    Used for file uploads in chat messages.
    """
    filename: str
    content_type: str
    bytes: str  # Base64 encoded


class ApiKeys(BaseModel):
    """User API keys for external services

    These are user-specific keys that override default keys (from Secrets Manager).
    """
    tavily_api_key: Optional[str] = None
    google_api_key: Optional[str] = None
    google_search_engine_id: Optional[str] = None
    google_maps_api_key: Optional[str] = None


class InvocationInput(BaseModel):
    """Input for /invocations endpoint (AgentCore Runtime standard)

    This is the main request format used by the production frontend.
    """
    user_id: str
    session_id: str
    message: str = ""  # Optional for action-only requests (e.g., stop)
    action: Optional[str] = None  # Action type: None (default chat), "stop"
    model_id: Optional[str] = None
    temperature: Optional[float] = None
    system_prompt: Optional[str] = None
    caching_enabled: Optional[bool] = None
    enabled_tools: Optional[List[str]] = None  # User-specific tool preferences
    files: Optional[List[FileContent]] = None  # Multimodal file attachments
    compaction_enabled: Optional[bool] = None
    warmup: Optional[bool] = None
    request_type: Optional[str] = None  # Request type: "normal" (default), "swarm", "compose"
    selected_artifact_id: Optional[str] = None  # Currently selected artifact for tool context
    api_keys: Optional[Dict[str, str]] = None  # User-specific API keys for external services
    auth_token: Optional[str] = None  # Cognito JWT for MCP Runtime 3LO OAuth
    elicitation_id: Optional[str] = None  # MCP elicitation ID for OAuth completion signal


class InvocationRequest(BaseModel):
    """AgentCore Runtime standard request format

    Wraps InvocationInput in a standard envelope.
    """
    input: InvocationInput


class InvocationResponse(BaseModel):
    """AgentCore Runtime standard response format

    Response envelope for structured data (non-streaming).
    """
    output: Dict[str, Any]
