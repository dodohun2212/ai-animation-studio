"""Project Reference Asset and generated-image approval tests."""

from pathlib import Path
import struct
import tempfile
import unittest

from app.services.generated_image_manager import GeneratedImageManager
from app.services.asset_library import AssetLibrary
from app.services.reference_asset_manager import (
    EpisodeScope,
    ProjectReferenceManager,
    ReferenceAssetError,
    SceneScope,
)
from app.long_story.ui_support import (
    effective_reference_groups,
    reference_type_label,
)


def write_png(path: Path, width: int = 8, height: int = 8) -> None:
    """Write the minimal header required by the dependency-free validator."""
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + struct.pack(">I", 13)
        + b"IHDR"
        + struct.pack(">II", width, height)
        + b"\x08\x06\x00\x00\x00"
        + b"\x00\x00\x00\x00"
    )


class ReferenceAssetTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.source = self.root / "source.png"
        write_png(self.source)
        self.manager = ProjectReferenceManager(self.root / "projects", "project_1")

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_manual_upload_and_reload(self) -> None:
        asset = self.manager.import_file(
            self.source, reference_type="character", face_baseline=True
        )
        loaded = self.manager.load_all()
        self.assertEqual(loaded[0].asset_id, asset.asset_id)
        self.assertEqual(loaded[0].source, "manual_upload")
        self.assertTrue(self.manager.resolve_path(loaded[0]).is_file())

    def test_unsupported_and_damaged_images_are_blocked(self) -> None:
        text = self.root / "bad.txt"
        text.write_text("not image")
        with self.assertRaises(ReferenceAssetError):
            self.manager.import_file(text)
        damaged = self.root / "bad.png"
        damaged.write_bytes(b"bad")
        with self.assertRaises(ReferenceAssetError):
            self.manager.import_file(damaged)

    def test_duplicate_is_blocked(self) -> None:
        self.manager.import_file(self.source)
        with self.assertRaises(ReferenceAssetError):
            self.manager.import_file(self.source)

    def test_all_single_range_and_list_scopes(self) -> None:
        scopes = (
            (SceneScope(), {1, 2, 3, 4, 5, 6}),
            (SceneScope(mode="scene", scene=3), {3}),
            (SceneScope(mode="range", start=2, end=4), {2, 3, 4}),
            (SceneScope(mode="list", scenes=[2, 4, 6]), {2, 4, 6}),
        )
        for scope, expected in scopes:
            self.assertEqual(
                {number for number in range(1, 7) if scope.includes(number)},
                expected,
            )

    def test_disabled_and_missing_references_are_excluded(self) -> None:
        asset = self.manager.import_file(self.source, enabled=False)
        selected, warnings = self.manager.select_for_scene(1)
        self.assertEqual(selected, [])
        self.assertEqual(warnings, [])
        self.manager.update(asset.asset_id, enabled=True)
        self.manager.resolve_path(asset).unlink()
        selected, warnings = self.manager.select_for_scene(1)
        self.assertEqual(selected, [])
        self.assertEqual(len(warnings), 1)

    def test_generated_image_requires_approval(self) -> None:
        project_root = self.root / "projects" / "project_1"
        reviews = GeneratedImageManager(project_root)
        with self.assertRaises(ReferenceAssetError):
            reviews.register_as_reference(
                1, self.manager, reference_type="style", display_name="scene",
                scene_scope=SceneScope(),
            )
        reviews.set_status(1, self.source, "approved")
        asset = reviews.register_as_reference(
            1, self.manager, reference_type="style", display_name="scene",
            scene_scope=SceneScope(),
        )
        self.assertEqual(asset.source, "approved_generated_image")

    def test_generated_status_does_not_mutate_identical_manual_asset(
        self,
    ) -> None:
        project_root = self.root / "projects" / "project_1"
        reviews = GeneratedImageManager(project_root)
        library = AssetLibrary(self.root)
        manual = library.import_file(
            self.source,
            asset_type="style",
            display_name="수동 참고 이미지",
        )
        reviews.set_status(1, self.source, "approved")

        generated = reviews.sync_library_status(1, library, "approved")

        self.assertNotEqual(generated.asset_id, manual.asset_id)
        restored_manual = library.get(manual.asset_id)
        self.assertEqual(
            restored_manual.source_project_id, "_asset_library_manual"
        )
        self.assertFalse(restored_manual.approved)
        self.assertEqual(generated.source_project_id, "project_1")
        self.assertTrue(generated.approved)

    def test_approved_image_new_version_and_project_snapshot(self) -> None:
        project_root = self.root / "projects" / "project_1"
        reviews = GeneratedImageManager(project_root)
        library = AssetLibrary(self.root)
        base_path = self.root / "base.png"
        write_png(base_path, 9, 9)
        asset = library.import_file(
            base_path, asset_type="style", display_name="스타일"
        )
        with self.assertRaises(ReferenceAssetError):
            reviews.register_as_library_version(1, library, asset.asset_id)
        reviews.set_status(1, self.source, "approved")
        versioned = reviews.register_as_library_version(
            1, library, asset.asset_id
        )
        self.assertEqual(versioned.version, 2)
        snapshot = reviews.save_as_project_snapshot(1)
        self.assertTrue(snapshot.is_file())
        self.assertTrue(project_root in snapshot.parents)

    def test_generated_short_images_are_grouped_in_one_library_folder(
        self,
    ) -> None:
        project_root = self.root / "projects" / "project_1"
        reviews = GeneratedImageManager(project_root)
        library = AssetLibrary(self.root)
        images = []
        for scene_number in range(1, 7):
            image = project_root / f"scene{scene_number}.png"
            image.parent.mkdir(parents=True, exist_ok=True)
            write_png(image, 8 + scene_number, 8)
            images.append(image)
        folder = reviews.index_generated_project_folder(
            images,
            library,
            project_name="테스트 단기 프로젝트",
            topic="잃어버린 별을 찾아가는 여행",
            genre="모험",
            mood="따뜻하고 신비로움",
            scene_descriptions=[
                f"{number}번 장면 설명" for number in range(1, 7)
            ],
        )
        self.assertTrue(folder.is_folder)
        self.assertEqual(folder.asset_type, "general_reference")
        self.assertEqual(len(folder.child_asset_ids), 6)
        self.assertEqual(folder.thumbnail_asset_id, folder.child_asset_ids[0])
        self.assertEqual(
            folder.display_name,
            "테스트 단기 프로젝트 · 생성 이미지",
        )
        self.assertIn("영상 주제: 잃어버린 별을 찾아가는 여행", folder.description)
        self.assertIn("장르: 모험", folder.description)
        self.assertIn("전체 분위기: 따뜻하고 신비로움", folder.description)
        self.assertIn("단기", folder.tags)
        self.assertIn("프로젝트", folder.tags)
        self.assertIn("모험", folder.tags)
        children = [
            library.get(asset_id) for asset_id in folder.child_asset_ids
        ]
        self.assertTrue(
            all(child.parent_folder_id == folder.asset_id for child in children)
        )
        self.assertEqual(children[0].display_name, "테스트 단기 프로젝트 · 장면 1")
        self.assertIn("1번 장면 설명", children[0].description)
        self.assertIn("장면", children[0].tags)
        self.assertIn("1", children[0].tags)

    def test_generated_project_folder_is_reused_after_regeneration(self) -> None:
        project_root = self.root / "projects" / "project_1"
        reviews = GeneratedImageManager(project_root)
        library = AssetLibrary(self.root)
        images = []
        for scene_number in range(1, 7):
            image = project_root / "images" / f"scene{scene_number}.png"
            image.parent.mkdir(parents=True, exist_ok=True)
            write_png(image, 8 + scene_number, 8)
            images.append(image)
        original = reviews.index_generated_project_folder(images, library)
        original_children = list(original.child_asset_ids)
        replacement = project_root / "images" / "scene3-regen-001.png"
        write_png(replacement, 30, 8)
        current, archived = reviews.promote_regenerated_image(
            3, images[2], replacement
        )
        self.assertIsNotNone(archived)
        library.replace_project_scene_image(
            source_project_id=project_root.name,
            source_scene_number=3,
            current_path=current,
            archived_previous_path=archived,
        )
        images[2] = current
        updated = reviews.index_generated_project_folder(images, library)
        folders = [asset for asset in library.load_all() if asset.is_folder]
        self.assertEqual(updated.asset_id, original.asset_id)
        self.assertEqual(len(folders), 1)
        self.assertEqual(len(updated.child_asset_ids), 6)
        self.assertEqual(updated.child_asset_ids, original_children)
        scene_asset = library.get(original_children[2])
        self.assertEqual(scene_asset.version, 2)
        self.assertEqual(Path(scene_asset.stored_path), current)
        self.assertEqual(len(scene_asset.versions), 2)
        self.assertEqual(
            Path(scene_asset.versions[0].stored_path), archived
        )
        self.assertTrue(archived.is_file())
        self.assertFalse(replacement.exists())

    def test_effective_preview_matches_short_and_long_selection(self) -> None:
        common = self.manager.import_file(
            self.source, reference_type="character", face_baseline=True
        )
        second_source = self.root / "second.png"
        write_png(second_source, 9, 9)
        scoped = self.manager.import_file(
            second_source, reference_type="background",
            episode_scope=EpisodeScope(mode="episode", episode=2),
            scene_scope=SceneScope(mode="scene", scene=3),
        )
        short_common, short_scene, _ = effective_reference_groups(
            self.manager, "short_project", 99, 3
        )
        self.assertEqual({item.asset_id for item in short_common}, {common.asset_id})
        # Short generation has no episode filter, matching ImagePipeline.
        self.assertEqual({item.asset_id for item in short_scene}, {scoped.asset_id})
        long_common, long_scene, _ = effective_reference_groups(
            self.manager, "long_story_project", 1, 3
        )
        self.assertEqual({item.asset_id for item in long_common}, {common.asset_id})
        self.assertEqual(long_scene, [])
        _common, long_scene, _ = effective_reference_groups(
            self.manager, "long_story_project", 2, 3
        )
        self.assertEqual({item.asset_id for item in long_scene}, {scoped.asset_id})
        self.assertEqual(reference_type_label(common), "대표 캐릭터")

    def test_effective_preview_never_mixes_projects(self) -> None:
        first = self.manager.import_file(self.source, reference_type="style")
        other_source = self.root / "other.png"
        write_png(other_source, 10, 10)
        other = ProjectReferenceManager(self.root / "projects", "project_2")
        other.import_file(other_source, reference_type="object")
        common, specific, _ = effective_reference_groups(
            self.manager, "short_project", 1, 1
        )
        self.assertEqual(
            {item.asset_id for item in [*common, *specific]}, {first.asset_id}
        )


if __name__ == "__main__":
    unittest.main()

