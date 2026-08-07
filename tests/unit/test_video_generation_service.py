"""Runway workflow tests using only fake provider and media boundaries."""

from pathlib import Path
import struct
import tempfile
import unittest

from app.adapters.runway_video_adapter import RunwayTask
from app.config.config import AppConfig
from app.core.project_context import ProjectContext, WorkflowState
from app.services.video_generation_service import (
    VideoGenerationService,
    VideoGenerationStopped,
    build_runway_scene_prompt,
)


class _FakeAdapter:
    def __init__(self) -> None:
        self.created: list[tuple[str, str]] = []
        self.options: list[dict[str, object]] = []
        self.polled: list[str] = []

    def create_image_to_video(
        self, image_path: Path, prompt: str, **kwargs: object
    ) -> str:
        task_id = f"task-{len(self.created) + 1}"
        self.created.append((image_path.name, prompt))
        self.options.append(dict(kwargs))
        return task_id

    def get_task(self, task_id: str) -> RunwayTask:
        self.polled.append(task_id)
        return RunwayTask(
            task_id, "SUCCEEDED",
            (f"https://example.test/{task_id}.mp4",),
        )

    def download_output(self, url: str, destination: Path) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(b"video")
        return destination


class _FakeFFmpeg:
    def extract_last_frame(self, video: Path, output: Path) -> Path:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_bytes(b"frame")
        return output


