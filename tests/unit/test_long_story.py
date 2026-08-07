"""Long-story offline management and fake-adapter production tests."""

from pathlib import Path
import shutil
import struct
import tempfile
import unittest

from app.config.config import AppConfig
from app.core.project_context import ProjectContext
from app.engines.image_engine import PNG_SIGNATURE
from app.long_story.context_builder import StoryContextBuilder
from app.long_story.bible_manager import BibleCollectionManager
from app.long_story.models import ContinuityMemory, LongProject
from app.long_story.service import LongStoryService
from app.services.reference_asset_manager import ProjectReferenceManager
from app.long_story.ui_support import (
    dashboard_metrics,
    filter_episodes,
    parse_scope,
    reference_scope_label,
)
from app.services.reference_asset_manager import ReferenceAsset, ReferenceAssetError
from app.services.asset_library import AssetLibrary


class FakeStory:
    def generate(self, prompt: str):
        return {
            "title": "회차",
            "synopsis": "연결된 이야기",
            "scenes": [
                {"number": number, "description": f"장면 {number}"}
                for number in range(1, 7)
            ],
            "ending": "다음 화로",
        }


class FakeImage:
    def __init__(self):
        self.calls = 0
        self.references: list[list[Path]] = []

    def generate(self, prompt: str, reference_images: list[Path]) -> bytes:
        self.calls += 1
        self.references.append(list(reference_images))
        return PNG_SIGNATURE + b"image"


class FailsSceneFourOnce(FakeImage):
    def generate(self, prompt: str, reference_images: list[Path]) -> bytes:
        self.calls += 1
        if self.calls == 4:
            raise TimeoutError("temporary")
        return PNG_SIGNATURE + b"image"


class FakePlanner:
    def generate(self, prompt: str, episode_count: int):
        return [
            {
                "number": number, "title": f"{number}화",
                "summary": "요약", "core_event": "사건",
                "conflict": "갈등", "cliffhanger": "연결",
            }
            for number in range(1, episode_count + 1)
        ]


class LongStoryTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        shutil.copytree(Path.cwd() / "prompts", self.root / "prompts")
        self.config = AppConfig.load(self.root, env={})
        self.config.ensure_directories()
        self.service = LongStoryService(self.config)
        self.store = self.service.create_project(
            LongProject(
                "long_1", title="별을 잃은 도시", logline="별을 찾는다",
                genre="판타지", episode_count=3,
            )
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_existing_project_defaults_to_short(self) -> None:
        self.assertEqual(ProjectContext("old", "topic").project_type, "short_project")

    def test_create_reload_bible_and_empty_plan(self) -> None:
        self.assertEqual(self.store.load_project().project_type, "long_story_project")
        self.assertEqual(len(self.store.list_episodes()), 3)
        bible = self.store.load_bible()
        character = bible.add("characters", {"name": "민재"}, "CHAR")
        bible.add("locations", {"name": "도시"}, "LOC")
        bible.add("props", {"name": "별 조각"}, "PROP")
        bible.add(
            "secrets",
            {"truth": "비밀", "reveal_available_episode": 3},
            "SECRET",
        )
        self.service.save_bible(self.store, bible)
        loaded = self.store.load_bible()
        self.assertEqual(loaded.characters[0]["character_id"], character["character_id"])

    def test_story_bible_typed_library_asset_links(self) -> None:
        library = AssetLibrary(self.root / "learning_data")
        source = self.root / "bible.png"
        source.write_bytes(
            PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
            + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
            + b"\x00\x00\x00\x00"
        )
        character_asset = library.import_file(
            source, asset_type="character", display_name="민재"
        )
        bible = self.store.load_bible()
        character = bible.add("characters", {"name": "민재"}, "CHAR")
        self.service.save_bible(self.store, bible)
        linked = self.service.link_bible_asset(
            self.store, "characters", character["character_id"],
            character_asset.asset_id,
        )
        self.assertEqual(
            linked["asset_link"]["asset_id"], character_asset.asset_id
        )
        self.assertNotIn("stored_path", linked["asset_link"])
        with self.assertRaises(ValueError):
            self.service.link_bible_asset(
                self.store, "locations", "missing", character_asset.asset_id
            )
        style_path = self.root / "style.png"
        style_path.write_bytes(
            PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
            + struct.pack(">II", 9, 9) + b"\x08\x06\x00\x00\x00"
            + b"\x00\x00\x00\x00"
        )
        style_asset = library.import_file(
            style_path, asset_type="style", display_name="기본 스타일"
        )
        bible = self.service.link_bible_style(
            self.store, style_asset.asset_id,
            version_policy="follow_latest",
        )
        self.assertEqual(
            bible.basic["style_asset_link"]["version_policy"],
            "follow_latest",
        )

    def test_story_bible_location_links_background_asset(self) -> None:
        library = AssetLibrary(self.root / "learning_data")
        source = self.root / "location.png"
        source.write_bytes(
            PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
            + struct.pack(">II", 12, 12) + b"\x08\x06\x00\x00\x00"
            + b"\x00\x00\x00\x00"
        )
        asset = library.import_file(
            source, asset_type="background", display_name="학교 복도"
        )
        bible = self.store.load_bible()
        location = bible.add("locations", {"name": "학교 복도"}, "LOC")
        self.service.save_bible(self.store, bible)
        linked = self.service.link_bible_asset(
            self.store, "locations", location["location_id"], asset.asset_id
        )
        self.assertEqual(linked["asset_link"]["asset_id"], asset.asset_id)

    def test_story_bible_prop_links_object_asset(self) -> None:
        library = AssetLibrary(self.root / "learning_data")
        source = self.root / "prop.png"
        source.write_bytes(
            PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
            + struct.pack(">II", 13, 13) + b"\x08\x06\x00\x00\x00"
            + b"\x00\x00\x00\x00"
        )
        asset = library.import_file(
            source, asset_type="object", display_name="검은 열쇠"
        )
        bible = self.store.load_bible()
        prop = bible.add("props", {"name": "검은 열쇠"}, "PROP")
        self.service.save_bible(self.store, bible)
        linked = self.service.link_bible_asset(
            self.store, "props", prop["prop_id"], asset.asset_id
        )
        self.assertEqual(linked["asset_link"]["asset_id"], asset.asset_id)

    def test_character_crud_clone_and_search(self) -> None:
        bible = self.store.load_bible()
        manager = BibleCollectionManager(bible, "characters")
        character = manager.add({
            "name": "민재", "description": "주인공", "alive": True,
            "injured": False, "emotional_state": "불안",
            "location_id": "LOC-1", "owned_item_ids": ["PROP-1"],
        })
        manager.update(character["character_id"], {"injured": True})
        self.assertTrue(manager.get(character["character_id"])["injured"])
        clone = manager.duplicate(character["character_id"])
        self.assertNotEqual(clone["character_id"], character["character_id"])
        self.assertEqual(len(manager.search("민재")), 2)
        manager.delete(clone["character_id"])
        self.assertEqual(len(manager.items), 1)

    def test_context_prioritizes_recent_and_forbids_future_secret(self) -> None:
        bible = self.store.load_bible()
        bible.secrets.append({
            "secret_id": "S1", "truth": "future",
            "reveal_available_episode": 3,
        })
        self.service.save_bible(self.store, bible)
        self.store.save_continuity(
            ContinuityMemory(1, episode_summary="첫 회 요약", events=["사건"])
        )
        context = self.service.build_context(self.store, 2)
        self.assertEqual(context["recent_continuity"][0]["episode_number"], 1)
        self.assertEqual(context["forbidden_information"][0]["secret_id"], "S1")

    def test_context_limit_is_enforced(self) -> None:
        builder = StoryContextBuilder(max_characters=2000)
        bible = self.store.load_bible()
        bible.foreshadowing = [
            {"id": index, "content": "x" * 300, "status": "open"}
            for index in range(20)
        ]
        context = builder.build(self.store, bible, self.store.load_episode(1))
        import json
        self.assertLessEqual(len(json.dumps(context, ensure_ascii=False)), 2000)

    def test_api_key_absent_keeps_management_but_blocks_generation(self) -> None:
        self.service.add_episode(self.store, "수동 회차")
        with self.assertRaisesRegex(RuntimeError, "OPENAI_API_KEY"):
            self.service.generate_episode_script(self.store, 1)
        self.assertFalse(
            (self.root / "learning_data" / "api_calls.json").exists()
        )

    def test_fake_full_episode_flow_and_no_next_auto_generation(self) -> None:
        images = FakeImage()
        service = LongStoryService(
            self.config, story_adapter=FakeStory(), image_adapter=images
        )
        source = self.root / "long-reference.png"
        source.write_bytes(
            PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
            + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
            + b"\x00\x00\x00\x00"
        )
        ProjectReferenceManager(
            service.projects_root, "long_1"
        ).import_file(source, reference_type="style")
        episode = service.generate_episode_script(self.store, 1)
        self.assertEqual(episode.state, "script_review")
        service.approve_script(self.store, 1)
        service.approve_episode_asset_mapping(
            self.store, 1, legacy_confirmed=True
        )
        episode = service.generate_episode_images(self.store, 1)
        self.assertEqual(episode.state, "images_review")
        self.assertEqual(images.calls, 6)
        self.assertTrue(all(len(paths) == 1 for paths in images.references))
        for scene in range(1, 7):
            episode = service.approve_image(self.store, 1, scene)
        self.assertEqual(episode.state, "waiting_for_video_confirmation")
        next_episode = service.prepare_next_episode(
            self.store, 1, ContinuityMemory(1, episode_summary="완료")
        )
        self.assertEqual(next_episode.state, "planned")
        self.assertEqual(next_episode.script, {})

    def test_images_blocked_before_script_approval(self) -> None:
        service = LongStoryService(
            self.config, story_adapter=FakeStory(), image_adapter=FakeImage()
        )
        with self.assertRaisesRegex(ValueError, "승인"):
            service.generate_episode_images(self.store, 1)

    def test_previous_episode_last_scene_is_scene_one_continuity_reference(
        self,
    ) -> None:
        images = FakeImage()
        service = LongStoryService(
            self.config, story_adapter=FakeStory(), image_adapter=images
        )
        service.generate_episode_script(self.store, 1)
        service.approve_script(self.store, 1)
        service.approve_episode_asset_mapping(
            self.store, 1, text_only_confirmed=True
        )
        first = service.generate_episode_images(self.store, 1)
        for scene in range(1, 7):
            first = service.approve_image(self.store, 1, scene)
        previous_last = Path(first.generated_images[5])

        second = self.store.load_episode(2)
        second.outline["previous_scene_link"] = {
            "source_kind": "long_episode",
            "project_id": "long_1",
            "episode_number": 1,
            "scene_number": 6,
            "story_context": "1화의 마지막 장면에서 이어진다.",
        }
        self.store.save_episode(second)
        service.generate_episode_script(
            self.store, 2,
            instruction="1화의 마지막 장면에서 이어진다.",
        )
        service.approve_script(self.store, 2)
        service.approve_episode_asset_mapping(
            self.store, 2, text_only_confirmed=True
        )
        service.generate_episode_images(self.store, 2)

        self.assertIn(previous_last, images.references[6])
        self.assertNotIn(previous_last, images.references[7])
        preview = service.preview_scene_generation(self.store, 2, 1)
        self.assertIn("이전 장면 연속성 Reference", preview["prompt"])

    def test_images_blocked_after_script_before_mapping_approval(self) -> None:
        images = FakeImage()
        service = LongStoryService(
            self.config, story_adapter=FakeStory(), image_adapter=images
        )
        service.generate_episode_script(self.store, 1)
        episode = service.approve_script(self.store, 1)
        self.assertEqual(
            episode.state, "waiting_for_asset_mapping_review"
        )
        with self.assertRaisesRegex(ValueError, "Mapping"):
            service.generate_episode_images(self.store, 1)
        self.assertEqual(images.calls, 0)

    def test_regenerate_replaces_only_one_scene_and_resets_approval(self) -> None:
        images = FakeImage()
        service = LongStoryService(
            self.config, story_adapter=FakeStory(), image_adapter=images
        )
        service.generate_episode_script(self.store, 1)
        service.approve_script(self.store, 1)
        service.approve_episode_asset_mapping(
            self.store, 1, text_only_confirmed=True
        )
        episode = service.generate_episode_images(self.store, 1)
        originals = list(episode.generated_images)
        episode = service.approve_image(self.store, 1, 4)
        self.assertIn(4, episode.approved_scene_numbers)
        preview = service.preview_scene_generation(self.store, 1, 4)
        self.assertEqual(preview["scene"], 4)
        self.assertIn("prompt", preview)
        episode = service.regenerate_episode_scene(self.store, 1, 4)
        self.assertEqual(images.calls, 7)
        self.assertEqual(episode.generated_images[:3], originals[:3])
        self.assertEqual(episode.generated_images[4:], originals[4:])
        self.assertNotIn(4, episode.approved_scene_numbers)
        self.assertEqual(episode.scene_regeneration_history[-1]["scene"], 4)
        self.assertEqual(episode.state, "images_review")

    def test_regeneration_blocked_when_script_fingerprint_changes(self) -> None:
        images = FakeImage()
        service = LongStoryService(
            self.config, story_adapter=FakeStory(), image_adapter=images
        )
        service.generate_episode_script(self.store, 1)
        service.approve_script(self.store, 1)
        service.approve_episode_asset_mapping(
            self.store, 1, text_only_confirmed=True
        )
        episode = service.generate_episode_images(self.store, 1)
        episode.script["scenes"][0]["description"] = "승인 후 변경"
        self.store.save_episode(episode)
        calls = images.calls
        with self.assertRaises(ReferenceAssetError):
            service.regenerate_episode_scene(self.store, 1, 1)
        self.assertEqual(images.calls, calls)

    def test_partial_episode_images_are_saved_and_only_missing_scenes_resume(self) -> None:
        images = FailsSceneFourOnce()
        service = LongStoryService(
            self.config, story_adapter=FakeStory(), image_adapter=images
        )
        service.generate_episode_script(self.store, 1)
        service.approve_script(self.store, 1)
        service.approve_episode_asset_mapping(
            self.store, 1, text_only_confirmed=True
        )
        with self.assertRaises(TimeoutError):
            service.generate_episode_images(self.store, 1)
        partial = self.store.load_episode(1)
        self.assertEqual(partial.state, "images_partial")
        self.assertEqual(partial.failed_scene_numbers, [4])
        self.assertTrue(all(partial.generated_images[index] for index in range(3)))
        completed = service.generate_episode_images(self.store, 1)
        self.assertEqual(completed.state, "images_review")
        self.assertEqual(images.calls, 7)

    def test_long_scene_regeneration_is_not_blocked_by_legacy_count(self) -> None:
        images = FakeImage()
        service = LongStoryService(
            self.config, story_adapter=FakeStory(), image_adapter=images
        )
        service.generate_episode_script(self.store, 1)
        service.approve_script(self.store, 1)
        service.approve_episode_asset_mapping(
            self.store, 1, text_only_confirmed=True
        )
        service.generate_episode_images(self.store, 1)
        attempts = self.config.app_max_regen_calls_per_scene + 1
        for _index in range(attempts):
            service.regenerate_episode_scene(self.store, 1, 2)
        episode = self.store.load_episode(1)
        scene_attempts = [
            item for item in episode.scene_regeneration_history
            if int(item.get("scene", 0)) == 2
        ]
        self.assertEqual(len(scene_attempts), attempts)

    def test_ui_support_scopes_filters_and_dashboard(self) -> None:
        episode_scope = parse_scope("1-10", episode=True)
        scene_scope = parse_scope("2-6", episode=False)
        asset = ReferenceAsset(
            "RA-1", "long_1", "reference_assets/a.png", "a.png", "Hero",
            "manual_upload", "character", episode_scope=episode_scope,
            scene_scope=scene_scope,
        )
        self.assertEqual(
            reference_scope_label(asset), "Episode 1~10 · Scene 2~6"
        )
        episodes = self.store.list_episodes()
        episodes[0].title = "Moon Case"
        self.assertEqual(filter_episodes(episodes, "moon")[0].number, 1)
        bible = self.store.load_bible()
        bible.secrets.append({"status": "open"})
        metrics = dashboard_metrics(episodes, bible, 4, 2)
        self.assertEqual(metrics["api_calls"], 4)
        self.assertEqual(metrics["reference_warnings"], 2)
        self.assertEqual(metrics["open_threads"], 1)

    def test_ai_plan_is_preview_until_explicit_approval(self) -> None:
        service = LongStoryService(self.config, planner_adapter=FakePlanner())
        original = self.store.load_episode(1).title
        preview = service.generate_plan_preview(self.store, count=3)
        self.assertEqual(preview[0].state, "planning_review")
        self.assertEqual(self.store.load_episode(1).title, original)
        service.approve_plan(self.store, preview)
        self.assertEqual(self.store.load_episode(1).title, "1화")


if __name__ == "__main__":
    unittest.main()

