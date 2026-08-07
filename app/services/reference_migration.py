"""Idempotent, non-destructive legacy Reference-to-Library migration."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from app.services.asset_library import AssetLibrary
from app.services.project_asset_mapping import (
    ProjectAssetMapping,
    ProjectAssetMappingStore,
)
from app.services.reference_asset_manager import ProjectReferenceManager


@dataclass(slots=True)
class MigrationReport:
    projects: int = 0
    migrated_assets: int = 0
    deduplicated_assets: int = 0
    failed_assets: int = 0


class LegacyReferenceMigrator:
    """Preserve legacy IDs/files and add Library mappings safely."""

    def __init__(self, learning_data_root: Path) -> None:
        self.learning_data_root = learning_data_root
        self.projects_root = learning_data_root / "projects"
        self.library = AssetLibrary(learning_data_root)

    def migrate_all(self) -> MigrationReport:
        report = MigrationReport()
        if not self.projects_root.is_dir():
            return report
        for project_root in sorted(self.projects_root.iterdir()):
            legacy_path = project_root / "reference_assets" / "references.json"
            if not project_root.is_dir() or not legacy_path.is_file():
                continue
            report.projects += 1
            manager = ProjectReferenceManager(
                self.projects_root, project_root.name
            )
            store = ProjectAssetMappingStore(
                self.projects_root, project_root.name
            )
            mappings = store.load_all()
            for legacy in manager.load_all():
                if any(
                    item.assignment_source == "migrated"
                    and item.asset_id in {
                        asset.asset_id for asset in self.library.load_all()
                        if legacy.asset_id in asset.legacy_asset_ids
                    }
                    for item in mappings
                ):
                    continue
                try:
                    before = len(self.library.load_all())
                    asset = self.library.import_file(
                        manager.resolve_path(legacy),
                        asset_type=legacy.reference_type,
                        display_name=legacy.display_name,
                        description=legacy.notes,
                        approved=legacy.source == "approved_generated_image",
                        face_baseline=legacy.face_baseline,
                        character_key=legacy.character_id,
                        notes=legacy.notes,
                        legacy_asset_id=legacy.asset_id,
                    )
                    if len(self.library.load_all()) == before:
                        report.deduplicated_assets += 1
                    mapping = ProjectAssetMapping(
                        mapping_id=f"MIGRATED-{legacy.asset_id}",
                        project_id=project_root.name,
                        asset_id=asset.asset_id,
                        enabled=legacy.enabled,
                        usage_role=legacy.reference_type,
                        episode_scope=legacy.episode_scope,
                        scene_scope=legacy.scene_scope,
                        assignment_source="migrated",
                        status="confirmed",
                        user_confirmed=True,
                        pinned_version=asset.version,
                        candidate_only=False,
                    )
                    mappings.append(mapping)
                    store.save_all(mappings)
                    report.migrated_assets += 1
                except (OSError, TypeError, ValueError):
                    report.failed_assets += 1
        return report
