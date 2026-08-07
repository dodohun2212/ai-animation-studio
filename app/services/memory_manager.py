"""Local JSON persistence and project resume support."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import shutil

from app.core.project_context import ProjectContext, WorkflowState


class MemoryError(ValueError):
    """Raised when persisted project data is missing or invalid."""


class MemoryManager:
    """Save and restore project contexts in documented project folders."""

    def __init__(self, projects_directory: Path) -> None:
        self.projects_directory = projects_directory

    def project_directory(self, project_id: str) -> Path:
        """Resolve a generated project ID within the storage root."""
        if not project_id or not all(
            character.isalnum() or character in "_-" for character in project_id
        ):
            raise MemoryError("Invalid project ID")
        return self.projects_directory / project_id

    def save(self, context: ProjectContext) -> Path:
        """Validate and atomically save `project.json` as UTF-8."""
        context.validate()
        project_directory = self.project_directory(
            context.project_directory_name
        )
        project_directory.mkdir(parents=True, exist_ok=True)
        destination = project_directory / "project.json"
        temporary = project_directory / "project.tmp"
        temporary.write_text(
            json.dumps(context.to_dict(), ensure_ascii=False, indent=4),
            encoding="utf-8",
        )
        temporary.replace(destination)
        return destination

    def load(self, project_id: str) -> ProjectContext:
        """Load a project and reject malformed JSON or mismatched IDs."""
        path = self.project_directory(project_id) / "project.json"
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            context = ProjectContext.from_dict(data)
        except (OSError, json.JSONDecodeError, ValueError) as exc:
            raise MemoryError(f"Cannot load project {project_id}") from exc
        if context.project_id != project_id:
            raise MemoryError("Stored project ID does not match its directory")
        return context

    def list_projects(
        self, state: WorkflowState | None = None
    ) -> list[ProjectContext]:
        """Return valid projects newest-first, optionally filtered by state."""
        if not self.projects_directory.is_dir():
            return []
        contexts: list[ProjectContext] = []
        for directory in self.projects_directory.iterdir():
            if not directory.is_dir():
                continue
            try:
                context = self.load(directory.name)
            except MemoryError:
                continue
            if state is None or context.workflow_state == state:
                contexts.append(context)
        return sorted(contexts, key=lambda item: item.updated_at, reverse=True)

    def recover_interrupted(self, project_ids: set[str]) -> int:
        """Move interrupted active states back to their saved retry gate.

        Completed story and scene checkpoint data is retained. Only the
        transient state changes, so the normal GenerationService/ImagePipeline
        resume path skips valid saved images.
        """
        recovered = 0
        retry_states = {
            WorkflowState.GENERATING_STORY: WorkflowState.READY,
            WorkflowState.GENERATING_IMAGES:
                WorkflowState.ASSET_MAPPING_APPROVED,
            WorkflowState.GENERATING_VIDEOS: WorkflowState.INTERRUPTED,
            WorkflowState.RENDERING: WorkflowState.VIDEOS_APPROVED,
        }
        for project_id in project_ids:
            try:
                context = self.load(project_id)
            except MemoryError:
                continue
            retry_state = retry_states.get(context.workflow_state)
            if retry_state is None:
                continue
            context.workflow_state = retry_state
            context.warnings.append(
                "이전 실행이 중단되어 저장된 체크포인트에서 재개할 수 있습니다."
            )
            self.save(context)
            self.append_event(
                project_id,
                "PROJECT_INTERRUPTED_RECOVERED",
                {"retry_state": retry_state.value},
            )
            recovered += 1
        return recovered

    def backup(self, context: ProjectContext, backup_directory: Path) -> Path:
        """Copy a completed project's JSON to the documented backup area."""
        source = self.save(context)
        backup_directory.mkdir(parents=True, exist_ok=True)
        destination = (
            backup_directory / f"{context.project_id}_backup.json"
        )
        shutil.copy2(source, destination)
        return destination

    def append_event(
        self, project_id: str, event: str, payload: dict[str, object] | None = None
    ) -> Path:
        """Append one JSON-lines event without exposing log secrets."""
        event_path = self.project_directory(project_id) / "events.jsonl"
        event_path.parent.mkdir(parents=True, exist_ok=True)
        record = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event,
            "payload": payload or {},
        }
        with event_path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + "\n")
        return event_path
