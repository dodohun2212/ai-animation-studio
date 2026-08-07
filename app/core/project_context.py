"""Serializable shared state for the complete production workflow."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import StrEnum
from pathlib import Path
from typing import Any


class WorkflowState(StrEnum):
    """Documented workflow states."""

    INIT = "INIT"
    READY = "READY"
    GENERATING_STORY = "GENERATING_STORY"
    WAITING_FOR_ASSET_MAPPING_REVIEW = "WAITING_FOR_ASSET_MAPPING_REVIEW"
    ASSET_MAPPING_APPROVED = "ASSET_MAPPING_APPROVED"
    GENERATING_IMAGES = "GENERATING_IMAGES"
    IMAGES_READY = "IMAGES_READY"
    IMAGES_REVIEW = "IMAGES_REVIEW"
    WAITING_FOR_VIDEO_CONFIRMATION = "WAITING_FOR_VIDEO_CONFIRMATION"
    GENERATING_VIDEOS = "GENERATING_VIDEOS"
    VIDEOS_READY = "VIDEOS_READY"
    REVIEWING_VIDEOS = "REVIEWING_VIDEOS"
    VIDEOS_APPROVED = "VIDEOS_APPROVED"
    INTERRUPTED = "INTERRUPTED"
    RENDERING = "RENDERING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


_TRANSITIONS: dict[WorkflowState, frozenset[WorkflowState]] = {
    WorkflowState.INIT: frozenset(
        {WorkflowState.READY, WorkflowState.FAILED, WorkflowState.CANCELLED}
    ),
    WorkflowState.READY: frozenset(
        {
            WorkflowState.GENERATING_STORY,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.GENERATING_STORY: frozenset(
        {
            WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW,
            WorkflowState.GENERATING_IMAGES,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW: frozenset(
        {
            WorkflowState.ASSET_MAPPING_APPROVED,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.ASSET_MAPPING_APPROVED: frozenset(
        {
            WorkflowState.GENERATING_IMAGES,
            WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.GENERATING_IMAGES: frozenset(
        {
            WorkflowState.IMAGES_READY,
            WorkflowState.ASSET_MAPPING_APPROVED,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.IMAGES_READY: frozenset(
        {
            WorkflowState.IMAGES_REVIEW,
            WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
            WorkflowState.GENERATING_IMAGES,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.IMAGES_REVIEW: frozenset(
        {
            WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
            WorkflowState.GENERATING_IMAGES,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION: frozenset(
        {
            WorkflowState.GENERATING_VIDEOS,
            WorkflowState.GENERATING_IMAGES,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.GENERATING_VIDEOS: frozenset(
        {
            WorkflowState.VIDEOS_READY,
            WorkflowState.INTERRUPTED,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.VIDEOS_READY: frozenset(
        {
            WorkflowState.REVIEWING_VIDEOS,
            WorkflowState.GENERATING_VIDEOS,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.REVIEWING_VIDEOS: frozenset(
        {
            WorkflowState.VIDEOS_APPROVED,
            WorkflowState.GENERATING_VIDEOS,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.VIDEOS_APPROVED: frozenset(
        {
            WorkflowState.RENDERING,
            WorkflowState.GENERATING_VIDEOS,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.INTERRUPTED: frozenset(
        {
            WorkflowState.GENERATING_VIDEOS,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.RENDERING: frozenset(
        {
            WorkflowState.COMPLETED,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
    ),
    WorkflowState.COMPLETED: frozenset(),
    WorkflowState.FAILED: frozenset(),
    WorkflowState.CANCELLED: frozenset(),
}


@dataclass(slots=True)
class ProjectContext:
    """State shared between engines without direct engine dependencies."""

    project_id: str
    topic: str
    workflow_state: WorkflowState = WorkflowState.INIT
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    character_profile: dict[str, Any] = field(default_factory=dict)
    lore_context: dict[str, Any] = field(default_factory=dict)
    style_profile: dict[str, Any] = field(default_factory=dict)
    references: list[dict[str, Any]] = field(default_factory=list)
    story: dict[str, Any] = field(default_factory=dict)
    scenes: list[dict[str, Any]] = field(default_factory=list)
    image_prompts: list[str] = field(default_factory=list)
    motion_prompts: list[str] = field(default_factory=list)
    generated_images: list[str] = field(default_factory=list)
    image_generation_records: list[dict[str, Any]] = field(default_factory=list)
    generated_image_reviews: list[dict[str, Any]] = field(default_factory=list)
    face_consistency_results: list[dict[str, Any]] = field(default_factory=list)
    generated_video_paths: list[str] = field(default_factory=list)
    video_generation_records: list[dict[str, Any]] = field(default_factory=list)
    video_reviews: list[dict[str, Any]] = field(default_factory=list)
    # Retained only so existing project JSON can be opened safely.
    capcut_clip_paths: list[str] = field(default_factory=list)
    final_video_path: str | None = None
    api_usage: list[dict[str, Any]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    project_type: str = "short_project"
    script_revision: int = 0
    mapping_revision: int = 0

    def __post_init__(self) -> None:
        self.project_id = self.project_id.strip()
        self.topic = self.topic.strip()
        if not self.project_id:
            raise ValueError("project_id is required")
        if not self.topic:
            raise ValueError("topic is required")
        if self.project_type not in {"short_project", "long_story_project"}:
            raise ValueError("Unsupported project_type")
        if not isinstance(self.workflow_state, WorkflowState):
            self.workflow_state = WorkflowState(self.workflow_state)

    def transition_to(self, new_state: WorkflowState) -> None:
        """Apply only a documented workflow transition."""
        state = WorkflowState(new_state)
        if state not in _TRANSITIONS[self.workflow_state]:
            raise ValueError(
                f"Invalid workflow transition: "
                f"{self.workflow_state} -> {state}"
            )
        self.workflow_state = state
        self.updated_at = datetime.now(timezone.utc).isoformat()

    def validate(self, require_complete_scenes: bool = False) -> None:
        """Validate invariants needed by persistence and pipelines."""
        if require_complete_scenes and len(self.scenes) != 6:
            raise ValueError("The workflow requires exactly 6 scenes")
        for field_name in (
            "image_prompts",
            "motion_prompts",
            "generated_images",
            "generated_video_paths",
            "capcut_clip_paths",
        ):
            values = getattr(self, field_name)
            if len(values) > 6:
                raise ValueError(f"{field_name} cannot contain over 6 items")

    def to_dict(self) -> dict[str, Any]:
        """Return a JSON-compatible representation."""
        result = asdict(self)
        result["workflow_state"] = self.workflow_state.value
        return result

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ProjectContext":
        """Restore a context from validated dictionary data."""
        if not isinstance(data, dict):
            raise ValueError("Project context must be an object")
        data = dict(data)
        legacy_state = str(data.get("workflow_state", ""))
        if legacy_state == "WAITING_FOR_CAPCUT":
            data["workflow_state"] = (
                WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION.value
            )
        elif legacy_state == "CAPCUT_CLIPS_READY":
            data["workflow_state"] = WorkflowState.VIDEOS_READY.value
        legacy_clips = data.get("capcut_clip_paths")
        if legacy_clips and not data.get("generated_video_paths"):
            data["generated_video_paths"] = list(legacy_clips)
        allowed = set(cls.__dataclass_fields__)
        unknown = set(data) - allowed
        if unknown:
            raise ValueError(f"Unknown project fields: {sorted(unknown)}")
        context = cls(**data)
        context.validate()
        return context

    @property
    def project_directory_name(self) -> str:
        """Return a path-safe directory name generated by the application."""
        if not all(character.isalnum() or character in "_-" for character in self.project_id):
            raise ValueError("project_id contains unsafe path characters")
        return self.project_id
