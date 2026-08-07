"""Project candidate assets, scene assignments, matching, and path resolution."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import time
from typing import Any
from uuid import uuid4
import hashlib
import shutil

from app.services.asset_library import AssetLibrary, LibraryAsset
from app.services.reference_asset_manager import (
    EpisodeScope,
    ProjectReferenceManager,
    ReferenceAssetError,
    SceneScope,
)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _atomic_write_json(path: Path, payload: object) -> None:
    """Write JSON safely when OneDrive briefly locks the destination file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.parent / (
        f".{path.name}.{os.getpid()}.{uuid4().hex}.tmp"
    )
    try:
        temporary.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        last_error: PermissionError | None = None
        for attempt in range(12):
            try:
                os.replace(temporary, path)
                return
            except PermissionError as exc:
                last_error = exc
                time.sleep(min(0.05 * (attempt + 1), 0.4))
        raise ReferenceAssetError(
            "프로젝트 Reference 설정 파일이 OneDrive 또는 Windows에 의해 "
            "잠시 사용 중입니다. 잠시 후 다시 시도해주세요."
        ) from last_error
    finally:
        temporary.unlink(missing_ok=True)


@dataclass(slots=True)
class ProjectAssetMapping:
    """One project-to-Library link, optionally scoped to episode and scene."""

    mapping_id: str
    project_id: str
    asset_id: str
    enabled: bool = True
    usage_role: str = "general_reference"
    episode_scope: EpisodeScope = field(default_factory=EpisodeScope)
    scene_scope: SceneScope = field(default_factory=SceneScope)
    assignment_source: str = "manual"
    confidence: float | None = None
    match_reason: str = ""
    status: str = "suggested"
    user_confirmed: bool = False
    version_policy: str = "pinned_version"
    pinned_version: int | None = 1
    candidate_only: bool = True
    created_at: str = field(default_factory=_now)
    updated_at: str = field(default_factory=_now)
    snapshot_path: str | None = None
    snapshot_sha256: str | None = None
    snapshot_source_version: int | None = None
    selected_child_asset_ids: list[str] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "ProjectAssetMapping":
        copied = dict(data)
        copied["episode_scope"] = EpisodeScope(**copied.get("episode_scope", {}))
        copied["scene_scope"] = SceneScope(**copied.get("scene_scope", {}))
        return cls(**copied)


@dataclass(slots=True)
class MappingReview:
    project_id: str
    mapping_revision: int = 0
    script_revision: int = 0
    script_fingerprint: str = ""
    status: str = "waiting"
    approved_at: str = ""
    approved_by: str = ""
    text_only_confirmed: bool = False
    legacy_confirmed: bool = False
    reviewed_scenes: list[int] = field(default_factory=list)

