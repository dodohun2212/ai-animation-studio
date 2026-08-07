"""v1.3.1 long-project outline-first workflow tests using free fakes."""

from pathlib import Path
import shutil
import tempfile
from threading import Event, Thread
import unittest

from app.config.config import AppConfig
from app.long_story.models import LongProject
from app.long_story.service import LongStoryService
from app.services.budget_manager import BudgetExceededError, BudgetManager


class OutlineAdapter:
    def __init__(self, fail: bool = False) -> None:
        self.calls = 0
        self.fail = fail
        self.prompt = ""

    def generate_outline(self, prompt: str, count: int) -> dict:
        self.calls += 1
        self.prompt = prompt
        if self.fail:
            raise TimeoutError("outline failed")
        return {
            "project": {
                "title": "긴 이야기",
                "logline": "문을 연다",
                "overview": "전체 줄거리",
                "genre": "미스터리",
                "tone": "긴장",
                "theme": "신뢰",
                "starting_state": "평온",
                "midpoint": "배신",
                "ending_direction": "화해",
                "story_flow_summary": "평온에서 위기를 거쳐 화해한다",
            },
            "episodes": [
                {
                    "episode_number": number,
                    "title": f"{number}화",
                    "summary": f"{number}화 요약",
                    "main_event": "문을 발견한다",
                    "conflict": "열지 말지 고민한다",
                    "characters": ["민재"],
                    "locations": ["복도"],
                    "objects": ["열쇠"],
                    "reveals": [],
                    "hidden_secrets": ["문 안의 비밀"],
                    "cliffhanger": "문이 열린다",
                    "next_episode_hook": "안으로 들어간다",
                }
                for number in range(1, count + 1)
            ],
        }


class StoryAdapter:
    def __init__(self) -> None:
        self.calls = 0
        self.prompt = ""

    def generate(self, prompt: str) -> dict:
        self.calls += 1
        self.prompt = prompt
        return {
            "title": "상세 대본",
            "synopsis": "한 Episode",
            "scenes": [
                {"number": number, "description": f"장면 {number}"}
                for number in range(1, 7)
            ],
            "ending": "끝",
        }


class BlockingStory(StoryAdapter):
    def __init__(self) -> None:
        super().__init__()
        self.started = Event()
        self.release = Event()

    def generate(self, prompt: str) -> dict:
        self.started.set()
        self.release.wait(timeout=5)
        return super().generate(prompt)


