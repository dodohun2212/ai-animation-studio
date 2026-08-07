"""Reference image metadata registration and search."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
from pathlib import Path
from typing import Any
from uuid import uuid4


SUPPORTED_EXTENSIONS = frozenset({".png", ".jpg", ".jpeg", ".webp"})
VALID_CATEGORIES = frozenset(
    {
        "style",
        "lighting",
        "background",
        "composition",
        "props",
        "character",
        "environment",
        "camera",
        "color",
    }
)


@dataclass(slots=True)
class ReferenceMetadata:
    """Searchable, non-copying description of one reference image."""

    reference_id: str
    file_name: str
    category: str
    description: str = ""
    tags: list[str] = field(default_factory=list)
    priority: int = 0
    enabled: bool = True
    license_note: str = ""
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class ReferenceManager:
    """Manage metadata under the existing reference library structure."""

    def __init__(self, library_root: Path) -> None:
        self.library_root = library_root
        self.metadata_directory = library_root / "metadata"

    def initialize(self) -> None:
        self.metadata_directory.mkdir(parents=True, exist_ok=True)

    def register(
        self,
        image_path: Path,
        category: str,
        *,
        description: str = "",
        tags: list[str] | None = None,
        priority: int = 0,
        license_note: str = "",
        reference_id: str | None = None,
    ) -> ReferenceMetadata:
        """Register existing supported image metadata without copying it."""
        normalized_category = category.lower()
        if not image_path.is_file():
            raise ValueError("Reference image does not exist")
        if image_path.suffix.lower() not in SUPPORTED_EXTENSIONS:
            raise ValueError("Unsupported reference image format")
        if normalized_category not in VALID_CATEGORIES:
            raise ValueError("Unsupported reference category")
        metadata = ReferenceMetadata(
            reference_id=reference_id or f"REF-{uuid4().hex[:8].upper()}",
            file_name=str(image_path.resolve()),
            category=normalized_category,
            description=description.strip(),
            tags=sorted({tag.strip().lower() for tag in tags or [] if tag.strip()}),
            priority=priority,
            license_note=license_note.strip(),
        )
        self._save(metadata)
        return metadata

    def _save(self, metadata: ReferenceMetadata) -> None:
        self.initialize()
        path = self.metadata_directory / f"{metadata.reference_id}.json"
        path.write_text(
            json.dumps(asdict(metadata), ensure_ascii=False, indent=4),
            encoding="utf-8",
        )

    def load_all(self) -> list[ReferenceMetadata]:
        """Load valid metadata; invalid files are rejected explicitly."""
        if not self.metadata_directory.is_dir():
            return []
        references: list[ReferenceMetadata] = []
        for path in sorted(self.metadata_directory.glob("*.json")):
            try:
                data: Any = json.loads(path.read_text(encoding="utf-8"))
                references.append(ReferenceMetadata(**data))
            except (OSError, json.JSONDecodeError, TypeError) as exc:
                raise ValueError(f"Invalid reference metadata: {path.name}") from exc
        return references

    def search(
        self,
        *,
        category: str | None = None,
        tags: list[str] | None = None,
        limit: int = 10,
    ) -> list[ReferenceMetadata]:
        """Search enabled records by category and any requested tag."""
        requested_tags = {tag.lower() for tag in tags or []}
        matches = [
            item
            for item in self.load_all()
            if item.enabled
            and (category is None or item.category == category.lower())
            and (
                not requested_tags
                or bool(requested_tags.intersection(item.tags))
            )
        ]
        return sorted(
            matches,
            key=lambda item: (
                -len(requested_tags.intersection(item.tags)),
                -item.priority,
                item.reference_id,
            ),
        )[:limit]

    def execute(self, **criteria: Any) -> list[ReferenceMetadata]:
        return self.search(**criteria)

    def validate(self, metadata: ReferenceMetadata) -> bool:
        return (
            metadata.category in VALID_CATEGORIES
            and Path(metadata.file_name).suffix.lower() in SUPPORTED_EXTENSIONS
        )

    def cleanup(self) -> None:
        """No runtime resources are held."""
