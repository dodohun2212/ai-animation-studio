"""Story response validation independent of an AI provider SDK."""

from __future__ import annotations

from typing import Any, Callable


StoryGenerator = Callable[[str], dict[str, Any]]


class StoryEngine:
    """Generate and validate one 30-second, six-scene story."""

    def __init__(self, generator: StoryGenerator) -> None:
        self.generator = generator
        self.initialized = False

    def initialize(self) -> None:
        self.initialized = True

    def execute(self, rendered_prompt: str) -> dict[str, Any]:
        if not self.initialized:
            raise RuntimeError("Story Engine is not initialized")
        story = self.generator(rendered_prompt)
        self.validate(story)
        return story

    def validate(self, story: dict[str, Any]) -> bool:
        required = {"title", "synopsis", "scenes", "ending"}
        if not isinstance(story, dict) or not required.issubset(story):
            raise ValueError("Story response is missing required fields")
        scenes = story["scenes"]
        if not isinstance(scenes, list) or len(scenes) != 6:
            raise ValueError("Story response must contain exactly 6 scenes")
        expected_numbers = list(range(1, 7))
        if [scene.get("number") for scene in scenes] != expected_numbers:
            raise ValueError("Scenes must be numbered 1 through 6")
        if any(not scene.get("description") for scene in scenes):
            raise ValueError("Every scene requires a description")
        return True

    def cleanup(self) -> None:
        self.initialized = False
