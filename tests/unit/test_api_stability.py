"""Paid-call stability protection without real provider requests."""

from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest

from app.adapters.openai_common import (
    OpenAIAdapterError,
    call_with_retry,
    classify_openai_error,
)
from app.engines.image_engine import ImageEngine, PNG_SIGNATURE
from app.services.api_job_manager import APIJobBlockedError, APIJobManager
from app.services.api_call_guard import APICallGuard, APICallLimitError
from app.services.memory_manager import MemoryManager
from app.core.project_context import ProjectContext, WorkflowState


class ProviderError(Exception):
    def __init__(self, status_code: int, code: str = "") -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code


class APIStabilityTest(unittest.TestCase):
    def test_job_duplicate_request_resource_and_concurrency_are_blocked(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = APIJobManager(Path(directory) / "jobs.json", 1)
            first = manager.begin(
                project_id="p1", project_type="short_project",
                operation="story", resource_key="p1:story",
                expected_api_calls=1, user_request_id="click-1",
            )
            with self.assertRaises(APIJobBlockedError):
                manager.begin(
                    project_id="p1", project_type="short_project",
                    operation="story", resource_key="p1:story",
                    expected_api_calls=1, user_request_id="click-2",
                )
            with self.assertRaises(APIJobBlockedError):
                manager.begin(
                    project_id="p2", project_type="short_project",
                    operation="story", resource_key="p2:story",
                    expected_api_calls=1, user_request_id="click-3",
                )
            manager.finish(first, "completed")
            second = manager.begin(
                project_id="p1", project_type="short_project",
                operation="story", resource_key="p1:story",
                expected_api_calls=1, user_request_id="click-2",
            )
            manager.finish(second, "completed")

    def test_different_projects_allowed_when_concurrency_is_two(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = APIJobManager(Path(directory) / "jobs.json", 2)
            one = manager.begin(
                project_id="one", project_type="short_project",
                operation="story", resource_key="one:story", expected_api_calls=1,
            )
            two = manager.begin(
                project_id="two", project_type="short_project",
                operation="story", resource_key="two:story", expected_api_calls=1,
            )
            manager.finish(one, "completed")
            manager.finish(two, "completed")

    def test_same_project_is_locked_across_manager_instances(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "jobs.json"
            first_manager = APIJobManager(path, 2)
            second_manager = APIJobManager(path, 2)
            job = first_manager.begin(
                project_id="shared", project_type="short_project",
                operation="story", resource_key="shared:story",
                expected_api_calls=1,
            )
            third_manager = APIJobManager(path, 2)
            self.assertEqual(
                third_manager.load_all()[0].status,
                "running",
            )
            with self.assertRaises(APIJobBlockedError):
                second_manager.begin(
                    project_id="shared", project_type="short_project",
                    operation="images", resource_key="shared:images",
                    expected_api_calls=6,
                )
            first_manager.finish(job, "completed")

    def test_stale_project_lock_is_recovered(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            lock_root = root / "job_locks"
            lock_root.mkdir()
            (lock_root / "stale.lock").write_text(
                '{"project_id":"stale","job_id":"old","pid":999999999}',
                encoding="utf-8",
            )
            manager = APIJobManager(root / "jobs.json", 1)
            self.assertFalse((lock_root / "stale.lock").exists())
            job = manager.begin(
                project_id="stale", project_type="short_project",
                operation="story", resource_key="stale:story",
                expected_api_calls=1,
            )
            manager.finish(job, "completed")

    def test_interrupted_image_project_returns_to_saved_retry_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            memory = MemoryManager(root / "projects")
            context = ProjectContext("p1", "topic")
            context.workflow_state = WorkflowState.GENERATING_IMAGES
            context.generated_images = ["scene1.png", "scene2.png"]
            memory.save(context)
            recovered = memory.recover_interrupted({"p1"})
            loaded = memory.load("p1")
            self.assertEqual(recovered, 1)
            self.assertEqual(
                loaded.workflow_state,
                WorkflowState.ASSET_MAPPING_APPROVED,
            )
            self.assertEqual(
                loaded.generated_images,
                ["scene1.png", "scene2.png"],
            )

    def test_job_audit_record_has_attempt_retry_and_provider_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = APIJobManager(Path(directory) / "jobs.json", 1)
            job = manager.begin(
                project_id="p", project_type="long_story_project",
                operation="episode_image_generation", resource_key="p:ep1",
                expected_api_calls=6, episode_number=1,
            )
            manager.record_call(
                job, call_type="image", model="fake", status="succeeded",
                retries=1, reference_ids=["RA-1"],
                reference_paths=["reference-front.png"],
                reference_reasons=["정면 키워드 감지"],
                provider_request_id="req_fake",
            )
            manager.finish(job, "completed")
            loaded = manager.load_all()[0]
            self.assertEqual(loaded.actual_attempts, 2)
            self.assertEqual(loaded.retry_count, 1)
            self.assertEqual(loaded.calls[0]["provider_request_id"], "req_fake")
            self.assertEqual(
                loaded.calls[0]["reference_paths"],
                ["reference-front.png"],
            )
            self.assertEqual(
                loaded.calls[0]["reference_reasons"],
                ["정면 키워드 감지"],
            )

    def test_retry_is_bounded_and_non_retryable_errors_stop(self) -> None:
        attempts = 0
        sleeps: list[float] = []

        def temporary_failure():
            nonlocal attempts
            attempts += 1
            if attempts < 3:
                raise ProviderError(500)
            return "ok"

        result, retries = call_with_retry(
            temporary_failure, 2, sleeper=sleeps.append
        )
        self.assertEqual((result, retries, attempts), ("ok", 2, 3))
        self.assertEqual(sleeps, [0.5, 1.0])
        for error in (
            ProviderError(401),
            ProviderError(402),
            ProviderError(400),
            ProviderError(429, "insufficient_quota"),
            ProviderError(400, "content_policy_violation"),
        ):
            calls = 0

            def fail():
                nonlocal calls
                calls += 1
                raise error

            with self.assertRaises(OpenAIAdapterError):
                call_with_retry(fail, 2, sleeper=lambda _seconds: None)
            self.assertEqual(calls, 1)

    def test_retry_classification(self) -> None:
        self.assertEqual(classify_openai_error(ProviderError(429)), ("rate_limit", True))
        self.assertEqual(classify_openai_error(ProviderError(503)), ("server", True))
        timeout = type("TimeoutError", (Exception,), {})()
        self.assertEqual(classify_openai_error(timeout), ("network", True))

    def test_corrupt_cache_is_ignored_and_replaced(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            calls = 0

            def generate(_prompt: str, _references: list[Path]) -> bytes:
                nonlocal calls
                calls += 1
                return PNG_SIGNATURE + b"valid"

            engine = ImageEngine(generate, root / "out", root / "cache", "namespace")
            engine.initialize()
            cache = engine.cache_path("prompt", [])
            cache.write_bytes(b"broken")
            engine.execute(1, "prompt", [])
            self.assertEqual(calls, 1)
            self.assertTrue(cache.read_bytes().startswith(PNG_SIGNATURE))

    def test_cache_key_tracks_reference_order_and_model_namespace(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = root / "first.png"
            second = root / "second.png"
            first.write_bytes(b"first")
            second.write_bytes(b"second")
            one = ImageEngine(lambda *_: b"", root / "o", root / "c", "model-a")
            two = ImageEngine(lambda *_: b"", root / "o", root / "c", "model-b")
            self.assertNotEqual(
                one.cache_path("prompt", [first, second]),
                one.cache_path("prompt", [second, first]),
            )
            self.assertNotEqual(
                one.cache_path("prompt", [first]),
                two.cache_path("prompt", [first]),
            )

    def test_daily_limit_persists_and_blocks_before_extra_record(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "calls.json"
            APICallGuard(path, 2).record("one", "p", "story")
            APICallGuard(path, 2).record("two", "p", "image")
            with self.assertRaises(APICallLimitError):
                APICallGuard(path, 2).record("three", "p", "image")
            import json
            self.assertEqual(len(json.loads(path.read_text(encoding="utf-8"))), 2)


if __name__ == "__main__":
    unittest.main()

