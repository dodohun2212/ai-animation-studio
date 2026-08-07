"""Tests for Story Engine using free mocks only."""

import unittest

from app.adapters.openai_story_adapter import STORY_SCHEMA
from app.engines.story_engine import StoryEngine


def valid_story() -> dict[str, object]:
    return {
        "title": "별빛",
        "synopsis": "모험",
        "scenes": [
            {"number": number, "description": f"장면 {number}"}
            for number in range(1, 7)
        ],
        "ending": "귀환",
    }


class StoryEngineTest(unittest.TestCase):
    def test_story_schema_requires_structured_video_motion_fields(self) -> None:
        scene_schema = STORY_SCHEMA["properties"]["scenes"]["items"]
        required = set(scene_schema["required"])
        self.assertTrue({
            "visual_action", "start_motion", "main_motion", "end_motion",
            "shot_size", "camera_angle", "composition", "lens_feel",
            "focus_subject",
            "camera_motion", "environment_motion", "motion_speed",
            "motion_intensity",
            "expression_change", "continuity_hint",
        }.issubset(required))

    def test_accepts_six_scene_mock_response(self) -> None:
        engine = StoryEngine(lambda prompt: valid_story())
        engine.initialize()
        self.assertEqual(len(engine.execute("prompt")["scenes"]), 6)

    def test_rejects_wrong_scene_count(self) -> None:
        story = valid_story()
        story["scenes"] = []
        engine = StoryEngine(lambda prompt: story)
        engine.initialize()
        with self.assertRaises(ValueError):
            engine.execute("prompt")


if __name__ == "__main__":
    unittest.main()

