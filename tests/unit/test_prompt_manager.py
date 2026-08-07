"""Tests for external prompt templates."""

from pathlib import Path
import tempfile
import unittest

from app.engines.prompt_manager import PromptManager


class PromptManagerTest(unittest.TestCase):
    def test_renders_external_template(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "story").mkdir()
            (root / "story" / "basic.txt").write_text(
                "Topic: $topic", encoding="utf-8"
            )
            manager = PromptManager(root)
            manager.initialize()
            prompt = manager.render("story/basic", {"topic": "우주"})
            self.assertEqual(prompt.text, "Topic: 우주")
            self.assertEqual(len(prompt.digest), 64)

    def test_rejects_missing_variable(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "x.txt").write_text("$required", encoding="utf-8")
            manager = PromptManager(root)
            manager.initialize()
            with self.assertRaises(ValueError):
                manager.render("x", {})


if __name__ == "__main__":
    unittest.main()

