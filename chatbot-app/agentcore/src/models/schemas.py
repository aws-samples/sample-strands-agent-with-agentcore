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


class InvocationInput(BaseModel):
    """Input for /invocations endpoint (AgentCore Runtime standard)

    This is the main request format used by the production frontend.
    """
    user_id: str
    session_id: str
    message: str
    model_id: Optional[str] = None
    temperature: Optional[float] = None
    system_prompt: Optional[str] = None
    caching_enabled: Optional[bool] = None
    enabled_tools: Optional[List[str]] = None  # User-specific tool preferences
    files: Optional[List[FileContent]] = None  # Multimodal file attachments


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
