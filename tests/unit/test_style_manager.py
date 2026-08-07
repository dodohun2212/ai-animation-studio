"""Tests for Style DNA management."""

from pathlib import Path
import tempfile
import unittest

from app.engines.style_manager import StyleManager, StyleProfile


class StyleManagerTest(unittest.TestCase):
    def test_feedback_persists_and_restores(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = StyleManager(Path(directory))
            manager.initialize()
            manager.execute(["warm", "cinematic"], approved=True)
            manager.save()
            restored = StyleManager(Path(directory))
            restored.initialize()
            self.assertEqual(restored.profile.scores["warm"], 1)

    def test_rejects_out_of_range_profile(self) -> None:
        manager = StyleManager(Path("."))
        with self.assertRaises(ValueError):
            manager.validate(StyleProfile(saturation=1.1))


if __name__ == "__main__":
    unittest.main()

