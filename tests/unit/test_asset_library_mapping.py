"""Global Asset Library, project mappings, matching, and migration tests."""

from pathlib import Path
import json
import struct
import tempfile
import unittest
from unittest.mock import patch

import os

from app.services.asset_library import (
    AssetLibrary,
    CharacterReferenceImage,
)
from app.services.project_asset_mapping import (
    ProjectAssetMappingStore,
    ProjectAssetResolver,
    SceneAssetMatcher,
    describe_reference_selection,
    select_character_reference_roles,
)
from app.services.reference_asset_manager import (
    ProjectReferenceManager,
    ReferenceAssetError,
    EpisodeScope,
    SceneScope,
)
from app.services.reference_migration import LegacyReferenceMigrator
from app.core.project_context import ProjectContext, WorkflowState
from app.services.memory_manager import MemoryManager


def png(path: Path, marker: bytes = b"") -> Path:
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n" + struct.pack(">I", 13) + b"IHDR"
        + struct.pack(">II", 8, 8) + b"\x08\x06\x00\x00\x00"
        + marker + b"\x00\x00\x00\x00"
    )
    return path


class AssetLibraryMappingTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.library = AssetLibrary(self.root)

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_index_save_retries_transient_windows_file_lock(self) -> None:
        original_replace = os.replace
        calls = 0

        def transient_replace(source: Path, destination: Path) -> None:
            nonlocal calls
            calls += 1
            if calls == 1:
                raise PermissionError(5, "access denied")
            original_replace(source, destination)

        with patch(
            "app.services.asset_library.os.replace",
            side_effect=transient_replace,
        ):
            self.library._save([])

        self.assertEqual(calls, 2)
        self.assertEqual(self.library.load_all(), [])
        self.assertFalse((self.library.root / "assets.tmp").exists())
        self.assertEqual(list(self.library.root.glob(".assets.*.tmp")), [])

    def test_library_works_without_project_and_deduplicates(self) -> None:
        source = png(self.root / "hero.png")
        first = self.library.import_file(
            source, asset_type="character", display_name="민재",
            description="회색 후드 남학생", tags=["주인공", "남학생"],
            aliases=["소년", "hero"], approved=True, face_baseline=True,
        )
        second = self.library.import_file(
            source, asset_type="character", display_name="복사본"
        )
        self.assertEqual(first.asset_id, second.asset_id)
        self.assertEqual(self.library.search("민재")[0].asset_id, first.asset_id)
        self.assertEqual(self.library.search(tags=["주인공"])[0].asset_id, first.asset_id)

    def test_search_indexes_all_metadata_casefolded_and_partially(self) -> None:
        asset = self.library.import_file(
            png(self.root / "panda.png"),
            asset_type="character",
            display_name="이배드 기본 캐릭터",
            description="어린왕자 느낌의 판다 주인공",
            tags=["판다", "여행", "카메라"],
            aliases=["Panda", "Mascot"],
        )
        for query in (
            "이배드", "어린왕자", "판다", "여행", "카메라",
            "PANDA", "mas", "Character", "ract",
        ):
            with self.subTest(query=query):
                self.assertEqual(
                    [item.asset_id for item in self.library.search(query)],
                    [asset.asset_id],
                )

    def test_legacy_index_without_optional_metadata_migrates_in_memory(
        self,
    ) -> None:
        asset = self.library.import_file(
            png(self.root / "legacy-index.png"),
            asset_type="background",
            display_name="기존 숲",
        )
        payload = json.loads(self.library.path.read_text(encoding="utf-8"))
        for key in ("description", "tags", "aliases"):
            payload[0].pop(key)
        self.library.path.write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
        loaded = self.library.load_all()[0]
        self.assertEqual(loaded.asset_id, asset.asset_id)
        self.assertEqual(loaded.description, "")
        self.assertEqual(loaded.tags, [])
        self.assertEqual(loaded.aliases, [])
        self.assertEqual(
            self.library.search("Background")[0].asset_id,
            asset.asset_id,
        )

    def test_legacy_character_gets_thumbnail_and_front_without_id_change(
        self,
    ) -> None:
        asset = self.library.import_file(
            png(self.root / "legacy-character.png"),
            asset_type="character",
            display_name="Fixture Character",
        )
        payload = json.loads(self.library.path.read_text(encoding="utf-8"))
        payload[0].pop("reference_images", None)
        self.library.path.write_text(
            json.dumps(payload, ensure_ascii=False), encoding="utf-8"
        )
        loaded = self.library.load_all()[0]
        self.assertEqual(loaded.asset_id, asset.asset_id)
        self.assertEqual(
            [item.role for item in loaded.reference_images],
            ["thumbnail", "front"],
        )
        persisted = json.loads(
            self.library.path.read_text(encoding="utf-8")
        )[0]
        self.assertNotIn("reference_images", persisted)

    def test_only_character_assets_use_reference_sets(self) -> None:
        background = self.library.import_file(
            png(self.root / "single-background.png"),
            asset_type="background",
            display_name="Fixture Background",
        )
        self.assertEqual(background.reference_images, [])

    def test_character_reference_set_reorders_and_changes_representative(
        self,
    ) -> None:
        asset = self.library.import_file(
            png(self.root / "character-main.png", b"main"),
            asset_type="character",
            display_name="Fixture Character",
        )
        alternate = png(self.root / "character-alt.png", b"alternate")
        asset = self.library.add_character_reference(
            asset.asset_id, alternate, "side"
        )
        side = next(
            item for item in asset.reference_images if item.role == "side"
        )
        updated = self.library.update_character_references(
            asset.asset_id,
            [
                CharacterReferenceImage(
                    "thumbnail", side.path, side.content_sha256,
                    side.original_filename,
                ),
                *[
                    item for item in asset.reference_images
                    if item.content_sha256 != side.content_sha256
                ],
            ],
        )
        self.assertEqual(updated.reference_images[0].role, "thumbnail")
        self.assertEqual(
            Path(updated.stored_path).resolve(), alternate.resolve()
        )
        self.assertEqual(Path(side.path).resolve(), alternate.resolve())

    def test_character_reference_roles_are_selected_locally(self) -> None:
        roles = select_character_reference_roles(
            {"description": "side view with a surprised expression"}
        )
        self.assertEqual(roles[:2], ["side", "expression"])
        self.assertIn("thumbnail", roles)

    def test_character_reference_custom_roles_can_be_added_and_removed(
        self,
    ) -> None:
        asset = self.library.import_file(
            png(self.root / "custom-role.png", b"custom-role"),
            asset_type="character",
            display_name="Custom Role Character",
        )
        references = list(asset.reference_images)
        references[0].role = "costume_detail"
        roles = [*asset.reference_roles, "costume_detail"]
        updated = self.library.update_character_references(
            asset.asset_id,
            references,
            reference_roles=roles,
        )
        self.assertIn("costume_detail", updated.reference_roles)
        self.assertEqual(
            updated.reference_images[0].role, "costume_detail"
        )

        updated.reference_images[0].role = "other"
        updated = self.library.update_character_references(
            asset.asset_id,
            updated.reference_images,
            reference_roles=[
                role for role in updated.reference_roles
                if role != "costume_detail"
            ],
        )
        self.assertNotIn("costume_detail", updated.reference_roles)
        self.assertTrue(
            all(
                reference.role != "costume_detail"
                for reference in updated.reference_images
            )
        )

    def test_generic_asset_folder_preserves_children_without_indexing_reference_names(
        self,
    ) -> None:
        first = self.library.import_file(
            png(self.root / "folder-day.png", b"folder-day"),
            asset_type="background",
            display_name="낮 전경",
        )
        second = self.library.import_file(
            png(self.root / "folder-night.png", b"folder-night"),
            asset_type="background",
            display_name="밤 내부",
        )
        self.library.update_metadata(first.asset_id, role="day")
        self.library.update_metadata(second.asset_id, role="night")
        folder = self.library.create_folder(
            display_name="도시 배경 모음",
            asset_type="background",
            description="같은 도시의 시간대별 모습",
            aliases=["도시"],
            tags=["배경"],
            child_asset_ids=[first.asset_id, second.asset_id],
            thumbnail_asset_id=first.asset_id,
        )
        self.assertTrue(folder.asset_id.startswith("FOLDER-"))
        self.assertEqual(
            folder.child_asset_ids, [first.asset_id, second.asset_id]
        )
        self.assertNotIn(
            folder.asset_id,
            [asset.asset_id for asset in self.library.search("밤 내부")],
        )
        renamed = self.library.update_folder(
            folder.asset_id, display_name="새 도시 배경"
        )
        self.assertEqual(renamed.asset_id, folder.asset_id)
        self.assertEqual(renamed.display_name, "새 도시 배경")

    def test_folder_type_change_synchronizes_child_reference_structure(
        self,
    ) -> None:
        child = self.library.import_file(
            png(self.root / "type-change.png", b"type-change"),
            asset_type="character",
            display_name="각도 이미지",
        )
        self.library.update_metadata(child.asset_id, role="front")
        folder = self.library.create_folder(
            display_name="유형 변경 Folder",
            asset_type="character",
            child_asset_ids=[child.asset_id],
        )

        self.library.update_folder(folder.asset_id, asset_type="background")
        background_child = self.library.get(child.asset_id)
        self.assertEqual(background_child.asset_type, "background")
        self.assertEqual(background_child.role, "reference")
        self.assertEqual(background_child.reference_images, [])
        self.assertEqual(background_child.reference_roles, [])

        self.library.update_folder(folder.asset_id, asset_type="character")
        character_child = self.library.get(child.asset_id)
        self.assertEqual(character_child.asset_type, "character")
        self.assertEqual(character_child.role, "other")
        self.assertEqual(
            {item.role for item in character_child.reference_images},
            {"thumbnail", "front"},
        )

    def test_legacy_folder_child_type_migration_is_idempotent(self) -> None:
        child = self.library.import_file(
            png(self.root / "legacy-child-type.png", b"legacy-child-type"),
            asset_type="general_reference",
            display_name="기존 하위 이미지",
        )
        folder = self.library.create_folder(
            display_name="기존 Character Folder",
            asset_type="general_reference",
            child_asset_ids=[child.asset_id],
        )
        assets = self.library.load_all()
        next(item for item in assets if item.asset_id == folder.asset_id).asset_type = (
            "character"
        )
        self.library._save(assets)

        self.assertEqual(self.library.synchronize_folder_child_types(), 1)
        migrated = self.library.get(child.asset_id)
        self.assertEqual(migrated.asset_type, "character")
        self.assertEqual(migrated.role, "other")
        self.assertEqual(self.library.synchronize_folder_child_types(), 0)

    def test_existing_reference_can_link_to_another_folder_without_copying(
        self,
    ) -> None:
        source_path = png(
            self.root / "shared-reference.png", b"shared-reference"
        )
        source = self.library.import_file(
            source_path,
            asset_type="character",
            display_name="공유 정면",
        )
        first_folder = self.library.create_folder(
            display_name="첫 캐릭터",
            asset_type="character",
            child_asset_ids=[source.asset_id],
        )

        linked = self.library.create_reference_link(
            source.asset_id,
            display_name="두 번째 연결",
            role="side",
        )
        second_folder = self.library.create_folder(
            display_name="두 번째 캐릭터",
            asset_type="character",
            child_asset_ids=[linked.asset_id],
        )

        self.assertNotEqual(source.asset_id, linked.asset_id)
        self.assertEqual(source.stored_path, linked.stored_path)
        self.assertEqual(source.content_sha256, linked.content_sha256)
        self.assertEqual(
            self.library.get(source.asset_id).parent_folder_id,
            first_folder.asset_id,
        )
        self.assertEqual(
            self.library.get(linked.asset_id).parent_folder_id,
            second_folder.asset_id,
        )
        self.assertEqual(linked.role, "side")
        self.assertEqual(
            self.library.find_matching_file(source_path).content_sha256,
            source.content_sha256,
        )
        self.library.update_folder(
            second_folder.asset_id, child_asset_ids=[]
        )
        self.library.delete_manual_file(
            linked.asset_id, self.root / "projects"
        )
        self.assertTrue(Path(source.stored_path).is_file())
        self.assertTrue(
            self.library.resolve_path(
                self.library.get(source.asset_id)
            ).is_file()
        )

    def test_legacy_root_asset_upgrades_to_folder_without_changing_id(
        self,
    ) -> None:
        source_path = png(
            self.root / "legacy-root.png", b"legacy-root"
        )
        legacy = self.library.import_file(
            source_path,
            asset_type="background",
            display_name="기존 배경",
            description="오래된 프로젝트 배경",
        )
        stored_path = self.library.resolve_path(legacy)

        self.assertEqual(
            self.library.upgrade_legacy_root_assets_to_folders(), 1
        )
        folder = self.library.get(legacy.asset_id)
        children = self.library.folder_children(folder)

        self.assertTrue(folder.is_folder)
        self.assertEqual(folder.asset_id, legacy.asset_id)
        self.assertEqual(folder.description, "오래된 프로젝트 배경")
        self.assertEqual(len(children), 1)
        self.assertEqual(children[0].parent_folder_id, folder.asset_id)
        self.assertEqual(
            self.library.resolve_path(children[0]), stored_path
        )
        self.assertEqual(
            self.library.upgrade_legacy_root_assets_to_folders(), 0
        )

    def test_generated_scenes_are_not_upgraded_one_by_one(self) -> None:
        scene_ids = []
        for scene_number in range(1, 7):
            source = png(
                self.root / f"generated-{scene_number}.png",
                f"generated-{scene_number}".encode(),
            )
            scene = self.library.index_project_image(
                source,
                asset_type="general_reference",
                display_name=f"Project · Scene {scene_number}",
                source_project_id="project_generated",
                source_scene_number=scene_number,
                deduplicate_globally=False,
            )
            scene_ids.append(scene.asset_id)

        self.assertEqual(
            self.library.upgrade_legacy_root_assets_to_folders(), 0
        )
        restored = self.library.load_all()
        self.assertFalse(any(item.is_folder for item in restored))
        self.assertEqual({item.asset_id for item in restored}, set(scene_ids))

    def test_repairs_legacy_one_scene_generated_folders(self) -> None:
        child_ids = []
        wrapper_ids = []
        for scene_number in range(1, 7):
            source = png(
                self.root / f"legacy-generated-{scene_number}.png",
                f"legacy-generated-{scene_number}".encode(),
            )
            child = self.library.index_project_image(
                source,
                asset_type="general_reference",
                display_name=f"Legacy Project · Scene {scene_number}",
                source_project_id="project_legacy_generated",
                source_scene_number=scene_number,
                deduplicate_globally=False,
            )
            child_ids.append(child.asset_id)
            wrapper = self.library.create_folder(
                display_name=child.display_name,
                asset_type="general_reference",
                child_asset_ids=[child.asset_id],
                source_project_id="project_legacy_generated",
            )
            stored = self.library.load_all()
            next(
                item for item in stored if item.asset_id == wrapper.asset_id
            ).source_scene_number = scene_number
            self.library._save(stored)
            wrapper_ids.append(wrapper.asset_id)

        self.assertEqual(
            self.library.repair_legacy_generated_scene_folders(), 1
        )
        restored = self.library.load_all()
        folders = [item for item in restored if item.is_folder]
        self.assertEqual(len(folders), 1)
        self.assertEqual(folders[0].asset_id, wrapper_ids[0])
        self.assertEqual(folders[0].child_asset_ids, child_ids)
        self.assertIsNone(folders[0].source_scene_number)
        self.assertEqual(
            folders[0].notes,
            "Automatically grouped generated project images",
        )
        self.assertEqual(
            {item.parent_folder_id for item in restored if not item.is_folder},
            {folders[0].asset_id},
        )

    def test_folder_mapping_sends_only_selected_child_image(self) -> None:
        first = self.library.import_file(
            png(self.root / "selected-front.png", b"selected-front"),
            asset_type="object", display_name="정면",
        )
        second = self.library.import_file(
            png(self.root / "unselected-side.png", b"unselected-side"),
            asset_type="object", display_name="측면",
        )
        self.library.update_metadata(first.asset_id, role="front")
        self.library.update_metadata(second.asset_id, role="side")
        folder = self.library.create_folder(
            display_name="소품 Folder",
            asset_type="object",
            description="같은 소품",
            child_asset_ids=[first.asset_id, second.asset_id],
        )
        store = ProjectAssetMappingStore(
            self.root / "projects", "folder_selection"
        )
        store.add_candidate(
            folder,
            always_apply=True,
            selected_child_asset_ids=[second.asset_id],
        )
        restored = ProjectAssetMappingStore(
            self.root / "projects", "folder_selection"
        ).load_all()[0]
        self.assertEqual(
            restored.selected_child_asset_ids, [second.asset_id]
        )
        paths, ids, warnings = ProjectAssetResolver(
            self.library, store
        ).select_for_episode_scene(1, 1)
        self.assertEqual(warnings, [])
        self.assertEqual(paths, [self.library.resolve_path(second)])
        self.assertEqual(len(ids), 1)
        self.assertIn(second.asset_id, ids[0])
        self.assertNotIn(first.asset_id, ids[0])
        metadata = ProjectAssetResolver(
            self.library, store
        ).prompt_asset_metadata(1, 1)
        self.assertIn("같은 Asset Folder", metadata)
        self.assertIn("측면(side)", metadata)
        self.library.update_metadata(
            second.asset_id, display_name="우측 참고"
        )
        manifest = ProjectAssetResolver(
            self.library, store
        ).prompt_reference_manifest(1, 1)
        self.assertIn("[첨부 Reference 1]", manifest)
        self.assertIn("Asset 대표 이름: 소품 Folder", manifest)
        self.assertIn("역할: side", manifest)
        self.assertIn("하위 이미지: 우측 참고(side)", manifest)
        self.assertNotIn("정면", manifest)

    def test_character_manifest_identifies_representative_asset(self) -> None:
        asset = self.library.import_file(
            png(self.root / "manifest-character.png", b"manifest"),
            asset_type="character",
            display_name="Fixture Lead",
            description="고유한 복장과 소품을 유지하는 대표 캐릭터",
        )
        store = ProjectAssetMappingStore(
            self.root / "projects", "character_manifest"
        )
        store.add_candidate(asset, always_apply=True)
        manifest = ProjectAssetResolver(
            self.library, store
        ).prompt_reference_manifest(
            1, 1, {"description": "front view"}
        )
        self.assertIn("Asset 대표 이름: Fixture Lead", manifest)
        self.assertIn("유형: character", manifest)
        self.assertIn("역할: front", manifest)
        self.assertIn("동일 캐릭터 외형 Reference", manifest)

    def test_folder_delete_never_deletes_original_image(self) -> None:
        path = png(self.root / "folder-original.png", b"folder-original")
        child = self.library.import_file(
            path, asset_type="style", display_name="원본"
        )
        folder = self.library.create_folder(
            display_name="삭제 Folder",
            asset_type="style",
            child_asset_ids=[child.asset_id],
        )
        self.library.delete_folder(
            folder.asset_id,
            self.root / "projects",
            remove_child_indexes=True,
        )
        self.assertTrue(path.is_file())
        with self.assertRaises(ReferenceAssetError):
            self.library.get(folder.asset_id)
        with self.assertRaises(ReferenceAssetError):
            self.library.get(child.asset_id)

    def test_folder_full_delete_removes_owned_manual_reference_files(self) -> None:
        upload = png(self.root / "folder-full-delete.png", b"folder-full")
        child = self.library.import_file(
            upload, asset_type="character", display_name="수동 Reference"
        )
        owned = self.library.resolve_path(child)
        folder = self.library.create_folder(
            display_name="완전 삭제 Folder",
            asset_type="character",
            child_asset_ids=[child.asset_id],
        )
        self.assertTrue(owned.is_file())

        self.library.delete_folder(
            folder.asset_id,
            self.root / "projects",
            remove_child_indexes=True,
            delete_manual_files=True,
        )

        self.assertFalse(owned.exists())
        self.assertTrue(upload.is_file())
        self.assertEqual(self.library.load_all(), [])

    def test_front_reference_selection_is_described(self) -> None:
        rows = describe_reference_selection(
            ["ASSET-TEST@v1#front"], [Path("front-view.png")],
            {"description": "front view"},
        )
        self.assertEqual(rows[0]["role"], "front")
        self.assertEqual(rows[0]["reason"], "정면 키워드 감지")

    def test_side_reference_selection_is_described(self) -> None:
        rows = describe_reference_selection(
            ["ASSET-TEST@v1#side"], [Path("side-view.png")],
            {"description": "side view"},
        )
        self.assertEqual(rows[0]["role"], "side")
        self.assertEqual(rows[0]["reason"], "측면 키워드 감지")

    def test_back_reference_selection_is_described(self) -> None:
        rows = describe_reference_selection(
            ["ASSET-TEST@v1#back"], [Path("back-view.png")],
            {"description": "back view"},
        )
        self.assertEqual(rows[0]["role"], "back")
        self.assertEqual(rows[0]["reason"], "후면 키워드 감지")

    def test_resolver_expands_one_character_mapping_to_selected_images(
        self,
    ) -> None:
        asset = self.library.import_file(
            png(self.root / "set-main.png", b"main"),
            asset_type="character",
            display_name="Fixture Character",
        )
        asset = self.library.add_character_reference(
            asset.asset_id,
            png(self.root / "set-side.png", b"side"),
            "side",
        )
        asset = self.library.add_character_reference(
            asset.asset_id,
            png(self.root / "set-expression.png", b"expression"),
            "expression",
        )
        store = ProjectAssetMappingStore(
            self.root / "projects", "character_set_project"
        )
        store.add_candidate(asset, always_apply=True)
        paths, ids, warnings = ProjectAssetResolver(
            self.library, store
        ).image_pipeline_selection(
            1, {"description": "side view, surprised expression"}
        )
        self.assertEqual(warnings, [])
        self.assertEqual(
            [path.name for path in paths],
            [
                "set-side.png",
                "set-expression.png",
                Path(asset.stored_path).name,
            ],
        )
        self.assertEqual(len({item.split("#")[0] for item in ids}), 1)
        self.assertTrue(all(item.startswith(asset.asset_id) for item in ids))

    def test_reference_image_filename_is_not_search_metadata(self) -> None:
        asset = self.library.import_file(
            png(self.root / "search-main.png", b"main"),
            asset_type="character",
            display_name="Fixture Character",
        )
        self.library.add_character_reference(
            asset.asset_id,
            png(self.root / "filename-only-token.png", b"alt"),
            "other",
        )
        self.assertEqual(
            self.library.search("filename-only-token"), []
        )

    def test_version_pinning_and_follow_latest(self) -> None:
        first_path = png(self.root / "first.png")
        asset = self.library.import_file(
            first_path, asset_type="style", display_name="기본 스타일"
        )
        projects = self.root / "projects"
        pinned = ProjectAssetMappingStore(projects, "project_a")
        candidate = pinned.add_candidate(asset, always_apply=True)
        candidate.candidate_only = False
        candidate.scene_scope = SceneScope(mode="scene", scene=1)
        pinned.save_all([candidate])
        old_path = self.library.resolve_path(asset, 1)
        self.library.add_version(asset.asset_id, png(self.root / "second.png", b"new"))
        resolver = ProjectAssetResolver(self.library, pinned)
        paths, ids, _ = resolver.image_pipeline_selection(1)
        self.assertEqual(paths, [old_path])
        self.assertEqual(ids, [f"{asset.asset_id}@v1"])

        candidate.version_policy = "follow_latest"
        pinned.save_all([candidate])
        paths, ids, _ = resolver.image_pipeline_selection(1)
        self.assertIn("@v2", ids[0])
        self.assertNotEqual(paths[0], old_path)

    def test_local_matcher_handles_exact_alias_ambiguous_and_type(self) -> None:
        minjae = self.library.import_file(
            png(self.root / "minjae.png"), asset_type="character",
            display_name="민재", aliases=["주인공"],
        )
        other = self.library.import_file(
            png(self.root / "other.png", b"x"), asset_type="character",
            display_name="다른 인물", aliases=["주인공"],
        )
        background = self.library.import_file(
            png(self.root / "hall.png", b"y"), asset_type="background",
            display_name="학교 복도",
        )
        matcher = SceneAssetMatcher()
        exact = matcher.match(
            "project_a", 1, {"characters": ["민재"]},
            [minjae, other, background],
        )
        self.assertEqual([item.asset_id for item in exact], [minjae.asset_id])
        ambiguous = matcher.match(
            "project_a", 1, {"characters": ["주인공"]},
            [minjae, other, background],
        )
        self.assertEqual(len(ambiguous), 2)
        self.assertTrue(all(item.status == "ambiguous" for item in ambiguous))
        self.assertTrue(all(item.usage_role == "character" for item in ambiguous))

    def test_same_asset_can_be_candidate_for_separate_episodes(self) -> None:
        asset = self.library.import_file(
            png(self.root / "episode-candidate.png"),
            asset_type="character",
            display_name="주인공",
        )
        store = ProjectAssetMappingStore(self.root / "projects", "long_a")
        first = store.add_candidate(
            asset, episode_scope=EpisodeScope(mode="episode", episode=1)
        )
        second = store.add_candidate(
            asset, episode_scope=EpisodeScope(mode="episode", episode=2)
        )
        self.assertNotEqual(first.mapping_id, second.mapping_id)
        mappings = store.load_all()
        self.assertEqual(len(mappings), 2)
        self.assertTrue(mappings[0].episode_scope.includes(1))
        self.assertTrue(mappings[1].episode_scope.includes(2))

    def test_resolver_requires_user_confirmation(self) -> None:
        asset = self.library.import_file(
            png(self.root / "asset.png"), asset_type="object",
            display_name="검은 열쇠",
        )
        store = ProjectAssetMappingStore(self.root / "projects", "project_a")
        suggested = SceneAssetMatcher().match(
            "project_a", 2, {"objects": ["검은 열쇠"]}, [asset]
        )[0]
        store.save_all([suggested])
        self.assertEqual(
            ProjectAssetResolver(self.library, store).image_pipeline_selection(2)[0],
            [],
        )
        store.confirm(suggested.mapping_id)
        self.assertEqual(
            len(ProjectAssetResolver(
                self.library, store
            ).image_pipeline_selection(2)[0]),
            1,
        )

    def test_library_and_legacy_duplicate_sha_is_passed_once(self) -> None:
        source = png(self.root / "shared.png")
        asset = self.library.import_file(
            source, asset_type="character", display_name="민재"
        )
        projects = self.root / "projects"
        store = ProjectAssetMappingStore(projects, "project_a")
        mapping = store.assign_asset(asset, scene_scope=SceneScope())
        legacy = ProjectReferenceManager(projects, "project_a")
        legacy.import_file(
            source, reference_type="character", display_name="민재"
        )
        resolver = ProjectAssetResolver(self.library, store, legacy)
        paths, ids, _warnings = resolver.image_pipeline_selection(1)
        self.assertEqual(len(paths), 1)
        self.assertEqual(ids, [f"{asset.asset_id}@v1"])

    def test_migration_is_idempotent_and_preserves_legacy(self) -> None:
        projects = self.root / "projects"
        source = png(self.root / "legacy.png")
        for project_id in ("project_a", "project_b"):
            ProjectReferenceManager(projects, project_id).import_file(
                source, reference_type="character", display_name="민재",
                scene_scope=SceneScope(mode="scene", scene=2),
                face_baseline=True,
            )
        migrator = LegacyReferenceMigrator(self.root)
        first = migrator.migrate_all()
        second = migrator.migrate_all()
        self.assertEqual(first.migrated_assets, 2)
        self.assertEqual(first.deduplicated_assets, 1)
        self.assertEqual(second.migrated_assets, 0)
        self.assertEqual(len(self.library.load_all()), 1)
        self.assertTrue(
            (projects / "project_a" / "reference_assets" / "references.json").is_file()
        )
        mapping = ProjectAssetMappingStore(projects, "project_a").load_all()[0]
        self.assertTrue(mapping.scene_scope.includes(2))
        self.assertTrue(self.library.load_all()[0].face_baseline)

    def test_in_use_asset_is_not_deleted_by_library_api(self) -> None:
        asset = self.library.import_file(
            png(self.root / "keep.png"), asset_type="background",
            display_name="옥상",
        )
        store = ProjectAssetMappingStore(self.root / "projects", "project_a")
        store.add_candidate(asset)
        with self.assertRaises(ReferenceAssetError):
            self.library.delete(asset.asset_id, self.root / "projects")
        self.assertTrue(self.library.resolve_path(asset).is_file())

    def test_unused_manual_asset_can_delete_owned_file(self) -> None:
        asset = self.library.import_file(
            png(self.root / "manual-delete.png"),
            asset_type="style",
            display_name="삭제할 수동 이미지",
        )
        owned = self.library.resolve_path(asset)
        self.assertTrue(owned.is_file())
        self.library.delete_manual_file(asset.asset_id, self.root / "projects")
        self.assertFalse(owned.exists())
        self.assertEqual(self.library.load_all(), [])

    def test_project_image_file_cannot_be_deleted_by_library(self) -> None:
        source = png(self.root / "project-image.png")
        asset = self.library.index_project_image(
            source,
            asset_type="background",
            display_name="프로젝트 이미지",
            source_project_id="project_a",
        )
        with self.assertRaises(ReferenceAssetError):
            self.library.delete_manual_file(
                asset.asset_id, self.root / "projects"
            )
        self.assertTrue(source.is_file())

    def test_file_audit_classifies_without_mutating_index(self) -> None:
        healthy = self.library.import_file(
            png(self.root / "healthy.png"),
            asset_type="style",
            display_name="정상",
        )
        missing = self.library.import_file(
            png(self.root / "missing.png", b"m"),
            asset_type="background",
            display_name="누락",
        )
        Path(missing.stored_path).unlink()
        before = self.library.path.read_bytes()
        results = {item.asset_id: item for item in self.library.audit_files()}
        self.assertEqual(results[healthy.asset_id].classification, "healthy")
        self.assertEqual(results[missing.asset_id].classification, "missing")
        self.assertEqual(self.library.path.read_bytes(), before)

    def test_relink_preserves_asset_id_and_updates_digest(self) -> None:
        asset = self.library.import_file(
            png(self.root / "old.png"),
            asset_type="object",
            display_name="검",
        )
        old_digest = asset.content_sha256
        replacement = png(self.root / "replacement.png", b"replacement")
        updated = self.library.relink_file(asset.asset_id, replacement)
        self.assertEqual(updated.asset_id, asset.asset_id)
        self.assertNotEqual(updated.content_sha256, old_digest)
        self.assertEqual(self.library.resolve_path(updated), replacement.resolve())

    def test_relink_rejects_invalid_file_without_mutation(self) -> None:
        asset = self.library.import_file(
            png(self.root / "safe.png"),
            asset_type="general_reference",
            display_name="안전",
        )
        before = self.library.path.read_bytes()
        invalid = self.root / "invalid.txt"
        invalid.write_text("not an image", encoding="utf-8")
        with self.assertRaises(ReferenceAssetError):
            self.library.relink_file(asset.asset_id, invalid)
        self.assertEqual(self.library.path.read_bytes(), before)

    def test_review_revision_script_change_and_snapshot(self) -> None:
        asset = self.library.import_file(
            png(self.root / "snapshot.png"), asset_type="style",
            display_name="고정 스타일",
        )
        store = ProjectAssetMappingStore(self.root / "projects", "project_a")
        mapping = store.add_candidate(asset, always_apply=True)
        mapping.candidate_only = False
        mapping.user_confirmed = True
        mapping.status = "confirmed"
        store.save_all([mapping])
        scenes = [{"number": number, "description": f"장면 {number}"}
                  for number in range(1, 7)]
        review = store.begin_review(scenes, 1)
        approved = store.approve_review(scenes, 1)
        self.assertEqual(approved.status, "approved")
        self.assertEqual(approved.mapping_revision, review.mapping_revision)
        with self.assertRaises(ReferenceAssetError):
            store.assert_generation_allowed(
                [*scenes[:-1], {"number": 6, "description": "수정"}], 2
            )
        snapshot = store.create_snapshot(mapping.mapping_id, self.library)
        original_snapshot = store.root / str(snapshot.snapshot_path)
        self.assertTrue(original_snapshot.is_file())
        self.library.add_version(
            asset.asset_id, png(self.root / "latest.png", b"latest")
        )
        resolver = ProjectAssetResolver(self.library, store)
        paths, _ids, _warnings = resolver.image_pipeline_selection(1)
        self.assertEqual(paths, [original_snapshot])

    def test_manual_edit_bulk_scope_unmatched_and_approval_invalidation(self) -> None:
        asset = self.library.import_file(
            png(self.root / "manual.png"), asset_type="background",
            display_name="복도",
        )
        replacement = self.library.import_file(
            png(self.root / "replacement.png", b"r"),
            asset_type="background", display_name="옥상",
        )
        store = ProjectAssetMappingStore(self.root / "projects", "project_a")
        scenes = [{"number": number, "description": str(number)}
                  for number in range(1, 7)]
        store.begin_review(scenes, 1)
        mapping = store.assign_asset(
            asset, scene_scope=SceneScope(mode="range", start=1, end=5)
        )
        store.mark_scene_unmatched(6, user_confirmed=True)
        store.replace_asset(mapping.mapping_id, replacement)
        approved = store.approve_review(scenes, 1)
        self.assertEqual(approved.status, "approved")
        previous_revision = approved.mapping_revision
        store.remove_assignment(mapping.mapping_id)
        invalidated = store.load_review()
        self.assertEqual(invalidated.status, "waiting")
        self.assertGreater(invalidated.mapping_revision, previous_revision)

    def test_legacy_disable_request_is_ignored_without_invalidating_project(self) -> None:
        asset = self.library.import_file(
            png(self.root / "disable.png"), asset_type="style",
            display_name="스타일",
        )
        projects = self.root / "projects"
        context = ProjectContext("project_a", "주제")
        context.scenes = [{"number": number, "description": str(number)}
                          for number in range(1, 7)]
        context.script_revision = 1
        context.transition_to(WorkflowState.READY)
        context.transition_to(WorkflowState.GENERATING_STORY)
        context.transition_to(WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW)
        store = ProjectAssetMappingStore(projects, context.project_id)
        mapping = store.assign_asset(asset, scene_scope=SceneScope())
        review = store.begin_review(context.scenes, 1)
        review = store.approve_review(context.scenes, 1)
        context.mapping_revision = review.mapping_revision
        context.transition_to(WorkflowState.ASSET_MAPPING_APPROVED)
        MemoryManager(projects).save(context)

        self.library.update_metadata(asset.asset_id, enabled=False)

        restored = MemoryManager(projects).load(context.project_id)
        self.assertEqual(
            restored.workflow_state,
            WorkflowState.ASSET_MAPPING_APPROVED,
        )
        self.assertEqual(store.load_review().status, "approved")
        self.assertTrue(self.library.get(asset.asset_id).enabled)


if __name__ == "__main__":
    unittest.main()

