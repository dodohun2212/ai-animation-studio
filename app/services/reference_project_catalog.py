"""Read-only project discovery and explicit empty-project creation for Reference UI."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from uuid import uuid4

from app.core.project_context import ProjectContext
from app.long_story.models import LongProject
from app.long_story.service import LongStoryService
from app.long_story.store import LongStoryStore
from app.services.memory_manager import MemoryManager


@dataclass(frozen=True, slots=True)
class ReferenceProjectOption:
    project_id: str
    title: str
    project_type: str


@dataclass(slots=True)
class ReferenceScreenState:
    active_project: ReferenceProjectOption | None = None

    @property
    def project_actions_enabled(self) -> bool:
        return self.active_project is not None


def list_reference_projects(projects_root: Path) -> list[ReferenceProjectOption]:
    """List valid short and long projects without creating or repairing folders."""
    options: list[ReferenceProjectOption] = []
    short_by_id = {
        item.project_id: item
        for item in MemoryManager(projects_root).list_projects()
    }
    if projects_root.is_dir():
        for directory in projects_root.iterdir():
            if not directory.is_dir():
                continue
            long_path = directory / "long_story" / "project.json"
            if long_path.is_file():
                try:
                    project = LongStoryStore(projects_root, directory.name)
                    long_project = project.load_project()
                    options.append(ReferenceProjectOption(
                        long_project.project_id, long_project.title,
                        "long_story_project",
                    ))
                except (OSError, TypeError, ValueError):
                    continue
            elif directory.name in short_by_id:
                short = short_by_id[directory.name]
                options.append(ReferenceProjectOption(
                    short.project_id, short.topic, "short_project"
                ))
    return sorted(options, key=lambda item: (item.title.lower(), item.project_id))


def resolve_reference_project(
    projects_root: Path, project_id: str
) -> ReferenceProjectOption | None:
    """Resolve only an existing valid project with matching stored identity."""
    return next(
        (item for item in list_reference_projects(projects_root)
         if item.project_id == project_id),
        None,
    )


def create_empty_short_project(
    projects_root: Path, title: str
) -> ReferenceProjectOption:
    context = ProjectContext(
        f"project_{uuid4().hex[:12]}", title.strip(),
        project_type="short_project",
    )
    MemoryManager(projects_root).save(context)
    return ReferenceProjectOption(context.project_id, context.topic, context.project_type)


def create_empty_long_project(
    service: LongStoryService, title: str, episode_count: int
) -> ReferenceProjectOption:
    project = LongProject(
        project_id=f"long_{uuid4().hex[:12]}",
        title=title.strip(),
        episode_count=episode_count,
    )
    service.create_project(project)
    return ReferenceProjectOption(
        project.project_id, project.title, project.project_type
    )