class ProjectAssetMappingStore:
    """Atomically persist mappings without owning the Library image files."""

    ASSIGNMENT_SOURCES = {
        "manual", "auto", "migrated", "approved_generated_image"
    }
    STATUSES = {
        "confirmed", "suggested", "ambiguous", "unmatched", "excluded", "invalid"
    }

    def __init__(
        self, projects_root: Path, project_id: str, review_scope: str = "project"
    ) -> None:
        if not project_id or not all(c.isalnum() or c in "_-" for c in project_id):
            raise ReferenceAssetError("Invalid project ID")
        self.project_id = project_id
        self.root = (projects_root / project_id).resolve()
        self.path = self.root / "asset_mappings.json"
        if not all(c.isalnum() or c in "_-" for c in review_scope):
            raise ReferenceAssetError("Invalid review scope")
        self.review_scope = review_scope
        self.review_path = (
            self.root / "asset_mapping_review.json"
            if review_scope == "project"
            else self.root / "mapping_reviews" / f"{review_scope}.json"
        )

    def load_all(self) -> list[ProjectAssetMapping]:
        if not self.path.is_file():
            return []
        try:
            payload = json.loads(self.path.read_text(encoding="utf-8"))
            if not isinstance(payload, list):
                raise TypeError("Mapping root must be a list")
            mappings = [ProjectAssetMapping.from_dict(item) for item in payload]
            for mapping in mappings:
                self._validate(mapping)
            return mappings
        except (OSError, json.JSONDecodeError, TypeError, ValueError) as exc:
            raise ReferenceAssetError("Project Asset Mapping is damaged") from exc

    def save_all(self, mappings: list[ProjectAssetMapping]) -> None:
        for mapping in mappings:
            self._validate(mapping)
        _atomic_write_json(self.path, [asdict(item) for item in mappings])
        self._mark_review_changed()

    def _mark_review_changed(self) -> None:
        """Invalidate an existing approval whenever Mapping content changes."""
        review_paths = [self.review_path]
        if self.review_scope == "project":
            directory = self.root / "mapping_reviews"
            if directory.is_dir():
                review_paths.extend(directory.glob("episode_*.json"))
        for path in review_paths:
            if not path.is_file():
                continue
            try:
                payload = json.loads(path.read_text(encoding="utf-8"))
                payload["mapping_revision"] = int(
                    payload.get("mapping_revision", 0)
                ) + 1
                payload["status"] = "waiting"
                payload["approved_at"] = ""
                payload["approved_by"] = ""
                payload["reviewed_scenes"] = []
                _atomic_write_json(path, payload)
                AssetLibrary._invalidate_owner_state(self.root, path)
            except (OSError, json.JSONDecodeError, TypeError, ValueError):
                continue

    def load_review(self) -> MappingReview:
        if not self.review_path.is_file():
            return MappingReview(self.project_id)
        try:
            data = json.loads(self.review_path.read_text(encoding="utf-8"))
            return MappingReview(**data)
        except (OSError, json.JSONDecodeError, TypeError) as exc:
            raise ReferenceAssetError("Asset Mapping review is damaged") from exc

    def save_review(self, review: MappingReview) -> None:
        if review.project_id != self.project_id:
            raise ReferenceAssetError("Review project ID mismatch")
        _atomic_write_json(self.review_path, asdict(review))

    def begin_review(self, scenes: list[dict[str, Any]], script_revision: int) -> MappingReview:
        previous = self.load_review()
        review = MappingReview(
            project_id=self.project_id,
            mapping_revision=previous.mapping_revision + 1,
            script_revision=script_revision,
            script_fingerprint=script_fingerprint(scenes),
        )
        self.save_review(review)
        return review

    def approve_review(
        self, scenes: list[dict[str, Any]], script_revision: int, *,
        text_only_confirmed: bool = False, legacy_confirmed: bool = False,
    ) -> MappingReview:
        review = self.load_review()
        if review.script_revision != script_revision or (
            review.script_fingerprint != script_fingerprint(scenes)
        ):
            self.invalidate_review(scenes, script_revision)
            raise ReferenceAssetError("대본 변경으로 Mapping 승인이 무효화되었습니다.")
        mappings = [item for item in self.load_all() if not item.candidate_only]
        blocked = [
            item for item in mappings
            if item.status in {"suggested", "ambiguous", "invalid"}
            or (item.status == "unmatched" and not item.user_confirmed)
        ]
        if blocked:
            raise ReferenceAssetError("확인되지 않은 Scene Mapping이 남아 있습니다.")
        if not mappings and not text_only_confirmed and not legacy_confirmed:
            raise ReferenceAssetError("Reference 없는 텍스트 생성을 명시적으로 확인하세요.")
        if mappings and not legacy_confirmed:
            reviewed_scenes = {
                scene
                for scene in range(1, 7)
                if any(
                    item.scene_scope.includes(scene)
                    and (
                        item.status in {"confirmed", "excluded"}
                        or (
                            item.status == "unmatched"
                            and item.user_confirmed
                        )
                    )
                    for item in mappings
                )
            }
            missing = sorted(set(range(1, 7)) - reviewed_scenes)
            if missing:
                raise ReferenceAssetError(
                    "미확인 장면이 남아 있습니다: "
                    + ", ".join(str(item) for item in missing)
                )
        review.status = "approved"
        review.approved_at = _now()
        review.approved_by = "user"
        review.text_only_confirmed = text_only_confirmed
        review.legacy_confirmed = legacy_confirmed
        review.reviewed_scenes = list(range(1, 7))
        self.save_review(review)
        return review

    def approve_automatic_selection(
        self, scenes: list[dict[str, Any]], script_revision: int
    ) -> MappingReview:
        """Confirm every user Candidate for every scene after summary approval."""
        episode_number = (
            int(self.review_scope.split("_", 1)[1])
            if self.review_scope.startswith("episode_")
            else 1
        )
        existing = self.load_all()
        candidates = [
            item for item in existing
            if item.candidate_only and item.enabled
            and item.episode_scope.includes(episode_number)
        ]
        mappings = [
            item for item in existing
            if not item.episode_scope.includes(episode_number)
        ] + list(candidates)
        for candidate in candidates:
            mappings.append(ProjectAssetMapping(
                mapping_id=f"MAP-{uuid4().hex[:12].upper()}",
                project_id=self.project_id,
                asset_id=candidate.asset_id,
                enabled=True,
                usage_role=candidate.usage_role,
                episode_scope=candidate.episode_scope,
                scene_scope=SceneScope(),
                assignment_source="auto",
                confidence=None,
                match_reason="candidate_collection",
                status="confirmed",
                user_confirmed=True,
                version_policy=candidate.version_policy,
                pinned_version=candidate.pinned_version,
                candidate_only=False,
                selected_child_asset_ids=list(
                    candidate.selected_child_asset_ids
                ),
            ))
        self.save_all(mappings)
        review = self.approve_review(
            scenes,
            script_revision,
            text_only_confirmed=not candidates,
        )
        review.approved_by = "user_confirmed_candidate_collection"
        self.save_review(review)
        return review

    def automatic_selection_summary(
        self, episode_number: int = 1
    ) -> dict[int, list[str]]:
        """Show all user Candidates that will be sent for every scene."""
        mappings = [
            item for item in self.load_all()
            if item.candidate_only and item.enabled
        ]
        return {
            scene: sorted({
                item.asset_id for item in mappings
                if item.episode_scope.includes(episode_number)
            })
            for scene in range(1, 7)
        }

    def assert_generation_allowed(
        self, scenes: list[dict[str, Any]], script_revision: int
    ) -> MappingReview:
        review = self.load_review()
        if review.status != "approved" or not review.approved_at:
            raise ReferenceAssetError(
                "장면 Asset Mapping이 아직 승인되지 않았습니다. "
                "Scene Mapping 화면에서 배정을 확인하십시오."
            )
        if review.script_revision != script_revision or (
            review.script_fingerprint != script_fingerprint(scenes)
        ):
            self.invalidate_review(scenes, script_revision)
            raise ReferenceAssetError("대본 변경으로 Mapping 승인이 무효화되었습니다.")
        return review

    def invalidate_review(
        self, scenes: list[dict[str, Any]], script_revision: int
    ) -> MappingReview:
        review = self.begin_review(scenes, script_revision)
        review.status = "waiting"
        self.save_review(review)
        return review

    def create_snapshot(
        self, mapping_id: str, library: AssetLibrary
    ) -> ProjectAssetMapping:
        mappings = self.load_all()
        mapping = next(
            (item for item in mappings if item.mapping_id == mapping_id), None
        )
        if mapping is None:
            raise ReferenceAssetError("Project Asset Mapping not found")
        asset = library.get(mapping.asset_id)
        version = mapping.pinned_version or asset.version
        source = library.resolve_path(asset, version)
        snapshots = self.root / "asset_snapshots"
        snapshots.mkdir(parents=True, exist_ok=True)
        destination = snapshots / (
            f"{mapping.mapping_id}-v{version}{source.suffix.lower()}"
        )
        shutil.copy2(source, destination)
        mapping.version_policy = "snapshot"
        mapping.snapshot_path = str(destination.relative_to(self.root))
        mapping.snapshot_sha256 = hashlib.sha256(destination.read_bytes()).hexdigest()
        mapping.snapshot_source_version = version
        self.save_all(mappings)
        return mapping

    def set_version_policy(
        self, mapping_id: str, policy: str, library: AssetLibrary,
        pinned_version: int | None = None,
    ) -> ProjectAssetMapping:
        if policy == "snapshot":
            return self.create_snapshot(mapping_id, library)
        if policy not in {"pinned_version", "follow_latest"}:
            raise ReferenceAssetError("Invalid version policy")
        mappings = self.load_all()
        mapping = next(
            (item for item in mappings if item.mapping_id == mapping_id), None
        )
        if mapping is None:
            raise ReferenceAssetError("Project Asset Mapping not found")
        asset = library.get(mapping.asset_id)
        version = pinned_version or asset.version
        library.resolve_path(asset, version)
        mapping.version_policy = policy
        mapping.pinned_version = version
        mapping.snapshot_path = None
        mapping.snapshot_sha256 = None
        mapping.snapshot_source_version = None
        mapping.updated_at = _now()
        self.save_all(mappings)
        return mapping

    def add_candidate(
        self,
        asset: LibraryAsset,
        *,
        usage_role: str | None = None,
        always_apply: bool = False,
        assignment_source: str = "manual",
        episode_scope: EpisodeScope | None = None,
        selected_child_asset_ids: list[str] | None = None,
    ) -> ProjectAssetMapping:
        mappings = self.load_all()
        existing = next(
            (
                item for item in mappings
                if item.asset_id == asset.asset_id and item.candidate_only
                and item.episode_scope == (episode_scope or EpisodeScope())
            ),
            None,
        )
        if existing:
            if selected_child_asset_ids is not None:
                existing.selected_child_asset_ids = list(dict.fromkeys(
                    selected_child_asset_ids
                ))
                existing.updated_at = _now()
                self.save_all(mappings)
            if (
                not existing.enabled or existing.status == "excluded"
                or (always_apply and existing.candidate_only)
            ):
                existing.enabled = True
                existing.status = "confirmed" if always_apply else "suggested"
                existing.user_confirmed = always_apply
                existing.candidate_only = not always_apply
                existing.updated_at = _now()
                self.save_all(mappings)
            return existing
        mapping = ProjectAssetMapping(
            mapping_id=f"MAP-{uuid4().hex[:12].upper()}",
            project_id=self.project_id,
            asset_id=asset.asset_id,
            usage_role=usage_role or asset.asset_type,
            assignment_source=assignment_source,
            status="confirmed" if always_apply else "suggested",
            user_confirmed=always_apply,
            pinned_version=asset.version,
            candidate_only=not always_apply,
            episode_scope=episode_scope or EpisodeScope(),
            selected_child_asset_ids=list(dict.fromkeys(
                selected_child_asset_ids or []
            )),
        )
        mappings.append(mapping)
        self.save_all(mappings)
        return mapping

    def replace_scene_assignments(
        self, scene_number: int, assignments: list[ProjectAssetMapping]
    ) -> None:
        mappings = [
            item for item in self.load_all()
            if item.candidate_only or not item.scene_scope.includes(scene_number)
        ]
        mappings.extend(assignments)
        self.save_all(mappings)

    def confirm(self, mapping_id: str, confirmed: bool = True) -> ProjectAssetMapping:
        mappings = self.load_all()
        mapping = next(
            (item for item in mappings if item.mapping_id == mapping_id), None
        )
        if mapping is None:
            raise ReferenceAssetError("Project Asset Mapping not found")
        mapping.user_confirmed = confirmed
        mapping.status = "confirmed" if confirmed else "excluded"
        mapping.updated_at = _now()
        self.save_all(mappings)
        return mapping

    def assign_asset(
        self,
        asset: LibraryAsset,
        *,
        scene_scope: SceneScope,
        episode_scope: EpisodeScope | None = None,
        usage_role: str | None = None,
        version_policy: str = "pinned_version",
    ) -> ProjectAssetMapping:
        """Add one explicit user assignment and invalidate prior approval."""
        mapping = ProjectAssetMapping(
            mapping_id=f"MAP-{uuid4().hex[:12].upper()}",
            project_id=self.project_id,
            asset_id=asset.asset_id,
            usage_role=usage_role or asset.asset_type,
            episode_scope=episode_scope or EpisodeScope(),
            scene_scope=scene_scope,
            assignment_source="manual",
            status="confirmed",
            user_confirmed=True,
            version_policy=version_policy,
            pinned_version=asset.version,
            candidate_only=False,
        )
        mappings = self.load_all()
        mappings.append(mapping)
        self.save_all(mappings)
        return mapping

    def replace_asset(
        self, mapping_id: str, asset: LibraryAsset
    ) -> ProjectAssetMapping:
        mappings = self.load_all()
        mapping = next(
            (item for item in mappings if item.mapping_id == mapping_id), None
        )
        if mapping is None:
            raise ReferenceAssetError("Project Asset Mapping not found")
        mapping.asset_id = asset.asset_id
        mapping.usage_role = asset.asset_type
        mapping.version_policy = "pinned_version"
        mapping.pinned_version = asset.version
        mapping.snapshot_path = None
        mapping.snapshot_sha256 = None
        mapping.snapshot_source_version = None
        mapping.assignment_source = "manual"
        mapping.status = "confirmed"
        mapping.user_confirmed = True
        mapping.updated_at = _now()
        self.save_all(mappings)
        return mapping

    def mark_scene_unmatched(
        self, scene_number: int, *, user_confirmed: bool
    ) -> ProjectAssetMapping:
        placeholder = ProjectAssetMapping(
            mapping_id=f"MAP-{uuid4().hex[:12].upper()}",
            project_id=self.project_id,
            asset_id="UNMATCHED",
            usage_role="general_reference",
            scene_scope=SceneScope(mode="scene", scene=scene_number),
            assignment_source="manual",
            status="unmatched",
            user_confirmed=user_confirmed,
            pinned_version=None,
            candidate_only=False,
        )
        mappings = self.load_all()
        mappings.append(placeholder)
        self.save_all(mappings)
        return placeholder

    def remove_assignment(self, mapping_id: str) -> None:
        mappings = self.load_all()
        mapping = next(
            (item for item in mappings if item.mapping_id == mapping_id), None
        )
        if mapping is None:
            raise ReferenceAssetError("Project Asset Mapping not found")
        mapping.status = "excluded"
        mapping.user_confirmed = True
        mapping.updated_at = _now()
        self.save_all(mappings)

    def exclude_project_asset(self, asset: LibraryAsset) -> None:
        mappings = self.load_all()
        changed = False
        for mapping in mappings:
            if mapping.asset_id == asset.asset_id:
                mapping.enabled = False
                mapping.status = "excluded"
                mapping.user_confirmed = True
                mapping.updated_at = _now()
                changed = True
        if not changed:
            mappings.append(ProjectAssetMapping(
                mapping_id=f"MAP-{uuid4().hex[:12].upper()}",
                project_id=self.project_id,
                asset_id=asset.asset_id,
                enabled=False,
                usage_role=asset.asset_type,
                assignment_source="manual",
                status="excluded",
                user_confirmed=True,
                pinned_version=asset.version,
                candidate_only=True,
            ))
            changed = True
        if changed:
            self.save_all(mappings)

    def _validate(self, mapping: ProjectAssetMapping) -> None:
        if mapping.project_id != self.project_id:
            raise ReferenceAssetError("Mapping project ID mismatch")
        if mapping.assignment_source not in self.ASSIGNMENT_SOURCES:
            raise ReferenceAssetError("Invalid assignment source")
        if mapping.status not in self.STATUSES:
            raise ReferenceAssetError("Invalid mapping status")
        if mapping.version_policy not in {
            "follow_latest", "pinned_version", "snapshot"
        }:
            raise ReferenceAssetError("Invalid version policy")
        mapping.scene_scope.validate()
        mapping.episode_scope.validate()