class VideoGenerationServiceTest(unittest.TestCase):
    def _fixture(
        self, root: Path
    ) -> tuple[AppConfig, ProjectContext, _FakeAdapter]:
        images: list[str] = []
        for number in range(1, 7):
            path = root / f"image{number}.png"
            path.write_bytes(f"image-{number}".encode())
            images.append(str(path))
        context = ProjectContext(
            project_id="short_test",
            topic="test",
            workflow_state=WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
            scenes=[
                {
                    "number": number,
                    "description": f"action {number}",
                    "visual_action": f"visual action {number}",
                    "start_motion": f"start {number}",
                    "main_motion": f"main {number}",
                    "end_motion": f"end {number}",
                    "camera_motion": f"camera {number}",
                    "environment_motion": f"environment {number}",
                    "motion_speed": "slow",
                    "motion_intensity": "moderate",
                    "expression_change": f"expression {number}",
                    "continuity_hint": f"connect {number}",
                }
                for number in range(1, 7)
            ],
            motion_prompts=[f"motion {number}" for number in range(1, 7)],
            generated_images=images,
        )
        config = AppConfig.load(
            root,
            env={
                "RUNWAYML_API_SECRET": "x" * 30,
                "RUNWAY_POLL_INTERVAL_SECONDS": "0.001",
                "RUNWAY_TASK_TIMEOUT_SECONDS": "2",
            },
        )
        return config, context, _FakeAdapter()

    def test_preview_does_not_call_provider_and_includes_continuity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            previews = service.previews(context)
            self.assertEqual(adapter.created, [])
            self.assertEqual(len(previews), 6)
            self.assertIn("end 1", previews[1].prompt)
            self.assertIn("Opening movement: start 2", previews[1].prompt)
            self.assertIn("Main action: main 2", previews[1].prompt)
            self.assertIn("Performance: expression 2", previews[1].prompt)
            self.assertIn("Ending movement: end 2", previews[1].prompt)
            self.assertIn("Motivated camera:", previews[1].prompt)
            self.assertIn("camera 2", previews[1].prompt)
            self.assertIn("Environment: environment 2", previews[1].prompt)
            self.assertIn("motion speed slow", previews[1].prompt)
            self.assertIn("intensity moderate", previews[1].prompt)
            self.assertEqual(previews[0].estimated_cost_usd, 0.25)

    def test_saved_project_aspect_controls_preview_prompt_and_provider(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            context.style_profile["aspect"] = "16:9"
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            previews = service.previews(context)
            self.assertEqual({item.ratio for item in previews}, {"1280:720"})
            self.assertIn("horizontal image-to-video", previews[0].prompt)
            service.generate(context, [item.prompt for item in previews])
            self.assertTrue(adapter.options)
            self.assertEqual(
                {item["ratio"] for item in adapter.options}, {"1280:720"}
            )

    def test_vertical_project_keeps_vertical_runway_ratio(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, _adapter = self._fixture(Path(directory))
            context.style_profile["aspect"] = "9:16"
            previews = VideoGenerationService(
                config, adapter=_adapter, ffmpeg_engine=_FakeFFmpeg()
            ).previews(context)
            self.assertEqual({item.ratio for item in previews}, {"720:1280"})
            self.assertIn("vertical image-to-video", previews[0].prompt)

    def test_actual_landscape_images_override_stale_vertical_setting(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            context.style_profile["aspect"] = "9:16"
            png_header = (
                b"\x89PNG\r\n\x1a\n"
                + struct.pack(">I", 13)
                + b"IHDR"
                + struct.pack(">II", 1536, 1024)
            )
            for value in context.generated_images:
                Path(value).write_bytes(png_header)
            previews = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            ).previews(context)
            self.assertEqual({item.ratio for item in previews}, {"1280:720"})
            self.assertIn("horizontal image-to-video", previews[0].prompt)

    def test_mixed_image_orientations_are_blocked_before_runway(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            for number, value in enumerate(context.generated_images, start=1):
                width, height = ((1536, 1024) if number < 6 else (1024, 1536))
                Path(value).write_bytes(
                    b"\x89PNG\r\n\x1a\n"
                    + struct.pack(">I", 13)
                    + b"IHDR"
                    + struct.pack(">II", width, height)
                )
            with self.assertRaisesRegex(ValueError, "방향이 서로 다릅니다"):
                VideoGenerationService(
                    config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
                ).previews(context)
            self.assertEqual(adapter.created, [])

    def test_legacy_meta_instruction_is_not_sent_as_motion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _config, context, _adapter = self._fixture(Path(directory))
            context.scenes[0] = {
                "number": 1,
                "description": "인물이 천천히 일어나 오른쪽을 바라본다.",
            }
            context.motion_prompts[0] = (
                "캐릭터·카메라·배경 움직임과 왜곡 방지 조건을 작성하십시오."
            )
            prompt = build_runway_scene_prompt(context, 1)
            self.assertNotIn("작성하십시오", prompt)
            self.assertIn("인물이 천천히 일어나", prompt)

    def test_long_motion_fields_are_omitted_instead_of_spliced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _config, context, _adapter = self._fixture(Path(directory))
            long_value = "아주 구체적인 움직임 " * 80
            for key in (
                "start_motion", "main_motion", "end_motion",
                "camera_motion", "environment_motion", "expression_change",
            ):
                context.scenes[1][key] = long_value
            prompt = build_runway_scene_prompt(context, 2)
            self.assertLessEqual(len(prompt.encode("utf-16-le")) // 2, 1000)
            self.assertNotIn("…", prompt)
            self.assertNotIn("아주 구체적인 움직임", prompt)

    def test_prompt_limit_shrinks_environment_before_core_motion(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _config, context, _adapter = self._fixture(Path(directory))
            context.scenes[0]["main_motion"] = "CORE ACTION MUST REMAIN"
            context.scenes[0]["start_motion"] = "CORE START MUST REMAIN"
            context.scenes[0]["end_motion"] = "CORE END MUST REMAIN"
            context.scenes[0]["environment_motion"] = "ambient detail " * 100
            prompt = build_runway_scene_prompt(context, 1)
            self.assertLessEqual(len(prompt.encode("utf-16-le")) // 2, 1000)
            self.assertIn("CORE ACTION MUST REMAIN", prompt)
            self.assertIn("CORE START MUST REMAIN", prompt)
            self.assertIn("CORE END MUST REMAIN", prompt)
            self.assertNotIn("Environment:", prompt)
            self.assertNotIn("…", prompt)

    def test_compaction_never_sends_partial_core_fields(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _config, context, _adapter = self._fixture(Path(directory))
            context.scenes[1].update({
                "start_motion": "START " + "opening detail " * 80 + "START-END",
                "main_motion": "MAIN " + "action detail " * 80 + "MAIN-END",
                "end_motion": "END " + "settling detail " * 80 + "FINAL-POSE",
                "camera_motion": "CAMERA " + "camera detail " * 60 + "CAMERA-END",
                "environment_motion": "ENVIRONMENT " + "ambient " * 100,
                "expression_change": "EXPRESSION " + "emotion " * 100,
            })
            prompt = build_runway_scene_prompt(context, 2)
            self.assertLessEqual(len(prompt.encode("utf-16-le")) // 2, 1000)
            self.assertNotIn("…", prompt)
            self.assertNotIn("START ", prompt)
            self.assertNotIn("MAIN ", prompt)
            self.assertNotIn("END ", prompt)
            self.assertNotIn("CAMERA ", prompt)

    def test_exact_duplicate_motion_is_referenced_once(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _config, context, _adapter = self._fixture(Path(directory))
            duplicate = "the character slowly raises one hand"
            context.scenes[0]["start_motion"] = duplicate
            context.scenes[0]["main_motion"] = duplicate
            prompt = build_runway_scene_prompt(context, 1)
            self.assertEqual(prompt.count(duplicate), 1)
            self.assertNotIn("same motion as", prompt)

    def test_prompt_uses_cinematic_arc_and_positive_consistency(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _config, context, _adapter = self._fixture(Path(directory))
            first = build_runway_scene_prompt(context, 1)
            climax = build_runway_scene_prompt(context, 4)
            ending = build_runway_scene_prompt(context, 6)
            self.assertIn("Pacing: start restrained", first)
            self.assertIn("strongest readable action", climax)
            self.assertIn("memorable final composition", ending)
            self.assertIn("Maintain stable identity", first)
            self.assertNotIn("No morphing", first)

    def test_camera_is_active_and_adapts_to_scene_action(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            _config, context, _adapter = self._fixture(Path(directory))
            context.scenes[1].update({
                "main_motion": "주인공이 복도를 달리며 추격자를 피한다.",
                "camera_motion": "카메라가 아주 천천히 고정된 구도로 본다.",
            })
            chase = build_runway_scene_prompt(context, 2)
            ending = build_runway_scene_prompt(context, 6)

            self.assertIn("track laterally", chase)
            self.assertIn("foreground parallax", chase)
            self.assertNotIn("아주 천천히", chase)
            self.assertIn("rising crane", ending)
            self.assertIn("full final composition", ending)

    def test_compacted_preview_reaches_adapter_without_text_changes(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            for number, scene in enumerate(context.scenes, start=1):
                scene.update({
                    "start_motion": (
                        f"SCENE-{number}-START "
                        + "opening motion detail " * 45
                        + f"SCENE-{number}-START-END"
                    ),
                    "main_motion": (
                        f"SCENE-{number}-MAIN "
                        + "main motion detail " * 45
                        + f"SCENE-{number}-MAIN-END"
                    ),
                    "end_motion": (
                        f"SCENE-{number}-END "
                        + "ending motion detail " * 45
                        + f"SCENE-{number}-FINAL-POSE"
                    ),
                    "camera_motion": (
                        f"SCENE-{number}-CAMERA "
                        + "camera detail " * 35
                        + f"SCENE-{number}-CAMERA-END"
                    ),
                })
            previews = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            ).previews(context)
            approved_prompts = [preview.prompt for preview in previews]
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            service.generate(context, approved_prompts)
            transmitted = [prompt for _image, prompt in adapter.created]
            self.assertEqual(transmitted, approved_prompts)
            for number, prompt in enumerate(transmitted, start=1):
                self.assertLessEqual(
                    len(prompt.encode("utf-16-le")) // 2, 1000
                )
                self.assertNotIn("…", prompt)
                self.assertNotIn(f"SCENE-{number}-START ", prompt)
                self.assertNotIn(f"SCENE-{number}-MAIN ", prompt)
                self.assertNotIn(f"SCENE-{number}-END ", prompt)
                self.assertNotIn(f"SCENE-{number}-CAMERA ", prompt)

    def test_sequential_generation_persists_six_videos(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            prompts = [item.prompt for item in service.previews(context)]
            result = service.generate(context, prompts)
            self.assertEqual(
                result.workflow_state, WorkflowState.REVIEWING_VIDEOS
            )
            self.assertEqual(len(adapter.created), 6)
            self.assertEqual(adapter.polled, [f"task-{n}" for n in range(1, 7)])
            self.assertTrue(all(Path(path).is_file() for path in result.generated_video_paths))
            self.assertEqual(
                [item["status"] for item in result.video_generation_records],
                ["succeeded"] * 6,
            )

    def test_approved_prompt_and_latest_image_are_exact_adapter_inputs(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            latest = Path(directory) / "latest-scene-1.png"
            latest.write_bytes(b"latest-approved-image")
            context.generated_images[0] = str(latest)
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            approved = [f"user approved prompt {number}" for number in range(1, 7)]
            service.generate(context, approved)
            self.assertEqual(adapter.created[0], (latest.name, approved[0]))
            self.assertEqual(
                [prompt for _name, prompt in adapter.created], approved
            )
            first_record = context.video_generation_records[0]
            self.assertEqual(first_record["scene_number"], 1)
            self.assertEqual(first_record["prompt"], approved[0])
            self.assertTrue(first_record["task_id"])
            self.assertEqual(
                first_record["input_hash"],
                service._input_hash(latest, approved[0]),
            )

    def test_stop_prevents_next_submission_only(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            prompts = [item.prompt for item in service.previews(context)]

            def progress(event: dict[str, object]) -> None:
                if event.get("kind") == "scene_completed":
                    service.request_stop()

            with self.assertRaises(VideoGenerationStopped):
                service.generate(context, prompts, progress=progress)
            self.assertEqual(len(adapter.created), 1)
            self.assertEqual(context.workflow_state, WorkflowState.INTERRUPTED)

    def test_all_six_reviews_gate_merge_state(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            result = service.generate(
                context, [item.prompt for item in service.previews(context)]
            )
            for number in range(1, 7):
                service.approve_scene(result, number, True)
            self.assertEqual(
                result.workflow_state, WorkflowState.VIDEOS_APPROVED
            )

    def test_resume_uses_saved_succeeded_task_without_new_paid_submit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            prompts = [item.prompt for item in service.previews(context)]
            image = Path(context.generated_images[0])
            context.video_generation_records = [{
                "scene_number": 1,
                "task_id": "saved-task",
                "input_hash": service._input_hash(image, prompts[0]),
                "prompt": prompts[0],
                "status": "SUCCEEDED",
            }]
            service.generate(context, prompts)
            self.assertNotIn(
                "task-1",
                [task_id for task_id in adapter.polled[:1]],
            )
            self.assertEqual(adapter.polled[0], "saved-task")
            self.assertEqual(len(adapter.created), 5)

    def test_resume_skips_completed_file_even_when_rebuilt_prompt_changed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            prompts = [item.prompt for item in service.previews(context)]
            service.generate(context, prompts)
            self.assertEqual(len(adapter.created), 6)

            context.workflow_state = WorkflowState.INTERRUPTED
            scene_six = Path(context.generated_video_paths[5])
            scene_six.unlink()
            context.generated_video_paths[5] = ""
            context.video_generation_records[5]["status"] = "FAILED"
            changed = [f"rebuilt prompt {number}" for number in range(1, 7)]

            self.assertEqual(service.expected_new_paid_requests(context), 1)
            service.generate(context, changed)

            self.assertEqual(len(adapter.created), 7)
            self.assertEqual(adapter.created[-1][0], "image6.png")
            self.assertEqual(adapter.created[-1][1], changed[5])

    def test_active_saved_task_is_recovered_despite_prompt_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            context.workflow_state = WorkflowState.INTERRUPTED
            context.video_generation_records = [{
                "scene_number": 1,
                "task_id": "already-paid-task",
                "input_hash": "older-prompt-hash",
                "prompt": "older prompt",
                "status": "RUNNING",
            }]
            prompts = [f"new prompt {number}" for number in range(1, 7)]

            self.assertEqual(service.expected_new_paid_requests(context), 5)
            service.generate(context, prompts)

            self.assertEqual(adapter.polled[0], "already-paid-task")
            self.assertEqual(len(adapter.created), 5)

    def test_force_all_regenerates_six_and_preserves_previous_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            prompts = [item.prompt for item in service.previews(context)]
            service.generate(context, prompts)
            first_paths = [Path(path) for path in context.generated_video_paths]
            self.assertEqual(len(adapter.created), 6)

            service.generate(context, prompts, force_all=True)

            self.assertEqual(len(adapter.created), 12)
            self.assertEqual(context.workflow_state, WorkflowState.REVIEWING_VIDEOS)
            self.assertEqual(context.video_reviews, [])
            previous = [
                Path(str(item.get("previous_output_path", "")))
                for item in context.video_generation_records
            ]
            self.assertTrue(all(path.is_file() for path in previous))
            self.assertTrue(all("history" in path.parts for path in previous))
            self.assertTrue(all(path.is_file() for path in first_paths))

    def test_force_all_cannot_be_combined_with_single_scene_retry(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config, context, adapter = self._fixture(Path(directory))
            service = VideoGenerationService(
                config, adapter=adapter, ffmpeg_engine=_FakeFFmpeg()
            )
            prompts = [item.prompt for item in service.previews(context)]
            with self.assertRaisesRegex(ValueError, "cannot be combined"):
                service.generate(
                    context, prompts, retry_scene=1, force_all=True
                )
            self.assertEqual(adapter.created, [])


if __name__ == "__main__":
    unittest.main()
