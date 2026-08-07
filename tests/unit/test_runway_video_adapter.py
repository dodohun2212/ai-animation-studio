"""Tests for the Runway SDK boundary without network access."""

from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from app.adapters.runway_video_adapter import RunwayVideoAdapter


class _Response:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def __enter__(self) -> "_Response":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self) -> bytes:
        return self.payload


class _FakeImageToVideo:
    def __init__(self) -> None:
        self.arguments: dict[str, object] = {}

    def create(self, **kwargs: object) -> SimpleNamespace:
        self.arguments = kwargs
        return SimpleNamespace(id="task-1")


class _FakeTasks:
    def __init__(self, response: SimpleNamespace) -> None:
        self.response = response
        self.retrieved: list[str] = []

    def retrieve(self, task_id: str) -> SimpleNamespace:
        self.retrieved.append(task_id)
        return self.response


class _FakeClient:
    def __init__(self, task: SimpleNamespace | None = None) -> None:
        self.image_to_video = _FakeImageToVideo()
        self.tasks = _FakeTasks(task or SimpleNamespace(status="PENDING"))


class RunwayVideoAdapterTest(unittest.TestCase):
    def test_submit_uses_sdk_and_returns_task_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            image = Path(directory) / "scene.png"
            image.write_bytes(b"png")
            client = _FakeClient()
            task_id = RunwayVideoAdapter(
                "x" * 30, client=client
            ).create_image_to_video(image, "gentle motion")
            self.assertEqual(task_id, "task-1")
            arguments = client.image_to_video.arguments
            self.assertEqual(arguments["model"], "gen4_turbo")
            self.assertEqual(arguments["prompt_text"], "gentle motion")
            self.assertEqual(arguments["ratio"], "720:1280")
            self.assertEqual(arguments["duration"], 5)
            self.assertTrue(
                str(arguments["prompt_image"]).startswith(
                    "data:image/png;base64,"
                )
            )

    def test_poll_normalizes_success_output(self) -> None:
        url = "https://example.test/video.mp4"
        client = _FakeClient(SimpleNamespace(
            status="SUCCEEDED", output=[url]
        ))
        task = RunwayVideoAdapter(
            "x" * 30, client=client
        ).get_task("task-1")
        self.assertTrue(task.terminal)
        self.assertEqual(task.output_urls[0], url)
        self.assertEqual(client.tasks.retrieved, ["task-1"])

    def test_poll_preserves_failure_message_and_code(self) -> None:
        client = _FakeClient(SimpleNamespace(
            status="FAILED",
            failure="An unexpected error occurred.",
            failure_code="INTERNAL_ERROR",
        ))
        task = RunwayVideoAdapter(
            "x" * 30, client=client
        ).get_task("task-failed")
        self.assertEqual(task.status, "FAILED")
        self.assertIn("An unexpected error occurred.", task.failure)
        self.assertIn("INTERNAL_ERROR", task.failure)

    def test_download_is_atomic(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            destination = Path(directory) / "scene1.mp4"
            with patch(
                "app.adapters.runway_video_adapter.urlopen",
                lambda *args, **kwargs: _Response(b"video"),
            ):
                RunwayVideoAdapter(
                    "x" * 30, client=_FakeClient()
                ).download_output(
                    "https://example.test/video.mp4", destination
                )
            self.assertEqual(destination.read_bytes(), b"video")
            self.assertFalse(destination.with_suffix(".mp4.part").exists())


if __name__ == "__main__":
    unittest.main()
