"""Pydantic models for Agent Core API"""

from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json

class FileContent(BaseModel):
    """File content (base64 encoded)"""
    filename: str
    content_type: str
    bytes: str  # Base64 encoded

class ChatRequest(BaseModel):
    """Chat request from BFF"""
    session_id: str
    message: str
    files: Optional[List[FileContent]] = None
    enabled_tools: Optional[List[str]] = None  # User-specific tool preferences (tool IDs)

class ChatEvent(BaseModel):
    """SSE event sent to BFF"""
    type: str  # "text" | "tool_use" | "tool_result" | "error" | "complete"
    content: str
    metadata: Optional[Dict[str, Any]] = None

    def to_json(self) -> str:
        """Convert to JSON string"""
        return json.dumps(self.model_dump(), ensure_ascii=False)

class SessionInfo(BaseModel):
    """Session information"""
    session_id: str
    message_count: int
    created_at: str
    updated_at: str
