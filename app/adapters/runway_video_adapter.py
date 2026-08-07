"""Runway SDK adapter with no workflow or budget responsibilities."""

from __future__ import annotations

import base64
from dataclasses import dataclass
import mimetypes
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from runwayml import (
    APIConnectionError,
    APIError,
    APITimeoutError,
    RateLimitError,
    RunwayML,
)


MAX_DATA_URI_BYTES = 5 * 1024 * 1024


class RunwayAPIError(RuntimeError):
    """Raised for a rejected, malformed, or unreachable Runway request."""


@dataclass(frozen=True, slots=True)
class RunwayTask:
    """Provider-neutral task state returned to the workflow service."""

    task_id: str
    status: str
    output_urls: tuple[str, ...] = ()
    failure: str = ""
    progress: float | None = None

    @property
    def terminal(self) -> bool:
        return self.status in {"SUCCEEDED", "FAILED", "CANCELLED"}


class RunwayVideoAdapter:
    """Translate PRISM FORGE operations to the official Runway SDK."""

    def __init__(
        self,
        api_secret: str,
        *,
        model: str = "gen4_turbo",
        timeout_seconds: float = 60.0,
        client: Any | None = None,
    ) -> None:
        if not api_secret.strip():
            raise ValueError("RUNWAYML_API_SECRET is required")
        self.model = model
        self.timeout_seconds = timeout_seconds
        # Disable SDK retries because the application owns paid retry policy.
        self._client = client or RunwayML(
            api_key=api_secret.strip(),
            timeout=timeout_seconds,
            max_retries=0,
        )

    def create_image_to_video(
        self,
        image_path: Path,
        prompt: str,
        *,
        ratio: str = "720:1280",
        duration: int = 5,
    ) -> str:
        """Create one paid task and immediately return its persistent ID."""
        text = prompt.strip()
        if not text:
            raise ValueError("Runway prompt cannot be empty")
        if len(text.encode("utf-16-le")) // 2 > 1000:
            raise ValueError("Runway prompt exceeds 1000 UTF-16 code units")
        try:
            response = self._client.image_to_video.create(
                model=self.model,
                prompt_image=self._image_data_uri(image_path),
                prompt_text=text,
                ratio=ratio,
                duration=duration,
            )
        except (RateLimitError, APITimeoutError, APIConnectionError, APIError) as exc:
            raise RunwayAPIError(self._safe_sdk_error(exc)) from exc
        task_id = str(getattr(response, "id", "")).strip()
        if not task_id:
            raise RunwayAPIError("Runway response did not contain a task ID")
        return task_id

    def get_task(self, task_id: str) -> RunwayTask:
        """Retrieve one task once; polling cadence remains app-controlled."""
        if not task_id.strip():
            raise ValueError("task_id is required")
        try:
            response = self._client.tasks.retrieve(task_id)
        except (RateLimitError, APITimeoutError, APIConnectionError, APIError) as exc:
            raise RunwayAPIError(self._safe_sdk_error(exc)) from exc
        status = str(getattr(response, "status", "")).upper()
        if not status:
            raise RunwayAPIError("Runway task response has no status")
        raw_output = getattr(response, "output", None) or []
        if isinstance(raw_output, str):
            raw_output = [raw_output]
        failure_message = str(getattr(response, "failure", "") or "").strip()
        failure_code = str(
            getattr(response, "failure_code", "") or ""
        ).strip()
        failure = failure_message
        if failure_code and failure_code.lower() not in failure_message.lower():
            failure = (
                f"{failure_message} (Runway code: {failure_code})"
                if failure_message else f"Runway code: {failure_code}"
            )
        raw_progress = getattr(response, "progress", None)
        progress = (
            float(raw_progress) if raw_progress is not None else None
        )
        return RunwayTask(
            task_id=task_id,
            status=status,
            output_urls=tuple(
                str(item) for item in raw_output if str(item).strip()
            ),
            failure=failure,
            progress=progress,
        )

    def download_output(self, url: str, destination: Path) -> Path:
        """Download an ephemeral output immediately using an atomic replace."""
        if not url.startswith(("https://", "http://")):
            raise RunwayAPIError("Runway output URL is invalid")
        request = Request(url, method="GET")
        temporary = destination.with_suffix(destination.suffix + ".part")
        destination.parent.mkdir(parents=True, exist_ok=True)
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                data = response.read()
        except (HTTPError, URLError, TimeoutError, OSError) as exc:
            raise RunwayAPIError("Runway output download failed") from exc
        if not data:
            raise RunwayAPIError("Runway output download was empty")
        temporary.write_bytes(data)
        temporary.replace(destination)
        return destination

    @staticmethod
    def _safe_sdk_error(error: Exception) -> str:
        """Return a useful category without leaking headers or API secrets."""
        if isinstance(error, RateLimitError):
            return "Runway request was rate limited"
        if isinstance(error, APITimeoutError):
            return "Runway API request timed out"
        if isinstance(error, APIConnectionError):
            return "Runway API connection failed"
        status_code = getattr(error, "status_code", None)
        if status_code:
            return f"Runway API rejected the request ({status_code})"
        return "Runway API request failed"

    @staticmethod
    def _image_data_uri(image_path: Path) -> str:
        path = image_path.resolve()
        if not path.is_file():
            raise FileNotFoundError(path)
        size = path.stat().st_size
        if size <= 0:
            raise ValueError("Reference image is empty")
        if size > MAX_DATA_URI_BYTES:
            raise ValueError(
                "Reference image exceeds Runway's 5 MB data-URI limit"
            )
        mime = mimetypes.guess_type(path.name)[0] or "image/png"
        if not mime.startswith("image/"):
            raise ValueError("Reference file must be an image")
        encoded = base64.b64encode(path.read_bytes()).decode("ascii")
        return f"data:{mime};base64,{encoded}"
