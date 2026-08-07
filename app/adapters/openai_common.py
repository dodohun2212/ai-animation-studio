"""Shared OpenAI adapter errors and bounded retry policy."""

from __future__ import annotations

import time
from typing import Callable, TypeVar


class OpenAIAdapterError(RuntimeError):
    """Classified, user-facing OpenAI request failure."""

    def __init__(self, category: str, message: str) -> None:
        super().__init__(message)
        self.category = category


T = TypeVar("T")


def call_with_retry(
    operation: Callable[[], T], max_retries: int,
    *, sleeper: Callable[[float], None] = time.sleep,
    max_backoff_seconds: float = 4.0,
) -> tuple[T, int]:
    retries = 0
    while True:
        try:
            return operation(), retries
        except Exception as exc:
            category, retryable = classify_openai_error(exc)
            if not retryable or retries >= max_retries:
                raise OpenAIAdapterError(category, korean_error(category)) from exc
            retry_after = _retry_after_seconds(exc)
            delay = (
                retry_after if retry_after is not None
                else 0.5 * (2 ** retries)
            )
            sleeper(max(0.0, min(max_backoff_seconds, delay)))
            retries += 1


def classify_openai_error(exc: Exception) -> tuple[str, bool]:
    name = type(exc).__name__.lower()
    status = getattr(exc, "status_code", None)
    code = str(
        getattr(exc, "code", "")
        or getattr(getattr(exc, "error", None), "code", "")
    ).lower()
    message = str(exc).lower()
    if status == 401 or "authentication" in name:
        return "authentication", False
    if (
        status in {402, 403}
        or "permission" in name
        or code in {"insufficient_quota", "billing_hard_limit_reached"}
        or "insufficient_quota" in message
    ):
        return "quota_or_permission", False
    if (
        code in {"content_policy_violation", "safety_violation"}
        or "content policy" in message
        or "safety" in name
    ):
        return "safety_policy", False
    if status == 429 or "ratelimit" in name:
        return "rate_limit", True
    if status is not None and 500 <= status <= 599:
        return "server", True
    if "timeout" in name or "connection" in name:
        return "network", True
    if status == 400 or "badrequest" in name:
        return "invalid_request", False
    return "unknown", False


def _retry_after_seconds(exc: Exception) -> float | None:
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", None) or getattr(exc, "headers", None)
    if headers:
        value = headers.get("retry-after") or headers.get("Retry-After")
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    return None


def korean_error(category: str) -> str:
    return {
        "authentication": "OpenAI API 키 인증에 실패했습니다.",
        "quota_or_permission": "OpenAI 사용 한도 또는 프로젝트 권한을 확인하세요.",
        "rate_limit": "OpenAI 요청 한도를 초과했습니다. 잠시 후 다시 시도하세요.",
        "server": "OpenAI 서버의 일시적인 오류가 반복되었습니다.",
        "network": "OpenAI 연결 시간이 초과되거나 네트워크 연결에 실패했습니다.",
        "invalid_request": "모델, 이미지 크기, 품질 또는 요청 형식이 지원되지 않습니다.",
        "safety_policy": "안전 정책에 따라 요청이 거부되었습니다. 자동 재시도하지 않습니다.",
        "unknown": "OpenAI 요청을 완료하지 못했습니다.",
    }[category]
