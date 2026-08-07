"""Mocked user journeys covering one full short and long production cycle."""

from pathlib import Path
import shutil
import struct
import tempfile
import unittest

from app.config.config import AppConfig
from app.core.project_context import WorkflowState
from app.engines.image_engine import PNG_SIGNATURE
from app.engines.video_pipeline import VideoPipeline
from app.long_story.models import LongProject
from app.long_story.service import LongStoryService
from app.services.generation_service import GenerationService


def fake_png() -> bytes:
    return (
        PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
        + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
        + b"\x00\x00\x00\x00"
    )


class StoryFake:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def generate(self, prompt: str) -> dict:
        self.prompts.append(prompt)
        return {
            "title": "사용자 여정",
            "synopsis": "처음부터 끝까지 이어지는 이야기",
            "scenes": [
                {"number": number, "description": f"장면 {number}"}
                for number in range(1, 7)
            ],
            "ending": "끝",
        }


class ImageFake:
    def __init__(self) -> None:
        self.prompts: list[str] = []

    def generate(self, prompt: str, _references: list[Path]) -> bytes:
        self.prompts.append(prompt)
        return fake_png()


class OutlineFake:
    def generate_outline(self, _prompt: str, count: int) -> dict:
        return {
            "project": {
                "title": "AI 제목",
                "logline": "AI 주제",
                "overview": "AI 세계관",
                "genre": "AI 장르",
                "tone": "AI 분위기",
                "theme": "AI 주제",
                "starting_state": "시작",
                "midpoint": "중간",
                "ending_direction": "AI 결말",
                "story_flow_summary": "전체 흐름",
            },
            "episodes": [
                {
                    "episode_number": number,
                    "title": f"Episode {number}",
                    "summary": "요약",
                    "main_event": "핵심 사건",
                    "conflict": "갈등",
                    "characters": [],
                    "locations": [],
                    "objects": [],
                    "reveals": [],
                    "hidden_secrets": [],
                    "cliffhanger": "다음 이야기",
                    "next_episode_hook": "연결",
                }
                for number in range(1, count + 1)
            ],
        }


class UserProjectCycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        shutil.copytree(Path.cwd() / "prompts", self.root / "prompts")
        self.config = AppConfig.load(
            self.root, env={"OPENAI_API_KEY": "mock-key"}
        )
        self.config.ensure_directories()

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_short_project_user_cycle_reaches_completed_and_reloads(self) -> None:
        story = StoryFake()
        images = ImageFake()
        service = GenerationService(
            self.config,
            story_adapter=story,  # type: ignore[arg-type]
            image_adapter=images,  # type: ignore[arg-type]
        )
        context = service.generate_project(
            "잃어버린 별을 찾는 아이",
            project_name="별의 지도",
            genre="판타지",
            mood="따뜻하고 신비로움",
            duration_seconds=30,
            additional_notes="무서운 장면 제외",
            style_notes={
                "visual_style": "미국 TV 애니메이션",
                "color": "남색과 금색",
                "lighting": "달빛",
                "camera": "넓은 구도",
                "dialogue": "짧고 따뜻함",
                "avoid": "텍스트와 손 왜곡",
                "aspect": "16:9",
            },
        )
        service.approve_asset_mapping(context, text_only_confirmed=True)
        service.generate_approved_images(context)
        for scene in range(1, 7):
            service.approve_scene_image(context, scene)
        self.assertEqual(context.workflow_state, WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION)

        runway = self.root / "videos" / "runway"
        runway.mkdir(parents=True, exist_ok=True)
        for number in range(1, 7):
            (runway / f"scene{number}.mp4").write_bytes(b"runway-video")

        output = self.root / "output" / "reels" / context.project_id / "final.mp4"

        def render(clips: list[Path], destination: Path) -> Path:
            self.assertEqual(
                [path.name for path in clips],
                [f"scene{number}.mp4" for number in range(1, 7)],
            )
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(b"merged-video")
            return destination

        pipeline = VideoPipeline(
            runway,
            output,
            lambda _path: {"has_video": True, "duration": 5},
            render,
            service.memory.save,
        )
        context.transition_to(WorkflowState.GENERATING_VIDEOS)
        context.transition_to(WorkflowState.VIDEOS_READY)
        context.transition_to(WorkflowState.REVIEWING_VIDEOS)
        context.transition_to(WorkflowState.VIDEOS_APPROVED)
        completed = pipeline.execute(context)
        reloaded = service.memory.load(context.project_id)
        self.assertEqual(completed.workflow_state, WorkflowState.COMPLETED)
        self.assertEqual(reloaded.workflow_state, WorkflowState.COMPLETED)
        self.assertEqual(Path(reloaded.final_video_path or ""), output)
        self.assertEqual(len(story.prompts), 1)
        self.assertEqual(len(images.prompts), 6)

    def test_long_project_episode_cycle_preserves_user_priority(self) -> None:
        story = StoryFake()
        images = ImageFake()
        service = LongStoryService(
            self.config,
            planner_adapter=OutlineFake(),
            story_adapter=story,
            image_adapter=images,
        )
        store = service.create_project(
            LongProject(
                "long_user_cycle",
                title="사용자 장기 제목",
                logline="사용자가 입력한 전체 주제",
                overview="사용자가 만든 세계관과 전체 줄거리",
                genre="판타지 미스터리",
                tone="어둡지만 희망적",
                theme="신뢰",
                episode_count=2,
                episode_duration_seconds=45,
                aspect_ratio="9:16",
                audience="청소년",
                notes="잔혹한 표현 제외",
                ending_direction="화해",
            )
        )
        service.generate_project_outline(store)
        project = store.load_project()
        self.assertEqual(project.title, "사용자 장기 제목")
        self.assertEqual(project.overview, "사용자가 만든 세계관과 전체 줄거리")

        service.generate_episode_script(
            store, 1, instruction="Episode Wizard 수정값: 분위기를 코미디로"
        )
        self.assertIn(
            "장기 프로젝트 전체 설정(project_overview)", story.prompts[0]
        )
        service.approve_script(store, 1)
        service.confirm_automatic_references(store, 1)
        preview = service.preview_scene_generation(store, 1, 1)
        for expected in (
            "장르: 판타지 미스터리",
            "전체 분위기: 어둡지만 희망적",
            "핵심 주제: 신뢰",
            "피해야 할 요소: 잔혹한 표현 제외",
            "화면 비율: 9:16",
            "전체 영상 길이: 약 45초",
            "대상 시청자: 청소년",
        ):
            self.assertIn(expected, preview["prompt"])

        service.generate_episode_images(store, 1)
        for scene in range(1, 7):
            service.approve_image(store, 1, scene)
        reloaded = store.load_episode(1)
        untouched = store.load_episode(2)
        self.assertEqual(reloaded.state, "waiting_for_video_confirmation")
        self.assertEqual(len(reloaded.generated_images), 6)
        self.assertEqual(untouched.state, "outline_ready")
        self.assertFalse(untouched.script)
        self.assertEqual(len(images.prompts), 6)


if __name__ == "__main__":
    unittest.main()

