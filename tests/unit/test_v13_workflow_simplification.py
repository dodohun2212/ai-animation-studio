"""v1.3 project-image indexing and simplified workflow regression tests."""

from pathlib import Path
import shutil
import struct
import tempfile
import unittest

from app.config.config import AppConfig
from app.core.project_context import WorkflowState
from app.engines.image_engine import PNG_SIGNATURE
from app.long_story.models import LongProject
from app.long_story.service import LongStoryService
from app.services.asset_library import AssetLibrary
from app.services.generation_service import GenerationService


def image_bytes(marker: bytes = b"") -> bytes:
    return (
        PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
        + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
        + marker + b"\x00\x00\x00\x00"
    )


class Story:
    def generate(self, _prompt: str) -> dict:
        return {
            "title": "테스트",
            "synopsis": "요약",
            "scenes": [
                {"number": number, "description": f"장면 {number}"}
                for number in range(1, 7)
            ],
            "ending": "끝",
        }


class Images:
    def generate(self, _prompt: str, _references: list[Path]) -> bytes:
        return image_bytes()


class CapturingImages:
    def __init__(self) -> None:
        self.prompts: list[str] = []
        self.references: list[list[Path]] = []

    def generate(self, prompt: str, references: list[Path]) -> bytes:
        self.prompts.append(prompt)
        self.references.append(list(references))
        return image_bytes()


class ProjectOutline:
    def __init__(self) -> None:
        self.calls = 0

    def generate_outline(self, _prompt: str, episode_count: int) -> dict:
        self.calls += 1
        return {
            "project": {
                "title": "장기",
                "logline": "한 줄",
                "overview": "전체 줄거리",
                "genre": "미스터리",
                "tone": "긴장",
                "theme": "신뢰",
                "starting_state": "평온",
                "midpoint": "배신",
                "ending_direction": "화해",
                "story_flow_summary": "시작-전환-결말",
            }
            ,
            "episodes": [
                {
                    "episode_number": number,
                    "title": f"{number}화",
                    "summary": f"{number}화 요약",
                    "main_event": "사건",
                    "conflict": "갈등",
                    "characters": ["민재"],
                    "locations": ["복도"],
                    "objects": ["열쇠"],
                    "reveals": [],
                    "hidden_secrets": ["비밀"],
                    "cliffhanger": "문이 열린다",
                    "next_episode_hook": "문 안을 조사한다",
                }
                for number in range(1, episode_count + 1)
            ],
        }


