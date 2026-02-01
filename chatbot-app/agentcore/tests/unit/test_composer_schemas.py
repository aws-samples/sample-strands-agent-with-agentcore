"""Tests for Composer Workflow Schemas

Tests focus on meaningful logic validation:
- State serialization/deserialization
- State transitions
- Document assembly
- Workflow progress tracking
"""

import pytest
from models.composer_schemas import (
    WritingTaskStatus,
    WritingWorkflowStatus,
    WritingRequirements,
    OutlineSection,
    OutlineSubsection,
    DocumentOutline,
    OutlineConfirmation,
    SectionContent,
    BodyWriteProgress,
    IntroOutroContent,
    ReviewResult,
    ReviewEdit,
    WritingWorkflowState,
)


# ============================================================
# Requirements and Structure Tests
# ============================================================

class TestWritingRequirements:
    """Test WritingRequirements schema"""

    def test_requirements_with_extracted_points(self):
        """Test requirements with extracted points from context"""
        req = WritingRequirements(
            document_type="report",
            topic="Cloud Computing Benefits",
            length_guidance="medium",
            extracted_points=[
                "AWS provides 99.99% SLA",
                "Cost reduction of 40% observed",
                "Migration took 6 months"
            ]
        )
        assert req.document_type == "report"
        assert len(req.extracted_points) == 3
        assert "AWS" in req.extracted_points[0]

    def test_requirements_serialization(self):
        """Test requirements can be serialized to dict"""
        req = WritingRequirements(
            document_type="article",
            topic="Machine Learning Basics",
            extracted_points=["Supervised learning", "Neural networks"]
        )
        data = req.model_dump()
        assert isinstance(data, dict)
        assert data["document_type"] == "article"
        assert len(data["extracted_points"]) == 2


# ============================================================
# Document Outline Tests
# ============================================================

class TestDocumentOutline:
    """Test DocumentOutline and section assignment"""

    def test_outline_with_assigned_points(self):
        """Test outline sections with assigned extracted points"""
        section = OutlineSection(
            title="Cost Analysis",
            description="Analyze cost benefits",
            estimated_words=400,
            assigned_points=[0, 1]  # Indices of extracted_points
        )
        assert section.title == "Cost Analysis"
        assert section.assigned_points == [0, 1]
        assert len(section.section_id) > 0

    def test_outline_with_subsections(self):
        """Test outline section with subsections"""
        subsection = OutlineSubsection(
            title="Background",
            description="Historical context"
        )
        section = OutlineSection(
            title="Introduction",
            description="Overview",
            subsections=[subsection]
        )
        assert len(section.subsections) == 1
        assert section.subsections[0].title == "Background"

    def test_document_outline_versioning(self):
        """Test outline version tracking for revisions"""
        sections = [
            OutlineSection(title="Intro", description="Opening"),
            OutlineSection(title="Body", description="Main content")
        ]
        outline = DocumentOutline(
            title="Test Document",
            sections=sections,
            total_estimated_words=1000,
            version=1
        )
        assert outline.version == 1

        # Simulate revision
        outline.version = 2
        assert outline.version == 2


class TestOutlineConfirmation:
    """Test outline confirmation logic"""

    def test_confirmation_with_feedback(self):
        """Test rejected confirmation with specific changes"""
        conf = OutlineConfirmation(
            approved=False,
            feedback="Need more technical depth",
            specific_changes=["Add security section", "Expand performance analysis"]
        )
        assert conf.approved is False
        assert "technical depth" in conf.feedback
        assert len(conf.specific_changes) == 2


# ============================================================
# Body Writing Progress Tests
# ============================================================

class TestBodyWriteProgress:
    """Test body writing progress tracking"""

    def test_progress_tracking(self):
        """Test section completion tracking"""
        section1 = SectionContent(
            section_id="s1",
            title="Introduction",
            content="This is the introduction content.",
            word_count=150,
            status=WritingTaskStatus.COMPLETED
        )
        section2 = SectionContent(
            section_id="s2",
            title="Analysis",
            content="",
            word_count=0,
            status=WritingTaskStatus.IN_PROGRESS
        )

        progress = BodyWriteProgress(
            total_sections=3,
            completed_sections=1,
            current_section_id="s2",
            sections_content=[section1, section2]
        )

        assert progress.completed_sections == 1
        assert progress.current_section_id == "s2"
        assert len(progress.sections_content) == 2
        assert progress.sections_content[0].status == WritingTaskStatus.COMPLETED


# ============================================================
# Review Result Tests
# ============================================================

class TestReviewResult:
    """Test review result with find-and-replace edits"""

    def test_review_with_edits(self):
        """Test review result with multiple edits"""
        edits = [
            ReviewEdit(old_text="teh", new_text="the"),
            ReviewEdit(old_text="recieve", new_text="receive"),
            ReviewEdit(old_text="seperate", new_text="separate")
        ]

        review = ReviewResult(
            edits=edits,
            edit_count=3
        )

        assert review.edit_count == 3
        assert len(review.edits) == 3
        assert review.edits[0].old_text == "teh"
        assert review.edits[0].new_text == "the"


# ============================================================
# Workflow State Tests
# ============================================================

