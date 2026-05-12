"""Composer Workflow Schemas - 6-Task Document Writing Workflow

This module defines schemas for the Composer workflow:
1. Intake - Extract requirements from user request
2. Outline - Generate document outline
3. Confirm - Get user confirmation on outline (with interrupt)
4. Body Write - Write each section (loop)
5. Intro/Outro - Write introduction and conclusion
6. Review - Final review and polish

State is persisted in DynamoDB under 'writingWorkflow' key.
"""

from enum import Enum
from pydantic import BaseModel, Field
from typing import Optional, List, Literal, Dict, Any
from uuid import uuid4


# ============================================================
# Status Enums
# ============================================================

class WritingTaskStatus(str, Enum):
    """Status of individual writing tasks"""
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    AWAITING_CONFIRMATION = "awaiting_confirmation"
    COMPLETED = "completed"
    FAILED = "failed"


class WritingWorkflowStatus(str, Enum):
    """Overall workflow status"""
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    AWAITING_OUTLINE_CONFIRMATION = "awaiting_outline_confirmation"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    FAILED = "failed"


# ============================================================
# Task 1: Requirements Intake
# ============================================================

class WritingRequirements(BaseModel):
    """Extracted requirements from user request"""
    document_type: str = Field(..., description="Type of document (report, article, essay, proposal, etc.)")
    topic: str = Field(..., description="Main topic or subject")
    length_guidance: str = Field(default="medium", description="Length guidance (short, medium, long, or specific word count)")

    # Extracted concrete information from conversation
    extracted_points: List[str] = Field(
        default_factory=list,
        description="Concrete facts, technical details, statistics, arguments extracted from conversation context"
    )


# ============================================================
# Task 2-3: Outline Generation and Confirmation
# ============================================================

class OutlineSubsection(BaseModel):
    """Subsection within a section"""
    subsection_id: str = Field(default_factory=lambda: str(uuid4())[:8])
    title: str
    description: str = ""


class OutlineSection(BaseModel):
    """Section in document outline"""
    section_id: str = Field(default_factory=lambda: str(uuid4())[:8])
    title: str = Field(..., description="Section title")
    description: str = Field(default="", description="Brief description of section content")
    subsections: List[OutlineSubsection] = Field(default_factory=list, description="Optional subsections")
    estimated_words: int = Field(default=0, description="Estimated word count for section")
    assigned_points: List[int] = Field(default_factory=list, description="Indices of extracted_points to use in this section")


class DocumentOutline(BaseModel):
    """Complete document outline"""
    title: str = Field(..., description="Document title")
    sections: List[OutlineSection] = Field(default_factory=list, description="Main sections")
    total_estimated_words: int = Field(default=0, description="Total estimated word count")
    version: int = Field(default=1, description="Outline version (increments on revision)")


class OutlineConfirmation(BaseModel):
    """User confirmation response for outline"""
    approved: bool = Field(..., description="Whether outline is approved")
    feedback: Optional[str] = Field(default=None, description="Optional feedback if not approved")
    specific_changes: List[str] = Field(default_factory=list, description="Specific changes requested")


# ============================================================
# Task 4: Body Writing
# ============================================================

class SectionContent(BaseModel):
    """Content for a written section"""
    section_id: str = Field(..., description="Section identifier")
    title: str = Field(..., description="Section title")
    content: str = Field(default="", description="Written content")
    word_count: int = Field(default=0, description="Actual word count")
    status: WritingTaskStatus = Field(default=WritingTaskStatus.PENDING)


class BodyWriteProgress(BaseModel):
    """Progress tracking for body writing task"""
    total_sections: int = Field(default=0)
    completed_sections: int = Field(default=0)
    current_section_id: Optional[str] = Field(default=None)
    sections_content: List[SectionContent] = Field(default_factory=list)


# ============================================================
# Task 5: Introduction and Conclusion
# ============================================================

class IntroOutroContent(BaseModel):
    """Introduction and conclusion content"""
    introduction: str = Field(default="", description="Introduction text")
    conclusion: str = Field(default="", description="Conclusion text")


# ============================================================
# Task 6: Review Result
# ============================================================

class ReviewEdit(BaseModel):
    """Single find-and-replace edit"""
    old_text: str = Field(..., description="Text to find")
    new_text: str = Field(..., description="Replacement text")


class ReviewResult(BaseModel):
    """Final review result with edits"""
    edits: List[ReviewEdit] = Field(default_factory=list, description="List of find-and-replace edits")
    edit_count: int = Field(default=0, description="Number of edits applied")


# ============================================================
# Workflow State (DynamoDB Persistence)
# ============================================================

class WritingWorkflowState(BaseModel):
    """Complete workflow state for DynamoDB persistence

    Stored under 'writingWorkflow' key in session metadata,
    similar to 'compaction' in CompactingSessionManager.
    """
    workflow_id: str = Field(default_factory=lambda: str(uuid4()))
    status: WritingWorkflowStatus = Field(default=WritingWorkflowStatus.NOT_STARTED)
    current_task: int = Field(default=0, description="Current task number (1-6)")

    # User request
    user_request: str = Field(default="", description="Original user request")

    # Task 1 output
    requirements: Optional[WritingRequirements] = Field(default=None)

    # Task 2-3 output
    outline: Optional[DocumentOutline] = Field(default=None)
    outline_attempts: int = Field(default=0, description="Number of outline generation attempts")
    max_outline_attempts: int = Field(default=3)
    outline_feedback: List[str] = Field(default_factory=list, description="Accumulated feedback")

    # Task 4 output
    body_progress: Optional[BodyWriteProgress] = Field(default=None)

    # Task 5 output
    intro_outro: Optional[IntroOutroContent] = Field(default=None)

    # Task 6 output
    review_result: Optional[ReviewResult] = Field(default=None)

    # Metadata
    created_at: Optional[str] = Field(default=None)
    updated_at: Optional[str] = Field(default=None)
    error_message: Optional[str] = Field(default=None)

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for DynamoDB storage"""
        return self.model_dump(mode='json')

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> "WritingWorkflowState":
        """Create from DynamoDB data"""
        if not data:
            return cls()
        return cls.model_validate(data)


# ============================================================
# SSE Events
# ============================================================

class WritingProgressEvent(BaseModel):
    """SSE event for writing progress updates"""
    type: Literal["writing_progress"] = "writing_progress"
    task: int = Field(..., description="Current task number (1-6)")
    task_name: str = Field(..., description="Human-readable task name")
    status: WritingTaskStatus
    details: Optional[str] = Field(default=None, description="Additional progress details")


class WritingOutlineEvent(BaseModel):
    """SSE event when outline is ready for confirmation"""
    type: Literal["writing_outline"] = "writing_outline"
    outline: DocumentOutline
    attempt: int = Field(..., description="Outline attempt number")


class WritingCompleteEvent(BaseModel):
    """SSE event when writing workflow completes"""
    type: Literal["writing_complete"] = "writing_complete"
    document_title: str
    word_count: int
    sections_count: int
