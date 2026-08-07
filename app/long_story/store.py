"""Atomic, project-contained persistence for long-story data."""

from __future__ import annotations

from dataclasses import asdict
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
from typing import Any

from app.long_story.models import ContinuityMemory, Episode, LongProject, StoryBible


class LongStoryStore:
    def __init__(self, projects_root: Path, project_id: str) -> None:
        if not project_id or not all(c.isalnum() or c in "_-" for c in project_id):
            raise ValueError("Invalid project ID")
        self.project_root = (projects_root / project_id).resolve()
        self.root = self.project_root / "long_story"
        self.episodes_root = self.root / "episodes"
        self.container_episodes_root = self.root

    def episode_root(self, number: int) -> Path:
        """Return the v1.3 short-project-compatible Episode directory."""
        return self.container_episodes_root / f"Episode{number:02d}"

    def _write(self, path: Path, payload: Any) -> Path:
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        temporary.replace(path)
        return path

    def _read(self, path: Path, default: Any) -> Any:
        if not path.is_file():
            return default
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError(f"Invalid long-story data: {path.name}") from exc

    def save_project(self, project: LongProject) -> Path:
        project.validate()
        return self._write(self.root / "project.json", asdict(project))

    def load_project(self) -> LongProject:
        project = LongProject(**self._read(self.root / "project.json", {}))
        project.validate()
        return project

    def save_bible(self, bible: StoryBible) -> Path:
        return self._write(self.root / "story_bible.json", asdict(bible))

    def load_bible(self) -> StoryBible:
        return StoryBible(**self._read(self.root / "story_bible.json", {}))

    def save_episode(self, episode: Episode) -> Path:
        legacy = self._write(
            self.episodes_root / f"episode_{episode.number:03d}" / "episode.json",
            episode.to_dict(),
        )
        root = self.episode_root(episode.number)
        payload = episode.to_dict()
        self._write(root / "project.json", payload)
        self._write(root / "outline.json", episode.outline)
        self._write(root / "script.json", episode.script)
        (root / "images").mkdir(parents=True, exist_ok=True)
        self.save_episode_outlines()
        return legacy

    def load_episode(self, number: int) -> Episode:
        modern = self.episode_root(number) / "project.json"
        legacy = self.episodes_root / f"episode_{number:03d}" / "episode.json"
        data = self._read(modern, {}) or self._read(legacy, {})
        if not data:
            raise ValueError(f"Episode {number} does not exist")
        script = self._read(self.episode_root(number) / "script.json", None)
        if script is not None:
            data["script"] = script
        outline = self._read(self.episode_root(number) / "outline.json", None)
        if outline is not None:
            data["outline"] = outline
        return Episode.from_dict(data)

    def list_episodes(self) -> list[Episode]:
        modern_paths = sorted(self.root.glob("Episode*/project.json"))
        if modern_paths:
            episodes = []
            for path in modern_paths:
                data = self._read(path, {})
                script = self._read(path.parent / "script.json", None)
                if script is not None:
                    data["script"] = script
                outline = self._read(path.parent / "outline.json", None)
                if outline is not None:
                    data["outline"] = outline
                episodes.append(Episode.from_dict(data))
            return sorted(episodes, key=lambda item: item.number)
        if not self.episodes_root.is_dir():
            return []
        episodes = []
        for path in sorted(self.episodes_root.glob("episode_*/episode.json")):
            episodes.append(Episode.from_dict(self._read(path, {})))
        return sorted(episodes, key=lambda item: item.number)

    def save_episode_outlines(self) -> Path:
        """Atomically refresh the long-project outline index."""
        outlines: list[dict[str, Any]] = []
        modern_paths = sorted(self.root.glob("Episode*/project.json"))
        for path in modern_paths:
            data = self._read(path, {})
            outline = self._read(path.parent / "outline.json", {})
            if not outline:
                outline = _outline_from_episode_data(data)
            outlines.append(outline)
        return self._write(self.root / "episode_outlines.json", outlines)

    def load_episode_outlines(self) -> list[dict[str, Any]]:
        """Load outlines or derive them from compatible existing Episodes."""
        path = self.root / "episode_outlines.json"
        if path.is_file():
            payload = self._read(path, [])
            if not isinstance(payload, list):
                raise ValueError("Invalid episode_outlines.json")
            return payload
        return [
            episode.outline or _outline_from_episode_data(episode.to_dict())
            for episode in self.list_episodes()
        ]

    def migrate_legacy_outlines(self) -> int:
        """Back up and add missing outlines without changing existing scripts."""
        if (self.root / "episode_outlines.json").is_file():
            return 0
        episodes = self.list_episodes()
        if not episodes:
            return 0
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = self.root / "migration_backups" / f"outlines-{stamp}"
        backup.mkdir(parents=True, exist_ok=False)
        for source in (
            self.root / "project.json",
            self.root / "story_bible.json",
        ):
            if source.is_file():
                shutil.copy2(source, backup / source.name)
        migrated = 0
        for episode in episodes:
            root = self.episode_root(episode.number)
            for name in ("project.json", "script.json"):
                source = root / name
                if source.is_file():
                    destination = backup / root.name / name
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    shutil.copy2(source, destination)
            if not episode.outline:
                episode.outline = _outline_from_episode_data(episode.to_dict())
                self._write(root / "outline.json", episode.outline)
                migrated += 1
        self.save_episode_outlines()
        return migrated

    def delete_episode(self, number: int) -> None:
        directory = self.episodes_root / f"episode_{number:03d}"
        if directory.is_dir():
            shutil.rmtree(directory)
        modern = self.episode_root(number)
        if modern.is_dir():
            shutil.rmtree(modern)
        self.save_episode_outlines()

    def save_continuity(self, memory: ContinuityMemory) -> Path:
        return self._write(
            self.episodes_root / f"episode_{memory.episode_number:03d}"
            / "continuity.json",
            asdict(memory),
        )

    def load_continuity(self, number: int) -> ContinuityMemory | None:
        data = self._read(
            self.episodes_root / f"episode_{number:03d}" / "continuity.json",
            None,
        )
        return ContinuityMemory(**data) if data else None


def _outline_from_episode_data(data: dict[str, Any]) -> dict[str, Any]:
    """Derive a non-destructive outline from legacy detailed Episode data."""
    return {
        "episode_number": int(data.get("number", 0)),
        "title": str(data.get("title", "")),
        "summary": str(
            data.get("summary")
            or data.get("script", {}).get("synopsis", "")
        ),
        "main_event": str(data.get("core_event", "")),
        "conflict": str(data.get("conflict", "")),
        "characters": list(data.get("character_ids", [])),
        "locations": list(data.get("location_ids", [])),
        "objects": list(data.get("prop_ids", [])),
        "reveals": list(data.get("reveal_ids", [])),
        "hidden_secrets": list(data.get("hidden_secret_ids", [])),
        "cliffhanger": str(data.get("cliffhanger", "")),
        "next_episode_hook": str(data.get("next_connection", "")),
        "status": str(data.get("state", "planned")),
    }
