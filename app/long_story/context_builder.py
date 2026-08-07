"""Priority-based context assembly for one selected episode."""

from __future__ import annotations

import json
from typing import Any

from app.long_story.models import Episode, StoryBible
from app.long_story.store import LongStoryStore


class StoryContextBuilder:
    def __init__(self, max_characters: int = 18_000) -> None:
        if max_characters < 2_000:
            raise ValueError("max_characters is too small")
        self.max_characters = max_characters

    def build(
        self,
        store: LongStoryStore,
        bible: StoryBible,
        episode: Episode,
        user_instruction: str = "",
    ) -> dict[str, Any]:
        character_ids = set(episode.character_ids)
        location_ids = set(episode.location_ids)
        prop_ids = set(episode.prop_ids)
        relevant_characters = _dedupe([
            item for item in bible.characters
            if item.get("character_id") in character_ids
        ])
        relevant_locations = _dedupe([
            item for item in bible.locations
            if item.get("location_id") in location_ids
        ])
        relevant_props = _dedupe([
            item for item in bible.props if item.get("prop_id") in prop_ids
        ])
        allowed_secrets = _dedupe([
            item for item in bible.secrets
            if int(item.get("reveal_available_episode", 1)) <= episode.number
        ])
        forbidden_secrets = _dedupe([
            item for item in bible.secrets
            if int(item.get("reveal_available_episode", 1)) > episode.number
        ])
        recent = []
        older = []
        for number in range(1, episode.number):
            memory = store.load_continuity(number)
            if not memory:
                continue
            value = {
                "episode_number": number,
                "summary": memory.episode_summary,
                "events": memory.events,
                "character_changes": memory.character_changes,
                "next_actions": memory.next_actions,
            }
            (recent if number >= episode.number - 3 else older).append(value)
        project = store.load_project()
        payload: dict[str, Any] = {
            "story_bible": {"basic": bible.basic, "world": bible.world},
            "project_overview": {
                "title": project.title,
                "logline": project.logline,
                "overview": project.overview,
                "genre": project.genre,
                "tone": project.tone,
                "theme": project.theme,
                "episode_count": project.episode_count,
                "episode_duration_seconds": project.episode_duration_seconds,
                "ending_direction": project.ending_direction,
                "platform": project.platform,
                "aspect_ratio": project.aspect_ratio,
                "audience": project.audience,
                "notes": project.notes,
                "starting_state": project.starting_state,
                "midpoint": project.midpoint,
                "story_flow_summary": project.story_flow_summary,
            },
            "episode_outline": episode.outline or {
                "number": episode.number,
                "title": episode.title,
                "summary": episode.summary,
                "core_event": episode.core_event,
                "conflict": episode.conflict,
                "cliffhanger": episode.cliffhanger,
                "next_connection": episode.next_connection,
            },
            "recent_continuity": recent,
            "older_compressed_summaries": [
                {"episode_number": item["episode_number"], "summary": item["summary"]}
                for item in older
            ],
            "characters": relevant_characters,
            "locations": relevant_locations,
            "props": relevant_props,
            "unresolved_foreshadowing": _dedupe([
                item for item in bible.foreshadowing
                if item.get("status", "open") in {"open", "planned"}
            ]),
            "revealable_information": allowed_secrets,
            "forbidden_information": forbidden_secrets,
            "user_instruction": user_instruction,
            "included_sections": [],
            "excluded_sections": [],
        }
        payload["included_sections"] = [
            key for key, value in payload.items()
            if key not in {"included_sections", "excluded_sections"} and value
        ]
        while len(json.dumps(payload, ensure_ascii=False)) > self.max_characters:
            if payload["older_compressed_summaries"]:
                payload["older_compressed_summaries"].pop(0)
                payload["excluded_sections"].append("oldest_compressed_summary")
            elif payload["recent_continuity"]:
                payload["recent_continuity"].pop(0)
                payload["excluded_sections"].append("older_recent_continuity")
            elif payload["unresolved_foreshadowing"]:
                payload["unresolved_foreshadowing"].pop()
                payload["excluded_sections"].append("lower_priority_foreshadowing")
            else:
                raise ValueError("Context exceeds the configured maximum size")
        return payload


def _dedupe(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    seen: set[str] = set()
    for item in items:
        key = json.dumps(item, ensure_ascii=False, sort_keys=True)
        if key not in seen:
            seen.add(key)
            result.append(item)
    return result
