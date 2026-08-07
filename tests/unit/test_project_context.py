"""Tests for shared project state."""

import unittest

from app.core.project_context import ProjectContext, WorkflowState


class ProjectContextTest(unittest.TestCase):
    """Verify state transitions and serialization."""

    def test_valid_transition_and_round_trip(self) -> None:
        context = ProjectContext("project_0001", "우주 모험")
        context.transition_to(WorkflowState.READY)
        restored = ProjectContext.from_dict(context.to_dict())
        self.assertEqual(restored.workflow_state, WorkflowState.READY)
        self.assertEqual(restored.topic, "우주 모험")

    def test_rejects_skipped_transition(self) -> None:
        context = ProjectContext("project_0001", "topic")
        with self.assertRaises(ValueError):
            context.transition_to(WorkflowState.COMPLETED)

    def test_waiting_for_video_confirmation_is_normal_transition(self) -> None:
        context = ProjectContext(
            "project_0001",
            "topic",
            workflow_state=WorkflowState.IMAGES_READY,
        )
        context.transition_to(WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION)
        self.assertEqual(
            context.workflow_state, WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION
        )

    def test_requires_exactly_six_complete_scenes(self) -> None:
        context = ProjectContext("project_0001", "topic", scenes=[{}])
        with self.assertRaises(ValueError):
            context.validate(require_complete_scenes=True)


if __name__ == "__main__":
    unittest.main()

