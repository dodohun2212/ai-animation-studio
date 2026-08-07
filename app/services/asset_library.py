"""Global, versioned image Asset Library shared by every project."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import threading
import time
from typing import Any
from uuid import uuid4

from app.services.reference_asset_manager import (
    REFERENCE_TYPES,
    ReferenceAssetError,
    validate_image_file,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass(slots=True)
class LibraryAssetVersion:
    """One immutable file revision of a Library Asset."""

    version: int
    stored_path: str
    content_sha256: str
    created_at: str = field(default_factory=_now)
    notes: str = ""


CHARACTER_REFERENCE_ROLES = {
    "thumbnail", "front", "left45", "right45", "side", "back",
    "expression", "other",
}


@dataclass(slots=True)
class CharacterReferenceImage:
    """One non-owning image link inside a Character Asset Set."""

    role: str
    path: str
    content_sha256: str = ""
    original_filename: str = ""


@dataclass(slots=True)
class LibraryAsset:
    """Searchable metadata pointing at a project-owned image."""

    asset_id: str
    asset_type: str
    display_name: str
    description: str
    stored_path: str
    original_filename: str
    content_sha256: str
    tags: list[str] = field(default_factory=list)
    aliases: list[str] = field(default_factory=list)
    enabled: bool = True
    approved: bool = False
    face_baseline: bool = False
    character_key: str | None = None
    version: int = 1
    versions: list[LibraryAssetVersion] = field(default_factory=list)
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    notes: str = ""
    legacy_asset_ids: list[str] = field(default_factory=list)
    status: str = "manual"
    source_project_id: str = ""
    source_scene_number: int | None = None
    reference_images: list[CharacterReferenceImage] = field(default_factory=list)
    reference_roles: list[str] = field(default_factory=list)
    is_folder: bool = False
    parent_folder_id: str = ""
    child_asset_ids: list[str] = field(default_factory=list)
    thumbnail_asset_id: str = ""
    role: str = ""
    sort_order: int = 0

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "LibraryAsset":
        copied = dict(data)
        # Older indexes may not contain the expanded searchable metadata.
        # Defaults migrate them in memory without changing IDs or mappings.
        copied.setdefault("description", "")
        copied.setdefault("tags", [])
        copied.setdefault("aliases", [])
        copied.setdefault("status", "manual")
        copied.setdefault("source_project_id", "")
        copied.setdefault("source_scene_number", None)
        copied.setdefault(
            "reference_roles",
            (
                sorted(CHARACTER_REFERENCE_ROLES)
                if copied.get("asset_type") == "character" else []
            ),
        )
        copied.setdefault("is_folder", False)
        copied.setdefault("parent_folder_id", "")
        copied.setdefault("child_asset_ids", [])
        copied.setdefault("thumbnail_asset_id", "")
        copied.setdefault("role", "")
        copied.setdefault("sort_order", 0)
        # Asset Library availability is no longer a user-controlled concept.
        # Keep the persisted field for older JSON readers, but treat every
        # migrated Library record as available.
        copied["enabled"] = True
        copied["reference_images"] = [
            CharacterReferenceImage(**item)
            for item in copied.get("reference_images", [])
            if isinstance(item, dict)
        ]
        copied["versions"] = [
            LibraryAssetVersion(**item) for item in copied.get("versions", [])
        ]
        asset = cls(**copied)
        if (
            asset.asset_type == "character"
            and not asset.is_folder
            and not asset.reference_images
        ):
            # Legacy Character Assets keep their original image and identity.
            # The same source link supplies thumbnail and front semantics without
            # copying image bytes or rewriting the stored JSON during load.
            asset.reference_images = [
                CharacterReferenceImage(
                    "thumbnail", asset.stored_path, asset.content_sha256,
                    asset.original_filename,
                ),
                CharacterReferenceImage(
                    "front", asset.stored_path, asset.content_sha256,
                    asset.original_filename,
                ),
            ]
        return asset


@dataclass(frozen=True, slots=True)
class AssetFileAudit:
    """Read-only result for one indexed Asset file."""

    asset_id: str
    display_name: str
    classification: str
    source_kind: str
    path: str
    message: str = ""


class AssetLibrary:
    """Search index for project-owned images, with legacy file compatibility."""

    _lock_registry_guard = threading.Lock()
    _lock_registry: dict[str, threading.RLock] = {}

    STATUSES = {
        "generated", "approved", "rejected", "replaced", "missing", "manual",
    }

    def __init__(self, learning_data_root: Path) -> None:
        self.root = (learning_data_root / "asset_library").resolve()
        self.files = self.root / "files"
        self.path = self.root / "assets.json"
        self._process_lock_path = self.root / ".assets-json.lock"
        lock_key = str(self.path).casefold()
        with self._lock_registry_guard:
            self._save_lock = self._lock_registry.setdefault(
                lock_key, threading.RLock()
            )

    def load_all(self) -> list[LibraryAsset]:
        if not self.path.is_file():
            return []
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(payload, list):
                raise TypeError("Asset Library root must be a list")
            assets = [LibraryAsset.from_dict(item) for item in payload]
            for asset in assets:
                self._validate(asset)
            return assets
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise ReferenceAssetError("Asset Library metadata is damaged") from exc

    def _save(self, assets: list[LibraryAsset]) -> None:
        """Atomically save the index without sharing a temporary filename.

        OneDrive and virus scanners can hold ``assets.json`` briefly.  A unique
        temporary file plus bounded replacement retries prevents that transient
        Windows lock from turning a completed generation into a failed job.
        """
        self.root.mkdir(parents=True, exist_ok=True)
        payload = json.dumps(
            [asdict(item) for item in assets], ensure_ascii=False, indent=2
        )
        with self._save_lock:
            lock_token = self._acquire_process_lock()
            temporary = self.root / (
                f".assets.{os.getpid()}.{uuid4().hex}.tmp"
            )
            try:
                temporary.write_text(payload, encoding="utf-8")
                last_error: PermissionError | None = None
                for attempt in range(12):
                    try:
                        os.replace(temporary, self.path)
                        return
                    except PermissionError as exc:
                        last_error = exc
                        time.sleep(min(0.05 * (attempt + 1), 0.4))
                raise ReferenceAssetError(
                    "Asset Library index is temporarily locked by Windows or "
                    "OneDrive. Close duplicate app windows and try again."
                ) from last_error
            finally:
                temporary.unlink(missing_ok=True)
                self._release_process_lock(lock_token)

    def _acquire_process_lock(self, timeout_seconds: float = 12.0) -> str:
        """Acquire the cross-process index lock using exclusive file creation."""
        token = f"{os.getpid()}:{uuid4().hex}"
        deadline = time.monotonic() + timeout_seconds
        while True:
            try:
                descriptor = os.open(
                    self._process_lock_path,
                    os.O_CREAT | os.O_EXCL | os.O_WRONLY,
                )
                try:
                    os.write(descriptor, token.encode("ascii"))
                finally:
                    os.close(descriptor)
                return token
            except FileExistsError:
                # A crashed process must not block the library forever. The
                # conservative timeout is far longer than a normal JSON save.
                try:
                    age = time.time() - self._process_lock_path.stat().st_mtime
                    if age > 60.0:
                        self._process_lock_path.unlink(missing_ok=True)
                        continue
                except FileNotFoundError:
                    continue
                if time.monotonic() >= deadline:
                    raise ReferenceAssetError(
                        "Another PRISM FORGE process is saving the Asset Library. "
                        "Close duplicate app windows and try again."
                    )
                time.sleep(0.05)

    def _release_process_lock(self, token: str) -> None:
        """Release only the process lock created by this save operation."""
        try:
            if self._process_lock_path.read_text(encoding="ascii") == token:
                self._process_lock_path.unlink(missing_ok=True)
        except FileNotFoundError:
            pass

    def import_file(
        self,
        source_path: Path,
        *,
        asset_type: str,
        display_name: str,
        description: str = "",
        tags: list[str] | None = None,
        aliases: list[str] | None = None,
        enabled: bool = True,
        approved: bool = False,
        face_baseline: bool = False,
        character_key: str | None = None,
        notes: str = "",
        legacy_asset_id: str | None = None,
    ) -> LibraryAsset:
        """Import a manual image into a dedicated project-owned image folder."""
        manual_root = (
            self.root.parent / "projects" / "_asset_library_manual" / "images"
        )
        manual_root.mkdir(parents=True, exist_ok=True)
        _, _, digest = validate_image_file(source_path)
        destination = manual_root / (
            f"{digest[:16]}{source_path.suffix.lower()}"
        )
        if not destination.is_file():
            shutil.copy2(source_path, destination)
        return self.index_project_image(
            destination,
            asset_type=asset_type,
            display_name=display_name,
            description=description,
            tags=tags,
            aliases=aliases,
            enabled=enabled,
            approved=approved,
            face_baseline=face_baseline,
            character_key=character_key,
            notes=notes,
            legacy_asset_id=legacy_asset_id,
            status="manual",
            source_project_id="_asset_library_manual",
        )

    def create_reference_link(
        self,
        source_asset_id: str,
        *,
        display_name: str | None = None,
        role: str | None = None,
    ) -> LibraryAsset:
        """Create another metadata link to existing image bytes.

        Asset Folder children have one parent. Reusing a Reference from another
        Folder therefore needs a new index record, while its immutable image
        file and versions remain shared and are never copied.
        """
        assets = self.load_all()
        source = _find(assets, source_asset_id)
        if source.is_folder:
            raise ReferenceAssetError(
                "Asset Folder 자체는 Reference로 연결할 수 없습니다"
            )
        prefix = {
            "character": "CHAR",
            "background": "BG",
            "object": "OBJ",
            "style": "STYLE",
            "general_reference": "GENERAL",
        }[source.asset_type]
        payload = asdict(source)
        payload.update({
            "asset_id": f"ASSET-{prefix}-{uuid4().hex[:12].upper()}",
            "display_name": (
                display_name.strip()
                if display_name is not None else source.display_name
            ),
            "parent_folder_id": "",
            "role": (
                role.strip() if role is not None else source.role
            ) or "other",
            "sort_order": 0,
            "created_at": _now(),
            "updated_at": _now(),
            "legacy_asset_ids": [],
        })
        linked = LibraryAsset.from_dict(payload)
        self._validate(linked)
        assets.append(linked)
        self._save(assets)
        return linked

    def find_matching_file(self, source_path: Path) -> LibraryAsset | None:
        """Return an indexed image with identical bytes without mutating it."""
        _, _, digest = validate_image_file(source_path)
        return next(
            (
                asset for asset in self.load_all()
                if not asset.is_folder and asset.content_sha256 == digest
            ),
            None,
        )

    def upgrade_legacy_root_assets_to_folders(self) -> int:
        """Promote legacy top-level images to one-Reference Folders in place.

        The original Asset ID becomes the Folder ID so existing project
        mappings remain valid. A new child index points to the same immutable
        image bytes; no image file is copied or rewritten.
        """
        assets = self.load_all()
        legacy_roots = [
            asset for asset in assets
            if not asset.is_folder and not asset.parent_folder_id
            and not (
                asset.source_project_id
                and asset.source_project_id != "_asset_library_manual"
                and asset.source_scene_number in range(1, 7)
            )
        ]
        if not legacy_roots:
            return 0
        for asset in legacy_roots:
            payload = asdict(asset)
            prefix = {
                "character": "CHAR",
                "background": "BG",
                "object": "OBJ",
                "style": "STYLE",
                "general_reference": "GENERAL",
            }[asset.asset_type]
            child_id = f"ASSET-{prefix}-{uuid4().hex[:12].upper()}"
            payload.update({
                "asset_id": child_id,
                "parent_folder_id": asset.asset_id,
                "role": asset.role or (
                    "front" if asset.asset_type == "character" else "reference"
                ),
                "sort_order": 0,
                "legacy_asset_ids": [],
                "created_at": _now(),
                "updated_at": _now(),
            })
            child = LibraryAsset.from_dict(payload)
            asset.is_folder = True
            asset.child_asset_ids = [child_id]
            asset.thumbnail_asset_id = child_id
            asset.stored_path = ""
            asset.original_filename = ""
            asset.content_sha256 = ""
            asset.versions = []
            asset.reference_images = []
            asset.reference_roles = []
            asset.parent_folder_id = ""
            asset.role = ""
            asset.sort_order = 0
            asset.updated_at = _now()
            self._validate(child)
            self._validate(asset)
            assets.append(child)
        self._save(assets)
        return len(legacy_roots)

    def repair_legacy_generated_scene_folders(self) -> int:
        """Collapse erroneous per-scene wrappers into one six-scene Folder.

        The six child Asset IDs and their version histories are preserved.
        Project-owned image files are never moved or deleted.
        """
        assets = self.load_all()
        by_id = {asset.asset_id: asset for asset in assets}
        grouped: dict[str, list[tuple[LibraryAsset, LibraryAsset]]] = {}
        for folder in assets:
            if (
                not folder.is_folder
                or not folder.source_project_id
                or folder.source_project_id == "_asset_library_manual"
                or folder.source_scene_number not in range(1, 7)
                or len(folder.child_asset_ids) != 1
            ):
                continue
            child = by_id.get(folder.child_asset_ids[0])
            if (
                child is None
                or child.is_folder
                or child.parent_folder_id != folder.asset_id
                or child.source_project_id != folder.source_project_id
                or child.source_scene_number != folder.source_scene_number
            ):
                continue
            grouped.setdefault(folder.source_project_id, []).append(
                (folder, child)
            )

        repaired = 0
        for project_id, pairs in grouped.items():
            by_scene = {
                int(folder.source_scene_number): (folder, child)
                for folder, child in pairs
            }
            if set(by_scene) != set(range(1, 7)):
                continue
            wrappers = [by_scene[number][0] for number in range(1, 7)]
            children = [by_scene[number][1] for number in range(1, 7)]
            wrapper_ids = {item.asset_id for item in wrappers}
            if any(
                self.usage_projects(
                    self.root.parent / "projects", wrapper.asset_id
                )
                for wrapper in wrappers[1:]
            ):
                continue

            folder = wrappers[0]
            base_name = children[0].display_name
            for marker in (" · 장면 1", " · Scene 1"):
                if base_name.endswith(marker):
                    base_name = base_name[:-len(marker)]
                    break
            folder.display_name = f"{base_name or project_id} · 생성 이미지"
            folder.description = (
                "이 프로젝트에서 생성된 현재 장면 이미지 6장을 모은 "
                "Reference Folder입니다."
            )
            folder.asset_type = "general_reference"
            folder.source_scene_number = None
            folder.notes = "Automatically grouped generated project images"
            folder.child_asset_ids = [child.asset_id for child in children]
            folder.thumbnail_asset_id = children[0].asset_id
            folder.legacy_asset_ids = list(dict.fromkeys(
                folder.legacy_asset_ids
                + [item.asset_id for item in wrappers[1:]]
            ))
            folder.updated_at = _now()
            for order, child in enumerate(children):
                child.parent_folder_id = folder.asset_id
                child.sort_order = order
                child.asset_type = "general_reference"
                child.updated_at = _now()
            assets = [
                asset for asset in assets
                if asset.asset_id not in wrapper_ids - {folder.asset_id}
            ]
            repaired += 1

        if repaired:
            for asset in assets:
                self._validate(asset)
            self._save(assets)
        return repaired

    def index_project_image(
        self,
        source_path: Path,
        *,
        asset_type: str,
        display_name: str,
        description: str = "",
        tags: list[str] | None = None,
        aliases: list[str] | None = None,
        enabled: bool = True,
        approved: bool = False,
        face_baseline: bool = False,
        character_key: str | None = None,
        notes: str = "",
        legacy_asset_id: str | None = None,
        status: str = "generated",
        source_project_id: str = "",
        source_scene_number: int | None = None,
        deduplicate_globally: bool = True,
    ) -> LibraryAsset:
        """Index an existing image without copying its bytes into the Library."""
        try:
            _, _, digest = validate_image_file(source_path)
        except ReferenceAssetError:
            payload = source_path.read_bytes()
            if not payload.startswith(b"\x89PNG\r\n\x1a\n"):
                raise
            digest = hashlib.sha256(payload).hexdigest()
        if status not in self.STATUSES:
            raise ReferenceAssetError("Unsupported Library Asset status")
        assets = self.load_all()
        duplicate = next(
            (
                asset for asset in assets
                if asset.content_sha256 == digest
                and (
                    deduplicate_globally
                    or (
                        asset.source_project_id == source_project_id
                        and asset.source_scene_number == source_scene_number
                    )
                )
            ),
            None,
        )
        if duplicate is not None:
            duplicate.status = status
            duplicate.approved = approved or duplicate.approved
            duplicate.source_project_id = (
                source_project_id or duplicate.source_project_id
            )
            duplicate.source_scene_number = (
                source_scene_number
                if source_scene_number is not None
                else duplicate.source_scene_number
            )
            duplicate.updated_at = _now()
            if legacy_asset_id and legacy_asset_id not in duplicate.legacy_asset_ids:
                duplicate.legacy_asset_ids.append(legacy_asset_id)
            self._save(assets)
            return duplicate
        if asset_type not in REFERENCE_TYPES:
            raise ReferenceAssetError("Unsupported Library Asset type")
        if face_baseline and asset_type != "character":
            raise ReferenceAssetError("Face baseline must be a character asset")
        prefix = {
            "character": "CHAR",
            "background": "BG",
            "object": "OBJ",
            "style": "STYLE",
            "general_reference": "GENERAL",
        }[asset_type]
        asset_id = f"ASSET-{prefix}-{uuid4().hex[:12].upper()}"
        stored_path = str(source_path.resolve())
        version = LibraryAssetVersion(1, stored_path, digest)
        asset = LibraryAsset(
            asset_id=asset_id,
            asset_type=asset_type,
            display_name=display_name.strip(),
            description=description.strip(),
            stored_path=stored_path,
            original_filename=source_path.name,
            content_sha256=digest,
            tags=_terms(tags),
            aliases=_terms(aliases),
            enabled=enabled,
            approved=approved,
            face_baseline=face_baseline,
            character_key=character_key,
            versions=[version],
            notes=notes.strip(),
            legacy_asset_ids=[legacy_asset_id] if legacy_asset_id else [],
            status=status,
            source_project_id=source_project_id,
            source_scene_number=source_scene_number,
            reference_images=(
                [
                    CharacterReferenceImage(
                        "thumbnail", stored_path, digest, source_path.name
                    ),
                    CharacterReferenceImage(
                        "front", stored_path, digest, source_path.name
                    ),
                ]
                if asset_type == "character" else []
            ),
            reference_roles=(
                sorted(CHARACTER_REFERENCE_ROLES)
                if asset_type == "character" else []
            ),
        )
        self._validate(asset)
        assets.append(asset)
        self._save(assets)
        return asset

    def update_metadata(self, asset_id: str, **changes: Any) -> LibraryAsset:
        assets = self.load_all()
        asset = _find(assets, asset_id)
        allowed = {
            "asset_type", "display_name", "description", "tags", "aliases", "enabled",
            "approved", "face_baseline", "character_key", "notes", "role",
        }
        if set(changes) - allowed:
            raise ReferenceAssetError("Unsupported Library Asset update")
        # `enabled` remains accepted so older callers and JSON stay compatible,
        # but Library availability is no longer mutable by users.
        changes.pop("enabled", None)
        if not changes:
            return asset
        for name, value in changes.items():
            setattr(
                asset,
                name,
                (
                    _terms(value)
                    if name in {"tags", "aliases"}
                    else value
                ),
            )
        asset.updated_at = _now()
        self._validate(asset)
        self._save(assets)
        self._invalidate_dependents(asset_id)
        return asset

    def add_version(
        self, asset_id: str, source_path: Path, *, notes: str = ""
    ) -> LibraryAsset:
        """Point a new immutable metadata revision at its project-owned image."""
        _, _, digest = validate_image_file(source_path)
        assets = self.load_all()
        asset = _find(assets, asset_id)
        if any(item.content_sha256 == digest for item in asset.versions):
            raise ReferenceAssetError("This version is already registered")
        number = max(item.version for item in asset.versions) + 1
        stored_path = str(source_path.resolve())
        asset.versions.append(
            LibraryAssetVersion(
                number, stored_path, digest, notes=notes.strip()
            )
        )
        asset.version = number
        asset.stored_path = stored_path
        asset.content_sha256 = digest
        asset.updated_at = _now()
        self._save(assets)
        self._invalidate_dependents(
            asset_id, version_policy="follow_latest"
        )
        return asset

    def get(self, asset_id: str) -> LibraryAsset:
        return _find(self.load_all(), asset_id)

    def replace_project_scene_image(
        self,
        *,
        source_project_id: str,
        source_scene_number: int,
        current_path: Path,
        archived_previous_path: Path | None = None,
        previous_current_path: Path | None = None,
    ) -> LibraryAsset | None:
        """Replace an indexed scene while preserving its Asset ID and history."""
        _, _, current_digest = validate_image_file(current_path)
        archived_digest = ""
        if archived_previous_path is not None:
            _, _, archived_digest = validate_image_file(
                archived_previous_path
            )
        assets = self.load_all()
        matches = [
            item for item in assets
            if not item.is_folder
            and item.source_project_id == source_project_id
            and item.source_scene_number == source_scene_number
            and item.notes == "Automatically indexed project image"
        ]
        if not matches:
            return None
        previous_resolved = (
            str(previous_current_path.resolve())
            if previous_current_path is not None else ""
        )
        exact = [
            item for item in matches
            if item.stored_path == previous_resolved
        ]
        asset = max(exact or matches, key=lambda item: item.updated_at)
        active = next(
            (item for item in asset.versions if item.version == asset.version),
            asset.versions[-1] if asset.versions else None,
        )
        if active is not None and archived_previous_path is not None:
            active.stored_path = str(archived_previous_path.resolve())
            active.content_sha256 = archived_digest
        current_version = next(
            (
                item for item in asset.versions
                if item.content_sha256 == current_digest
            ),
            None,
        )
        if current_version is None:
            number = max(
                (item.version for item in asset.versions), default=0
            ) + 1
            current_version = LibraryAssetVersion(
                number,
                str(current_path.resolve()),
                current_digest,
                notes="Regenerated scene image",
            )
            asset.versions.append(current_version)
        else:
            current_version.stored_path = str(current_path.resolve())
        asset.version = current_version.version
        asset.stored_path = str(current_path.resolve())
        asset.original_filename = current_path.name
        asset.content_sha256 = current_digest
        asset.status = "generated"
        asset.updated_at = _now()
        self._validate(asset)
        self._save(assets)
        self._invalidate_dependents(
            asset.asset_id, version_policy="follow_latest"
        )
        return asset

    def create_folder(
        self,
        *,
        display_name: str,
        asset_type: str,
        description: str = "",
        tags: list[str] | None = None,
        aliases: list[str] | None = None,
        child_asset_ids: list[str] | None = None,
        thumbnail_asset_id: str = "",
        approved: bool = False,
        enabled: bool = True,
        source_project_id: str = "",
    ) -> LibraryAsset:
        """Create one logical Folder in the existing Asset index."""
        if asset_type not in REFERENCE_TYPES:
            raise ReferenceAssetError("Unsupported Library Asset type")
        assets = self.load_all()
        children = list(dict.fromkeys(child_asset_ids or []))
        child_assets = [_find(assets, child_id) for child_id in children]
        if any(child.is_folder for child in child_assets):
            raise ReferenceAssetError("Asset Folder 중첩은 지원하지 않습니다")
        folder_id = f"FOLDER-{uuid4().hex[:12].upper()}"
        thumbnail = thumbnail_asset_id or (
            children[0] if children else ""
        )
        if thumbnail and thumbnail not in children:
            raise ReferenceAssetError("대표 썸네일은 Folder 하위 Asset이어야 합니다")
        folder = LibraryAsset(
            asset_id=folder_id,
            asset_type=asset_type,
            display_name=display_name.strip(),
            description=description.strip(),
            stored_path="",
            original_filename="",
            content_sha256="",
            tags=_terms(tags),
            aliases=_terms(aliases),
            enabled=enabled,
            approved=approved,
            versions=[],
            source_project_id=source_project_id,
            is_folder=True,
            child_asset_ids=children,
            thumbnail_asset_id=thumbnail,
            reference_roles=[],
        )
        self._validate(folder)
        for order, child in enumerate(child_assets):
            if child.parent_folder_id and child.parent_folder_id != folder_id:
                raise ReferenceAssetError(
                    f"{child.display_name}은 이미 다른 Folder에 속해 있습니다"
                )
            child.parent_folder_id = folder_id
            child.sort_order = order
            child.updated_at = _now()
        assets.append(folder)
        self._save(assets)
        return folder

    def update_folder(
        self,
        folder_id: str,
        *,
        display_name: str | None = None,
        asset_type: str | None = None,
        description: str | None = None,
        tags: list[str] | None = None,
        aliases: list[str] | None = None,
        child_asset_ids: list[str] | None = None,
        thumbnail_asset_id: str | None = None,
        approved: bool | None = None,
        enabled: bool | None = None,
    ) -> LibraryAsset:
        """Atomically update Folder metadata and child links."""
        assets = self.load_all()
        folder = _find(assets, folder_id)
        if not folder.is_folder:
            raise ReferenceAssetError("선택한 항목은 Asset Folder가 아닙니다")
        old_children = set(folder.child_asset_ids)
        children = (
            list(dict.fromkeys(child_asset_ids))
            if child_asset_ids is not None else list(folder.child_asset_ids)
        )
        child_assets = [_find(assets, child_id) for child_id in children]
        for removed_id in old_children - set(children):
            used_by = self.usage_projects(
                self.root.parent / "projects", removed_id
            )
            if used_by:
                raise ReferenceAssetError(
                    "선택된 하위 이미지를 사용하는 프로젝트가 있습니다: "
                    + ", ".join(used_by)
                )
        if any(child.is_folder for child in child_assets):
            raise ReferenceAssetError("Asset Folder 중첩은 지원하지 않습니다")
        for child in child_assets:
            if child.parent_folder_id not in {"", folder_id}:
                raise ReferenceAssetError(
                    f"{child.display_name}은 이미 다른 Folder에 속해 있습니다"
                )
        if display_name is not None:
            folder.display_name = display_name.strip()
        if asset_type is not None:
            folder.asset_type = asset_type
        if description is not None:
            folder.description = description.strip()
        if tags is not None:
            folder.tags = _terms(tags)
        if aliases is not None:
            folder.aliases = _terms(aliases)
        if approved is not None:
            folder.approved = approved
        if enabled is not None:
            folder.enabled = enabled
        folder.child_asset_ids = children
        requested_thumbnail = (
            thumbnail_asset_id
            if thumbnail_asset_id is not None
            else folder.thumbnail_asset_id
        )
        folder.thumbnail_asset_id = (
            requested_thumbnail
            if requested_thumbnail in children
            else (children[0] if children else "")
        )
        for child in assets:
            if child.asset_id in old_children - set(children):
                child.parent_folder_id = ""
                child.sort_order = 0
            elif child.asset_id in children:
                child.parent_folder_id = folder_id
                child.sort_order = children.index(child.asset_id)
                child.asset_type = folder.asset_type
                child.face_baseline = False
                if folder.asset_type == "character":
                    child.reference_roles = sorted(CHARACTER_REFERENCE_ROLES)
                    if not child.reference_images and child.stored_path:
                        child.reference_images = [
                            CharacterReferenceImage(
                                "thumbnail",
                                child.stored_path,
                                child.content_sha256,
                                child.original_filename,
                            ),
                            CharacterReferenceImage(
                                "front",
                                child.stored_path,
                                child.content_sha256,
                                child.original_filename,
                            ),
                        ]
                    if child.role not in CHARACTER_REFERENCE_ROLES:
                        child.role = "other"
                else:
                    child.reference_images = []
                    child.reference_roles = []
                    if child.role in CHARACTER_REFERENCE_ROLES:
                        child.role = "reference"
                child.updated_at = _now()
        folder.updated_at = _now()
        self._validate(folder)
        self._save(assets)
        self._invalidate_dependents(folder_id)
        return folder

    def folder_children(self, folder: LibraryAsset | str) -> list[LibraryAsset]:
        """Return linked children in persisted order."""
        assets = self.load_all()
        record = _find(assets, folder) if isinstance(folder, str) else folder
        if not record.is_folder:
            return []
        by_id = {asset.asset_id: asset for asset in assets}
        return [
            by_id[child_id] for child_id in record.child_asset_ids
            if child_id in by_id
        ]

    def synchronize_folder_child_types(self) -> int:
        """Upgrade legacy Folder children to their owning Folder's type.

        Older UI versions allowed a Folder type to change without updating
        its children. Reusing ``update_folder`` keeps role/reference cleanup
        and project invalidation identical to a current user edit.
        """
        changed_children = 0
        for folder in [
            asset for asset in self.load_all() if asset.is_folder
        ]:
            mismatches = [
                child
                for child in self.folder_children(folder)
                if child.asset_type != folder.asset_type
            ]
            if not mismatches:
                continue
            self.update_folder(folder.asset_id, asset_type=folder.asset_type)
            changed_children += len(mismatches)
        return changed_children

    def find_character_by_representative_name(
        self, representative_name: str
    ) -> LibraryAsset | None:
        """Find one enabled Character by exact, case-insensitive name."""
        normalized = representative_name.strip().casefold()
        if not normalized:
            return None
        matches = [
            asset for asset in self.load_all()
            if asset.enabled
            and asset.asset_type == "character"
            and asset.display_name.strip().casefold() == normalized
        ]
        folder_matches = [asset for asset in matches if asset.is_folder]
        if folder_matches:
            matches = folder_matches
        if len(matches) > 1:
            raise ReferenceAssetError(
                "같은 대표 이름을 가진 Character Asset이 여러 개입니다. "
                "Asset Library에서 이름을 구분해 주세요."
            )
        return matches[0] if matches else None

    def resolve_path(self, asset: LibraryAsset, version: int | None = None) -> Path:
        if asset.is_folder:
            if not asset.thumbnail_asset_id:
                raise ReferenceAssetError("Asset Folder에 대표 이미지가 없습니다")
            return self.resolve_path(self.get(asset.thumbnail_asset_id))
        if (
            version is None and asset.asset_type == "character"
            and asset.reference_images
        ):
            representative = next(
                (
                    item for item in asset.reference_images
                    if item.role == "thumbnail"
                ),
                next(
                    (
                        item for item in asset.reference_images
                        if item.role == "front"
                    ),
                    asset.reference_images[0],
                ),
            )
            return self.resolve_reference_path(representative)
        selected = version or asset.version
        record = next(
            (item for item in asset.versions if item.version == selected), None
        )
        if record is None:
            raise ReferenceAssetError("Asset version does not exist")
        stored = Path(record.stored_path)
        path = stored.resolve() if stored.is_absolute() else self._resolve_relative(stored)
        validate_image_file(path)
        return path

    def resolve_reference_path(
        self, reference: CharacterReferenceImage
    ) -> Path:
        """Resolve a Character Set image link without taking file ownership."""
        stored = Path(reference.path)
        path = (
            stored.resolve()
            if stored.is_absolute()
            else self._resolve_relative(stored)
        )
        validate_image_file(path)
        return path

    def add_character_reference(
        self, asset_id: str, source_path: Path, role: str
    ) -> LibraryAsset:
        """Link one existing image to a Character Asset without copying it."""
        _, _, digest = validate_image_file(source_path)
        assets = self.load_all()
        asset = _find(assets, asset_id)
        if asset.asset_type != "character":
            raise ReferenceAssetError(
                "Reference Image Set은 Character Asset에서만 사용할 수 있습니다"
            )
        if role not in asset.reference_roles:
            raise ReferenceAssetError("Unsupported Character Reference role")
        resolved = source_path.resolve()
        if any(
            item.role == role and item.content_sha256 == digest
            for item in asset.reference_images
        ):
            raise ReferenceAssetError("같은 역할의 Reference 이미지가 이미 있습니다")
        asset.reference_images.append(CharacterReferenceImage(
            role=role,
            path=str(resolved),
            content_sha256=digest,
            original_filename=source_path.name,
        ))
        asset.updated_at = _now()
        self._validate(asset)
        self._save(assets)
        self._invalidate_dependents(asset_id)
        return asset

    def update_character_references(
        self,
        asset_id: str,
        references: list[CharacterReferenceImage],
        *,
        reference_roles: list[str] | None = None,
    ) -> LibraryAsset:
        """Persist reordered, reassigned, or removed Character references."""
        assets = self.load_all()
        asset = _find(assets, asset_id)
        if asset.asset_type != "character":
            raise ReferenceAssetError(
                "Reference Image Set은 Character Asset에서만 사용할 수 있습니다"
            )
        if not references:
            raise ReferenceAssetError(
                "Character Asset에는 Reference 이미지가 하나 이상 필요합니다"
            )
        roles = _reference_roles(
            reference_roles
            if reference_roles is not None
            else asset.reference_roles
        )
        normalized: list[CharacterReferenceImage] = []
        seen: set[tuple[str, str]] = set()
        for reference in references:
            if reference.role not in roles:
                raise ReferenceAssetError(
                    "Unsupported Character Reference role"
                )
            path = self.resolve_reference_path(reference)
            _, _, digest = validate_image_file(path)
            key = (reference.role, digest)
            if key in seen:
                continue
            seen.add(key)
            normalized.append(CharacterReferenceImage(
                reference.role, str(path), digest,
                reference.original_filename or path.name,
            ))
        asset.reference_images = normalized
        asset.reference_roles = roles
        representative = next(
            (item for item in normalized if item.role == "thumbnail"),
            next(
                (item for item in normalized if item.role == "front"),
                normalized[0],
            ),
        )
        asset.stored_path = representative.path
        asset.content_sha256 = representative.content_sha256
        asset.original_filename = representative.original_filename
        asset.updated_at = _now()
        self._validate(asset)
        self._save(assets)
        self._invalidate_dependents(asset_id)
        return asset

    def search(
        self,
        query: str = "",
        *,
        asset_type: str | None = None,
        tags: list[str] | None = None,
        include_disabled: bool = False,
    ) -> list[LibraryAsset]:
        """Search metadata without weighting or mutating persisted records.

        The UX presents matching fields in this explanatory priority:
        display name, aliases, tags, then description. Asset type remains
        searchable for backward compatibility.
        """
        words = set(_terms([query]))
        requested_tags = set(_terms(tags))
        results = []
        for asset in self.load_all():
            haystack = set(_terms([
                asset.display_name,
                asset.description,
                asset.asset_type,
                *asset.tags,
                *asset.aliases,
            ]))
            if not include_disabled and not asset.enabled:
                continue
            if asset_type and asset.asset_type != asset_type:
                continue
            if words and not any(word in " ".join(haystack) for word in words):
                continue
            if requested_tags and not requested_tags.intersection(asset.tags):
                continue
            results.append(asset)
        return sorted(results, key=lambda item: (item.asset_type, item.display_name))

    def usage_projects(self, projects_root: Path, asset_id: str) -> list[str]:
        """Return projects that currently reference an Asset ID."""
        used_by: list[str] = []
        if not projects_root.is_dir():
            return used_by
        for directory in projects_root.iterdir():
            path = directory / "asset_mappings.json"
            if not path.is_file():
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if any(
                isinstance(item, dict) and (
                    item.get("asset_id") == asset_id
                    or asset_id in item.get("selected_child_asset_ids", [])
                )
                for item in payload if isinstance(payload, list)
            ):
                used_by.append(directory.name)
        return sorted(used_by)

    def usage_details(
        self, projects_root: Path, asset_id: str
    ) -> list[dict[str, str]]:
        details: list[dict[str, str]] = []
        if not projects_root.is_dir():
            return details
        for directory in projects_root.iterdir():
            path = directory / "asset_mappings.json"
            if not path.is_file():
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError):
                continue
            if not isinstance(payload, list):
                continue
            for item in payload:
                if isinstance(item, dict) and (
                    item.get("asset_id") == asset_id
                    or asset_id in item.get("selected_child_asset_ids", [])
                ):
                    details.append({
                        "project_id": directory.name,
                        "version_policy": str(
                            item.get("version_policy", "pinned_version")
                        ),
                        "mapping_id": str(item.get("mapping_id", "")),
                    })
        return details

    def delete(self, asset_id: str, projects_root: Path) -> None:
        """Delete only index metadata; never delete a project-owned image."""
        used_by = self.usage_projects(projects_root, asset_id)
        if used_by:
            raise ReferenceAssetError(
                "Asset is used by projects: " + ", ".join(used_by)
            )
        assets = self.load_all()
        asset = _find(assets, asset_id)
        if asset.parent_folder_id:
            raise ReferenceAssetError(
                "Folder 하위 Asset은 Folder 편집에서 연결을 먼저 제거하세요"
            )
        if asset.is_folder:
            for child in assets:
                if child.parent_folder_id == asset.asset_id:
                    child.parent_folder_id = ""
                    child.sort_order = 0
        assets.remove(asset)
        self._save(assets)

    def delete_folder(
        self,
        folder_id: str,
        projects_root: Path,
        *,
        remove_child_indexes: bool = False,
        delete_manual_files: bool = False,
    ) -> None:
        """Remove Folder metadata and optionally its unused manual files."""
        used_by = self.usage_projects(projects_root, folder_id)
        if used_by:
            raise ReferenceAssetError(
                "Asset Folder is used by projects: " + ", ".join(used_by)
            )
        assets = self.load_all()
        folder = _find(assets, folder_id)
        if not folder.is_folder:
            raise ReferenceAssetError("선택한 항목은 Asset Folder가 아닙니다")
        child_ids = set(folder.child_asset_ids) | {
            item.asset_id
            for item in assets
            if item.parent_folder_id == folder_id
        }
        if delete_manual_files:
            remove_child_indexes = True
        if remove_child_indexes:
            for child_id in child_ids:
                used = self.usage_projects(projects_root, child_id)
                if used:
                    raise ReferenceAssetError(
                        "하위 Asset을 사용하는 프로젝트가 있습니다: "
                        + ", ".join(used)
                    )
        files_to_delete: set[Path] = set()
        if delete_manual_files:
            manual_root = (
                self.root.parent
                / "projects"
                / "_asset_library_manual"
                / "images"
            ).resolve()
            for child in assets:
                if child.asset_id not in child_ids:
                    continue
                if child.source_project_id != "_asset_library_manual":
                    raise ReferenceAssetError(
                        "프로젝트 생성 이미지는 원본 파일을 삭제할 수 없습니다"
                    )
                resolved = self.resolve_path(child).resolve()
                if resolved.parent != manual_root:
                    raise ReferenceAssetError(
                        "Manual Asset file is outside the owned folder"
                    )
                files_to_delete.add(resolved)

        retained: list[LibraryAsset] = []
        for asset in assets:
            if asset.asset_id == folder_id:
                continue
            if remove_child_indexes and asset.asset_id in child_ids:
                continue
            if asset.asset_id in child_ids:
                asset.parent_folder_id = ""
                asset.sort_order = 0
            retained.append(asset)
        self._save(retained)
        if delete_manual_files:
            retained_paths = {
                Path(item.stored_path).resolve()
                for item in retained
                if not item.is_folder and item.stored_path
            }
            for path in files_to_delete - retained_paths:
                path.unlink(missing_ok=True)

    def delete_manual_file(self, asset_id: str, projects_root: Path) -> None:
        """Delete an unused manual Asset and its owned file, never project output."""
        used_by = self.usage_projects(projects_root, asset_id)
        if used_by:
            raise ReferenceAssetError(
                "Asset is used by projects: " + ", ".join(used_by)
            )
        assets = self.load_all()
        asset = _find(assets, asset_id)
        if asset.source_project_id != "_asset_library_manual":
            raise ReferenceAssetError(
                "Project Images는 Library 인덱스에서만 제거할 수 있습니다"
            )
        manual_root = (
            self.root.parent / "projects" / "_asset_library_manual" / "images"
        ).resolve()
        path = self.resolve_path(asset)
        resolved = path.resolve()
        if resolved.parent != manual_root:
            raise ReferenceAssetError("Manual Asset file is outside the owned folder")
        assets.remove(asset)
        shared_file = any(
            not item.is_folder
            and Path(item.stored_path).resolve() == resolved
            for item in assets
        )
        self._save(assets)
        if not shared_file:
            resolved.unlink(missing_ok=True)

    def audit_files(self) -> list[AssetFileAudit]:
        """Classify every indexed file without changing Library metadata."""
        results: list[AssetFileAudit] = []
        for asset in self.load_all():
            if asset.is_folder:
                continue
            source_kind = (
                "manual"
                if asset.source_project_id == "_asset_library_manual"
                else "project"
            )
            path = Path(asset.stored_path)
            resolved = (
                path.resolve()
                if path.is_absolute()
                else self._resolve_relative(path)
            )
            if not resolved.is_file():
                results.append(AssetFileAudit(
                    asset.asset_id, asset.display_name, "missing",
                    source_kind, str(resolved), "파일이 존재하지 않습니다",
                ))
                continue
            try:
                validate_image_file(resolved)
            except ReferenceAssetError as exc:
                results.append(AssetFileAudit(
                    asset.asset_id, asset.display_name, "damaged",
                    source_kind, str(resolved), str(exc),
                ))
                continue
            results.append(AssetFileAudit(
                asset.asset_id, asset.display_name, "healthy",
                source_kind, str(resolved),
            ))
        return results

    def relink_file(self, asset_id: str, replacement: Path) -> LibraryAsset:
        """Safely repoint an Asset while preserving its stable identity."""
        _, _, digest = validate_image_file(replacement)
        assets = self.load_all()
        asset = _find(assets, asset_id)
        resolved = replacement.resolve()
        version = next(
            (item for item in asset.versions if item.version == asset.version),
            None,
        )
        if version is None:
            raise ReferenceAssetError("Current Asset version does not exist")
        version.stored_path = str(resolved)
        version.content_sha256 = digest
        asset.stored_path = str(resolved)
        asset.content_sha256 = digest
        asset.status = "manual" if asset.source_project_id == (
            "_asset_library_manual"
        ) else "generated"
        asset.updated_at = _now()
        self._validate(asset)
        self._save(assets)
        self._invalidate_dependents(asset_id)
        return asset

    def update_status(self, asset_id: str, status: str) -> LibraryAsset:
        """Update lifecycle state without touching the indexed image."""
        if status not in self.STATUSES:
            raise ReferenceAssetError("Unsupported Library Asset status")
        assets = self.load_all()
        asset = _find(assets, asset_id)
        asset.status = status
        asset.approved = status == "approved"
        asset.updated_at = _now()
        self._save(assets)
        return asset

    def _resolve_relative(self, relative: Path) -> Path:
        path = (self.root / relative).resolve()
        if self.root not in path.parents:
            raise ReferenceAssetError("Asset path escapes Library directory")
        return path

    def _invalidate_dependents(
        self, asset_id: str, version_policy: str | None = None
    ) -> None:
        """Invalidate persisted project/Episode approvals after Library changes."""
        projects_root = self.root.parent / "projects"
        for detail in self.usage_details(projects_root, asset_id):
            if (
                version_policy
                and detail["version_policy"] != version_policy
            ):
                continue
            project_root = projects_root / detail["project_id"]
            review_paths = [project_root / "asset_mapping_review.json"]
            review_directory = project_root / "mapping_reviews"
            if review_directory.is_dir():
                review_paths.extend(review_directory.glob("episode_*.json"))
            for review_path in review_paths:
                if not review_path.is_file():
                    continue
                try:
                    review = json.loads(review_path.read_text(encoding="utf-8"))
                    review["status"] = "waiting"
                    review["approved_at"] = ""
                    review["approved_by"] = ""
                    review["mapping_revision"] = int(
                        review.get("mapping_revision", 0)
                    ) + 1
                    temporary = review_path.with_suffix(".tmp")
                    temporary.write_text(
                        json.dumps(review, ensure_ascii=False, indent=2),
                        encoding="utf-8",
                    )
                    temporary.replace(review_path)
                    self._invalidate_owner_state(project_root, review_path)
                except (OSError, json.JSONDecodeError, TypeError, ValueError):
                    continue

    @staticmethod
    def _invalidate_owner_state(project_root: Path, review_path: Path) -> None:
        if review_path.name == "asset_mapping_review.json":
            state_path = project_root / "project.json"
            waiting_state = "WAITING_FOR_ASSET_MAPPING_REVIEW"
            approved_state = "ASSET_MAPPING_APPROVED"
        else:
            try:
                number = int(review_path.stem.split("_", 1)[1])
            except (IndexError, ValueError):
                return
            state_path = (
                project_root / "long_story" / "episodes"
                / f"episode_{number:03d}" / "episode.json"
            )
            waiting_state = "waiting_for_asset_mapping_review"
            approved_state = "asset_mapping_approved"
        if not state_path.is_file():
            return
        try:
            payload = json.loads(state_path.read_text(encoding="utf-8"))
            if payload.get("workflow_state", payload.get("state")) == approved_state:
                key = "workflow_state" if "workflow_state" in payload else "state"
                payload[key] = waiting_state
                temporary = state_path.with_suffix(".tmp")
                temporary.write_text(
                    json.dumps(payload, ensure_ascii=False, indent=2),
                    encoding="utf-8",
                )
                temporary.replace(state_path)
        except (OSError, json.JSONDecodeError, TypeError):
            return

    def _validate(self, asset: LibraryAsset) -> None:
        if asset.asset_type not in REFERENCE_TYPES:
            raise ReferenceAssetError("Invalid Library Asset type")
        if not asset.asset_id.startswith(("ASSET-", "FOLDER-")):
            raise ReferenceAssetError("Invalid Library Asset ID")
        if not asset.display_name:
            raise ReferenceAssetError("Asset display name is required")
        if asset.face_baseline and asset.asset_type != "character":
            raise ReferenceAssetError("Invalid face baseline")
        if asset.status not in self.STATUSES:
            raise ReferenceAssetError("Invalid Library Asset status")
        if asset.is_folder:
            if asset.versions or asset.stored_path or asset.reference_images:
                raise ReferenceAssetError("Folder는 이미지 파일을 직접 소유하지 않습니다")
            if asset.thumbnail_asset_id and (
                asset.thumbnail_asset_id not in asset.child_asset_ids
            ):
                raise ReferenceAssetError("Invalid Folder thumbnail")
            return
        if asset.asset_type != "character" and asset.reference_images:
            raise ReferenceAssetError(
                "Only Character Assets can contain Reference Image Sets"
            )
        if asset.asset_type != "character" and asset.reference_roles:
            raise ReferenceAssetError(
                "Only Character Assets can contain Reference roles"
            )
        asset.reference_roles = _reference_roles(asset.reference_roles)
        for reference in asset.reference_images:
            if reference.role not in asset.reference_roles:
                raise ReferenceAssetError("Invalid Character Reference role")
        if not asset.versions or asset.version not in {
            item.version for item in asset.versions
        }:
            raise ReferenceAssetError("Invalid Asset version history")


def _find(assets: list[LibraryAsset], asset_id: str) -> LibraryAsset:
    asset = next((item for item in assets if item.asset_id == asset_id), None)
    if asset is None:
        raise ReferenceAssetError("Library Asset not found")
    return asset


def _reference_roles(values: list[str] | tuple[str, ...]) -> list[str]:
    """Normalize user-managed Character Reference role labels."""
    roles: list[str] = []
    for value in values:
        role = str(value).strip()
        if (
            not role
            or len(role) > 40
            or any(character in role for character in "\r\n\t")
        ):
            raise ReferenceAssetError(
                "Reference 역할은 1~40자의 한 줄 이름이어야 합니다"
            )
        if role.casefold() not in {
            existing.casefold() for existing in roles
        }:
            roles.append(role)
    return roles


def _terms(values: list[str] | tuple[str, ...] | None) -> list[str]:
    terms: set[str] = set()
    for value in values or []:
        for part in str(value).replace(",", " ").split():
            if part.strip():
                terms.add(part.strip().casefold())
    return sorted(terms)
