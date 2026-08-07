"""Tests for monthly budget enforcement."""

from datetime import datetime, timezone
from pathlib import Path
import tempfile
import unittest

from app.services.budget_manager import (
    BudgetExceededError,
    BudgetManager,
    UsageRecord,
)


NOW = datetime(2026, 7, 26, tzinfo=timezone.utc)


class BudgetManagerTest(unittest.TestCase):
    """Verify persistence, monthly filtering, and blocking."""

    def test_records_cost_and_calculates_remaining(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = BudgetManager(
                Path(directory) / "api_usage.json",
                clock=lambda: NOW,
            )
            manager.record(
                UsageRecord(
                    NOW.isoformat(), "p1", "story", 2.0, 1.5
                )
            )
            self.assertEqual(manager.spent_this_month(), 1.5)
            self.assertEqual(manager.remaining(), 8.5)

    def test_blocks_estimate_over_remaining_budget(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = BudgetManager(
                Path(directory) / "api_usage.json",
                monthly_limit_usd=1.0,
                clock=lambda: NOW,
            )
            with self.assertRaises(BudgetExceededError):
                manager.require_budget(1.01)

    def test_ignores_previous_month(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = BudgetManager(
                Path(directory) / "api_usage.json",
                clock=lambda: NOW,
            )
            manager.record(
                UsageRecord(
                    "2026-06-30T00:00:00+00:00",
                    "p1",
                    "story",
                    9.0,
                    9.0,
                )
            )
            self.assertEqual(manager.spent_this_month(), 0.0)

    def test_budgeted_operation_is_recorded_after_success(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = BudgetManager(
                Path(directory) / "api_usage.json",
                monthly_limit_usd=1.0,
                clock=lambda: NOW,
            )
            self.assertEqual(
                manager.run_budgeted("p1", "story", lambda: "done"),
                "done",
            )
            self.assertEqual(manager.spent_this_month(), 0.05)
            self.assertEqual(manager.summary()["remaining_usd"], 0.95)

    def test_blocked_operation_is_never_executed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = BudgetManager(
                Path(directory) / "api_usage.json",
                monthly_limit_usd=0.04,
                clock=lambda: NOW,
            )
            executed = False

            def operation() -> None:
                nonlocal executed
                executed = True

            with self.assertRaises(BudgetExceededError):
                manager.run_budgeted("p1", "story", operation)
            self.assertFalse(executed)
            self.assertEqual(manager.spent_this_month(), 0.0)

    def test_failed_provider_attempt_is_still_recorded(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = BudgetManager(
                Path(directory) / "api_usage.json",
                clock=lambda: NOW,
            )

            def fail() -> None:
                raise RuntimeError("provider failure")

            with self.assertRaises(RuntimeError):
                manager.run_budgeted("p1", "image", fail)
            self.assertEqual(manager.spent_this_month(), 0.1)


if __name__ == "__main__":
    unittest.main()

