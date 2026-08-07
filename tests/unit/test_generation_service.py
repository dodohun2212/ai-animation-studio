"""End-to-end composition test with free injected adapters."""

from pathlib import Path
import hashlib
import shutil
import struct
import tempfile
import unittest
from unittest import mock

from app.config.config import AppConfig
from app.core.project_context import ProjectContext, WorkflowState
from app.engines.image_engine import PNG_SIGNATURE
from app.services.generation_service import (
    GenerationService,
    render_short_story_prompt,
    short_scene_continuity_option,
)
from app.services.image_review_service import ProjectImageReviewService
from app.services.asset_library import AssetLibrary
from app.services.project_asset_mapping import ProjectAssetMappingStore
from app.services.budget_manager import BudgetExceededError, BudgetManager


class FakeStoryAdapter:
    def __init__(self):
        self.prompt = ""
        self.calls = 0

    def generate(self, prompt: str):
        self.calls += 1
        self.prompt = prompt
        return {
            "title": "테스트",
            "synopsis": "테스트 이야기",
            "scenes": [
                {"number": number, "description": f"장면 {number}"}
                for number in range(1, 7)
            ],
            "ending": "끝",
        }


class FakeImageAdapter:
    def __init__(self):
        self.calls = 0
        self.references: list[list[Path]] = []
        self.prompts: list[str] = []

    def generate(self, prompt: str, references: list[Path]) -> bytes:
        self.calls += 1
        self.prompts.append(prompt)
        self.references.append(list(references))
        return (
            PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
            + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
            + b"\x00\x00\x00\x00"
        )


class SizedFakeImageAdapter(FakeImageAdapter):
    def __init__(self):
        super().__init__()
        self.sizes: list[str] = []

    def generate_for_size(
        self, prompt: str, references: list[Path], size: str
    ) -> bytes:
        self.sizes.append(size)
        return self.generate(prompt, references)


class FailingImageAdapter:
    """Simulate a provider timeout without making a paid request."""

    MAX_REFERENCE_IMAGES = 16

    def generate(self, prompt: str, references: list[Path]) -> bytes:
        raise TimeoutError("simulated image timeout")


