"""Project-scoped Reference Asset storage, validation, and selection."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import struct
from typing import Any
from uuid import uuid4


SUPPORTED_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp"})
REFERENCE_TYPES = frozenset(
    {"character", "style", "background", "object", "general_reference"}
)
REFERENCE_SOURCES = frozenset({"manual_upload", "approved_generated_image"})
MAX_IMAGE_BYTES = 25 * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000


@dataclass(slots=True)
class SceneScope:
    """Serializable scene selection supporting all, one, range, or list."""

    mode: str = "all"
    scene: int | None = None
    start: int | None = None
    end: int | None = None
    scenes: list[int] = field(default_factory=list)

    def includes(self, scene_number: int) -> bool:
        if self.mode == "all":
            return True
        if self.mode == "scene":
            return scene_number == self.scene
        if self.mode == "range":
            return (
                self.start is not None
                and self.end is not None
                and self.start <= scene_number <= self.end
            )
        if self.mode == "list":
            return scene_number in self.scenes
        raise ValueError(f"Unsupported scene scope: {self.mode}")

    def validate(self) -> None:
        if self.mode not in {"all", "scene", "range", "list"}:
            raise ValueError("Invalid scene scope mode")
        values = [value for value in (self.scene, self.start, self.end) if value]
        values.extend(self.scenes)
        if any(value not in range(1, 7) for value in values):
            raise ValueError("Scene numbers must be between 1 and 6")
        if self.mode == "scene" and self.scene is None:
            raise ValueError("Single scene scope requires scene")
        if self.mode == "range" and (
            self.start is None or self.end is None or self.start > self.end
        ):
            raise ValueError("Range scope requires ordered start and end")
        if self.mode == "list" and not self.scenes:
            raise ValueError("List scope requires scenes")


@dataclass(slots=True)
class EpisodeScope:
    """Optional long-project episode scope, independent of scene scope."""

    mode: str = "all"
    episode: int | None = None
    start: int | None = None
    end: int | None = None
    episodes: list[int] = field(default_factory=list)

    def includes(self, number: int) -> bool:
        if self.mode == "all":
            return True
        if self.mode == "episode":
            return number == self.episode
        if self.mode == "range":
            return self.start is not None and self.end is not None and self.start <= number <= self.end
        if self.mode == "list":
            return number in self.episodes
        raise ValueError("Invalid episode scope")

    def validate(self) -> None:
        values = [value for value in (self.episode, self.start, self.end) if value]
        values.extend(self.episodes)
        if self.mode not in {"all", "episode", "range", "list"} or any(value <= 0 for value in values):
            raise ValueError("Invalid episode scope")
        if self.mode == "episode" and self.episode is None:
            raise ValueError("Episode scope requires episode")
        if self.mode == "range" and (
            self.start is None or self.end is None or self.start > self.end
        ):
            raise ValueError("Invalid episode range")
        if self.mode == "list" and not self.episodes:
            raise ValueError("Episode list is empty")


@dataclass(slots=True)
class ReferenceAsset:
    """One project-owned reference image and its generation role."""

    asset_id: str
    project_id: str
    stored_path: str
    original_filename: str
    display_name: str
    source: str
    reference_type: str
    enabled: bool = True
    scene_scope: SceneScope = field(default_factory=SceneScope)
    episode_scope: EpisodeScope = field(default_factory=EpisodeScope)
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    notes: str = ""
    character_id: str | None = None
    face_baseline: bool = False
    content_sha256: str = ""

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ReferenceAsset":
        copied = dict(data)
        copied["scene_scope"] = SceneScope(**copied.get("scene_scope", {}))
        copied["episode_scope"] = EpisodeScope(**copied.get("episode_scope", {}))
        return cls(**copied)


class ReferenceAssetError(ValueError):
    """User-actionable project Reference Asset error."""


class ProjectReferenceManager:
    """Safely copy and atomically persist project Reference Assets."""

    def __init__(self, projects_root: Path, project_id: str) -> None:
        if not project_id or not all(c.isalnum() or c in "_-" for c in project_id):
            raise ReferenceAssetError("Invalid project ID")
        self.project_id = project_id
        self.project_root = (projects_root / project_id).resolve()
        self.asset_directory = self.project_root / "reference_assets"
        self.metadata_path = self.asset_directory / "references.json"

    def _load_payload(self) -> list[dict[str, Any]]:
        if not self.metadata_path.is_file():
            return []
        try:
            payload = json.loads(self.metadata_path.read_text(encoding="utf-8"))
            if not isinstance(payload, list):
                raise TypeError("metadata root must be a list")
            return payload
        except (OSError, json.JSONDecodeError, TypeError) as exc:
            raise ReferenceAssetError("Reference metadata is damaged") from exc

    def load_all(self) -> list[ReferenceAsset]:
        try:
            assets = [ReferenceAsset.from_dict(item) for item in self._load_payload()]
            for asset in assets:
                self._validate_asset(asset)
            return assets
        except (TypeError, ValueError) as exc:
            raise ReferenceAssetError("Reference metadata is invalid") from exc

    def _save_all(self, assets: list[ReferenceAsset]) -> None:
        self.asset_directory.mkdir(parents=True, exist_ok=True)
        temporary = self.metadata_path.with_suffix(".tmp")
        temporary.write_text(
            json.dumps([asdict(item) for item in assets], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        temporary.replace(self.metadata_path)

    def import_file(
        self,
        source_path: Path,
        *,
        reference_type: str = "general_reference",
        display_name: str | None = None,
        scene_scope: SceneScope | None = None,
        episode_scope: EpisodeScope | None = None,
        enabled: bool = True,
        notes: str = "",
        face_baseline: bool = False,
        source: str = "manual_upload",
        approved: bool = False,
        character_id: str | None = None,
    ) -> ReferenceAsset:
        if source == "approved_generated_image" and not approved:
            raise ReferenceAssetError("Generated image must be approved first")
        if source not in REFERENCE_SOURCES:
            raise ReferenceAssetError("Unsupported reference source")
        width, height, digest = validate_image_file(source_path)
        if width * height > MAX_IMAGE_PIXELS:
            raise ReferenceAssetError("Image dimensions are too large")
        existing = self.load_all()
        if any(item.content_sha256 == digest for item in existing):
            raise ReferenceAssetError("This image is already registered")
        scope = scene_scope or SceneScope()
        scope.validate()
        asset_id = f"RA-{uuid4().hex[:12].upper()}"
        suffix = source_path.suffix.lower()
        destination = self.asset_directory / f"{asset_id}{suffix}"
        self.asset_directory.mkdir(parents=True, exist_ok=True)
        try:
            shutil.copy2(source_path, destination)
        except OSError as exc:
            raise ReferenceAssetError("Unable to store reference image") from exc
        asset = ReferenceAsset(
            asset_id=asset_id,
            project_id=self.project_id,
            stored_path=str(destination.relative_to(self.project_root)),
            original_filename=source_path.name,
            display_name=(display_name or source_path.stem).strip(),
            source=source,
            reference_type=reference_type,
            enabled=enabled,
            scene_scope=scope,
            episode_scope=episode_scope or EpisodeScope(),
            notes=notes.strip(),
            character_id=character_id,
            face_baseline=face_baseline,
            content_sha256=digest,
        )
        self._validate_asset(asset)
        existing.append(asset)
        self._save_all(existing)
        return asset

    def update(self, asset_id: str, **changes: Any) -> ReferenceAsset:
        assets = self.load_all()
        asset = next((item for item in assets if item.asset_id == asset_id), None)
        if asset is None:
            raise ReferenceAssetError("Reference Asset not found")
        allowed = {
            "display_name", "reference_type", "enabled", "scene_scope",
            "episode_scope", "notes", "character_id", "face_baseline",
        }
        if set(changes) - allowed:
            raise ReferenceAssetError("Unsupported Reference Asset update")
        for key, value in changes.items():
            setattr(asset, key, value)
        asset.updated_at = datetime.now(timezone.utc).isoformat()
        self._validate_asset(asset)
        self._save_all(assets)
        return asset

    def remove(self, asset_id: str, *, delete_file: bool = False) -> None:
        assets = self.load_all()
        asset = next((item for item in assets if item.asset_id == asset_id), None)
        if asset is None:
            raise ReferenceAssetError("Reference Asset not found")
        assets.remove(asset)
        self._save_all(assets)
        if delete_file:
            path = self.resolve_path(asset)
            if path.is_file():
                path.unlink()

    def select_for_scene(self, scene_number: int) -> tuple[list[ReferenceAsset], list[str]]:
        selected: list[ReferenceAsset] = []
        warnings: list[str] = []
        for asset in self.load_all():
            if not asset.enabled or not asset.scene_scope.includes(scene_number):
                continue
            path = self.resolve_path(asset)
            try:
                validate_image_file(path)
            except ReferenceAssetError:
                warnings.append(f"{asset.asset_id}: missing or invalid file")
                continue
            selected.append(asset)
        return selected, warnings

    def image_pipeline_selection(
        self, scene_number: int
    ) -> tuple[list[Path], list[str], list[str]]:
        """Return the callback shape consumed by the existing ImagePipeline."""
        assets, warnings = self.select_for_scene(scene_number)
        return (
            [self.resolve_path(asset) for asset in assets],
            [asset.asset_id for asset in assets],
            warnings,
        )

    def select_for_episode_scene(
        self, episode_number: int, scene_number: int
    ) -> tuple[list[ReferenceAsset], list[str]]:
        assets, warnings = self.select_for_scene(scene_number)
        return (
            [asset for asset in assets if asset.episode_scope.includes(episode_number)],
            warnings,
        )

    def resolve_path(self, asset: ReferenceAsset) -> Path:
        path = (self.project_root / asset.stored_path).resolve()
        if self.project_root not in path.parents:
            raise ReferenceAssetError("Reference path escapes project directory")
        return path

    def _validate_asset(self, asset: ReferenceAsset) -> None:
        if asset.project_id != self.project_id:
            raise ReferenceAssetError("Reference project ID mismatch")
        if asset.source not in REFERENCE_SOURCES:
            raise ReferenceAssetError("Invalid reference source")
        if asset.reference_type not in REFERENCE_TYPES:
            raise ReferenceAssetError("Invalid reference type")
        if asset.face_baseline and asset.reference_type != "character":
            raise ReferenceAssetError("Face baseline must be a character reference")
        asset.scene_scope.validate()
        asset.episode_scope.validate()
        self.resolve_path(asset)


def validate_image_file(path: Path) -> tuple[int, int, str]:
    """Validate format, size, basic decoding structure, and dimensions."""
    if not path.is_file():
        raise ReferenceAssetError("Image file does not exist")
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ReferenceAssetError("Unsupported image format")
    try:
        size = path.stat().st_size
        if size <= 16:
            raise ReferenceAssetError("Image file is damaged")
        if size > MAX_IMAGE_BYTES:
            raise ReferenceAssetError("Image file exceeds 25 MB")
        data = path.read_bytes()
        width, height = _image_dimensions(data, path.suffix.lower())
    except OSError as exc:
        raise ReferenceAssetError("Unable to read image file") from exc
    if width <= 0 or height <= 0:
        raise ReferenceAssetError("Image dimensions are invalid")
    return width, height, hashlib.sha256(data).hexdigest()


def _image_dimensions(data: bytes, suffix: str) -> tuple[int, int]:
    if suffix == ".png" and data.startswith(b"\x89PNG\r\n\x1a\n"):
        if data[12:16] != b"IHDR":
            raise ReferenceAssetError("PNG header is damaged")
        return struct.unpack(">II", data[16:24])
    if suffix in {".jpg", ".jpeg"} and data.startswith(b"\xff\xd8"):
        position = 2
        while position + 9 < len(data):
            if data[position] != 0xFF:
                position += 1
                continue
            marker = data[position + 1]
            position += 2
            if marker in {0xD8, 0xD9}:
                continue
            length = int.from_bytes(data[position:position + 2], "big")
            if length < 2 or position + length > len(data):
                break
            if marker in set(range(0xC0, 0xC4)) | set(range(0xC5, 0xC8)) | set(range(0xC9, 0xCC)) | set(range(0xCD, 0xD0)):
                return (
                    int.from_bytes(data[position + 5:position + 7], "big"),
                    int.from_bytes(data[position + 3:position + 5], "big"),
                )
            position += length
    if suffix == ".webp" and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        if data[12:16] == b"VP8X" and len(data) >= 30:
            return (
                1 + int.from_bytes(data[24:27], "little"),
                1 + int.from_bytes(data[27:30], "little"),
            )
    raise ReferenceAssetError("Image cannot be decoded or format is inconsistent")
