"""Display helpers for the long-story Tkinter workspace."""

from __future__ import annotations

from dataclasses import asdict
import json
from typing import Any, Iterable

from app.long_story.models import Episode, StoryBible
from app.services.reference_asset_manager import EpisodeScope, ReferenceAsset, SceneScope
from app.services.reference_asset_manager import ProjectReferenceManager


STATE_PROGRESS = {
    "planned": 10,
    "planning_review": 15,
    "outline_ready": 18,
    "script_generating": 25,
    "script_review": 35,
    "script_approved": 45,
    "waiting_for_asset_mapping_review": 48,
    "asset_mapping_approved": 55,
    "images_generating": 60,
    "images_partial": 65,
    "images_review": 75,
    "waiting_for_video_confirmation": 82,
    "videos_generating": 85,
    "videos_ready": 88,
    "videos_review": 90,
    "videos_approved": 94,
    "rendering": 97,
    "edited": 90,
    "upload_ready": 94,
    "uploaded": 98,
    "completed": 100,
    "failed": 0,
}


def parse_scope(value: str, *, episode: bool) -> EpisodeScope | SceneScope:
    """Parse all, one number, an inclusive range, or a comma-separated list."""
    raw = value.strip().lower() or "all"
    scope_type = EpisodeScope if episode else SceneScope
    single_key = "episode" if episode else "scene"
    list_key = "episodes" if episode else "scenes"
    if raw == "all":
        return scope_type()
    if "-" in raw:
        start, end = (int(item.strip()) for item in raw.split("-", 1))
        result = scope_type(mode="range", start=start, end=end)
    elif "," in raw:
        result = scope_type(
            mode="list", **{list_key: [int(item.strip()) for item in raw.split(",")]}
        )
    else:
        result = scope_type(mode=single_key, **{single_key: int(raw)})
    result.validate()
    return result


def scope_label(scope: EpisodeScope | SceneScope, noun: str) -> str:
    if scope.mode == "all":
        return f"모든 {noun}"
    if scope.mode in {"episode", "scene"}:
        return f"{noun} {getattr(scope, scope.mode)}"
    if scope.mode == "range":
        return f"{noun} {scope.start}~{scope.end}"
    values = scope.episodes if isinstance(scope, EpisodeScope) else scope.scenes
    return f"{noun} " + ",".join(str(value) for value in values)


def reference_scope_label(asset: ReferenceAsset) -> str:
    return (
        f"{scope_label(asset.episode_scope, 'Episode')} · "
        f"{scope_label(asset.scene_scope, 'Scene')}"
    )


def reference_type_label(asset: ReferenceAsset) -> str:
    if asset.reference_type == "character" and asset.face_baseline:
        return "대표 캐릭터"
    return {
        "character": "캐릭터",
        "background": "배경",
        "object": "소품",
        "style": "화풍",
        "general_reference": "일반 참고 이미지",
    }.get(asset.reference_type, asset.reference_type)


def effective_reference_groups(
    manager: ProjectReferenceManager,
    project_type: str,
    episode_number: int,
    scene_number: int,
) -> tuple[list[ReferenceAsset], list[ReferenceAsset], list[str]]:
    """Mirror the actual short or long image-generation selection path."""
    if project_type == "long_story_project":
        selected, warnings = manager.select_for_episode_scene(
            episode_number, scene_number
        )
        common = [
            item for item in selected
            if item.episode_scope.mode == "all"
            and item.scene_scope.mode == "all"
        ]
    else:
        # Short projects have no episode dimension in ImagePipeline.
        selected, warnings = manager.select_for_scene(scene_number)
        common = [item for item in selected if item.scene_scope.mode == "all"]
    common_ids = {item.asset_id for item in common}
    scene_specific = [
        item for item in selected if item.asset_id not in common_ids
    ]
    return common, scene_specific, warnings


def filter_references(
    assets: Iterable[ReferenceAsset], reference_type: str = "all"
) -> list[ReferenceAsset]:
    return [
        asset for asset in assets
        if reference_type == "all" or asset.reference_type == reference_type
    ]


def filter_episodes(
    episodes: Iterable[Episode], query: str = "", state: str = "all",
    descending: bool = False,
) -> list[Episode]:
    normalized = query.strip().lower()
    selected = [
        episode for episode in episodes
        if (state == "all" or episode.state == state)
        and (
            not normalized
            or normalized in episode.title.lower()
            or normalized in episode.summary.lower()
            or normalized in str(episode.number)
        )
    ]
    return sorted(selected, key=lambda item: item.number, reverse=descending)


def dashboard_metrics(
    episodes: list[Episode], bible: StoryBible, api_calls: int,
    reference_warnings: int,
) -> dict[str, Any]:
    active = next(
        (item for item in episodes if item.state != "completed"),
        episodes[-1] if episodes else None,
    )
    next_episode = next(
        (item for item in episodes if active and item.number > active.number),
        None,
    )
    open_threads = sum(
        str(item.get("status", "open")).lower() not in {"resolved", "closed"}
        for item in [*bible.secrets, *bible.foreshadowing]
    )
    return {
        "current_episode": active.number if active else None,
        "next_episode": next_episode.number if next_episode else None,
        "open_threads": open_threads,
        "reference_warnings": reference_warnings,
        "face_warnings": sum(
            result.get("status") not in {"pass", "passed"}
            for episode in episodes for result in episode.face_consistency_results
        ),
        "api_calls": api_calls,
        "waiting_for_video_confirmation": sum(
            item.state == "waiting_for_video_confirmation" for item in episodes
        ),
        "recent_images": sum(bool(path) for item in episodes for path in item.generated_images),
        "bible_updated_at": bible.updated_at,
    }


def context_length(context: dict[str, Any]) -> int:
    return len(json.dumps(context, ensure_ascii=False))