class TestWritingWorkflowState:
    """Test workflow state persistence and transitions"""

    def test_state_serialization_roundtrip(self):
        """Test state can be serialized and deserialized"""
        original_state = WritingWorkflowState(
            status=WritingWorkflowStatus.IN_PROGRESS,
            current_task=2,
            user_request="Write a report about cloud computing",
            requirements=WritingRequirements(
                document_type="report",
                topic="Cloud Computing"
            )
        )

        # Serialize
        data = original_state.to_dict()
        assert isinstance(data, dict)
        assert data["status"] == "in_progress"

        # Deserialize
        restored_state = WritingWorkflowState.from_dict(data)
        assert restored_state.status == WritingWorkflowStatus.IN_PROGRESS
        assert restored_state.current_task == 2
        assert restored_state.requirements.topic == "Cloud Computing"

    def test_state_from_empty(self):
        """Test state creation from None returns default"""
        state = WritingWorkflowState.from_dict(None)
        assert state.status == WritingWorkflowStatus.NOT_STARTED
        assert state.current_task == 0

    def test_complete_workflow_state_persistence(self):
        """Test full workflow state with all components"""
        req = WritingRequirements(
            document_type="article",
            topic="AI Ethics",
            extracted_points=["Privacy concerns", "Bias in algorithms"]
        )

        outline = DocumentOutline(
            title="AI Ethics in Modern Society",
            sections=[
                OutlineSection(
                    title="Introduction",
                    description="Opening",
                    assigned_points=[0]
                ),
                OutlineSection(
                    title="Main Discussion",
                    description="Core content",
                    assigned_points=[1]
                )
            ],
            total_estimated_words=1500
        )

        body = BodyWriteProgress(
            total_sections=2,
            completed_sections=2,
            sections_content=[
                SectionContent(
                    section_id="s1",
                    title="Introduction",
                    content="Content here",
                    word_count=300,
                    status=WritingTaskStatus.COMPLETED
                ),
                SectionContent(
                    section_id="s2",
                    title="Main Discussion",
                    content="More content",
                    word_count=800,
                    status=WritingTaskStatus.COMPLETED
                )
            ]
        )

        intro_outro = IntroOutroContent(
            introduction="Welcome to this article about AI ethics.",
            conclusion="In conclusion, AI ethics requires careful consideration."
        )

        review = ReviewResult(
            edits=[
                ReviewEdit(old_text="AI", new_text="artificial intelligence")
            ],
            edit_count=1
        )

        state = WritingWorkflowState(
            status=WritingWorkflowStatus.COMPLETED,
            current_task=6,
            user_request="Write about AI ethics",
            requirements=req,
            outline=outline,
            body_progress=body,
            intro_outro=intro_outro,
            review_result=review
        )

        # Test serialization round-trip
        data = state.to_dict()
        restored = WritingWorkflowState.from_dict(data)

        assert restored.status == WritingWorkflowStatus.COMPLETED
        assert restored.requirements.topic == "AI Ethics"
        assert len(restored.requirements.extracted_points) == 2
        assert restored.outline.title == "AI Ethics in Modern Society"
        assert len(restored.outline.sections) == 2
        assert restored.outline.sections[0].assigned_points == [0]
        assert len(restored.body_progress.sections_content) == 2
        assert restored.review_result.edit_count == 1


# ============================================================
# State Transition Tests
# ============================================================

class TestStateTransitions:
    """Test workflow state transitions"""

    def test_workflow_task_progression(self):
        """Test workflow progresses through tasks correctly"""
        state = WritingWorkflowState()

        # Start workflow
        state.status = WritingWorkflowStatus.IN_PROGRESS
        state.current_task = 1
        assert state.status == WritingWorkflowStatus.IN_PROGRESS

        # Progress through tasks
        state.current_task = 2
        state.current_task = 3

        # Await confirmation
        state.status = WritingWorkflowStatus.AWAITING_OUTLINE_CONFIRMATION
        assert state.status == WritingWorkflowStatus.AWAITING_OUTLINE_CONFIRMATION

        # Resume after confirmation
        state.status = WritingWorkflowStatus.IN_PROGRESS
        state.current_task = 4

        # Complete
        state.current_task = 6
        state.status = WritingWorkflowStatus.COMPLETED
        assert state.status == WritingWorkflowStatus.COMPLETED

    def test_outline_revision_tracking(self):
        """Test outline revision attempt tracking"""
        state = WritingWorkflowState()

        # First outline attempt
        state.outline_attempts = 1
        assert state.outline_attempts < state.max_outline_attempts

        # Add feedback for revision
        state.outline_feedback.append("Add more technical sections")
        state.outline_attempts = 2
        assert len(state.outline_feedback) == 1

        # Third attempt (max)
        state.outline_feedback.append("Expand security section")
        state.outline_attempts = 3
        assert state.outline_attempts >= state.max_outline_attempts

    def test_failure_state_handling(self):
        """Test workflow failure state"""
        state = WritingWorkflowState(
            status=WritingWorkflowStatus.IN_PROGRESS,
            current_task=2
        )

        # Simulate failure
        state.status = WritingWorkflowStatus.FAILED
        state.error_message = "LLM invocation failed"

        assert state.status == WritingWorkflowStatus.FAILED
        assert state.error_message is not None
