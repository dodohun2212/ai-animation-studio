"""Tests for cached single-scene image generation."""

from pathlib import Path
import tempfile
import unittest

from app.engines.image_engine import ImageEngine, PNG_SIGNATURE


class ImageEngineTest(unittest.TestCase):
    def test_generates_named_scene_and_reuses_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            calls: list[str] = []

            def generate(prompt: str, references: list[Path]) -> bytes:
                calls.append(prompt)
                return PNG_SIGNATURE + b"valid-image"

            root = Path(directory)
            engine = ImageEngine(generate, root / "images", root / "cache")
            engine.initialize()
            first = engine.execute(1, "prompt", [])
            second = engine.execute(1, "prompt", [])
            self.assertEqual(first.name, "scene1.png")
            self.assertEqual(second.read_bytes(), first.read_bytes())
            self.assertEqual(len(calls), 1)

    def test_rejects_invalid_payload(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            engine = ImageEngine(
                lambda prompt, refs: b"bad", root / "images", root / "cache"
            )
            engine.initialize()
            with self.assertRaises(ValueError):
                engine.execute(1, "prompt", [])

    def test_reference_content_change_invalidates_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.png"
            reference.write_bytes(b"version-one")
            calls = 0

            def generate(prompt: str, references: list[Path]) -> bytes:
                nonlocal calls
                calls += 1
                return PNG_SIGNATURE + b"valid-image"

            engine = ImageEngine(
                generate, root / "images", root / "cache", "model|size|quality"
            )
            engine.initialize()
            engine.execute(1, "prompt", [reference])
            reference.write_bytes(b"version-two")
            engine.execute(1, "prompt", [reference])
            self.assertEqual(calls, 2)

    def test_asset_descriptor_fields_invalidate_cache(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            reference = root / "reference.png"
            reference.write_bytes(b"same-content")
            engine = ImageEngine(
                lambda *_: PNG_SIGNATURE + b"image",
                root / "out", root / "cache", "model|size|quality",
            )
            descriptors = (
                "0:ASSET-CHAR-1:v1:character:sha:mapping=1:script=1",
                "0:ASSET-CHAR-2:v1:character:sha:mapping=1:script=1",
                "0:ASSET-CHAR-1:v2:character:sha:mapping=1:script=1",
                "0:ASSET-CHAR-1:v1:style:sha:mapping=1:script=1",
                "0:ASSET-CHAR-1:v1:character:sha:mapping=2:script=1",
            )
            keys = {
                engine.cache_path("prompt", [reference], [descriptor])
                for descriptor in descriptors
            }
            self.assertEqual(len(keys), len(descriptors))


if __name__ == "__main__":
    unittest.main()

