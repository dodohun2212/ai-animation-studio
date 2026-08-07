"""Tests for workflow ordering and resumable manual pause."""

from pathlib import Path
import unittest

from app.core.project_context import ProjectContext, WorkflowState
from app.engines.video_pipeline import MissingVideoClipsError
from app.engines.workflow_engine import WorkflowDependencies, WorkflowEngine


class WorkflowEngineTest(unittest.TestCase):
    def test_new_run_stops_at_waiting_for_video_confirmation(self) -> None:
        events: list[str] = []

        def story(context: ProjectContext) -> ProjectContext:
            context.scenes = [
                {"number": number, "description": "scene"}
                for number in range(1, 7)
            ]
            return context

        def images(context: ProjectContext) -> ProjectContext:
            context.transition_to(WorkflowState.IMAGES_READY)
            context.transition_to(WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION)
            return context

        engine = WorkflowEngine(
            WorkflowDependencies(
                story,
                images,
                lambda context: context,
                lambda context: None,
                lambda project_id, event, payload: events.append(event),
            )
        )
        engine.initialize()
        context = engine.execute(ProjectContext("project_0001", "topic"))
        self.assertEqual(
            context.workflow_state, WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION
        )
        self.assertIn("STORY_GENERATED", events)

    def test_missing_resume_files_remain_waiting(self) -> None:
        def missing(context: ProjectContext) -> ProjectContext:
            raise MissingVideoClipsError([Path("scene1.mp4")])

        engine = WorkflowEngine(
            WorkflowDependencies(
                lambda context: context,
                lambda context: context,
                missing,
                lambda context: None,
                lambda project_id, event, payload: None,
            )
        )
        engine.initialize()
        context = ProjectContext(
            "project_0001",
            "topic",
            workflow_state=WorkflowState.VIDEOS_APPROVED,
        )
        engine.resume(context)
        self.assertEqual(
            context.workflow_state, WorkflowState.VIDEOS_APPROVED
        )


if __name__ == "__main__":
    unittest.main()

