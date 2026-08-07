"""Persistent API job audit records and process-wide duplicate protection."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
import os
from pathlib import Path
from threading import Lock, RLock
from typing import Any
from uuid import uuid4


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class APIJob:
    job_id: str
    project_id: str
    project_type: str
    operation: str
    resource_key: str
    user_request_id: str
    episode_number: int | None = None
    scene_number: int | None = None
    created_at: str = field(default_factory=_now)
    started_at: str = ""
    completed_at: str = ""
    status: str = "created"
    expected_api_calls: int = 0
    actual_attempts: int = 0
    successful_calls: int = 0
    failed_calls: int = 0
    retry_count: int = 0
    cache_hits: int = 0
    error_category: str = ""
    cancelled: bool = False
    calls: list[dict[str, Any]] = field(default_factory=list)


class APIJobBlockedError(RuntimeError):
    """Raised before a duplicate or over-concurrency job can call a provider."""


class APIJobManager:
    """Atomic records with locks shared by all service instances in one process."""

    _registry_lock = Lock()
    _active_by_path: dict[str, set[str]] = {}
    _request_ids_by_path: dict[str, set[str]] = {}
    _io_by_path: dict[str, RLock] = {}

    def __init__(self, path: Path, max_concurrent_jobs: int = 1) -> None:
        self.path = path
        self.max_concurrent_jobs = max_concurrent_jobs
        self._path_key = str(path.resolve())
        self.lock_root = path.parent / "job_locks"
        with self._registry_lock:
            self._active_by_path.setdefault(self._path_key, set())
            self._request_ids_by_path.setdefault(self._path_key, set())
            self._io_lock = self._io_by_path.setdefault(self._path_key, RLock())
            has_active_process_jobs = bool(self._active_by_path[self._path_key])
        self.recover_stale_locks()
        if not has_active_process_jobs:
            self._mark_interrupted()

    def begin(
        self,
        *,
        project_id: str,
        project_type: str,
        operation: str,
        resource_key: str,
        expected_api_calls: int,
        user_request_id: str | None = None,
        episode_number: int | None = None,
        scene_number: int | None = None,
    ) -> APIJob:
        request_id = user_request_id or f"REQ-{uuid4().hex[:12].upper()}"
        job_id = f"JOB-{uuid4().hex[:16].upper()}"
        with self._registry_lock:
            active = self._active_by_path[self._path_key]
            requests = self._request_ids_by_path[self._path_key]
            if resource_key in active:
                raise APIJobBlockedError("동일한 생성 작업이 이미 실행 중입니다.")
            if request_id in requests:
                raise APIJobBlockedError("동일 사용자 요청은 두 번 실행할 수 없습니다.")
            if len(active) >= self.max_concurrent_jobs:
                raise APIJobBlockedError("동시 API 생성 작업 한도를 초과했습니다.")
            self._acquire_project_lock(
                project_id, job_id, operation, resource_key
            )
            active.add(resource_key)
            requests.add(request_id)
        job = APIJob(
            job_id=job_id,
            project_id=project_id,
            project_type=project_type,
            operation=operation,
            resource_key=resource_key,
            user_request_id=request_id,
            episode_number=episode_number,
            scene_number=scene_number,
            expected_api_calls=expected_api_calls,
            started_at=_now(),
            status="running",
        )
        try:
            self._upsert(job)
        except Exception:
            with self._registry_lock:
                active.discard(resource_key)
                requests.discard(request_id)
            self._release_project_lock(project_id, job_id)
            raise
        return job

    def record_call(
        self, job: APIJob, *, call_type: str, model: str, status: str,
        cache_hit: bool = False, retries: int = 0, error_category: str = "",
        reference_ids: list[str] | None = None,
        reference_paths: list[str] | None = None,
        reference_reasons: list[str] | None = None,
        provider_request_id: str = "",
    ) -> None:
        if cache_hit:
            job.cache_hits += 1
        else:
            job.actual_attempts += 1 + max(0, retries)
            job.retry_count += max(0, retries)
            if status == "succeeded":
                job.successful_calls += 1
            elif status == "failed":
                job.failed_calls += 1
        job.error_category = error_category
        job.calls.append({
            "request_id": f"CALL-{uuid4().hex[:14].upper()}",
            "call_type": call_type,
            "model": model,
            "timestamp": _now(),
            "status": status,
            "cache_hit": cache_hit,
            "attempt_number": job.actual_attempts,
            "retry_count": retries,
            "error_category": error_category,
            "reference_ids": list(reference_ids or []),
            "reference_paths": list(reference_paths or []),
            "reference_reasons": list(reference_reasons or []),
            "provider_request_id": provider_request_id,
        })
        self._upsert(job)

    def finish(
        self, job: APIJob, status: str, *, error_category: str = ""
    ) -> None:
        job.status = status
        job.completed_at = _now()
        job.error_category = error_category or job.error_category
        self._upsert(job)
        with self._registry_lock:
            self._active_by_path[self._path_key].discard(job.resource_key)
            self._request_ids_by_path[self._path_key].discard(job.user_request_id)
        self._release_project_lock(job.project_id, job.job_id)

    def load_all(self) -> list[APIJob]:
        with self._io_lock:
            if not self.path.is_file():
                return []
            try:
                data = json.loads(self.path.read_text(encoding="utf-8"))
                return [APIJob(**item) for item in data] if isinstance(data, list) else []
            except (OSError, json.JSONDecodeError, TypeError):
                return []

    def interrupted_project_ids(self) -> set[str]:
        """Return projects whose prior owner process ended mid-job."""
        return {
            job.project_id
            for job in self.load_all()
            if job.status == "unknown"
            and job.error_category == "interrupted"
        }

    def _upsert(self, job: APIJob) -> None:
        with self._io_lock:
            jobs = self.load_all()
            existing = next((item for item in jobs if item.job_id == job.job_id), None)
            if existing:
                jobs[jobs.index(existing)] = job
            else:
                jobs.append(job)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps([asdict(item) for item in jobs], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temporary.replace(self.path)

    def _mark_interrupted(self) -> None:
        jobs = self.load_all()
        changed = False
        for job in jobs:
            if job.status == "running":
                if self._project_lock_is_live(job.project_id):
                    continue
                job.status = "unknown"
                job.completed_at = _now()
                job.error_category = "interrupted"
                changed = True
        if changed:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            temporary = self.path.with_suffix(".tmp")
            temporary.write_text(
                json.dumps([asdict(item) for item in jobs], ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            temporary.replace(self.path)

    def _project_lock_is_live(self, project_id: str) -> bool:
        path = self._lock_path(project_id)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            return _process_exists(int(payload.get("pid", 0)))
        except (OSError, json.JSONDecodeError, TypeError, ValueError):
            return False

    def recover_stale_locks(self) -> int:
        """Remove project locks whose owner process no longer exists."""
        if not self.lock_root.is_dir():
            return 0
        removed = 0
        for path in self.lock_root.glob("*.lock"):
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                pid = int(payload.get("pid", 0))
            except (OSError, json.JSONDecodeError, TypeError, ValueError):
                pid = 0
            if pid > 0 and _process_exists(pid):
                continue
            try:
                path.unlink()
                removed += 1
            except FileNotFoundError:
                pass
        return removed

    def _lock_path(self, project_id: str) -> Path:
        safe = "".join(
            character if character.isalnum() or character in "_-" else "_"
            for character in project_id
        )
        if not safe:
            raise APIJobBlockedError("Project ID is invalid for locking")
        return self.lock_root / f"{safe}.lock"

    def _acquire_project_lock(
        self,
        project_id: str,
        job_id: str,
        operation: str,
        resource_key: str,
    ) -> None:
        self.lock_root.mkdir(parents=True, exist_ok=True)
        path = self._lock_path(project_id)
        payload = json.dumps({
            "project_id": project_id,
            "job_id": job_id,
            "operation": operation,
            "resource_key": resource_key,
            "pid": os.getpid(),
            "started_at": _now(),
        }, ensure_ascii=False, indent=2)
        for _attempt in range(2):
            try:
                descriptor = os.open(
                    path,
                    os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                )
                try:
                    os.write(descriptor, payload.encode("utf-8"))
                finally:
                    os.close(descriptor)
                return
            except FileExistsError:
                self.recover_stale_locks()
        raise APIJobBlockedError(
            "같은 프로젝트의 Story, Image 또는 Render 작업이 "
            "다른 프로그램에서 이미 실행 중입니다."
        )

    def _release_project_lock(self, project_id: str, job_id: str) -> None:
        path = self._lock_path(project_id)
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except (FileNotFoundError, OSError, json.JSONDecodeError):
            return
        if str(payload.get("job_id", "")) != job_id:
            return
        try:
            path.unlink()
        except FileNotFoundError:
            pass


def _process_exists(pid: int) -> bool:
    """Return whether a process is alive without terminating it."""
    if pid <= 0:
        return False
    if pid == os.getpid():
        return True
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    except OSError:
        return False
    return True
