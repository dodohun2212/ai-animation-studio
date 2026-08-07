"""Tests for the reference metadata library."""

from pathlib import Path
import tempfile
import unittest

from app.engines.reference_manager import ReferenceManager


class ReferenceManagerTest(unittest.TestCase):
    def test_registers_and_searches_by_priority_and_tag(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "forest.png"
            image.write_bytes(b"image")
            manager = ReferenceManager(root / "library")
            saved = manager.register(
                image, "background", tags=["forest", "night"], priority=5
            )
            results = manager.search(category="background", tags=["night"])
            self.assertEqual(results[0].reference_id, saved.reference_id)

    def test_rejects_unsupported_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "bad.txt"
            image.write_text("x", encoding="utf-8")
            with self.assertRaises(ValueError):
                ReferenceManager(root / "library").register(image, "style")


if __name__ == "__main__":
    unittest.main()

