"""Fine-grained v1.2 completion invariants without paid provider calls."""

from pathlib import Path
import os
import struct
import tempfile
import unittest
from unittest.mock import patch

from app.core.project_context import ProjectContext, WorkflowState
from app.engines.image_engine import ImageEngine, PNG_SIGNATURE
from app.services.asset_library import AssetLibrary
from app.services.project_asset_mapping import (
    ProjectAssetMappingStore,
    ProjectAssetResolver,
    SceneAssetMatcher,
    extract_scene_entities,
    script_fingerprint,
)
from app.services.reference_asset_manager import (
    EpisodeScope,
    ProjectReferenceManager,
    ReferenceAssetError,
    SceneScope,
)


def image(path: Path, size: int = 8) -> Path:
    path.write_bytes(
        PNG_SIGNATURE + struct.pack(">I", 13) + b"IHDR"
        + struct.pack(">II", size, size) + b"\x08\x06\x00\x00\x00"
        + b"\x00\x00\x00\x00"
    )
    return path


class AssetMappingCompletionTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.projects = self.root / "projects"
        self.library = AssetLibrary(self.root)
        self.asset = self.library.import_file(
            image(self.root / "hero.png"),
            asset_type="character", display_name="민재",
            aliases=["주인공"], tags=["학생"], approved=True,
            face_baseline=True,
        )
        self.store = ProjectAssetMappingStore(self.projects, "project_a")
        self.scenes = [
            {"number": number, "description": f"민재 장면 {number}"}
            for number in range(1, 7)
        ]

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_01_new_context_accepts_review_state(self) -> None:
        context = ProjectContext("p", "t")
        context.transition_to(WorkflowState.READY)
        context.transition_to(WorkflowState.GENERATING_STORY)
        context.transition_to(WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW)
        self.assertEqual(context.workflow_state, WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW)

    def test_02_review_defaults_to_waiting(self) -> None:
        self.assertEqual(self.store.load_review().status, "waiting")

    def test_03_begin_review_persists_fingerprint(self) -> None:
        review = self.store.begin_review(self.scenes, 1)
        self.assertEqual(review.script_fingerprint, script_fingerprint(self.scenes))

    def test_03b_review_save_retries_transient_onedrive_lock(self) -> None:
        real_replace = os.replace
        attempts = {"count": 0}

        def transient_replace(source: Path, destination: Path) -> None:
            attempts["count"] += 1
            if attempts["count"] < 3:
                raise PermissionError("temporarily locked")
            real_replace(source, destination)

        with patch(
            "app.services.project_asset_mapping.os.replace",
            side_effect=transient_replace,
        ), patch("app.services.project_asset_mapping.time.sleep"):
            review = self.store.begin_review(self.scenes, 1)

        self.assertEqual(attempts["count"], 3)
        self.assertEqual(self.store.load_review(), review)
        self.assertEqual(list(self.store.root.glob("*.tmp")), [])

    def test_04_approval_without_assets_requires_text_confirmation(self) -> None:
        self.store.begin_review(self.scenes, 1)
        with self.assertRaises(ReferenceAssetError):
            self.store.approve_review(self.scenes, 1)

    def test_05_text_only_confirmation_allows_empty_mapping(self) -> None:
        self.store.begin_review(self.scenes, 1)
        review = self.store.approve_review(
            self.scenes, 1, text_only_confirmed=True
        )
        self.assertTrue(review.text_only_confirmed)

    def test_06_legacy_confirmation_allows_empty_mapping(self) -> None:
        self.store.begin_review(self.scenes, 1)
        review = self.store.approve_review(
            self.scenes, 1, legacy_confirmed=True
        )
        self.assertTrue(review.legacy_confirmed)

    def test_07_suggested_blocks_final_approval(self) -> None:
        candidate = self.store.add_candidate(self.asset)
        candidate.candidate_only = False
        self.store.save_all([candidate])
        self.store.begin_review(self.scenes, 1)
        with self.assertRaises(ReferenceAssetError):
            self.store.approve_review(self.scenes, 1)

    def test_08_ambiguous_blocks_final_approval(self) -> None:
        match = SceneAssetMatcher().match(
            "project_a", 1, {"characters": ["민재"]}, [self.asset]
        )[0]
        match.status = "ambiguous"
        self.store.save_all([match])
        self.store.begin_review(self.scenes, 1)
        with self.assertRaises(ReferenceAssetError):
            self.store.approve_review(self.scenes, 1)

    def test_09_invalid_blocks_final_approval(self) -> None:
        mapping = self.store.assign_asset(self.asset, scene_scope=SceneScope())
        mapping.status = "invalid"
        self.store.save_all([mapping])
        self.store.begin_review(self.scenes, 1)
        with self.assertRaises(ReferenceAssetError):
            self.store.approve_review(self.scenes, 1)

    def test_10_unconfirmed_unmatched_blocks_approval(self) -> None:
        self.store.mark_scene_unmatched(1, user_confirmed=False)
        self.store.begin_review(self.scenes, 1)
        with self.assertRaises(ReferenceAssetError):
            self.store.approve_review(self.scenes, 1)

    def test_11_confirmed_unmatched_is_allowed_for_scene(self) -> None:
        for scene in range(1, 7):
            self.store.mark_scene_unmatched(scene, user_confirmed=True)
        self.store.begin_review(self.scenes, 1)
        self.assertEqual(self.store.approve_review(self.scenes, 1).status, "approved")

    def test_12_partial_scene_review_is_blocked(self) -> None:
        self.store.assign_asset(
            self.asset, scene_scope=SceneScope(mode="scene", scene=1)
        )
        self.store.begin_review(self.scenes, 1)
        with self.assertRaisesRegex(ReferenceAssetError, "미확인"):
            self.store.approve_review(self.scenes, 1)

    def test_13_all_scene_scope_covers_review(self) -> None:
        self.store.assign_asset(self.asset, scene_scope=SceneScope())
        self.store.begin_review(self.scenes, 1)
        self.assertEqual(self.store.approve_review(self.scenes, 1).status, "approved")

    def test_14_script_revision_change_invalidates(self) -> None:
        self.store.begin_review(self.scenes, 1)
        self.store.approve_review(self.scenes, 1, text_only_confirmed=True)
        with self.assertRaises(ReferenceAssetError):
            self.store.assert_generation_allowed(self.scenes, 2)

    def test_15_scene_description_change_invalidates(self) -> None:
        self.store.begin_review(self.scenes, 1)
        self.store.approve_review(self.scenes, 1, text_only_confirmed=True)
        changed = [dict(item) for item in self.scenes]
        changed[0]["description"] = "수정"
        with self.assertRaises(ReferenceAssetError):
            self.store.assert_generation_allowed(changed, 1)

    def test_16_manual_add_increments_mapping_revision(self) -> None:
        before = self.store.begin_review(self.scenes, 1).mapping_revision
        self.store.assign_asset(self.asset, scene_scope=SceneScope())
        self.assertGreater(self.store.load_review().mapping_revision, before)

    def test_17_manual_replace_changes_asset_id(self) -> None:
        second = self.library.import_file(
            image(self.root / "second.png", 9),
            asset_type="character", display_name="유진",
        )
        mapping = self.store.assign_asset(self.asset, scene_scope=SceneScope())
        self.assertEqual(
            self.store.replace_asset(mapping.mapping_id, second).asset_id,
            second.asset_id,
        )

    def test_18_exclusion_is_user_confirmed(self) -> None:
        mapping = self.store.assign_asset(self.asset, scene_scope=SceneScope())
        self.store.remove_assignment(mapping.mapping_id)
        stored = self.store.load_all()[0]
        self.assertEqual((stored.status, stored.user_confirmed), ("excluded", True))

    def test_19_range_scope_applies_only_requested_scenes(self) -> None:
        mapping = self.store.assign_asset(
            self.asset, scene_scope=SceneScope(mode="range", start=2, end=4)
        )
        self.assertEqual(
            [n for n in range(1, 7) if mapping.scene_scope.includes(n)],
            [2, 3, 4],
        )

    def test_20_episode_scope_isolated(self) -> None:
        mapping = self.store.assign_asset(
            self.asset, scene_scope=SceneScope(),
            episode_scope=EpisodeScope(mode="episode", episode=2),
        )
        self.assertFalse(mapping.episode_scope.includes(1))
        self.assertTrue(mapping.episode_scope.includes(2))

    def test_21_legacy_disabled_library_asset_remains_available(self) -> None:
        self.store.assign_asset(self.asset, scene_scope=SceneScope())
        self.library.update_metadata(self.asset.asset_id, enabled=False)
        ProjectAssetResolver(
            self.library, self.store
        ).validate_approved_assets(1)
        self.assertTrue(self.library.get(self.asset.asset_id).enabled)

    def test_22_missing_pinned_version_fails_preflight(self) -> None:
        mapping = self.store.assign_asset(self.asset, scene_scope=SceneScope())
        mapping.pinned_version = 99
        self.store.save_all([mapping])
        with self.assertRaises(ReferenceAssetError):
            ProjectAssetResolver(
                self.library, self.store
            ).validate_approved_assets(1)

    def test_23_snapshot_stays_inside_project(self) -> None:
        mapping = self.store.assign_asset(self.asset, scene_scope=SceneScope())
        snapshot = self.store.create_snapshot(mapping.mapping_id, self.library)
        self.assertTrue(self.store.root in (self.store.root / snapshot.snapshot_path).parents)

    def test_24_snapshot_survives_library_version_change(self) -> None:
        mapping = self.store.assign_asset(self.asset, scene_scope=SceneScope())
        snapshot = self.store.create_snapshot(mapping.mapping_id, self.library)
        path = self.store.root / str(snapshot.snapshot_path)
        before = path.read_bytes()
        self.library.add_version(
            self.asset.asset_id, image(self.root / "new.png", 10)
        )
        self.assertEqual(path.read_bytes(), before)

    def test_25_exact_name_beats_alias(self) -> None:
        alias = self.library.import_file(
            image(self.root / "alias.png", 11),
            asset_type="character", display_name="다른 인물",
            aliases=["민재"],
        )
        results = SceneAssetMatcher().match(
            "project_a", 1, {"characters": ["민재"]}, [alias, self.asset]
        )
        self.assertEqual(results[0].asset_id, self.asset.asset_id)

    def test_26_description_fallback_extracts_all_typed_terms(self) -> None:
        entities = extract_scene_entities(
            {"description": "민재가 학교 복도에서 검은 열쇠를 줍는다"}
        )
        self.assertIn("민재가", entities["characters"])
        self.assertIn("학교 복도에서", entities["locations"])
        self.assertIn("검은 열쇠를", entities["objects"])

    def test_27_inactive_candidate_is_not_matched(self) -> None:
        self.asset.enabled = False
        self.assertEqual(
            SceneAssetMatcher().match(
                "project_a", 1, {"characters": ["민재"]}, [self.asset]
            ),
            [],
        )

    def test_28_cache_descriptor_contains_identity_fields(self) -> None:
        self.store.assign_asset(self.asset, scene_scope=SceneScope())
        descriptor = ProjectAssetResolver(
            self.library, self.store
        ).cache_descriptors(1, 1, 3, 2)[0]
        self.assertIn(self.asset.asset_id, descriptor)
        self.assertIn(":v1:character:", descriptor)
        self.assertIn("mapping=3:script=2", descriptor)

    def test_29_cache_order_changes_key(self) -> None:
        engine = ImageEngine(
            lambda *_: PNG_SIGNATURE + b"x",
            self.root / "out", self.root / "cache", "namespace",
        )
        path = self.library.resolve_path(self.asset)
        first = engine.cache_path("p", [path], ["0:A:v1:character:x"])
        second = engine.cache_path("p", [path], ["1:A:v1:character:x"])
        self.assertNotEqual(first, second)

    def test_30_legacy_duplicate_sha_is_deduplicated(self) -> None:
        self.store.assign_asset(self.asset, scene_scope=SceneScope())
        legacy = ProjectReferenceManager(self.projects, "project_a")
        legacy.import_file(
            self.root / "hero.png", reference_type="character"
        )
        paths, _ids, _warnings = ProjectAssetResolver(
            self.library, self.store, legacy
        ).image_pipeline_selection(1)
        self.assertEqual(len(paths), 1)


if __name__ == "__main__":
    unittest.main()