class SceneAssetMatcher:
    """Deterministic local matcher; it never calls an AI provider."""

    TYPE_ENTITY_KEYS = {
        "character": "characters",
        "background": "locations",
        "object": "objects",
        "style": "styles",
        "general_reference": "keywords",
    }

    def match(
        self,
        project_id: str,
        scene_number: int,
        entities: dict[str, list[str]],
        candidates: list[LibraryAsset],
    ) -> list[ProjectAssetMapping]:
        scored: dict[str, list[tuple[int, LibraryAsset, str]]] = {}
        for asset in candidates:
            if not asset.enabled:
                continue
            key = self.TYPE_ENTITY_KEYS[asset.asset_type]
            entity_terms = {_normalize(item) for item in entities.get(key, [])}
            score, reason = self._score(asset, entity_terms)
            if score:
                scored.setdefault(asset.asset_type, []).append((score, asset, reason))
        assignments: list[ProjectAssetMapping] = []
        for asset_type, matches in scored.items():
            matches.sort(key=lambda item: (-item[0], item[1].asset_id))
            best = matches[0][0]
            tied = [item for item in matches if item[0] == best]
            for score, asset, reason in tied:
                assignments.append(ProjectAssetMapping(
                    mapping_id=f"MAP-{uuid4().hex[:12].upper()}",
                    project_id=project_id,
                    asset_id=asset.asset_id,
                    usage_role=asset_type,
                    scene_scope=SceneScope(mode="scene", scene=scene_number),
                    assignment_source="auto",
                    confidence=round(score / 100, 2),
                    match_reason=reason,
                    status="ambiguous" if len(tied) > 1 else "suggested",
                    user_confirmed=False,
                    pinned_version=asset.version,
                    candidate_only=False,
                ))
        return assignments

    @staticmethod
    def _score(asset: LibraryAsset, entities: set[str]) -> tuple[int, str]:
        if not entities:
            return (0, "")
        if asset.character_key and _normalize(asset.character_key) in entities:
            return (100, "고유 ID 직접 일치")
        if _normalize(asset.display_name) in entities:
            return (90, "이름 정확 일치")
        display_name = _normalize(asset.display_name)
        if display_name and any(display_name in entity for entity in entities):
            return (85, "장면 문구에 이름 포함")
        aliases = {_normalize(item) for item in asset.aliases}
        if aliases.intersection(entities):
            return (80, "별칭 정확 일치")
        tags = {_normalize(item) for item in asset.tags}
        tag_hits = len(tags.intersection(entities))
        if tag_hits:
            return (60 + min(tag_hits, 3) * 5, f"태그 {tag_hits}개 일치")
        description = _normalize(asset.description)
        if any(entity and entity in description for entity in entities):
            return (40, "설명 키워드 일치")
        return (0, "")