class GenerationServiceTest(unittest.TestCase):
    def test_regeneration_refreshes_stale_automatic_reference_review(self) -> None:
        """A stale legacy MappingReview must not reopen manual Mapping UI."""
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            images = FakeImageAdapter()
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=images,  # type: ignore[arg-type]
            )
            context = service.generate_project("regeneration gate test")
            service.confirm_automatic_references(context)
            service.generate_approved_images(context)
            store = ProjectAssetMappingStore(
                root / "learning_data" / "projects", context.project_id
            )
            store.invalidate_review(context.scenes, context.script_revision)

            result = service.regenerate_scene(context, 3)

            self.assertTrue(result.is_file())
            self.assertEqual(images.calls, 7)
            self.assertEqual(context.workflow_state, WorkflowState.IMAGES_REVIEW)
            self.assertEqual(store.load_review().status, "approved")

    def test_wizard_aspect_controls_actual_image_request_size(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root,
                env={
                    "OPENAI_API_KEY": "test-key",
                    "OPENAI_IMAGE_SIZE": "1024x1536",
                },
            )
            config.ensure_directories()
            images = SizedFakeImageAdapter()
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=images,  # type: ignore[arg-type]
            )
            context = service.generate_project(
                "가로 영상",
                style_notes={"aspect": "16:9"},
            )
            service.confirm_automatic_references(context)
            service.generate_approved_images(context)

            self.assertEqual(images.sizes, ["1536x1024"] * 6)

    def test_previous_project_last_scene_reaches_story_and_scene_one_image(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            source = ProjectContext("project_previous", "이전 이야기")
            source.workflow_state = WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION
            source.lore_context = {"project_name": "이전 작품"}
            source.story = {"title": "이전 작품", "ending": "문이 열린다"}
            source.scenes = [
                {"number": number, "description": f"이전 장면 {number}"}
                for number in range(1, 7)
            ]
            source_image = (
                root / "learning_data" / "projects"
                / source.project_id / "images" / "scene6.png"
            )
            source_image.parent.mkdir(parents=True, exist_ok=True)
            source_image.write_bytes(PNG_SIGNATURE + b"previous-scene")
            source.generated_images = [str(source_image)] * 6
            service_images = FakeImageAdapter()
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=service_images,  # type: ignore[arg-type]
            )
            service.memory.save(source)
            link = short_scene_continuity_option(
                service.memory.projects_directory, source.project_id
            )

            context = service.generate_project(
                "이어지는 이야기", previous_scene_link=link
            )
            self.assertIn("이전 작품", service.story_adapter.prompt)
            self.assertIn("이전 장면 6", service.story_adapter.prompt)
            service.approve_asset_mapping(
                context, text_only_confirmed=True
            )
            service.generate_approved_images(context)

            self.assertIn(source_image, service_images.references[0])
            self.assertNotIn(source_image, service_images.references[1])
            self.assertIn(
                "이전 장면 연속성 Reference",
                service_images.prompts[0],
            )

    def test_previous_project_link_requires_explicit_user_selection(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )

            stale_link = {
                "source_kind": "short_project",
                "project_id": "project_previous",
                "project_name": "자동으로 들어가면 안 되는 작품",
                "story_context": "이 내용은 전달되면 안 됩니다.",
                "image_path": str(root / "stale.png"),
            }
            context = service.generate_project(
                "독립적인 새 이야기",
                previous_scene_link=stale_link,
            )

            self.assertNotIn("이 내용은 전달되면 안 됩니다.", service.story_adapter.prompt)
            self.assertEqual(context.lore_context["previous_scene_link"], {})

    def test_story_budget_blocks_before_adapter_call(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            story = FakeStoryAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
                budget_manager=BudgetManager(
                    root / "usage.json", monthly_limit_usd=0.04
                ),
            )
            with self.assertRaises(BudgetExceededError):
                service.generate_project("blocked story")
            self.assertEqual(story.calls, 0)

    def test_image_budget_blocks_before_adapter_call(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            images = FakeImageAdapter()
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=images,  # type: ignore[arg-type]
                budget_manager=BudgetManager(
                    root / "usage.json", monthly_limit_usd=0.06
                ),
            )
            context = service.generate_project("blocked image")
            service.approve_asset_mapping(
                context, text_only_confirmed=True
            )
            with self.assertRaises(BudgetExceededError):
                service.generate_approved_images(context)
            self.assertEqual(images.calls, 0)

    def test_global_atmosphere_asset_reaches_story_and_image_requests(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            source = root / "mood.png"
            source.write_bytes(
                PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
                + b"mood"
            )
            atmosphere = AssetLibrary(
                root / "learning_data"
            ).import_file(
                source,
                asset_type="style",
                display_name="고요한 새벽 분위기",
                description="청록색 안개와 부드러운 역광",
            )
            story = FakeStoryAdapter()
            images = FakeImageAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=images,  # type: ignore[arg-type]
            )
            context = service.generate_project(
                "새벽의 여행",
                atmosphere_asset_ids=[atmosphere.asset_id],
            )
            self.assertIn(
                "[3. 영상·장면 전체 분위기 Reference Asset]",
                story.prompt,
            )
            self.assertIn("고요한 새벽 분위기", story.prompt)
            self.assertIn("청록색 안개와 부드러운 역광", story.prompt)
            self.assertEqual(
                context.lore_context["atmosphere_asset_ids"],
                [atmosphere.asset_id],
            )
            service.confirm_automatic_references(context)
            service.generate_approved_images(context)
            self.assertTrue(all(len(items) == 1 for items in images.references))
            self.assertIn(
                "[3. 영상·장면 전체 분위기 Reference Asset]",
                images.prompts[0],
            )
            self.assertIn("고요한 새벽 분위기", images.prompts[0])

    def test_scene_reference_purpose_reaches_story_and_image_requests(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(root, env={"OPENAI_API_KEY": "test-key"})
            config.ensure_directories()
            source = root / "key.png"
            source.write_bytes(
                PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
                + b"key"
            )
            item = AssetLibrary(root / "learning_data").import_file(
                source,
                asset_type="object",
                display_name="낡은 은빛 열쇠",
                description="손바닥 크기의 녹슨 열쇠",
            )
            story = FakeStoryAdapter()
            images = FakeImageAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=images,  # type: ignore[arg-type]
            )
            purpose = "주인공이 문을 열 때 사용하는 핵심 소품"
            context = service.generate_project(
                "잠긴 문 너머",
                scene_reference_assets={item.asset_id: purpose},
            )

            self.assertIn("[4. 장면 참고 Asset]", story.prompt)
            self.assertIn("낡은 은빛 열쇠", story.prompt)
            self.assertIn(purpose, story.prompt)
            self.assertEqual(
                context.lore_context["scene_reference_assets"],
                {item.asset_id: purpose},
            )
            service.confirm_automatic_references(context)
            service.generate_approved_images(context)
            stored = Path(item.stored_path).resolve()
            self.assertTrue(all(stored in refs for refs in images.references))
            self.assertIn("[4. 장면 참고 Asset]", images.prompts[0])
            self.assertIn(purpose, images.prompts[0])

    def test_project_cast_reaches_story_and_image_prompts(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            library = AssetLibrary(root / "learning_data")
            assets = []
            for name, description in (
                ("별빛 탐험가", "은빛 가방을 든 주인공"),
                ("숲의 안내자", "푸른 등불을 든 조력자"),
            ):
                source = root / f"{name}.png"
                source.write_bytes(
                    PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                    + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
                    + name.encode("utf-8")
                )
                assets.append(library.import_file(
                    source,
                    asset_type="character",
                    display_name=name,
                    description=description,
                ))
            story = FakeStoryAdapter()
            images = FakeImageAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=images,  # type: ignore[arg-type]
            )
            context = service.generate_project(
                "두 캐릭터의 여행",
                character=assets[0].display_name,
                candidate_asset_ids=[item.asset_id for item in assets],
                character_cast=[
                    {
                        "asset_id": assets[0].asset_id,
                        "cast_role": "lead",
                        "story_role": "주인공",
                    },
                    {
                        "asset_id": assets[1].asset_id,
                        "cast_role": "supporting",
                        "story_role": "숲을 안내하는 조력자",
                    },
                ],
            )
            self.assertIn("이름: 별빛 탐험가", story.prompt)
            self.assertIn("구분: 대표 캐릭터", story.prompt)
            self.assertIn("이름: 숲의 안내자", story.prompt)
            self.assertIn("구분: 서브 캐릭터", story.prompt)
            self.assertIn("이야기 역할: 숲을 안내하는 조력자", story.prompt)
            self.assertEqual(len(context.character_profile["cast"]), 2)

            service.confirm_automatic_references(context)
            service.generate_approved_images(context)
            self.assertEqual(images.calls, 6)
            self.assertTrue(all(len(items) == 2 for items in images.references))
            self.assertIn("이름: 숲의 안내자", images.prompts[0])
            self.assertIn(
                "서브 캐릭터는 현재 장면 대본에 등장하거나",
                images.prompts[0],
            )

    def test_image_failure_returns_project_to_explicit_retry_gate(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=FailingImageAdapter(),  # type: ignore[arg-type]
            )
            context = service.generate_project("timeout recovery")
            service.approve_asset_mapping(
                context, text_only_confirmed=True
            )
            with self.assertRaises(TimeoutError):
                service.generate_approved_images(context)
            self.assertEqual(
                context.workflow_state,
                WorkflowState.ASSET_MAPPING_APPROVED,
            )
            restored = service.memory.load(context.project_id)
            self.assertEqual(
                restored.workflow_state,
                WorkflowState.ASSET_MAPPING_APPROVED,
            )

    def test_blank_creative_settings_are_rendered_as_autonomous(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )
            prompt = render_short_story_prompt(
                service.prompts,
                topic="자율 설정 테스트",
                genre="모험",
                mood="따뜻함",
                duration_seconds=30,
                scene_count=6,
                additional_notes="",
                character="대표 캐릭터",
                lore="",
                style_notes={},
            )
            for label in ("세계관", "대사 스타일"):
                self.assertIn(f"{label}: 자율", prompt)
            for creative_label in (
                "시각적 스타일", "색감", "조명", "카메라 느낌",
                "피해야 할 요소", "화면 비율",
            ):
                self.assertIn(f"{creative_label}:", prompt)

    def test_selected_single_asset_metadata_reaches_story_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            source = root / "selected-background.png"
            source.write_bytes(
                PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
                + b"\x00\x00\x00\x00"
            )
            asset = AssetLibrary(root / "learning_data").import_file(
                source,
                asset_type="background",
                display_name="선택한 항구",
                description="밤마다 푸른 안개가 피어나는 항구",
            )
            story = FakeStoryAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )
            service.generate_project(
                "Asset 설명 전달",
                candidate_asset_ids=[asset.asset_id],
            )
            self.assertIn("이름: 선택한 항구", story.prompt)
            self.assertIn("유형: 배경", story.prompt)
            self.assertIn(
                "설명: 밤마다 푸른 안개가 피어나는 항구", story.prompt
            )

    def test_preview_prompt_is_exact_story_adapter_input(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            story = FakeStoryAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )
            preview = render_short_story_prompt(
                service.prompts,
                topic="정확성 테스트",
                genre="모험",
                mood="따뜻함",
                duration_seconds=30,
                scene_count=6,
                additional_notes="대사는 짧게",
                character="대표 캐릭터",
                lore="기본 세계관",
            )
            context = service.generate_project(
                "정확성 테스트",
                genre="모험",
                mood="따뜻함",
                additional_notes="대사는 짧게",
                character="대표 캐릭터",
                lore="기본 세계관",
                approved_story_prompt=preview,
                original_story_prompt=preview,
                story_prompt_approved_at="2026-07-28T00:00:00+00:00",
            )
            self.assertEqual(story.prompt, preview)
            self.assertEqual(story.calls, 1)
            audit = context.lore_context["story_prompt_request"]
            self.assertEqual(audit["actual_prompt"], preview)
            self.assertFalse(audit["modified"])
            self.assertEqual(
                audit["sha256"],
                hashlib.sha256(preview.encode("utf-8")).hexdigest(),
            )

    def test_modified_preview_is_used_once_without_rerender(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            story = FakeStoryAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )
            original = "원본 요청"
            modified = "사용자가 수정한 최종 요청"
            service.prompts.render = mock.Mock(
                side_effect=AssertionError("approval 이후 재렌더링 금지")
            )
            context = service.generate_project(
                "수정 테스트",
                approved_story_prompt=modified,
                original_story_prompt=original,
            )
            self.assertEqual(story.prompt, modified)
            self.assertEqual(story.calls, 1)
            audit = context.lore_context["story_prompt_request"]
            self.assertTrue(audit["modified"])
            self.assertEqual(audit["original_prompt"], original)
            self.assertEqual(audit["actual_prompt"], modified)

    def test_blank_approved_prompt_never_calls_story_adapter(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            story = FakeStoryAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )
            with self.assertRaisesRegex(ValueError, "비어"):
                service.generate_project(
                    "빈 요청", approved_story_prompt="   "
                )
            self.assertEqual(story.calls, 0)

    def test_composition_waits_for_mapping_then_generates_six(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            # Reuse the repository's real prompt files.
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(root, env={"OPENAI_API_KEY": "test-key"})
            config.ensure_directories()
            images = FakeImageAdapter()
            reference = root / "character.png"
            reference.write_bytes(
                PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
                + b"\x00\x00\x00\x00"
            )
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=images,  # type: ignore[arg-type]
            )
            context = service.generate_project(
                "주제", initial_reference_paths=[reference]
            )
            self.assertEqual(
                context.workflow_state,
                WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW,
            )
            self.assertEqual(images.calls, 0)
            with self.assertRaises(ValueError):
                service.generate_approved_images(context)
            service.approve_asset_mapping(
                context, legacy_confirmed=True
            )
            context = service.generate_approved_images(context)
            self.assertEqual(context.workflow_state, WorkflowState.IMAGES_REVIEW)
            self.assertEqual(len(context.generated_images), 6)
            self.assertEqual(images.calls, 6)
            self.assertTrue(all(call == [images.references[0][0]] for call in images.references))
            for scene in range(1, 7):
                service.approve_scene_image(context, scene)
            self.assertEqual(context.workflow_state, WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION)

    def test_brief_fields_are_included_in_story_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(root, env={"OPENAI_API_KEY": "test-key"})
            config.ensure_directories()
            story = FakeStoryAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )

            context = service.generate_project(
                "달에서 길을 잃은 우체부",
                project_name="달빛 우체국",
                genre="SF 모험",
                mood="쓸쓸하지만 희망적",
                character="달 토끼 우체부",
                lore="달의 도시와 지구 사이에 편지를 배달하는 세계",
                full_story="길을 잃은 우체부가 마지막 편지의 주인을 찾아간다.",
                duration_seconds=45,
                scene_count=6,
                additional_notes="대사는 적게, 마지막에 반전",
                style_notes={
                    "visual_style": "종이 질감 애니메이션",
                    "color": "남색과 은색",
                    "lighting": "부드러운 달빛",
                    "camera": "넓은 전경",
                    "dialogue": "짧고 따뜻하게",
                    "avoid": "화면 속 글자",
                    "aspect": "16:9",
                },
            )

            self.assertIn("프로젝트 이름: 달빛 우체국", story.prompt)
            self.assertIn(
                "영상 주제: 달에서 길을 잃은 우체부", story.prompt
            )
            self.assertIn(
                "전체 줄거리: 길을 잃은 우체부가 마지막 편지의 주인을 찾아간다.",
                story.prompt,
            )
            self.assertIn("장르: SF 모험", story.prompt)
            self.assertIn("전체 분위기: 쓸쓸하지만 희망적", story.prompt)
            self.assertIn("대표 캐릭터: 달 토끼 우체부", story.prompt)
            self.assertIn(
                "세계관: 달의 도시와 지구 사이에 편지를 배달하는 세계",
                story.prompt,
            )
            self.assertIn("대사 스타일: 짧고 따뜻하게", story.prompt)
            for visual_value in (
                "종이 질감 애니메이션", "남색과 은색",
                "부드러운 달빛", "넓은 전경", "화면 속 글자", "16:9",
            ):
                self.assertIn(visual_value, story.prompt)
            self.assertIn("영상 길이: 약 45초", story.prompt)
            self.assertIn("장면 수: 정확히 6개", story.prompt)
            self.assertIn("대사는 적게, 마지막에 반전", story.prompt)
            self.assertIn(
                "한국어 애니메이션 대본만 작성하십시오", story.prompt
            )
            self.assertIn(
                "이미지 프롬프트, Reference 선택, 이미지 생성 지시",
                story.prompt,
            )
            self.assertIn(
                "작품 제목(title), 전체 대본 요약(synopsis)",
                story.prompt,
            )
            self.assertEqual(context.style_profile["mood"], "쓸쓸하지만 희망적")
            self.assertEqual(
                context.character_profile["name"], "달 토끼 우체부"
            )
            self.assertEqual(
                context.lore_context["lore"],
                "달의 도시와 지구 사이에 편지를 배달하는 세계",
            )

    def test_atmosphere_asset_is_not_duplicated_as_project_asset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(root, env={"OPENAI_API_KEY": "test-key"})
            config.ensure_directories()
            library = AssetLibrary(root / "learning_data")
            source = root / "mood.png"
            source.write_bytes(
                PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
                + b"mood"
            )
            atmosphere = library.import_file(
                source,
                asset_type="style",
                display_name="고요한 밤의 분위기",
                description="짙은 남색과 은은한 달빛",
            )
            story = FakeStoryAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )

            service.generate_project(
                "달빛 아래의 산책",
                candidate_asset_ids=[atmosphere.asset_id],
                atmosphere_asset_ids=[atmosphere.asset_id],
            )

            self.assertEqual(
                story.prompt.count("고요한 밤의 분위기"), 1
            )
            self.assertEqual(
                story.prompt.count("짙은 남색과 은은한 달빛"), 1
            )

    def test_wizard_metadata_and_candidate_assets_are_persisted(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(root, env={"OPENAI_API_KEY": "test-key"})
            config.ensure_directories()
            source = root / "candidate.png"
            source.write_bytes(
                PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
                + b"\x00\x00\x00\x00"
            )
            asset = AssetLibrary(root / "learning_data").import_file(
                source, asset_type="style", display_name="차가운 야간 스타일"
            )
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )
            context = service.generate_project(
                "Wizard 저장 테스트",
                project_name="야간 도시",
                style_notes={"aspect": "16:9", "lighting": "네온"},
                candidate_asset_ids=[asset.asset_id],
            )
            self.assertEqual(context.lore_context["project_name"], "야간 도시")
            self.assertEqual(
                context.lore_context["candidate_asset_ids"], [asset.asset_id]
            )
            mappings = ProjectAssetMappingStore(
                root / "learning_data" / "projects", context.project_id
            ).load_all()
            self.assertEqual([item.asset_id for item in mappings], [asset.asset_id])
            self.assertTrue(mappings[0].candidate_only)

    def test_saved_ready_project_resumes_without_ready_to_ready_transition(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(root, env={"OPENAI_API_KEY": "test-key"})
            config.ensure_directories()
            saved = ProjectContext("project_saved_ready", "기존 주제")
            saved.transition_to(WorkflowState.READY)
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )
            service.memory.save(saved)

            resumed = service.generate_project(
                "수정한 주제",
                existing_project_id=saved.project_id,
            )

            self.assertEqual(resumed.project_id, saved.project_id)
            self.assertEqual(resumed.topic, "수정한 주제")
            self.assertEqual(
                resumed.workflow_state,
                WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW,
            )

    def test_character_name_auto_includes_matching_asset(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            source = root / "named-character.png"
            source.write_bytes(
                PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
                + b"\x00\x00\x00\x00"
            )
            asset = AssetLibrary(root / "learning_data").import_file(
                source,
                asset_type="character",
                display_name="별빛 여행자",
                description="은색 망토와 작은 나침반을 지닌 여행자",
            )
            story = FakeStoryAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )
            context = service.generate_project(
                "이름 자동 연결",
                character="  별빛 여행자  ",
            )
            self.assertIn("이름: 별빛 여행자", story.prompt)
            self.assertIn(
                "설명: 은색 망토와 작은 나침반을 지닌 여행자",
                story.prompt,
            )
            self.assertEqual(
                context.lore_context["candidate_asset_ids"],
                [asset.asset_id],
            )
            mappings = ProjectAssetMappingStore(
                root / "learning_data" / "projects", context.project_id
            ).load_all()
            self.assertEqual(
                [mapping.asset_id for mapping in mappings],
                [asset.asset_id],
            )

    def test_character_folder_auto_links_front_and_story_metadata(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            library = AssetLibrary(root / "learning_data")
            # Use the same valid free fixture encoding as other tests.
            front_path = root / "front.png"
            side_path = root / "side.png"
            for path, marker in ((front_path, b"front"), (side_path, b"side")):
                path.write_bytes(
                    PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                    + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
                    + marker
                )
            front = library.import_file(
                front_path, asset_type="character", display_name="정면"
            )
            side = library.import_file(
                side_path, asset_type="character", display_name="측면"
            )
            library.update_metadata(front.asset_id, role="front")
            library.update_metadata(side.asset_id, role="side")
            folder = library.create_folder(
                display_name="여행자",
                asset_type="character",
                description="붉은 외투를 입은 여행자",
                aliases=["주인공"],
                tags=["여행"],
                child_asset_ids=[front.asset_id, side.asset_id],
                thumbnail_asset_id=front.asset_id,
            )
            story = FakeStoryAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )
            context = service.generate_project(
                "Folder Story", character="여행자"
            )
            self.assertIn("이름: 여행자", story.prompt)
            self.assertIn("붉은 외투를 입은 여행자", story.prompt)
            self.assertEqual(story.prompt.count("붉은 외투를 입은 여행자"), 1)
            self.assertIn(
                "위 대표 캐릭터 설정을 대본 전체에서 일관되게 유지하십시오",
                story.prompt,
            )
            self.assertEqual(
                context.lore_context["candidate_asset_ids"],
                [folder.asset_id],
            )
            self.assertEqual(
                context.lore_context["folder_child_selections"][folder.asset_id],
                [front.asset_id],
            )

    def test_image_api_receives_only_selected_folder_child(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            library = AssetLibrary(root / "learning_data")
            paths = [root / "first.png", root / "second.png"]
            for index, path in enumerate(paths):
                path.write_bytes(
                    PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                    + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
                    + bytes([index])
                )
            first = library.import_file(
                paths[0], asset_type="background", display_name="첫 이미지"
            )
            second = library.import_file(
                paths[1], asset_type="background", display_name="둘째 이미지"
            )
            library.update_metadata(first.asset_id, role="day")
            library.update_metadata(second.asset_id, role="night")
            folder = library.create_folder(
                display_name="배경 Folder",
                asset_type="background",
                child_asset_ids=[first.asset_id, second.asset_id],
            )
            images = FakeImageAdapter()
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=images,  # type: ignore[arg-type]
            )
            context = service.generate_project(
                "Folder Image",
                candidate_asset_ids=[folder.asset_id],
                folder_child_selections={
                    folder.asset_id: [second.asset_id]
                },
            )
            service.confirm_automatic_references(context)
            service.generate_approved_images(context)
            selected_path = library.resolve_path(second)
            self.assertEqual(images.calls, 6)
            self.assertTrue(
                all(references == [selected_path] for references in images.references)
            )
            self.assertTrue(
                all("둘째 이미지(night)" in prompt for prompt in images.prompts)
            )
            self.assertTrue(
                all("첫 이미지" not in prompt for prompt in images.prompts)
            )

    def test_character_folder_metadata_and_references_reach_correct_apis(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(
                root, env={"OPENAI_API_KEY": "test-key"}
            )
            config.ensure_directories()
            library = AssetLibrary(root / "learning_data")
            reference_paths = [root / "front.png", root / "side.png"]
            for index, path in enumerate(reference_paths, start=1):
                path.write_bytes(
                    PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                    + struct.pack(">II", 8 + index, 8)
                    + b"\x08\x06\x00\x00\x00" + bytes([index])
                )
            front = library.import_file(
                reference_paths[0],
                asset_type="character",
                display_name="정면 기준",
            )
            side = library.import_file(
                reference_paths[1],
                asset_type="character",
                display_name="측면 기준",
            )
            library.update_metadata(front.asset_id, role="front")
            library.update_metadata(side.asset_id, role="side")
            folder_description = "\n".join((
                "외형·실루엣: 둥근 얼굴과 작은 체형",
                "복장·대표 색상·소품: 파란 재킷과 은색 가방",
                "일관성 유지 기준: 왼쪽 눈 아래 점 유지",
            ))
            folder = library.create_folder(
                display_name="별빛 안내자",
                asset_type="character",
                description=folder_description,
                tags=["검색 전용 태그"],
                child_asset_ids=[front.asset_id, side.asset_id],
                thumbnail_asset_id=front.asset_id,
            )
            story = FakeStoryAdapter()
            images = FakeImageAdapter()
            service = GenerationService(
                config,
                story_adapter=story,  # type: ignore[arg-type]
                image_adapter=images,  # type: ignore[arg-type]
            )
            context = service.generate_project(
                "Character Folder 전달 검사",
                character="별빛 안내자",
                candidate_asset_ids=[folder.asset_id],
                folder_child_selections={
                    folder.asset_id: [front.asset_id, side.asset_id],
                },
            )
            self.assertIn("이름: 별빛 안내자", story.prompt)
            self.assertIn(folder_description, story.prompt)
            self.assertNotIn("정면 기준(front)", story.prompt)
            self.assertNotIn("측면 기준(side)", story.prompt)
            self.assertNotIn("검색 전용 태그", story.prompt)

            service.confirm_automatic_references(context)
            service.generate_approved_images(context)
            self.assertTrue(all(
                folder_description in prompt for prompt in images.prompts
            ))
            self.assertTrue(all(
                "정면 기준(front)" in prompt for prompt in images.prompts
            ))
            self.assertTrue(all(
                "측면 기준(side)" in prompt for prompt in images.prompts
            ))
            self.assertTrue(all(
                references == [
                    library.resolve_path(front),
                    library.resolve_path(side),
                ]
                for references in images.references
            ))
            self.assertTrue(all(
                "검색 전용 태그" not in prompt for prompt in images.prompts
            ))

    def test_all_wizard_visual_settings_reach_image_prompt(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(root, env={"OPENAI_API_KEY": "test-key"})
            config.ensure_directories()
            images = FakeImageAdapter()
            service = GenerationService(
                config,
                story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=images,  # type: ignore[arg-type]
            )
            context = service.generate_project(
                "이미지 설정 전달",
                mood="긴장되고 몽환적",
                duration_seconds=45,
                scene_count=6,
                style_notes={
                    "visual_style": "미국 TV 애니메이션",
                    "color": "청록과 보라",
                    "lighting": "강한 역광",
                    "camera": "낮은 앵글과 와이드 숏",
                    "dialogue": "짧고 건조한 대사",
                    "avoid": "과도한 텍스트와 손 왜곡",
                    "aspect": "16:9",
                },
            )
            service.approve_asset_mapping(
                context, text_only_confirmed=True
            )
            service.generate_approved_images(context)
            prompt = images.prompts[0]
            for expected in (
                "전체 분위기: 긴장되고 몽환적",
                "시각적 스타일: 미국 TV 애니메이션",
                "색감: 청록과 보라",
                "조명: 강한 역광",
                "카메라 느낌: 낮은 앵글과 와이드 숏",
                "대사 스타일: 짧고 건조한 대사",
                "피해야 할 요소: 과도한 텍스트와 손 왜곡",
                "화면 비율: 16:9",
                "전체 영상 길이: 약 45초",
                "전체 장면 수: 6개",
            ):
                self.assertIn(expected, prompt)
            self.assertIn("- 화면 비율: 16:9", prompt)
            self.assertIn(
                "대표 캐릭터는 모든 장면에 등장시켜야 합니다", prompt
            )
            self.assertIn("서로 다른 Character Asset의 얼굴", prompt)
            self.assertIn("분할 화면, 콜라주, 캐릭터 시트", prompt)
            self.assertIn("대사를 화면 글자로 표시하지 마십시오", prompt)

    def test_mapping_review_state_survives_service_restart(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            shutil.copytree(Path.cwd() / "prompts", root / "prompts")
            config = AppConfig.load(root, env={"OPENAI_API_KEY": "test-key"})
            config.ensure_directories()
            first = GenerationService(
                config, story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=FakeImageAdapter(),  # type: ignore[arg-type]
            )
            context = first.generate_project("재시작 테스트")
            restored = first.memory.load(context.project_id)
            self.assertEqual(
                restored.workflow_state,
                WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW,
            )
            images = FakeImageAdapter()
            restarted = GenerationService(
                config, story_adapter=FakeStoryAdapter(),  # type: ignore[arg-type]
                image_adapter=images,  # type: ignore[arg-type]
            )
            restarted.approve_asset_mapping(
                restored, text_only_confirmed=True
            )
            result = restarted.generate_approved_images(restored)
            self.assertEqual(result.workflow_state, WorkflowState.IMAGES_REVIEW)
            self.assertEqual(images.calls, 6)

    def test_image_review_approval_does_not_require_api_key(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            projects = root / "learning_data" / "projects"
            context = ProjectContext(
                "project_review", "주제",
                workflow_state=WorkflowState.IMAGES_REVIEW,
            )
            image_path = root / "scene.png"
            image_path.write_bytes(
                PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
                + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
                + b"\x00\x00\x00\x00"
            )
            context.generated_images = [str(image_path)] * 6
            service = ProjectImageReviewService(projects)
            for scene in range(1, 7):
                service.approve_scene(context, scene)
            self.assertEqual(
                context.workflow_state, WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION
            )


if __name__ == "__main__":
    unittest.main()

