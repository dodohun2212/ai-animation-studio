"""Character profiles with immutable main-character identity."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
import json
from pathlib import Path
from typing import Any


IMMUTABLE_APPEARANCE_FIELDS = frozenset(
    {"face_shape", "eyes", "hair", "primary_color", "signature_prop"}
)


@dataclass(slots=True)
class CharacterProfile:
    """Persistent character identity and mutable current state."""

    character_id: str
    name: str
    role: str
    appearance: dict[str, str]
    personality: dict[str, Any] = field(default_factory=dict)
    emotion: str = "calm"
    current_status: dict[str, Any] = field(default_factory=dict)
    relationships: dict[str, str] = field(default_factory=dict)
    history: list[dict[str, Any]] = field(default_factory=list)
    reference_images: list[str] = field(default_factory=list)


class CharacterManager:
    """Persist profiles and prevent accidental main identity drift."""

    def __init__(self, profiles_directory: Path) -> None:
        self.profiles_directory = profiles_directory
        self.profiles: dict[str, CharacterProfile] = {}

    def initialize(self) -> None:
        self.profiles_directory.mkdir(parents=True, exist_ok=True)
        for path in sorted(self.profiles_directory.glob("*.json")):
            data = json.loads(path.read_text(encoding="utf-8"))
            profile = CharacterProfile(**data)
            self.validate(profile)
            self.profiles[profile.character_id] = profile

    def save(self, profile: CharacterProfile) -> Path:
        self.validate(profile)
        self.profiles_directory.mkdir(parents=True, exist_ok=True)
        path = self.profiles_directory / f"{profile.character_id}.json"
        path.write_text(
            json.dumps(asdict(profile), ensure_ascii=False, indent=4),
            encoding="utf-8",
        )
        self.profiles[profile.character_id] = profile
        return path

    def update(
        self,
        character_id: str,
        *,
        appearance: dict[str, str] | None = None,
        emotion: str | None = None,
        current_status: dict[str, Any] | None = None,
    ) -> CharacterProfile:
        """Update mutable state while protecting main identity fields."""
        profile = self.profiles[character_id]
        if appearance:
            if profile.role == "main":
                for key in IMMUTABLE_APPEARANCE_FIELDS:
                    if key in appearance and appearance[key] != profile.appearance.get(key):
                        raise ValueError(f"Main character {key} cannot change")
            profile.appearance.update(appearance)
        if emotion is not None:
            profile.emotion = emotion
        if current_status is not None:
            profile.current_status.update(current_status)
        self.validate(profile)
        return profile

    def main_character(self) -> CharacterProfile:
        """Return exactly one required main character."""
        matches = [item for item in self.profiles.values() if item.role == "main"]
        if len(matches) != 1:
            raise ValueError("Exactly one main character is required")
        return matches[0]

    def execute(self, character_id: str, **changes: Any) -> CharacterProfile:
        return self.update(character_id, **changes)

    def validate(self, profile: CharacterProfile) -> bool:
        if not profile.character_id.startswith("CHAR-"):
            raise ValueError("Character ID must start with CHAR-")
        if not profile.name.strip():
            raise ValueError("Character name is required")
        if profile.role == "main":
            missing = IMMUTABLE_APPEARANCE_FIELDS - profile.appearance.keys()
            if missing:
                raise ValueError(
                    f"Main character appearance is incomplete: {sorted(missing)}"
                )
            if not profile.reference_images:
                raise ValueError("Main character requires a reference image")
        return True

    def cleanup(self) -> None:
        for profile in self.profiles.values():
            self.save(profile)