class ProjectAssetResolver:
    """Resolve confirmed mappings first and legacy project References second."""

    def __init__(
        self, library: AssetLibrary, mappings: ProjectAssetMappingStore,
        legacy: ProjectReferenceManager | None = None,
    ) -> None:
        self.library = library
        self.mappings = mappings
        self.legacy = legacy

    def select_for_episode_scene(
        self, episode_number: int, scene_number: int,
        scene_context: dict[str, Any] | str | None = None,
    ) -> tuple[list[Path], list[str], list[str]]:
        paths: list[Path] = []
        ids: list[str] = []
        warnings: list[str] = []
        active = [
            item for item in self.mappings.load_all()
            if item.enabled
            and not item.candidate_only
            and item.user_confirmed
            and item.status == "confirmed"
            and item.episode_scope.includes(episode_number)
            and item.scene_scope.includes(scene_number)
        ]
        for mapping in active:
            try:
                asset = self.library.get(mapping.asset_id)
                if not asset.enabled:
                    warnings.append(f"{asset.asset_id}: disabled Library Asset")
                    continue
                if asset.is_folder:
                    children = self.library.folder_children(asset)
                    selected_ids = set(mapping.selected_child_asset_ids)
                    selected = [
                        child for child in children
                        if child.asset_id in selected_ids and child.enabled
                    ]
                    if not selected:
                        selected = [
                            child for child in children
                            if child.asset_id == asset.thumbnail_asset_id
                            or child.role == "front"
                        ][:2]
                    for child in selected:
                        paths.append(self.library.resolve_path(child))
                        ids.append(
                            f"{asset.asset_id}#{child.asset_id}#{child.role or 'other'}"
                        )
                    continue
                version = (
                    asset.version if mapping.version_policy == "follow_latest"
                    else mapping.pinned_version
                )
                if mapping.version_policy == "snapshot":
                    if not mapping.snapshot_path:
                        raise ReferenceAssetError("Snapshot path is missing")
                    snapshot = (self.mappings.root / mapping.snapshot_path).resolve()
                    if self.mappings.root not in snapshot.parents:
                        raise ReferenceAssetError("Snapshot path escapes project")
                    if hashlib.sha256(snapshot.read_bytes()).hexdigest() != (
                        mapping.snapshot_sha256
                    ):
                        raise ReferenceAssetError("Snapshot integrity check failed")
                    paths.append(snapshot)
                    ids.append(f"{asset.asset_id}@v{version}")
                elif asset.asset_type == "character":
                    selected = self._character_references(
                        asset, scene_context,
                        all_references=(
                            mapping.match_reason == "candidate_collection"
                        ),
                    )
                    has_multiple_images = len({
                        item.content_sha256 or item.path
                        for item in asset.reference_images
                    }) > 1
                    for reference in selected:
                        paths.append(
                            self.library.resolve_reference_path(reference)
                        )
                        ids.append(
                            f"{asset.asset_id}@v{version}"
                            + (
                                f"#{reference.role}"
                                if has_multiple_images else ""
                            )
                        )
                else:
                    paths.append(self.library.resolve_path(asset, version))
                    ids.append(f"{asset.asset_id}@v{version}")
            except ReferenceAssetError as exc:
                warnings.append(f"{mapping.asset_id}: {exc}")
        if self.legacy is not None:
            assets, legacy_warnings = self.legacy.select_for_episode_scene(
                episode_number, scene_number
            )
            existing_digests = {
                hashlib.sha256(path.read_bytes()).hexdigest() for path in paths
            }
            for asset in assets:
                path = self.legacy.resolve_path(asset)
                digest = hashlib.sha256(path.read_bytes()).hexdigest()
                if digest in existing_digests:
                    continue
                paths.append(path)
                ids.append(asset.asset_id)
                existing_digests.add(digest)
            warnings.extend(legacy_warnings)
        return paths, ids, warnings

    def image_pipeline_selection(
        self, scene_number: int,
        scene_context: dict[str, Any] | str | None = None,
    ) -> tuple[list[Path], list[str], list[str]]:
        return self.select_for_episode_scene(
            1, scene_number, scene_context
        )

    @staticmethod
    def _character_references(
        asset: LibraryAsset,
        scene_context: dict[str, Any] | str | None,
        maximum: int = 3,
        all_references: bool = False,
    ) -> list[Any]:
        """Resolve Character Set images without a provider-side API call."""
        references = asset.reference_images
        if not references:
            return []
        if all_references:
            selected = []
            seen_digests: set[str] = set()
            for reference in references:
                digest = reference.content_sha256 or reference.path
                if digest in seen_digests:
                    continue
                selected.append(reference)
                seen_digests.add(digest)
            return selected
        desired = select_character_reference_roles(scene_context)
        selected = []
        seen_digests: set[str] = set()
        for role in desired:
            reference = next(
                (item for item in references if item.role == role), None
            )
            if reference is None:
                continue
            digest = reference.content_sha256 or reference.path
            if digest in seen_digests:
                continue
            selected.append(reference)
            seen_digests.add(digest)
            if len(selected) >= maximum:
                break
        if not selected:
            selected.append(references[0])
        return selected

    def cache_descriptors(
        self, episode_number: int, scene_number: int,
        mapping_revision: int, script_revision: int,
        scene_context: dict[str, Any] | str | None = None,
    ) -> list[str]:
        """Return ordered identity metadata explicitly included in cache keys."""
        descriptors: list[str] = []
        active = [
            item for item in self.mappings.load_all()
            if item.enabled and not item.candidate_only and item.user_confirmed
            and item.status == "confirmed"
            and item.episode_scope.includes(episode_number)
            and item.scene_scope.includes(scene_number)
        ]
        for order, mapping in enumerate(active):
            asset = self.library.get(mapping.asset_id)
            if asset.is_folder:
                selected = set(mapping.selected_child_asset_ids)
                for child in self.library.folder_children(asset):
                    if child.asset_id not in selected:
                        continue
                    descriptors.append(
                        f"{len(descriptors)}:{asset.asset_id}:{child.asset_id}:"
                        f"{child.role}:{child.content_sha256}:"
                        f"mapping={mapping_revision}:script={script_revision}"
                    )
                continue
            version = (
                asset.version if mapping.version_policy == "follow_latest"
                else mapping.pinned_version
            )
            if (
                asset.asset_type == "character"
                and mapping.version_policy != "snapshot"
            ):
                for reference in self._character_references(
                    asset, scene_context,
                    all_references=(
                        mapping.match_reason == "candidate_collection"
                    ),
                ):
                    descriptors.append(
                        f"{len(descriptors)}:{asset.asset_id}:v{version}:"
                        f"character:{reference.role}:"
                        f"{reference.content_sha256}:mapping={mapping_revision}:"
                        f"script={script_revision}"
                    )
            else:
                digest = (
                    mapping.snapshot_sha256
                    if mapping.version_policy == "snapshot"
                    else next(
                        item.content_sha256 for item in asset.versions
                        if item.version == version
                    )
                )
                descriptors.append(
                    f"{order}:{asset.asset_id}:v{version}:{asset.asset_type}:"
                    f"{digest}:mapping={mapping_revision}:script={script_revision}"
                )
        if self.legacy is not None:
            legacy, _ = self.legacy.select_for_episode_scene(
                episode_number, scene_number
            )
            existing_digests: set[str] = set()
            for descriptor in descriptors:
                parts = descriptor.split(":")
                if len(parts) > 5 and parts[3] == "character":
                    existing_digests.add(parts[5])
                elif len(parts) > 4:
                    existing_digests.add(parts[4])
            for order, asset in enumerate(legacy):
                if asset.content_sha256 in existing_digests:
                    continue
                descriptors.append(
                    f"{len(descriptors)}:legacy:{asset.asset_id}:{asset.reference_type}:"
                    f"{asset.content_sha256}:mapping={mapping_revision}:"
                    f"script={script_revision}"
                )
                existing_digests.add(asset.content_sha256)
        return descriptors

    def prompt_asset_metadata(
        self, episode_number: int, scene_number: int
    ) -> str:
        """Describe attached Assets without exposing tags or aliases."""
        active = [
            item for item in self.mappings.load_all()
            if item.enabled and not item.candidate_only and item.user_confirmed
            and item.status == "confirmed"
            and item.episode_scope.includes(episode_number)
            and item.scene_scope.includes(scene_number)
        ]
        blocks = []
        seen: set[str] = set()
        for mapping in active:
            if mapping.asset_id in seen:
                continue
            seen.add(mapping.asset_id)
            asset = self.library.get(mapping.asset_id)
            lines = [
                f"이름: {asset.display_name}",
                f"유형: {asset.asset_type}",
                f"설명: {asset.description or '별도 설명 없음'}",
            ]
            if asset.is_folder:
                selected = set(mapping.selected_child_asset_ids)
                children = [
                    child for child in self.library.folder_children(asset)
                    if child.asset_id in selected
                ]
                lines.extend((
                    "자료 관계: 같은 Asset Folder에 속한 동일 대상의 다른 참고 이미지",
                    "선택 하위 이미지: " + (
                        ", ".join(
                            f"{child.display_name}({child.role or 'other'})"
                            for child in children
                        ) or "없음"
                    ),
                ))
            if asset.asset_type == "character":
                roles = list(dict.fromkeys(
                    item.role for item in asset.reference_images
                ))
                lines.append(
                    "Character Reference 역할: "
                    + (", ".join(roles) if roles else "대표 이미지")
                )
            blocks.append("\n".join(lines))
        return "\n\n----------------\n\n".join(blocks) or "없음"

    def prompt_reference_manifest(
        self,
        episode_number: int,
        scene_number: int,
        scene_context: dict[str, Any] | str | None = None,
    ) -> str:
        """Describe each actual provider attachment in its exact send order."""
        paths, reference_ids, _warnings = self.select_for_episode_scene(
            episode_number, scene_number, scene_context
        )
        if not paths:
            return "첨부 Reference 없음 (Text Only)"

        legacy_by_id = (
            {item.asset_id: item for item in self.legacy.load_all()}
            if self.legacy is not None else {}
        )
        blocks: list[str] = []
        for index, (path, reference_id) in enumerate(
            zip(paths, reference_ids, strict=True), start=1
        ):
            asset_id = reference_id.split("@v", 1)[0].split("#", 1)[0]
            role = (
                reference_id.rsplit("#", 1)[1]
                if "#" in reference_id else "대표 이미지"
            )
            try:
                asset = self.library.get(asset_id)
                if asset.asset_type == "character" and "#" not in reference_id:
                    desired_roles = select_character_reference_roles(
                        scene_context
                    )
                    matching_roles = [
                        reference.role
                        for reference in asset.reference_images
                        if self.library.resolve_reference_path(reference) == path
                    ]
                    role = next(
                        (
                            desired for desired in desired_roles
                            if desired in matching_roles
                        ),
                        matching_roles[0] if matching_roles else role,
                    )
                child_name = ""
                if asset.is_folder and "#" in reference_id:
                    parts = reference_id.split("#")
                    if len(parts) >= 2:
                        try:
                            child_name = self.library.get(parts[1]).display_name
                        except ReferenceAssetError:
                            child_name = ""
                lines = [
                    f"[첨부 Reference {index}]",
                    f"파일: {path.name}",
                    f"Asset 대표 이름: {asset.display_name}",
                    f"유형: {asset.asset_type}",
                    f"역할: {role}",
                    f"설명: {asset.description or '별도 설명 없음'}",
                ]
                if child_name:
                    lines.append(f"하위 이미지: {child_name}({role})")
                if asset.asset_type == "character":
                    lines.append(
                        "관계: 위 Asset 대표 이름의 동일 캐릭터 외형 Reference"
                    )
            except ReferenceAssetError:
                legacy = legacy_by_id.get(asset_id)
                lines = [
                    f"[첨부 Reference {index}]",
                    f"파일: {path.name}",
                    "Asset 대표 이름: "
                    + (legacy.display_name if legacy else asset_id),
                    "유형: "
                    + (legacy.reference_type if legacy else "reference"),
                    f"역할: {role}",
                    "설명: "
                    + (
                        legacy.notes
                        if legacy and legacy.notes else "별도 설명 없음"
                    ),
                ]
            blocks.append("\n".join(lines))
        return "\n\n".join(blocks)

    def candidate_asset_counts(
        self, episode_number: int, scene_number: int
    ) -> dict[str, int]:
        """Count unique attached Assets by type for Image Review."""
        counts = {
            "total": 0, "character": 0, "background": 0,
            "object": 0, "style": 0, "general_reference": 0,
        }
        seen: set[str] = set()
        for mapping in self.mappings.load_all():
            if (
                not mapping.enabled or mapping.candidate_only
                or not mapping.user_confirmed or mapping.status != "confirmed"
                or not mapping.episode_scope.includes(episode_number)
                or not mapping.scene_scope.includes(scene_number)
                or mapping.asset_id in seen
            ):
                continue
            asset = self.library.get(mapping.asset_id)
            seen.add(mapping.asset_id)
            counts["total"] += 1
            counts[asset.asset_type] += 1
        return counts

    def validate_approved_assets(
        self, episode_number: int, scene_count: int = 6,
        max_references: int = 16,
        scenes: list[dict[str, Any]] | None = None,
    ) -> None:
        """Fail before a provider call when an approved mapping is no longer valid."""
        mappings = self.mappings.load_all()
        for mapping in mappings:
            if (
                not mapping.enabled or mapping.candidate_only
                or not mapping.user_confirmed or mapping.status != "confirmed"
                or not mapping.episode_scope.includes(episode_number)
            ):
                continue
            asset = self.library.get(mapping.asset_id)
            if not asset.enabled:
                raise ReferenceAssetError(
                    f"{asset.asset_id}: 비활성 Asset은 사용할 수 없습니다."
                )
            if asset.is_folder:
                selected = set(mapping.selected_child_asset_ids)
                children = self.library.folder_children(asset)
                known = {child.asset_id for child in children}
                missing_links = selected - known
                if missing_links:
                    raise ReferenceAssetError(
                        f"{asset.display_name}: Folder 하위 이미지 연결이 변경되었습니다"
                    )
                for child in children:
                    if child.asset_id in selected:
                        self.library.resolve_path(child)
                continue
            version = (
                asset.version if mapping.version_policy == "follow_latest"
                else mapping.pinned_version
            )
            if mapping.version_policy == "snapshot":
                if not mapping.snapshot_path or not mapping.snapshot_sha256:
                    raise ReferenceAssetError("Snapshot 정보가 누락되었습니다.")
            else:
                self.library.resolve_path(asset, version)
        for scene in range(1, scene_count + 1):
            scene_context = next(
                (
                    item for item in (scenes or [])
                    if int(item.get("number", 0)) == scene
                ),
                None,
            )
            paths, _ids, warnings = self.select_for_episode_scene(
                episode_number, scene, scene_context
            )
            if warnings:
                raise ReferenceAssetError(
                    f"Scene {scene}: " + "; ".join(warnings)
                )
            unique = {hashlib.sha256(path.read_bytes()).hexdigest() for path in paths}
            if len(unique) > max_references:
                raise ReferenceAssetError(
                    f"Scene {scene}: Provider Reference 개수 제한을 초과했습니다."
                )


