"""World-lore JSON collections and conflict checks."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


COLLECTIONS = (
    "locations",
    "events",
    "timeline",
    "items",
    "organizations",
    "species",
    "environment",
)


class LoreManager:
    """Manage lore entities without silently creating duplicates."""

    def __init__(self, storage_directory: Path) -> None:
        self.storage_directory = storage_directory
        self.data: dict[str, list[dict[str, Any]]] = {
            name: [] for name in COLLECTIONS
        }

    def initialize(self) -> None:
        self.storage_directory.mkdir(parents=True, exist_ok=True)
        for collection in COLLECTIONS:
            path = self.storage_directory / f"{collection}.json"
            if path.is_file():
                value = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(value, list):
                    raise ValueError(f"{collection} lore must be a list")
                self.data[collection] = value
        self.validate()

    def add(self, collection: str, entity: dict[str, Any]) -> dict[str, Any]:
        """Add an entity after ID and normalized-name conflict checks."""
        if collection not in COLLECTIONS:
            raise ValueError("Unknown lore collection")
        lore_id = str(entity.get("id", "")).strip()
        name = str(entity.get("name", "")).strip()
        if not lore_id.startswith("LORE-") or not name:
            raise ValueError("Lore entity requires LORE- ID and name")
        normalized_name = name.casefold()
        for existing in self.data[collection]:
            if existing.get("id") == lore_id:
                raise ValueError(f"Duplicate lore ID: {lore_id}")
            if str(existing.get("name", "")).casefold() == normalized_name:
                raise ValueError(f"Duplicate lore name: {name}")
        copied = dict(entity)
        self.data[collection].append(copied)
        return copied

    def find(self, collection: str, name: str) -> dict[str, Any] | None:
        normalized_name = name.strip().casefold()
        return next(
            (
                item
                for item in self.data[collection]
                if str(item.get("name", "")).casefold() == normalized_name
            ),
            None,
        )

    def execute(self, collection: str, entity: dict[str, Any]) -> dict[str, Any]:
        return self.add(collection, entity)

    def validate(self) -> bool:
        ids: set[str] = set()
        for entities in self.data.values():
            for entity in entities:
                lore_id = str(entity.get("id", ""))
                if not lore_id.startswith("LORE-") or lore_id in ids:
                    raise ValueError("Invalid or duplicate Lore ID")
                ids.add(lore_id)
        timeline_orders = [
            item.get("order")
            for item in self.data["timeline"]
            if item.get("order") is not None
        ]
        if timeline_orders != sorted(timeline_orders):
            raise ValueError("Lore timeline must be ordered")
        return True

    def cleanup(self) -> None:
        self.validate()
        self.storage_directory.mkdir(parents=True, exist_ok=True)
        for collection, entities in self.data.items():
            (self.storage_directory / f"{collection}.json").write_text(
                json.dumps(entities, ensure_ascii=False, indent=4),
                encoding="utf-8",
            )

    def context(self) -> dict[str, list[dict[str, Any]]]:
        return {key: list(value) for key, value in self.data.items()}