class V13WorkflowSimplificationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        shutil.copytree(Path.cwd() / "prompts", self.root / "prompts")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_library_indexes_project_image_without_copying_or_deleting_it(self) -> None:
        project_image = self.root / "learning_data" / "projects" / "p1" / "images"
        project_image.mkdir(parents=True)
        source = project_image / "scene1.png"
        source.write_bytes(image_bytes())
        library = AssetLibrary(self.root / "learning_data")
        asset = library.index_project_image(
            source,
            asset_type="general_reference",
            display_name="Scene 1",
            source_project_id="p1",
            source_scene_number=1,
        )
        self.assertEqual(library.resolve_path(asset), source.resolve())
        self.assertFalse(library.files.exists())
        library.delete(asset.asset_id, self.root / "learning_data" / "projects")
        self.assertTrue(source.is_file())

    def test_short_default_flow_confirms_automatic_references(self) -> None:
        config = AppConfig.load(
            self.root, env={"OPENAI_API_KEY": "test-key"}
        )
        config.ensure_directories()
        service = GenerationService(
            config, story_adapter=Story(), image_adapter=Images()
        )
        context = service.generate_project("주제")
        summary = service.automatic_reference_summary(context)
        self.assertEqual(summary["estimated_image_api_calls"], 6)
        context = service.confirm_automatic_references(context)
        self.assertEqual(context.workflow_state, WorkflowState.ASSET_MAPPING_APPROVED)
        context = service.generate_approved_images(context)
        project_root = service.memory.project_directory(context.project_id)
        self.assertTrue(all(
            Path(path).parent == project_root / "images"
            for path in context.generated_images
        ))
        indexed = AssetLibrary(self.root / "learning_data").load_all()
        folders = [asset for asset in indexed if asset.is_folder]
        children = [asset for asset in indexed if asset.parent_folder_id]
        self.assertEqual(len(folders), 1)
        self.assertEqual(len(children), 6)
        self.assertEqual(folders[0].child_asset_ids, [
            child.asset_id
            for child in sorted(children, key=lambda item: item.sort_order)
        ])

    def test_default_flow_sends_every_candidate_and_character_reference(
        self,
    ) -> None:
        config = AppConfig.load(
            self.root, env={"OPENAI_API_KEY": "test-key"}
        )
        config.ensure_directories()
        library = AssetLibrary(self.root / "learning_data")
        source = self.root / "character-main.png"
        source.write_bytes(image_bytes(b"main"))
        character = library.import_file(
            source,
            asset_type="character",
            display_name="Fixture Character",
            description="Fixture Character Description",
            tags=["not-in-image-prompt-tag"],
            aliases=["not-in-image-prompt-alias"],
        )
        for role in ("side", "back"):
            reference = self.root / f"character-{role}.png"
            reference.write_bytes(image_bytes(role.encode()))
            character = library.add_character_reference(
                character.asset_id, reference, role
            )
        background_source = self.root / "background.png"
        background_source.write_bytes(image_bytes(b"background"))
        background = library.import_file(
            background_source,
            asset_type="background",
            display_name="Fixture Background",
            description="Fixture Background Description",
        )
        images = CapturingImages()
        service = GenerationService(
            config, story_adapter=Story(), image_adapter=images
        )
        context = service.generate_project(
            "주제",
            candidate_asset_ids=[character.asset_id, background.asset_id],
        )
        summary = service.automatic_reference_summary(context)
        self.assertTrue(all(
            set(summary["selected_asset_ids_by_scene"][scene])
            == {character.asset_id, background.asset_id}
            for scene in range(1, 7)
        ))
        context = service.confirm_automatic_references(context)
        context = service.generate_approved_images(context)
        self.assertEqual(len(images.references), 6)
        self.assertTrue(all(
            len(references) == 4 for references in images.references
        ))
        for prompt in images.prompts:
            self.assertIn("Fixture Character", prompt)
            self.assertIn("Fixture Character Description", prompt)
            self.assertIn("Fixture Background", prompt)
            self.assertIn("Fixture Background Description", prompt)
            self.assertIn("실제로 필요한 Reference만 사용하십시오", prompt)
            self.assertNotIn("not-in-image-prompt-tag", prompt)
            self.assertNotIn("not-in-image-prompt-alias", prompt)
        counts = context.image_generation_records[0][
            "candidate_asset_counts"
        ]
        self.assertEqual(counts["total"], 2)
        self.assertEqual(counts["character"], 1)
        self.assertEqual(counts["background"], 1)

    def test_long_project_dual_writes_episode_as_short_project_container(self) -> None:
        config = AppConfig.load(self.root, env={})
        config.ensure_directories()
        store = LongStoryService(config).create_project(
            LongProject("long_v13", title="장기", episode_count=2)
        )
        for number in (1, 2):
            episode_root = store.episode_root(number)
            self.assertTrue((episode_root / "project.json").is_file())
            self.assertTrue((episode_root / "script.json").is_file())
            self.assertTrue((episode_root / "images").is_dir())
        self.assertEqual(len(store.list_episodes()), 2)

    def test_long_creation_generates_only_outlines_in_one_mock_call(self) -> None:
        config = AppConfig.load(self.root, env={})
        config.ensure_directories()
        adapter = ProjectOutline()
        service = LongStoryService(config, planner_adapter=adapter)
        store = service.create_project(
            LongProject("long_scripts", title="장기", episode_count=3)
        )
        episodes = service.generate_project_outline(store)
        self.assertEqual(adapter.calls, 1)
        self.assertEqual(len(episodes), 3)
        self.assertTrue(all(item.state == "outline_ready" for item in episodes))
        self.assertTrue(all(item.outline for item in episodes))
        self.assertTrue(all(not item.script for item in episodes))
        self.assertFalse(any(item.generated_images for item in episodes))
        self.assertEqual(len(store.load_episode_outlines()), 3)


if __name__ == "__main__":
    unittest.main()

