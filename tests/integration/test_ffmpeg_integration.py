"""Real FFmpeg integration test; Runway itself is intentionally excluded."""

from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

from app.engines.ffmpeg_engine import FFmpegEngine


@unittest.skipUnless(
    shutil.which("ffmpeg") and shutil.which("ffprobe"),
    "FFmpeg and ffprobe are required",
)
class FFmpegIntegrationTest(unittest.TestCase):
    """Generate six tiny clips and verify the documented final format."""

    def test_normalizes_and_merges_six_real_clips(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            clips: list[Path] = []
            for number in range(1, 7):
                path = root / f"scene{number}.mp4"
                result = subprocess.run(
                    [
                        "ffmpeg",
                        "-y",
                        "-f",
                        "lavfi",
                        "-i",
                        f"color=c=blue:s=180x320:d=0.1:r=30",
                        "-c:v",
                        "libx264",
                        "-pix_fmt",
                        "yuv420p",
                        str(path),
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                clips.append(path)
            engine = FFmpegEngine()
            engine.initialize()
            output = engine.execute(clips, root / "final.mp4")
            metadata = engine.probe(output)
            self.assertTrue(metadata["has_video"])
            self.assertGreater(float(metadata["duration"]), 0)
            self.assertEqual(metadata["width"], 1080)
            self.assertEqual(metadata["height"], 1920)


if __name__ == "__main__":
    unittest.main()

