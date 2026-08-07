"""Tests for safe FFmpeg command handling."""

import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from app.engines.ffmpeg_engine import FFmpegEngine, FFmpegError


class FFmpegEngineTest(unittest.TestCase):
    def test_media_subprocess_decodes_utf8_paths_independent_of_windows_locale(
        self,
    ) -> None:
        captured: dict[str, object] = {}

        def runner(
            args: list[str], **kwargs: object
        ) -> subprocess.CompletedProcess[str]:
            captured.update(kwargs)
            payload = {
                "streams": [{"codec_type": "video", "codec_name": "h264"}],
                "format": {"duration": "5.0", "filename": "한글 경로.mp4"},
            }
            return subprocess.CompletedProcess(args, 0, json.dumps(payload), "")

        FFmpegEngine(runner=runner).probe(Path("한글 경로.mp4"))

        self.assertEqual(captured["encoding"], "utf-8")
        self.assertEqual(captured["errors"], "replace")

    def test_probe_parses_video_stream(self) -> None:
        def runner(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            payload = {
                "streams": [{"codec_type": "video", "codec_name": "h264"}],
                "format": {"duration": "5.0"},
            }
            return subprocess.CompletedProcess(args, 0, json.dumps(payload), "")

        metadata = FFmpegEngine(runner=runner).probe(Path("scene1.mp4"))
        self.assertEqual(metadata["duration"], 5.0)

    def test_render_uses_argument_arrays_and_six_clips(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls: list[list[str]] = []

            def runner(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
                calls.append(args)
                output = Path(args[-1])
                if output.suffix == ".mp4":
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(b"video")
                return subprocess.CompletedProcess(args, 0, "", "")

            clips = []
            for number in range(1, 7):
                path = root / f"scene{number}.mp4"
                path.write_bytes(b"clip")
                clips.append(path)
            output = FFmpegEngine(runner=runner).execute(
                clips, root / "final.mp4"
            )
            self.assertTrue(output.is_file())
            self.assertTrue(all(isinstance(call, list) for call in calls))
            self.assertIn("scale=1080:1920", " ".join(calls[0]))

    def test_failed_command_raises(self) -> None:
        def runner(args: list[str], **kwargs: object) -> subprocess.CompletedProcess[str]:
            return subprocess.CompletedProcess(args, 1, "", "failure")

        with self.assertRaises(FFmpegError):
            FFmpegEngine(runner=runner).probe(Path("bad.mp4"))

    def test_landscape_render_uses_landscape_normalization(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls: list[list[str]] = []

            def runner(
                args: list[str], **kwargs: object
            ) -> subprocess.CompletedProcess[str]:
                calls.append(args)
                output = Path(args[-1])
                if output.suffix == ".mp4":
                    output.parent.mkdir(parents=True, exist_ok=True)
                    output.write_bytes(b"video")
                return subprocess.CompletedProcess(args, 0, "", "")

            clips = []
            for number in range(1, 7):
                clip = root / f"scene{number}.mp4"
                clip.write_bytes(b"clip")
                clips.append(clip)
            FFmpegEngine(runner=runner).execute(
                clips, root / "landscape.mp4", output_size=(1920, 1080)
            )
            self.assertIn("scale=1920:1080", " ".join(calls[0]))

    def test_extracts_last_frame_for_continuity(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "last.png"

            def runner(
                args: list[str], **kwargs: object
            ) -> subprocess.CompletedProcess[str]:
                Path(args[-1]).write_bytes(b"frame")
                return subprocess.CompletedProcess(args, 0, "", "")

            result = FFmpegEngine(runner=runner).extract_last_frame(
                Path(directory) / "scene.mp4", output
            )
            self.assertEqual(result.read_bytes(), b"frame")


if __name__ == "__main__":
    unittest.main()