class V131LongOutlineTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        shutil.copytree(Path.cwd() / "prompts", self.root / "prompts")
        self.config = AppConfig.load(
            self.root, env={
                "OPENAI_API_KEY": "test-key",
                "APP_MAX_CONCURRENT_API_JOBS": "2",
            }
        )
        self.config.ensure_directories()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def make_store(
        self, service: LongStoryService, count: int = 3
    ):
        return service.create_project(
            LongProject("long_outline", title="초기 제목", episode_count=count)
        )

    def test_outline_budget_blocks_before_planner_call(self) -> None:
        outline = OutlineAdapter()
        service = LongStoryService(
            self.config,
            planner_adapter=outline,
            budget_manager=BudgetManager(
                self.root / "usage.json", monthly_limit_usd=0.04
            ),
        )
        store = self.make_store(service)
        with self.assertRaises(BudgetExceededError):
            service.generate_project_outline(store)
        self.assertEqual(outline.calls, 0)

    def test_creation_calls_outline_once_and_generates_no_scripts_or_images(self) -> None:
        outline = OutlineAdapter()
        service = LongStoryService(self.config, planner_adapter=outline)
        store = self.make_store(service)
        episodes = service.generate_project_outline(store)
        self.assertEqual(outline.calls, 1)
        self.assertTrue(all(item.state == "outline_ready" for item in episodes))
        self.assertTrue(all(not item.script for item in episodes))
        self.assertTrue(all(not item.generated_images for item in episodes))
        self.assertEqual(len(store.load_episode_outlines()), 3)
        self.assertTrue((store.root / "episode_outlines.json").is_file())
        self.assertTrue((store.episode_root(1) / "outline.json").is_file())

    def test_long_prompt_preview_matches_exact_adapter_input(self) -> None:
        outline = OutlineAdapter()
        service = LongStoryService(self.config, planner_adapter=outline)
        store = self.make_store(service)
        preview = service.render_project_outline_prompt(store)
        self.assertEqual(outline.calls, 0)
        modified = preview + "\n사용자 수정 지시"
        service.generate_project_outline(
            store, approved_prompt=modified
        )
        self.assertEqual(outline.calls, 1)
        self.assertEqual(outline.prompt, modified)

    def test_blank_long_prompt_is_blocked_before_adapter(self) -> None:
        outline = OutlineAdapter()
        service = LongStoryService(self.config, planner_adapter=outline)
        store = self.make_store(service)
        with self.assertRaisesRegex(ValueError, "비어"):
            service.generate_project_outline(
                store, approved_prompt="  "
            )
        self.assertEqual(outline.calls, 0)

    def test_user_long_project_settings_override_outline_response(self) -> None:
        outline = OutlineAdapter()
        service = LongStoryService(self.config, planner_adapter=outline)
        store = service.create_project(
            LongProject(
                "long_priority",
                title="사용자 제목",
                logline="사용자 주제",
                overview="사용자 세계관과 전체 줄거리",
                genre="사용자 장르",
                tone="사용자 분위기",
                theme="사용자 핵심 주제",
                episode_count=2,
                episode_duration_seconds=45,
                ending_direction="사용자 결말",
                platform="YouTube",
                aspect_ratio="16:9",
                audience="가족",
                notes="폭력 묘사 제외",
            )
        )
        service.generate_project_outline(store)
        project = store.load_project()
        self.assertEqual(project.title, "사용자 제목")
        self.assertEqual(project.logline, "사용자 주제")
        self.assertEqual(project.overview, "사용자 세계관과 전체 줄거리")
        self.assertEqual(project.genre, "사용자 장르")
        self.assertEqual(project.tone, "사용자 분위기")
        self.assertEqual(project.theme, "사용자 핵심 주제")
        self.assertEqual(project.ending_direction, "사용자 결말")

        context = service.build_context(store, 1)
        overview = context["project_overview"]
        self.assertEqual(overview["episode_duration_seconds"], 45)
        self.assertEqual(overview["aspect_ratio"], "16:9")
        self.assertEqual(overview["audience"], "가족")
        self.assertEqual(overview["notes"], "폭력 묘사 제외")

    def test_episode_prompt_preserves_context_priority_and_wizard_instruction(
        self,
    ) -> None:
        outline = OutlineAdapter()
        story = StoryAdapter()
        service = LongStoryService(
            self.config, planner_adapter=outline, story_adapter=story
        )
        store = self.make_store(service)
        service.generate_project_outline(store)
        service.generate_episode_script(
            store,
            1,
            instruction=(
                "[Episode Wizard 수정값]\n핵심 사건: 수정 사건\n\n"
                "[사용자 추가 지시사항]\n대사를 짧게"
            ),
        )
        ordered = (
            '"story_bible"',
            '"project_overview"',
            '"episode_outline"',
            '"recent_continuity"',
            '"user_instruction"',
        )
        positions = [story.prompt.index(value) for value in ordered]
        self.assertEqual(positions, sorted(positions))
        self.assertIn(
            "Story Bible > 장기 프로젝트 전체 설정(project_overview)",
            story.prompt,
        )
        self.assertIn("[Episode Wizard 수정값]", story.prompt)
        self.assertIn("[사용자 추가 지시사항]", story.prompt)

    def test_selected_episode_only_generates_one_script_and_revision_history(self) -> None:
        outline = OutlineAdapter()
        story = StoryAdapter()
        service = LongStoryService(
            self.config, planner_adapter=outline, story_adapter=story
        )
        store = self.make_store(service)
        service.generate_project_outline(store)
        first = service.generate_episode_script(store, 2)
        self.assertEqual(story.calls, 1)
        self.assertEqual(first.script_revision, 1)
        self.assertEqual(first.state, "script_review")
        self.assertFalse(store.load_episode(1).script)
        self.assertFalse(store.load_episode(3).script)
        with self.assertRaisesRegex(ValueError, "명시적 재생성"):
            service.generate_episode_script(store, 2)
        regenerated = service.generate_episode_script(
            store, 2, regenerate=True
        )
        self.assertEqual(story.calls, 2)
        self.assertEqual(regenerated.script_revision, 2)
        self.assertEqual(len(regenerated.script_history), 2)

    def test_duplicate_episode_script_job_is_blocked(self) -> None:
        outline = OutlineAdapter()
        story = BlockingStory()
        service = LongStoryService(
            self.config, planner_adapter=outline, story_adapter=story
        )
        store = self.make_store(service, 1)
        service.generate_project_outline(store)
        errors: list[Exception] = []

        def run() -> None:
            try:
                service.generate_episode_script(store, 1)
            except Exception as exc:  # pragma: no cover - diagnostic capture
                errors.append(exc)

        worker = Thread(target=run)
        worker.start()
        self.assertTrue(story.started.wait(timeout=3))
        with self.assertRaisesRegex(RuntimeError, "동일 회차"):
            service.generate_episode_script(store, 1)
        story.release.set()
        worker.join(timeout=5)
        self.assertFalse(errors)
        self.assertEqual(story.calls, 1)

    def test_outline_failure_preserves_project_and_can_retry(self) -> None:
        adapter = OutlineAdapter(fail=True)
        service = LongStoryService(self.config, planner_adapter=adapter)
        store = self.make_store(service)
        with self.assertRaises(TimeoutError):
            service.generate_project_outline(store)
        self.assertEqual(store.load_project().title, "초기 제목")
        self.assertTrue(all(not item.script for item in store.list_episodes()))
        adapter.fail = False
        service.generate_project_outline(store)
        self.assertEqual(adapter.calls, 2)

    def test_legacy_scripts_are_preserved_and_outlines_are_backed_up(self) -> None:
        story = StoryAdapter()
        service = LongStoryService(self.config, story_adapter=story)
        store = self.make_store(service, 1)
        episode = store.load_episode(1)
        episode.script = story.generate("")
        episode.summary = ""
        episode.state = "script_review"
        store.save_episode(episode)
        (store.root / "episode_outlines.json").unlink()
        (store.episode_root(1) / "outline.json").unlink()
        original_script = (store.episode_root(1) / "script.json").read_text(
            encoding="utf-8"
        )
        self.assertEqual(store.migrate_legacy_outlines(), 1)
        self.assertEqual(
            (store.episode_root(1) / "script.json").read_text(encoding="utf-8"),
            original_script,
        )
        self.assertEqual(
            store.load_episode_outlines()[0]["summary"], "한 Episode"
        )
        self.assertTrue(any(
            store.root.glob("migration_backups/outlines-*/Episode01/script.json")
        ))

    def test_episode_limit_is_configured_and_over_thirty_is_supported(self) -> None:
        config = AppConfig.load(
            self.root, env={
                "OPENAI_API_KEY": "test-key",
                "APP_MAX_LONG_PROJECT_EPISODES": "35",
            }
        )
        adapter = OutlineAdapter()
        service = LongStoryService(config, planner_adapter=adapter)
        store = service.create_project(
            LongProject("long_35", title="35화", episode_count=35)
        )
        self.assertEqual(len(service.generate_project_outline(store)), 35)
        self.assertEqual(adapter.calls, 1)
        with self.assertRaisesRegex(ValueError, "APP_MAX_LONG"):
            service.create_project(
                LongProject("long_36", title="36화", episode_count=36)
            )
        self.assertEqual(adapter.calls, 1)

    def test_api_key_absent_keeps_outline_management(self) -> None:
        config = AppConfig.load(self.root, env={})
        service = LongStoryService(config)
        store = self.make_store(service, 2)
        self.assertEqual(len(store.list_episodes()), 2)
        with self.assertRaisesRegex(RuntimeError, "Adapter"):
            service.generate_project_outline(store)


if __name__ == "__main__":
    unittest.main()

