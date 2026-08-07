"""Style DNA persistence and deterministic profile updates."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import json
from pathlib import Path
from typing import Any


@dataclass(slots=True)
class StyleProfile:
    """Brand-level visual direction, not an artist imitation."""

    name: str = "default"
    color_palette: dict[str, str] = field(default_factory=dict)
    lighting: str = "cinematic"
    composition: str = "medium shot"
    camera: str = "static"
    mood: str = "adventure"
    rendering: dict[str, str] = field(default_factory=dict)
    background_density: float = 0.5
    contrast: float = 0.5
    saturation: float = 0.5
    scores: dict[str, int] = field(default_factory=dict)


class StyleManager:
    """Load, update, validate, and save one Style DNA profile."""

    def __init__(self, storage_directory: Path) -> None:
        self.storage_directory = storage_directory
        self.profile_path = storage_directory / "style_profile.json"
        self.profile = StyleProfile()

    def initialize(self) -> None:
        self.storage_directory.mkdir(parents=True, exist_ok=True)
        if self.profile_path.is_file():
            self.profile = self.load()

    def load(self) -> StyleProfile:
        try:
            data = json.loads(self.profile_path.read_text(encoding="utf-8"))
            profile = StyleProfile(**data)
        except (OSError, json.JSONDecodeError, TypeError) as exc:
            raise ValueError("Invalid style profile") from exc
        self.validate(profile)
        return profile

    def save(self, profile: StyleProfile | None = None) -> Path:
        selected = profile or self.profile
        self.validate(selected)
        self.storage_directory.mkdir(parents=True, exist_ok=True)
        self.profile_path.write_text(
            json.dumps(asdict(selected), ensure_ascii=False, indent=4),
            encoding="utf-8",
        )
        self.profile = selected
        return self.profile_path

    def apply_feedback(
        self, attributes: list[str], approved: bool
    ) -> StyleProfile:
        """Raise approved attribute scores and lower rejected ones."""
        adjustment = 1 if approved else -1
        for attribute in {item.strip().lower() for item in attributes if item.strip()}:
            current = self.profile.scores.get(attribute, 0)
            self.profile.scores[attribute] = max(-10, min(10, current + adjustment))
        return self.profile

    def execute(self, attributes: list[str], approved: bool) -> StyleProfile:
        return self.apply_feedback(attributes, approved)

    def validate(self, profile: StyleProfile | None = None) -> bool:
        selected = profile or self.profile
        for value in (
            selected.background_density,
            selected.contrast,
            selected.saturation,
        ):
            if not 0 <= value <= 1:
                raise ValueError("Style numeric values must be between 0 and 1")
        forbidden = ("in the style of", "작가 화풍", "화풍 복제")
        combined = " ".join(
            [selected.name, selected.lighting, selected.mood]
            + list(selected.rendering.values())
        ).lower()
        if any(term in combined for term in forbidden):
            raise ValueError("Artist or work style imitation is not allowed")
        return True

    def cleanup(self) -> None:
        self.save()

    def prompt_data(self) -> dict[str, Any]:
        """Return structured data for Prompt Manager."""
        return asdict(self.profile)
