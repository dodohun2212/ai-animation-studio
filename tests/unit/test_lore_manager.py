"""Tests for Lore consistency."""

from pathlib import Path
import tempfile
import unittest

from app.engines.lore_manager import LoreManager


class LoreManagerTest(unittest.TestCase):
    def test_persists_location(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = LoreManager(Path(directory))
            manager.initialize()
            manager.add(
                "locations", {"id": "LORE-0001", "name": "별빛 도시"}
            )
            manager.cleanup()
            restored = LoreManager(Path(directory))
            restored.initialize()
            self.assertIsNotNone(restored.find("locations", "별빛 도시"))

    def test_rejects_duplicate_name(self) -> None:
        manager = LoreManager(Path("."))
        manager.add("events", {"id": "LORE-0001", "name": "개막"})
        with self.assertRaises(ValueError):
            manager.add("events", {"id": "LORE-0002", "name": "개막"})


if __name__ == "__main__":
    unittest.main()

