"""Swarm Event Schemas for SSE streaming

Defines Pydantic models for Swarm-related SSE events sent to the frontend.
"""

from typing import Any, Dict, List, Optional
from pydantic import BaseModel


class SwarmNodeStartEvent(BaseModel):
    """Event emitted when a Swarm node (agent) starts execution."""

    type: str = "swarm_node_start"
    node_id: str
    node_description: str


class SwarmNodeStopEvent(BaseModel):
    """Event emitted when a Swarm node (agent) completes execution."""

    type: str = "swarm_node_stop"
    node_id: str
    status: str  # "completed" | "failed" | "interrupted"


class SwarmHandoffEvent(BaseModel):
    """Event emitted when control is handed off between agents."""

    type: str = "swarm_handoff"
    from_node: str
    to_node: str
    message: Optional[str] = None
    context: Optional[Dict[str, Any]] = None  # shared_context from the handing-off agent


class SwarmCompleteEvent(BaseModel):
    """Event emitted when the entire Swarm execution completes."""

    type: str = "swarm_complete"
    total_nodes: int
    node_history: List[str]
    status: str  # "completed" | "failed" | "interrupted"
    # Fallback response when last agent is not responder (didn't stream to chat)
    final_response: Optional[str] = None
    final_node_id: Optional[str] = None  # Which agent generated the final response
