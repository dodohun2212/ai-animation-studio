"""Single-scene image generation with deterministic caching."""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Callable


ImageGenerator = Callable[[str, list[Path]], bytes]
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"


class ImageEngine:
    """Generate one PNG per request through an injected provider."""

    def __init__(
        self,
        generator: ImageGenerator,
        output_directory: Path,
        cache_directory: Path,
        cache_namespace: str = "",
    ) -> None:
        self.generator = generator
        self.output_directory = output_directory
        self.cache_directory = cache_directory
        self.cache_namespace = cache_namespace
        self.last_cache_hit = False

    def initialize(self) -> None:
        self.output_directory.mkdir(parents=True, exist_ok=True)
        self.cache_directory.mkdir(parents=True, exist_ok=True)

    def execute(
        self,
        scene_number: int,
        prompt: str,
        reference_images: list[Path],
        *,
        regenerate: bool = False,
        reference_descriptors: list[str] | None = None,
    ) -> Path:
        if scene_number not in range(1, 7):
            raise ValueError("scene_number must be between 1 and 6")
        if not prompt.strip():
            raise ValueError("Image prompt cannot be empty")
        cache_path = self.cache_path(
            prompt, reference_images, reference_descriptors
        )
        if regenerate:
            revision = 1 + len(list(
                self.output_directory.glob(f"scene{scene_number}-regen-*.png")
            ))
            destination = self.output_directory / (
                f"scene{scene_number}-regen-{revision:03d}.png"
            )
        else:
            destination = self.output_directory / f"scene{scene_number}.png"
        if cache_path.is_file() and not regenerate:
            try:
                cached = cache_path.read_bytes()
                self.validate_bytes(cached)
            except (OSError, ValueError):
                cache_path.unlink(missing_ok=True)
            else:
                self.last_cache_hit = True
                self._atomic_write(destination, cached)
                return destination
        self.last_cache_hit = False
        image_data = self.generator(prompt, reference_images)
        self.validate_bytes(image_data)
        self._atomic_write(cache_path, image_data)
        self._atomic_write(destination, image_data)
        return destination

    def cache_path(
        self, prompt: str, reference_images: list[Path],
        reference_descriptors: list[str] | None = None,
    ) -> Path:
        """Build a content-sensitive key including provider configuration."""
        reference_digests = []
        for path in reference_images:
            if not path.is_file():
                raise ValueError(f"Reference image is missing: {path.name}")
            reference_digests.append(hashlib.sha256(path.read_bytes()).hexdigest())
        digest = hashlib.sha256(
            (
                self.cache_namespace + "|" + prompt + "|"
                + "|".join(reference_digests) + "|"
                + "|".join(reference_descriptors or [])
            ).encode("utf-8")
        ).hexdigest()
        return self.cache_directory / f"{digest}.png"

    def is_cached(
        self, prompt: str, reference_images: list[Path],
        reference_descriptors: list[str] | None = None,
    ) -> bool:
        path = self.cache_path(prompt, reference_images, reference_descriptors)
        if not path.is_file():
            return False
        try:
            self.validate_bytes(path.read_bytes())
            return True
        except (OSError, ValueError):
            path.unlink(missing_ok=True)
            return False

    def validate_bytes(self, image_data: bytes) -> bool:
        if len(image_data) <= len(PNG_SIGNATURE) or not image_data.startswith(
            PNG_SIGNATURE
        ):
            raise ValueError("Generated image is not a valid PNG payload")
        return True

    def validate(self, path: Path) -> bool:
        return self.validate_bytes(path.read_bytes())

    @staticmethod
    def _atomic_write(path: Path, data: bytes) -> None:
        temporary = path.with_suffix(path.suffix + ".tmp")
        temporary.write_bytes(data)
        temporary.replace(path)

    def cleanup(self) -> None:
        """No runtime resources are held."""
