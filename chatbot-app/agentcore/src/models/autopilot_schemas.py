"""Autopilot Mode Schemas - Application-Level Orchestration

This module defines the protocol for Autopilot mode where:
- Mission Control: Strategic planner (local LLM call) that issues Directives
- ChatbotAgent: Executes directives with focused tool sets

Both components run locally. The application (chat.py) orchestrates the loop.
"""

from pydantic import BaseModel, Field
from typing import Optional, List, Literal
from uuid import uuid4


# ============================================================
# Tool Groups (for Mission Control's catalog)
# ============================================================

class ToolGroup(BaseModel):
    """Tool group information for Mission Control's catalog

    Mission Control receives group-level descriptions, not individual tool details.
    This reduces context size while providing enough info for planning.
    """
    id: str = Field(..., description="Tool group identifier")
    name: str = Field(..., description="Human-readable group name")
    tools: List[str] = Field(..., description="List of tool IDs in this group")
    capabilities: str = Field(..., description="Brief description of capabilities")


# ============================================================
# Mission Control → Application
# ============================================================

class Directive(BaseModel):
    """Mission Control's instruction for a single step

    A focused sub-task with specific tools and clear expectations.
    Adaptive planning: no total_steps_estimate, just the current step.
    """
    directive_id: str = Field(default_factory=lambda: str(uuid4()))
    step: int = Field(..., description="Current step number (1-indexed)")
    prompt: str = Field(..., description="Clear instruction for this step (2-3 sentences)")
    tools: List[str] = Field(..., description="Tool IDs to enable for this step")
    expected_output: str = Field(..., description="What success looks like (1 sentence)")
    context_summary: Optional[str] = Field(
        default=None,
        description="Key findings from previous steps"
    )


class MissionComplete(BaseModel):
    """Signal that mission is complete (or no tools needed)"""
    mission_id: str
    total_steps: int


# ============================================================
# Application → Mission Control
# ============================================================

class ToolCall(BaseModel):
    """Record of a tool invocation"""
    name: str = Field(..., description="Tool name")
    input_summary: str = Field(..., description="Truncated input parameters")


class ProgressReport(BaseModel):
    """Report after executing a directive"""
    directive_id: str = Field(..., description="ID of executed directive")
    tool_calls: List[ToolCall] = Field(default_factory=list, description="Tools invoked during execution")
    response_text: str = Field(default="", description="Agent's text response")


# ============================================================
# SSE Events for Frontend
# ============================================================

class MissionProgressEvent(BaseModel):
    """SSE event for mission progress updates (adaptive, no total estimate)"""
    type: Literal["mission_progress"] = "mission_progress"
    step: int
    directive_prompt: str
    active_tools: List[str]


class MissionCompleteEvent(BaseModel):
    """SSE event when mission completes"""
    type: Literal["mission_complete"] = "mission_complete"
    total_steps: int


# ============================================================
# Mission Control Response (union type)
# ============================================================

class MissionControlResponse(BaseModel):
    """Wrapper for Mission Control's response (either Directive or MissionComplete)"""
    response_type: Literal["directive", "mission_complete"]
    directive: Optional[Directive] = None
    mission_complete: Optional[MissionComplete] = None