def select_character_reference_roles(
    scene_context: dict[str, Any] | str | None,
) -> list[str]:
    """Return deterministic view roles using only local scene text."""
    text = (
        json.dumps(scene_context, ensure_ascii=False)
        if isinstance(scene_context, dict)
        else str(scene_context or "")
    ).casefold()
    role_terms = (
        ("back", ("뒷모습", "후면", "등을 보", "back view", "from behind")),
        ("side", ("측면", "옆모습", "profile", "side view")),
        ("left45", ("좌45", "왼쪽 45", "left45", "left 45", "left three-quarter")),
        ("right45", ("우45", "오른쪽 45", "right45", "right 45", "right three-quarter")),
        ("front", ("정면", "앞모습", "front view", "facing camera")),
    )
    roles = [
        role for role, terms in role_terms
        if any(term in text for term in terms)
    ]
    if any(
        term in text for term in (
            "표정", "감정", "웃", "울", "화난", "놀란",
            "expression", "smile", "cry", "angry", "surprised",
        )
    ):
        roles.append("expression")
    roles.extend(("thumbnail", "front"))
    return list(dict.fromkeys(roles))


def describe_reference_selection(
    reference_ids: list[str],
    reference_paths: list[Path | str],
    scene_context: dict[str, Any] | str | None = None,
) -> list[dict[str, str]]:
    """Format existing Resolver output for logs and review UI."""
    detected = select_character_reference_roles(scene_context)
    reason_by_role = {
        "front": (
            "정면 키워드 감지"
            if detected and detected[0] == "front"
            else "정면 기본 Reference"
        ),
        "left45": "좌측 45도 키워드 감지",
        "right45": "우측 45도 키워드 감지",
        "side": "측면 키워드 감지",
        "back": "후면 키워드 감지",
        "expression": "표정 또는 감정 키워드 감지",
        "thumbnail": "대표 이미지 기본 선택",
        "other": "장면에 연결된 Character Reference",
    }
    rows: list[dict[str, str]] = []
    for index, raw_path in enumerate(reference_paths):
        reference_id = (
            str(reference_ids[index])
            if index < len(reference_ids) else ""
        )
        role = (
            reference_id.rsplit("#", 1)[1]
            if "#" in reference_id else "reference"
        )
        path = Path(raw_path)
        rows.append({
            "asset_id": reference_id,
            "path": str(path),
            "filename": path.name,
            "role": role,
            "reason": reason_by_role.get(
                role, "승인된 Scene Asset Mapping"
            ),
        })
    return rows


def extract_scene_entities(scene: dict[str, Any]) -> dict[str, list[str]]:
    """Normalize structured entities, falling back to local description tokens."""
    raw = scene.get("entities")
    if isinstance(raw, dict):
        return {
            key: [str(item) for item in value if str(item).strip()]
            for key, value in raw.items() if isinstance(value, list)
        }
    description = str(scene.get("description", ""))
    tokens = [
        token for token in re.findall(r"[\w가-힣-]{2,}", description.casefold())
        if token
    ]
    phrases = list(tokens)
    for size in (2, 3):
        phrases.extend(
            " ".join(tokens[index:index + size])
            for index in range(0, max(0, len(tokens) - size + 1))
        )
    # Types remain isolated during matching; sharing locally extracted terms
    # lets a typed candidate name/alias match without guessing its entity type.
    return {
        "characters": phrases,
        "locations": phrases,
        "objects": phrases,
        "styles": phrases,
        "keywords": phrases,
    }


def _normalize(value: str) -> str:
    return " ".join(str(value).casefold().replace("_", " ").split())


def script_fingerprint(scenes: list[dict[str, Any]]) -> str:
    payload = json.dumps(scenes, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()
