"""Tests for the manual Runway handoff boundary."""

from pathlib import Path
import tempfile
import unittest

from app.core.project_context import ProjectContext, WorkflowState
from app.engines.image_pipeline import ImagePipeline


class ImagePipelineTest(unittest.TestCase):
    def test_generates_six_and_pauses_for_runway(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            saved_states: list[WorkflowState] = []

            def generate(number: int, prompt: str) -> Path:
                path = root / f"scene{number}.png"
                path.write_bytes(b"png")
                return path

            pipeline = ImagePipeline(
                lambda scene: (f"image {scene['number']}", "motion"),
                generate,
                lambda context: saved_states.append(context.workflow_state),
                root / "prompts" / "runway_motion_prompts.txt",
            )
            pipeline.initialize()
            context = ProjectContext(
                "project_0001",
                "topic",
                workflow_state=WorkflowState.GENERATING_IMAGES,
                scenes=[
                    {"number": number, "description": "scene"}
                    for number in range(1, 7)
                ],
            )
            pipeline.execute(context)
            self.assertEqual(
                context.workflow_state, WorkflowState.IMAGES_REVIEW
            )
            self.assertEqual(
                saved_states,
                [WorkflowState.IMAGES_READY, WorkflowState.IMAGES_REVIEW],
            )

    def test_optional_reference_generator_records_assets(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.png"
            reference.write_bytes(b"reference")
            calls: list[list[Path]] = []

            def generate_with_references(
                number: int, prompt: str, references: list[Path]
            ) -> Path:
                calls.append(references)
                path = root / f"scene{number}.png"
                path.write_bytes(b"png")
                return path

            pipeline = ImagePipeline(
                lambda scene: ("image", "motion"),
                lambda number, prompt: root / "unused.png",
                lambda context: None,
                root / "motion.txt",
                reference_selector=lambda number: (
                    [reference], ["RA-1"], []
                ),
                reference_image_generator=generate_with_references,
            )
            pipeline.initialize()
            context = ProjectContext(
                "project_0001", "topic",
                workflow_state=WorkflowState.GENERATING_IMAGES,
                scenes=[{"number": number} for number in range(1, 7)],
            )
            pipeline.execute(context)
            self.assertEqual(len(calls), 6)
            self.assertEqual(
                context.image_generation_records[0]["reference_asset_ids"],
                ["RA-1"],
            )


if __name__ == "__main__":
    unittest.main()

