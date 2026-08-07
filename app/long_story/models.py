"""Serializable long-story project, bible, episode, and continuity models."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4


EPISODE_STATES = {
    "planned", "planning_review", "outline_ready",
    "script_generating", "script_review",
    "script_approved", "waiting_for_asset_mapping_review",
    "asset_mapping_approved", "images_generating", "images_partial", "images_review",
    "waiting_for_video_confirmation", "videos_generating", "videos_ready",
    "videos_review", "videos_approved", "rendering",
    # Legacy states remain readable for existing saved episodes.
    "waiting_for_capcut", "edited", "upload_ready", "uploaded",
    "completed", "failed",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class LongProject:
    project_id: str
    project_type: str = "long_story_project"
    title: str = ""
    logline: str = ""
    overview: str = ""
    genre: str = ""
    tone: str = ""
    theme: str = ""
    episode_count: int = 1
    episode_duration_seconds: int = 30
    start_date: str = ""
    schedule_type: str = "weekly"
    upload_schedule: str = "weekly"
    ending_direction: str = ""
    platform: str = "YouTube Shorts"
    aspect_ratio: str = "9:16"
    audience: str = ""
    notes: str = ""
    starting_state: str = ""
    midpoint: str = ""
    story_flow_summary: str = ""
    created_at: str = field(default_factory=now)
    updated_at: str = field(default_factory=now)

    def validate(self) -> None:
        if self.project_type != "long_story_project":
            raise ValueError("Invalid long project type")
        if not self.project_id or not self.title.strip():
            raise ValueError("project_id and title are required")
        if not 1 <= self.episode_count <= 365:
            raise ValueError("episode_count must be between 1 and 365")
        if self.episode_duration_seconds <= 0:
            raise ValueError("episode duration must be positive")


@dataclass(slots=True)
class StoryBible:
    basic: dict[str, Any] = field(default_factory=dict)
    world: dict[str, Any] = field(default_factory=dict)
    characters: list[dict[str, Any]] = field(default_factory=list)
    locations: list[dict[str, Any]] = field(default_factory=list)
    props: list[dict[str, Any]] = field(default_factory=list)
    secrets: list[dict[str, Any]] = field(default_factory=list)
    foreshadowing: list[dict[str, Any]] = field(default_factory=list)
    summaries: dict[str, Any] = field(default_factory=dict)
    updated_at: str = field(default_factory=now)

    def add(self, collection: str, data: dict[str, Any], prefix: str) -> dict[str, Any]:
        target = getattr(self, collection)
        item = dict(data)
        id_key = {
            "CHAR": "character_id",
            "LOC": "location_id",
            "PROP": "prop_id",
            "SECRET": "secret_id",
            "FORESHADOW": "foreshadowing_id",
        }.get(prefix, f"{prefix.lower()}_id")
        item.setdefault(id_key, f"{prefix}-{uuid4().hex[:8].upper()}")
        target.append(item)
        self.updated_at = now()
        return item


@dataclass(slots=True)
class Episode:
    episode_id: str
    number: int
    title: str = ""
    summary: str = ""
    core_event: str = ""
    starting_state: str = ""
    conflict: str = ""
    protagonist_goal: str = ""
    character_ids: list[str] = field(default_factory=list)
    location_ids: list[str] = field(default_factory=list)
    prop_ids: list[str] = field(default_factory=list)
    reveal_ids: list[str] = field(default_factory=list)
    hidden_secret_ids: list[str] = field(default_factory=list)
    foreshadowing_ids: list[str] = field(default_factory=list)
    payoff_ids: list[str] = field(default_factory=list)
    cliffhanger: str = ""
    next_connection: str = ""
    duration_seconds: int = 30
    production_date: str = ""
    upload_date: str = ""
    completed_at: str = ""
    notes: str = ""
    approved: bool = False
    state: str = "planned"
    script: dict[str, Any] = field(default_factory=dict)
    script_history: list[dict[str, Any]] = field(default_factory=list)
    generated_images: list[str] = field(default_factory=list)
    image_generation_records: list[dict[str, Any]] = field(default_factory=list)
    failed_scene_numbers: list[int] = field(default_factory=list)
    approved_scene_numbers: list[int] = field(default_factory=list)
    scene_regeneration_history: list[dict[str, Any]] = field(default_factory=list)
    face_consistency_results: list[dict[str, Any]] = field(default_factory=list)
    error: str = ""
    script_revision: int = 0
    mapping_revision: int = 0
    outline: dict[str, Any] = field(default_factory=dict)
    updated_at: str = field(default_factory=now)

    def validate(self) -> None:
        if self.number <= 0 or self.state not in EPISODE_STATES:
            raise ValueError("Invalid episode")
        if self.state == "images_generating" and not self.approved:
            raise ValueError("Script approval is required before images")
        if (
            self.state
            in {"waiting_for_video_confirmation", "waiting_for_capcut"}
            and len(self.approved_scene_numbers) != 6
        ):
            raise ValueError("All six images must be approved")

    def to_dict(self) -> dict[str, Any]:
        self.validate()
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Episode":
        data = dict(data)
        if data.get("state") == "waiting_for_capcut":
            data["state"] = "waiting_for_video_confirmation"
        episode = cls(**data)
        episode.validate()
        return episode


@dataclass(slots=True)
class ContinuityMemory:
    episode_number: int
    episode_summary: str = ""
    events: list[str] = field(default_factory=list)
    appeared_character_ids: list[str] = field(default_factory=list)
    character_changes: list[dict[str, Any]] = field(default_factory=list)
    appeared_location_ids: list[str] = field(default_factory=list)
    item_changes: list[dict[str, Any]] = field(default_factory=list)
    resolved_conflicts: list[str] = field(default_factory=list)
    new_conflicts: list[str] = field(default_factory=list)
    revealed_secret_ids: list[str] = field(default_factory=list)
    remaining_secret_ids: list[str] = field(default_factory=list)
    new_foreshadowing_ids: list[str] = field(default_factory=list)
    resolved_foreshadowing_ids: list[str] = field(default_factory=list)
    next_actions: list[str] = field(default_factory=list)
    time_elapsed: str = ""
    world_changes: list[str] = field(default_factory=list)
    user_edits: str = ""
    updated_at: str = field(default_factory=now)
