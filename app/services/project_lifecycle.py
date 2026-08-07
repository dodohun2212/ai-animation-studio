"""Recoverable project archival used by short and long project UIs."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
from uuid import uuid4


class ProjectLifecycleError(RuntimeError):
    """Raised when a project cannot be safely archived."""


class ProjectLifecycleService:
    def __init__(
        self, projects_root: Path, archive_root: Path, api_jobs_path: Path
    ) -> None:
        self.projects_root = projects_root.resolve()
        self.archive_root = archive_root.resolve()
        self.api_jobs_path = api_jobs_path

    def archive_project(self, project_id: str) -> Path:
        """Move one exact project folder to a recoverable archive."""
        if not project_id or not all(
            character.isalnum() or character in "_-" for character in project_id
        ):
            raise ProjectLifecycleError("프로젝트 ID가 올바르지 않습니다.")
        if self._has_running_job(project_id):
            raise ProjectLifecycleError(
                "API 생성 작업이 진행 중인 프로젝트는 삭제할 수 없습니다."
            )
        source = (self.projects_root / project_id).resolve()
        if source.parent != self.projects_root or not source.is_dir():
            raise ProjectLifecycleError("프로젝트 폴더를 찾을 수 없습니다.")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        destination = (
            self.archive_root
            / f"{project_id}_{stamp}_{uuid4().hex[:6]}"
        )
        self.archive_root.mkdir(parents=True, exist_ok=True)
        try:
            shutil.move(str(source), str(destination))
        except OSError as exc:
            raise ProjectLifecycleError(
                "프로젝트를 보관함으로 이동하지 못했습니다."
            ) from exc
        return destination

    def _has_running_job(self, project_id: str) -> bool:
        if not self.api_jobs_path.is_file():
            return False
        try:
            jobs = json.loads(self.api_jobs_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return False
        return any(
            isinstance(item, dict)
            and item.get("project_id") == project_id
            and item.get("status") in {"created", "confirmed", "running"}
            for item in jobs if isinstance(jobs, list)
        )
