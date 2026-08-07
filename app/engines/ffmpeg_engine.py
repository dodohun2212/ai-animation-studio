"""Safe FFmpeg/ffprobe subprocess integration."""

from __future__ import annotations

import json
from pathlib import Path
import shutil
import subprocess
from typing import Callable, Sequence


class FFmpegError(RuntimeError):
    """Raised for missing tools, probe failures, or render failures."""


Runner = Callable[..., subprocess.CompletedProcess[str]]


class FFmpegEngine:
    """Normalize six clips and concatenate them using argument arrays."""

    def __init__(
        self,
        ffmpeg_binary: str = "ffmpeg",
        ffprobe_binary: str = "ffprobe",
        runner: Runner = subprocess.run,
    ) -> None:
        self.ffmpeg_binary = ffmpeg_binary
        self.ffprobe_binary = ffprobe_binary
        self.runner = runner

    def initialize(self) -> None:
        for binary in (self.ffmpeg_binary, self.ffprobe_binary):
            if shutil.which(binary) is None and Path(binary).parent == Path("."):
                raise FFmpegError(f"Required executable is not installed: {binary}")

    def _run(self, arguments: Sequence[str]) -> subprocess.CompletedProcess[str]:
        try:
            result = self.runner(
                list(arguments),
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                check=False,
            )
        except OSError as exc:
            raise FFmpegError(f"Cannot execute media tool: {arguments[0]}") from exc
        if result.returncode != 0:
            raise FFmpegError(result.stderr.strip() or "Media command failed")
        return result

    def probe(self, path: Path) -> dict[str, object]:
        """Return validated video metadata from ffprobe JSON."""
        result = self._run(
            [
                self.ffprobe_binary,
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
                str(path),
            ]
        )
        try:
            data = json.loads(result.stdout)
            streams = data.get("streams", [])
            video_stream = next(
                stream
                for stream in streams
                if stream.get("codec_type") == "video"
            )
            duration = float(
                data.get("format", {}).get(
                    "duration", video_stream.get("duration", 0)
                )
            )
        except (json.JSONDecodeError, StopIteration, TypeError, ValueError) as exc:
            raise FFmpegError(f"Invalid or corrupted video: {path.name}") from exc
        return {
            "has_video": True,
            "duration": duration,
            "codec": video_stream.get("codec_name"),
            "width": video_stream.get("width"),
            "height": video_stream.get("height"),
        }

    def execute(
        self,
        clips: list[Path],
        output_path: Path,
        *,
        output_size: tuple[int, int] = (1080, 1920),
    ) -> Path:
        """Normalize and concatenate exactly six clips."""
        if len(clips) != 6:
            raise ValueError("FFmpeg Engine requires exactly 6 scene clips")
        output_path.parent.mkdir(parents=True, exist_ok=True)
        temporary_directory = output_path.parent / "normalized"
        temporary_directory.mkdir(parents=True, exist_ok=True)
        width, height = output_size
        if width <= 0 or height <= 0:
            raise ValueError("output_size dimensions must be positive")
        video_filter = (
            f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
            f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,"
            "fps=30,format=yuv420p"
        )
        normalized: list[Path] = []
        for number, clip in enumerate(clips, start=1):
            target = temporary_directory / f"scene{number}.mp4"
            self._run(
                [
                    self.ffmpeg_binary,
                    "-y",
                    "-i",
                    str(clip),
                    "-f",
                    "lavfi",
                    "-i",
                    "anullsrc=channel_layout=stereo:sample_rate=48000",
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-vf",
                    video_filter,
                    "-c:v",
                    "libx264",
                    "-c:a",
                    "aac",
                    "-shortest",
                    str(target),
                ]
            )
            normalized.append(target)
        concat_path = temporary_directory / "concat.txt"
        concat_path.write_text(
            "\n".join(
                f"file '{path.resolve().as_posix().replace(chr(39), chr(39) * 2)}'"
                for path in normalized
            ),
            encoding="utf-8",
        )
        self._run(
            [
                self.ffmpeg_binary,
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(concat_path),
                "-c",
                "copy",
                str(output_path),
            ]
        )
        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise FFmpegError("FFmpeg did not create a valid output file")
        return output_path

    def validate(self, output_path: Path) -> bool:
        metadata = self.probe(output_path)
        return bool(metadata["has_video"]) and float(metadata["duration"]) > 0

    def extract_last_frame(self, video_path: Path, output_path: Path) -> Path:
        """Save the final decodable frame for next-scene motion continuity."""
        output_path.parent.mkdir(parents=True, exist_ok=True)
        self._run(
            [
                self.ffmpeg_binary,
                "-y",
                "-sseof",
                "-0.1",
                "-i",
                str(video_path),
                "-frames:v",
                "1",
                str(output_path),
            ]
        )
        if not output_path.is_file() or output_path.stat().st_size == 0:
            raise FFmpegError("FFmpeg did not extract a continuity frame")
        return output_path

    def cleanup(self) -> None:
        """Temporary media is retained for recoverable diagnostics."""
