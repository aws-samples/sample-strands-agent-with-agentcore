"""Pydantic models for AgentCore Runtime API

This module defines the API contract between frontend and backend.
All models follow AgentCore Runtime standard format.
"""

from pydantic import BaseModel
from typing import Optional


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


