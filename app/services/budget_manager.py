"""Monthly OpenAI API budget tracking."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import json
from pathlib import Path
from threading import Lock
from typing import Callable, TypeVar


T = TypeVar("T")


DEFAULT_COST_ESTIMATES_USD = {
    "story": 0.05,
    "image": 0.10,
    "long_story_plan": 0.05,
    "long_story_outline": 0.05,
    "episode_story": 0.05,
    "video": 0.50,
}


class BudgetExceededError(RuntimeError):
    """Raised before an API call that would exceed the monthly budget."""


@dataclass(frozen=True, slots=True)
class UsageRecord:
    """One API usage event."""

    timestamp: str
    project_id: str
    api_type: str
    estimated_cost_usd: float
    actual_cost_usd: float
    input_tokens: int = 0
    output_tokens: int = 0
    response_seconds: float = 0.0
    succeeded: bool = True


class BudgetManager:
    """Persist usage and enforce a fixed monthly USD limit."""

    def __init__(
        self,
        storage_path: Path,
        monthly_limit_usd: float = 10.0,
        warning_threshold: float = 0.8,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if monthly_limit_usd <= 0:
            raise ValueError("monthly_limit_usd must be positive")
        if not 0 < warning_threshold <= 1:
            raise ValueError("warning_threshold must be between 0 and 1")
        self.storage_path = storage_path
        self.monthly_limit_usd = monthly_limit_usd
        self.warning_threshold = warning_threshold
        self._clock = clock or (lambda: datetime.now(timezone.utc))
        self._lock = Lock()

    def _load(self) -> list[dict[str, object]]:
        if not self.storage_path.is_file():
            return []
        try:
            data = json.loads(self.storage_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise ValueError("Budget usage file is invalid") from exc
        if not isinstance(data, list):
            raise ValueError("Budget usage file must contain a list")
        return data

    def _current_month(self) -> str:
        return self._clock().strftime("%Y-%m")

    def spent_this_month(self) -> float:
        """Return actual recorded cost for the current UTC month."""
        month = self._current_month()
        return round(
            sum(
                float(item.get("actual_cost_usd", 0.0))
                for item in self._load()
                if str(item.get("timestamp", "")).startswith(month)
            ),
            8,
        )

    def remaining(self) -> float:
        """Return available budget, never below zero."""
        return max(0.0, self.monthly_limit_usd - self.spent_this_month())

    def can_spend(self, estimated_cost_usd: float) -> bool:
        """Check a non-negative estimate against remaining budget."""
        if estimated_cost_usd < 0:
            raise ValueError("estimated_cost_usd cannot be negative")
        return estimated_cost_usd <= self.remaining()

    def require_budget(self, estimated_cost_usd: float) -> None:
        """Raise before a call when its estimate exceeds the budget."""
        if not self.can_spend(estimated_cost_usd):
            raise BudgetExceededError(
                "월 API 예산을 초과하여 요청을 보내지 않았습니다. "
                f"예상 비용 ${estimated_cost_usd:.2f}, "
                f"남은 예산 ${self.remaining():.2f}"
            )

    def warning_level(self) -> str | None:
        """Return the highest documented budget warning level."""
        ratio = self.spent_this_month() / self.monthly_limit_usd
        if ratio >= 1:
            return "100%"
        if ratio >= 0.9:
            return "90%"
        if ratio >= self.warning_threshold:
            return f"{self.warning_threshold:.0%}"
        return None

    def record(self, usage: UsageRecord) -> None:
        """Append one usage record using an atomic replace."""
        if usage.actual_cost_usd < 0 or usage.estimated_cost_usd < 0:
            raise ValueError("Costs cannot be negative")
        with self._lock:
            records = self._load()
            records.append(asdict(usage))
            self.storage_path.parent.mkdir(parents=True, exist_ok=True)
            temporary_path = self.storage_path.with_suffix(".tmp")
            temporary_path.write_text(
                json.dumps(records, ensure_ascii=False, indent=4),
                encoding="utf-8",
            )
            temporary_path.replace(self.storage_path)

    def estimate(self, api_type: str, units: int = 1) -> float:
        """Return a conservative local estimate for a provider operation."""
        if units <= 0:
            raise ValueError("units must be positive")
        unit_cost = DEFAULT_COST_ESTIMATES_USD.get(api_type)
        if unit_cost is None:
            raise ValueError(f"Unsupported budget API type: {api_type}")
        return round(unit_cost * units, 8)

    def run_budgeted(
        self,
        project_id: str,
        api_type: str,
        operation: Callable[[], T],
        *,
        estimated_cost_usd: float | None = None,
    ) -> T:
        """Authorize, execute and persist one provider attempt.

        OpenAI responses used by the current adapters do not expose a reliable
        billed-dollar value. The conservative preflight estimate is therefore
        recorded as actual local usage for both successful and failed provider
        attempts, preventing an error response from silently bypassing budget
        accounting.
        """
        estimate = (
            self.estimate(api_type)
            if estimated_cost_usd is None
            else estimated_cost_usd
        )
        self.require_budget(estimate)
        started = self._clock()
        succeeded = False
        try:
            result = operation()
            succeeded = True
            return result
        finally:
            elapsed = max(
                0.0, (self._clock() - started).total_seconds()
            )
            self.record(UsageRecord(
                timestamp=self._clock().isoformat(),
                project_id=project_id,
                api_type=api_type,
                estimated_cost_usd=estimate,
                actual_cost_usd=estimate,
                response_seconds=elapsed,
                succeeded=succeeded,
            ))

    def summary(self, estimated_next_cost_usd: float = 0.0) -> dict[str, object]:
        """Return GUI-ready budget information without mutating usage."""
        spent = self.spent_this_month()
        remaining = self.remaining()
        return {
            "monthly_limit_usd": self.monthly_limit_usd,
            "spent_usd": spent,
            "remaining_usd": remaining,
            "estimated_next_cost_usd": estimated_next_cost_usd,
            "can_spend": self.can_spend(estimated_next_cost_usd),
            "warning_level": self.warning_level(),
        }
