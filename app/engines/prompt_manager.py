"""Load and render versioned prompt files from the prompts directory."""

from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
from pathlib import Path
from string import Template
from typing import Any


@dataclass(frozen=True, slots=True)
class RenderedPrompt:
    """Rendered prompt plus reproducible identity metadata."""

    name: str
    version: str
    text: str
    digest: str


class PromptManager:
    """Render external UTF-8 templates without engine-to-engine calls."""

    def __init__(self, prompts_root: Path) -> None:
        self.prompts_root = prompts_root.resolve()
        self._templates: dict[str, Path] = {}

    def initialize(self) -> None:
        if not self.prompts_root.is_dir():
            raise ValueError("Prompts directory does not exist")
        self._templates = {
            str(path.relative_to(self.prompts_root).with_suffix("")).replace(
                "\\", "/"
            ): path
            for path in self.prompts_root.rglob("*.txt")
            if path.is_file()
        }

    def render(
        self,
        name: str,
        values: dict[str, Any],
        version: str = "1.0",
    ) -> RenderedPrompt:
        """Strictly substitute a named template and calculate its digest."""
        if name not in self._templates:
            raise KeyError(f"Unknown prompt template: {name}")
        template_text = self._templates[name].read_text(encoding="utf-8")
        safe_values = {
            key: (
                json.dumps(value, ensure_ascii=False, sort_keys=True)
                if isinstance(value, (dict, list))
                else str(value)
            )
            for key, value in values.items()
        }
        try:
            text = Template(template_text).substitute(safe_values).strip()
        except KeyError as exc:
            raise ValueError(f"Missing prompt variable: {exc.args[0]}") from exc
        digest = hashlib.sha256(text.encode("utf-8")).hexdigest()
        return RenderedPrompt(name, version, text, digest)

    def execute(
        self, name: str, values: dict[str, Any], version: str = "1.0"
    ) -> RenderedPrompt:
        return self.render(name, values, version)

    def validate(self, prompt: RenderedPrompt) -> bool:
        if not prompt.text:
            raise ValueError("Rendered prompt is empty")
        if "$" in prompt.text:
            raise ValueError("Rendered prompt has unresolved variables")
        return True

    def cleanup(self) -> None:
        self._templates.clear()
