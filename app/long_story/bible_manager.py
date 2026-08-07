"""CRUD helpers for Story Bible characters, locations, and props."""

from __future__ import annotations

from copy import deepcopy
from typing import Any
from uuid import uuid4

from app.long_story.models import StoryBible


class BibleCollectionManager:
    """Operate on one Story Bible collection without provider dependencies."""

    ID_KEYS = {
        "characters": "character_id",
        "locations": "location_id",
        "props": "prop_id",
        "secrets": "secret_id",
        "foreshadowing": "foreshadowing_id",
    }

    def __init__(self, bible: StoryBible, collection: str) -> None:
        if collection not in self.ID_KEYS:
            raise ValueError("Unsupported Story Bible collection")
        self.bible = bible
        self.collection = collection
        self.id_key = self.ID_KEYS[collection]

    @property
    def items(self) -> list[dict[str, Any]]:
        return getattr(self.bible, self.collection)

    def add(self, data: dict[str, Any]) -> dict[str, Any]:
        item = dict(data)
        item.setdefault(
            self.id_key,
            f"{self.id_key.removesuffix('_id').upper()}-{uuid4().hex[:8].upper()}",
        )
        if any(existing.get(self.id_key) == item[self.id_key] for existing in self.items):
            raise ValueError("Duplicate Story Bible ID")
        self.items.append(item)
        return item

    def update(self, item_id: str, changes: dict[str, Any]) -> dict[str, Any]:
        item = self.get(item_id)
        safe = dict(changes)
        safe.pop(self.id_key, None)
        item.update(safe)
        return item

    def get(self, item_id: str) -> dict[str, Any]:
        item = next(
            (value for value in self.items if value.get(self.id_key) == item_id),
            None,
        )
        if item is None:
            raise ValueError("Story Bible item not found")
        return item

    def delete(self, item_id: str) -> None:
        self.items.remove(self.get(item_id))

    def duplicate(self, item_id: str) -> dict[str, Any]:
        clone = deepcopy(self.get(item_id))
        clone[self.id_key] = (
            f"{self.id_key.removesuffix('_id').upper()}-{uuid4().hex[:8].upper()}"
        )
        clone["name"] = f"{clone.get('name', '항목')} 복사본"
        self.items.append(clone)
        return clone

    def search(self, query: str) -> list[dict[str, Any]]:
        normalized = query.strip().lower()
        return [
            item for item in self.items
            if normalized in str(item.get("name", "")).lower()
            or normalized in str(item.get("description", "")).lower()
        ]
