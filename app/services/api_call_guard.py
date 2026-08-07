"""Local duplicate and API-call count protection."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
from threading import Lock


class APICallLimitError(RuntimeError):
    """Raised before a call that exceeds a configured local soft limit."""


class APICallGuard:
    """Track daily calls and reject duplicate active project jobs."""

    _registry_lock = Lock()
    _path_locks: dict[str, Lock] = {}
    _active_by_path: dict[str, set[str]] = {}

    def __init__(self, path: Path, daily_limit: int) -> None:
        self.path = path
        self.daily_limit = daily_limit
        key = str(path.resolve())
        with self._registry_lock:
            self._lock = self._path_locks.setdefault(key, Lock())
            self._active_projects = self._active_by_path.setdefault(key, set())

    def begin(self, project_id: str) -> None:
        with self._lock:
            if project_id in self._active_projects:
                raise APICallLimitError("동일 프로젝트의 생성 작업이 이미 실행 중입니다.")
            self._active_projects.add(project_id)

    def finish(self, project_id: str) -> None:
        with self._lock:
            self._active_projects.discard(project_id)

    def record(self, job_id: str, project_id: str, call_type: str) -> None:
        with self._lock:
            records = self._load()
            today = datetime.now(timezone.utc).date().isoformat()
            if sum(str(item.get("timestamp", "")).startswith(today) for item in records) >= self.daily_limit:
                raise APICallLimitError("앱의 일일 API 호출 한도를 초과했습니다.")
            records.append({
                "timestamp": datetime.now(timezone.utc).isoformat(),
                "job_id": job_id,
                "project_id": project_id,
                "call_type": call_type,
            })
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps(records, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temporary.replace(self.path)

    def _load(self) -> list[dict[str, object]]:
        if not self.path.is_file():
            return []
        try:
            value = json.loads(self.path.read_text(encoding="utf-8"))
            return value if isinstance(value, list) else []
        except (OSError, json.JSONDecodeError):
            return []
