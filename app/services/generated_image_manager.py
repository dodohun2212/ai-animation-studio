"""Approval and Reference registration rules for generated scene images."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
from pathlib import Path
import shutil
from typing import Any

from app.services.reference_asset_manager import (
    ProjectReferenceManager,
    ReferenceAsset,
    ReferenceAssetError,
    SceneScope,
    validate_image_file,
)
from app.services.asset_library import AssetLibrary, LibraryAsset


@dataclass(slots=True)
class GeneratedImageReview:
    """Persisted user decision and regeneration history for one scene image."""

    scene_number: int
    image_path: str
    status: str = "pending"
    regeneration_count: int = 0
    history: list[dict[str, Any]] = field(default_factory=list)
    updated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class GeneratedImageManager:
    """Atomically persist scene approval independently from generation."""

    GENERATED_FOLDER_NOTE = "Automatically grouped generated project images"

    def __init__(self, project_root: Path) -> None:
        self.project_root = project_root.resolve()
        self.path = self.project_root / "generated_image_reviews.json"

    def load_all(self) -> list[GeneratedImageReview]:
        if not self.path.is_file():
            return []
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            return [GeneratedImageReview(**item) for item in payload]
        except (OSError, json.JSONDecodeError, TypeError) as exc:
            raise ValueError("Generated image review metadata is damaged") from exc

    def _save(self, reviews: list[GeneratedImageReview]) -> None:
        self.project_root.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps([asdict(item) for item in reviews], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(self.path)

    def set_status(
        self, scene_number: int, image_path: Path, status: str
    ) -> GeneratedImageReview:
        if scene_number not in range(1, 7):
            raise ValueError("scene_number must be between 1 and 6")
        if status not in {"pending", "approved", "excluded"}:
            raise ValueError("Invalid generated image status")
        validate_image_file(image_path)
        reviews = self.load_all()
        review = next(
            (item for item in reviews if item.scene_number == scene_number), None
        )
        if review is None:
            review = GeneratedImageReview(scene_number, str(image_path.resolve()))
            reviews.append(review)
        review.image_path = str(image_path.resolve())
        review.status = status
        review.updated_at = datetime.now(timezone.utc).isoformat()
        review.history.append({"event": status, "timestamp": review.updated_at})
        self._save(reviews)
        return review

    def record_regeneration(
        self, scene_number: int, image_path: Path
    ) -> GeneratedImageReview:
        review = self.set_status(scene_number, image_path, "pending")
        reviews = self.load_all()
        stored = next(item for item in reviews if item.scene_number == scene_number)
        stored.regeneration_count += 1
        stored.history.append(
            {"event": "regenerated", "timestamp": stored.updated_at}
        )
        self._save(reviews)
        return stored

    def promote_regenerated_image(
        self,
        scene_number: int,
        previous_path: Path,
        replacement_path: Path,
    ) -> tuple[Path, Path | None]:
        """Promote one regeneration to the stable scene path and archive prior bytes.

        The current image always remains ``images/sceneN.png`` so Image Review,
        Runway, and the generated-project Asset Folder share one stable path.
        Older results are immutable files under ``images/originals``.
        """
        if scene_number not in range(1, 7):
            raise ValueError("scene_number must be between 1 and 6")
        validate_image_file(replacement_path)
        images_root = self.project_root / "images"
        images_root.mkdir(parents=True, exist_ok=True)
        canonical = images_root / f"scene{scene_number}.png"
        prior = previous_path if previous_path.is_file() else canonical
        archived: Path | None = None
        if prior.is_file() and prior.resolve() != replacement_path.resolve():
            originals = images_root / "originals"
            originals.mkdir(parents=True, exist_ok=True)
            revision = 1 + len(list(
                originals.glob(f"scene{scene_number}_v*.png")
            ))
            archived = originals / f"scene{scene_number}_v{revision:03d}.png"
            temporary_archive = archived.with_suffix(".png.tmp")
            shutil.copy2(prior, temporary_archive)
            temporary_archive.replace(archived)

        if replacement_path.resolve() != canonical.resolve():
            temporary_current = canonical.with_suffix(".png.tmp")
            shutil.copy2(replacement_path, temporary_current)
            temporary_current.replace(canonical)
            if (
                replacement_path.parent.resolve() == images_root.resolve()
                and replacement_path.name.startswith(f"scene{scene_number}-regen-")
            ):
                replacement_path.unlink(missing_ok=True)
        validate_image_file(canonical)
        return canonical.resolve(), archived.resolve() if archived else None

    def register_as_reference(
        self,
        scene_number: int,
        references: ProjectReferenceManager,
        *,
        reference_type: str,
        display_name: str,
        scene_scope: SceneScope,
        enabled: bool = True,
        notes: str = "",
        face_baseline: bool = False,
    ) -> ReferenceAsset:
        review = next(
            (
                item for item in self.load_all()
                if item.scene_number == scene_number
            ),
            None,
        )
        if review is None or review.status != "approved":
            raise ReferenceAssetError(
                "Only an approved generated image can become a Reference Asset"
            )
        return references.import_file(
            Path(review.image_path),
            source="approved_generated_image",
            approved=True,
            reference_type=reference_type,
            display_name=display_name,
            scene_scope=scene_scope,
            enabled=enabled,
            notes=notes,
            face_baseline=face_baseline,
        )

    def register_in_library(
        self,
        scene_number: int,
        library: AssetLibrary,
        *,
        asset_type: str,
        display_name: str,
        description: str = "",
        tags: list[str] | None = None,
        aliases: list[str] | None = None,
        face_baseline: bool = False,
    ) -> LibraryAsset:
        """Register only a user-approved generated image in the global Library."""
        review = next(
            (
                item for item in self.load_all()
                if item.scene_number == scene_number
            ),
            None,
        )
        if review is None or review.status != "approved":
            raise ReferenceAssetError(
                "Only an approved generated image can enter the Asset Library"
            )
        return library.index_project_image(
            Path(review.image_path),
            asset_type=asset_type,
            display_name=display_name,
            description=description,
            tags=tags,
            aliases=aliases,
            approved=True,
            face_baseline=face_baseline,
            notes="Approved generated scene image",
            status="approved",
            source_project_id=self.project_root.name,
            source_scene_number=scene_number,
        )

    def index_generated_image(
        self,
        scene_number: int,
        image_path: Path,
        library: AssetLibrary,
        *,
        asset_type: str = "general_reference",
        project_name: str = "",
        topic: str = "",
        genre: str = "",
        mood: str = "",
        scene_description: str = "",
    ) -> LibraryAsset:
        """Index every generated result immediately without copying the file."""
        label = project_name.strip() or self.project_root.name
        description_parts = [
            f"프로젝트 '{label}'에서 생성된 {scene_number}번 장면입니다."
        ]
        if scene_description.strip():
            description_parts.append(
                f"장면 내용: {scene_description.strip()}"
            )
        if topic.strip():
            description_parts.append(f"영상 주제: {topic.strip()}")
        indexed = library.index_project_image(
            image_path,
            asset_type=asset_type,
            display_name=f"{label} · 장면 {scene_number}",
            description=" ".join(description_parts),
            tags=[
                value for value in (
                    "생성 이미지", "단기 프로젝트", label,
                    genre.strip(), mood.strip(), f"장면 {scene_number}",
                )
                if value
            ],
            status="generated",
            source_project_id=self.project_root.name,
            source_scene_number=scene_number,
            notes="Automatically indexed project image",
            deduplicate_globally=False,
        )
        # Re-indexing after regeneration or reopening an older project must
        # also upgrade the searchable metadata, not only the file status.
        return library.update_metadata(
            indexed.asset_id,
            display_name=f"{label} · 장면 {scene_number}",
            description=" ".join(description_parts),
            tags=[
                value for value in (
                    "생성 이미지", "단기 프로젝트", label,
                    genre.strip(), mood.strip(), f"장면 {scene_number}",
                )
                if value
            ],
        )

    def index_generated_project_folder(
        self,
        image_paths: list[Path],
        library: AssetLibrary,
        *,
        project_name: str = "",
        topic: str = "",
        genre: str = "",
        mood: str = "",
        scene_descriptions: list[str] | None = None,
    ) -> LibraryAsset:
        """Group six project-owned scene images under one Library Folder."""
        if len(image_paths) != 6:
            raise ValueError("Exactly six generated scene images are required")
        descriptions = list(scene_descriptions or [])
        children = [
            self.index_generated_image(
                number,
                Path(image_path),
                library,
                project_name=project_name,
                topic=topic,
                genre=genre,
                mood=mood,
                scene_description=(
                    descriptions[number - 1]
                    if number <= len(descriptions) else ""
                ),
            )
            for number, image_path in enumerate(image_paths, start=1)
        ]
        child_ids = list(dict.fromkeys(child.asset_id for child in children))
        if len(child_ids) != 6:
            raise ReferenceAssetError(
                "Generated scenes must resolve to six distinct Library images"
            )
        existing = next(
            (
                asset for asset in library.load_all()
                if asset.is_folder
                and asset.source_project_id == self.project_root.name
                and asset.notes == self.GENERATED_FOLDER_NOTE
            ),
            None,
        )
        display_name = (
            f"{project_name.strip()} · 생성 이미지"
            if project_name.strip()
            else f"{self.project_root.name} · 생성 이미지"
        )
        details = [
            "단기 프로젝트에서 생성된 완성 장면 이미지 6장을 모은 "
            "Reference Folder입니다."
        ]
        if topic.strip():
            details.append(f"영상 주제: {topic.strip()}")
        if genre.strip():
            details.append(f"장르: {genre.strip()}")
        if mood.strip():
            details.append(f"전체 분위기: {mood.strip()}")
        description = " ".join(details)
        tags = [
            value for value in (
                "생성 이미지", "단기 프로젝트",
                project_name.strip() or self.project_root.name,
                genre.strip(), mood.strip(),
            )
            if value
        ]
        if existing is not None:
            return library.update_folder(
                existing.asset_id,
                display_name=display_name,
                description=description,
                tags=tags,
                child_asset_ids=child_ids,
                thumbnail_asset_id=child_ids[0],
                approved=False,
            )
        folder = library.create_folder(
            display_name=display_name,
            asset_type="general_reference",
            description=description,
            tags=tags,
            child_asset_ids=child_ids,
            thumbnail_asset_id=child_ids[0],
            source_project_id=self.project_root.name,
        )
        # create_folder deliberately has a small public surface. The note is an
        # internal marker used only to update this same folder after regeneration.
        return library.update_metadata(
            folder.asset_id,
            notes=self.GENERATED_FOLDER_NOTE,
        )

    def sync_generated_project_folder_approval(
        self,
        library: AssetLibrary,
    ) -> LibraryAsset | None:
        """Mirror the six scene approvals onto the generated project Folder."""
        folder = next(
            (
                asset for asset in library.load_all()
                if asset.is_folder
                and asset.source_project_id == self.project_root.name
                and asset.notes == self.GENERATED_FOLDER_NOTE
            ),
            None,
        )
        if folder is None:
            return None
        approved_scenes = {
            review.scene_number
            for review in self.load_all()
            if review.status == "approved"
        }
        return library.update_folder(
            folder.asset_id,
            approved=approved_scenes == set(range(1, 7)),
        )

    def sync_library_status(
        self, scene_number: int, library: AssetLibrary, status: str
    ) -> LibraryAsset:
        """Mirror review state into the searchable index."""
        review = next(
            (item for item in self.load_all() if item.scene_number == scene_number),
            None,
        )
        if review is None:
            raise ReferenceAssetError("Generated image review does not exist")
        asset = library.index_project_image(
            Path(review.image_path),
            asset_type="general_reference",
            display_name=f"{self.project_root.name} · Scene {scene_number}",
            status=status,
            approved=status == "approved",
            source_project_id=self.project_root.name,
            source_scene_number=scene_number,
            # The same bytes may also be registered as a manual/reference
            # Asset. Review state must only update this project's scene record.
            deduplicate_globally=False,
        )
        return asset

    def register_as_library_version(
        self, scene_number: int, library: AssetLibrary, asset_id: str
    ) -> LibraryAsset:
        review = self._approved_review(scene_number)
        return library.add_version(asset_id, Path(review.image_path))

    def save_as_project_snapshot(self, scene_number: int) -> Path:
        """Keep an approved generated image only inside its current project."""
        review = self._approved_review(scene_number)
        source = Path(review.image_path)
        validate_image_file(source)
        directory = self.project_root / "asset_snapshots"
        directory.mkdir(parents=True, exist_ok=True)
        destination = directory / (
            f"approved-scene{scene_number}{source.suffix.lower()}"
        )
        temporary = destination.with_suffix(destination.suffix + ".tmp")
        shutil.copy2(source, temporary)
        temporary.replace(destination)
        return destination

    def _approved_review(self, scene_number: int) -> GeneratedImageReview:
        review = next(
            (
                item for item in self.load_all()
                if item.scene_number == scene_number
            ),
            None,
        )
        if review is None or review.status != "approved":
            raise ReferenceAssetError(
                "Only an approved generated image can be registered"
            )
        return review
