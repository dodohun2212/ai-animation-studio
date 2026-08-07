"""Tests for character identity rules."""

from pathlib import Path
import tempfile
import unittest

from app.engines.character_manager import CharacterManager, CharacterProfile


def main_profile() -> CharacterProfile:
    return CharacterProfile(
        "CHAR-0001",
        "루미",
        "main",
        {
            "face_shape": "round",
            "eyes": "blue",
            "hair": "short silver",
            "primary_color": "cyan",
            "signature_prop": "star bag",
        },
        reference_images=["character/main_character/lumi.png"],
    )


class CharacterManagerTest(unittest.TestCase):
    def test_main_character_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = CharacterManager(Path(directory))
            manager.save(main_profile())
            restored = CharacterManager(Path(directory))
            restored.initialize()
            self.assertEqual(restored.main_character().name, "루미")

    def test_blocks_main_identity_change(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = CharacterManager(Path(directory))
            profile = main_profile()
            manager.save(profile)
            with self.assertRaises(ValueError):
                manager.update(profile.character_id, appearance={"eyes": "red"})


if __name__ == "__main__":
    unittest.main()

