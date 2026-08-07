"""Tests for Runway clip validation and manual waiting behavior."""

from pathlib import Path
import tempfile
import unittest

from app.core.project_context import ProjectContext, WorkflowState
from app.engines.video_pipeline import MissingVideoClipsError, VideoPipeline


class VideoPipelineTest(unittest.TestCase):
    def test_missing_clips_keep_waiting_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            context = ProjectContext(
                "project_0001",
                "topic",
                workflow_state=WorkflowState.VIDEOS_APPROVED,
            )
            pipeline = VideoPipeline(
                root / "runway",
                root / "final.mp4",
                lambda path: {},
                lambda clips, output: output,
                lambda item: None,
            )
            pipeline.initialize()
            with self.assertRaises(MissingVideoClipsError) as captured:
                pipeline.execute(context)
            self.assertEqual(len(captured.exception.missing), 6)
            self.assertEqual(
                context.workflow_state, WorkflowState.VIDEOS_APPROVED
            )

    def test_valid_clips_render_in_scene_order(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            runway = root / "runway"
            runway.mkdir()
            for number in range(1, 7):
                (runway / f"scene{number}.mp4").write_bytes(b"video")
            rendered_order: list[str] = []

            def render(clips: list[Path], output: Path) -> Path:
                rendered_order.extend(path.name for path in clips)
                output.write_bytes(b"final")
                return output

            pipeline = VideoPipeline(
                runway,
                root / "final.mp4",
                lambda path: {"has_video": True, "duration": 5},
                render,
                lambda item: None,
            )
            context = ProjectContext(
                "project_0001",
                "topic",
                workflow_state=WorkflowState.VIDEOS_APPROVED,
            )
            pipeline.execute(context)
            self.assertEqual(rendered_order[0], "scene1.mp4")
            self.assertEqual(rendered_order[-1], "scene6.mp4")
            self.assertEqual(context.workflow_state, WorkflowState.COMPLETED)


if __name__ == "__main__":
    unittest.main()

