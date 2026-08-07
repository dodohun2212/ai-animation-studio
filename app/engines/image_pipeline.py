"""Six-scene image pipeline ending at explicit user image review."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from app.core.project_context import ProjectContext, WorkflowState


PromptBuilder = Callable[[dict[str, object]], tuple[str, str]]
SceneImageGenerator = Callable[[int, str], Path]
ReferenceImageGenerator = Callable[[int, str, list[Path]], Path]
ReferenceSelector = Callable[[int], tuple[list[Path], list[str], list[str]]]
ContextSaver = Callable[[ProjectContext], object]


class ImagePipeline:
    """Coordinate scene callbacks without directly depending on engines."""

    def __init__(
        self,
        prompt_builder: PromptBuilder,
        image_generator: SceneImageGenerator,
        context_saver: ContextSaver,
        motion_prompt_path: Path,
        *,
        reference_selector: ReferenceSelector | None = None,
        reference_image_generator: ReferenceImageGenerator | None = None,
        checkpoint_saver: ContextSaver | None = None,
    ) -> None:
        self.prompt_builder = prompt_builder
        self.image_generator = image_generator
        self.context_saver = context_saver
        self.motion_prompt_path = motion_prompt_path
        self.reference_selector = reference_selector
        self.reference_image_generator = reference_image_generator
        self.checkpoint_saver = checkpoint_saver

    def initialize(self) -> None:
        self.motion_prompt_path.parent.mkdir(parents=True, exist_ok=True)

    def execute(self, context: ProjectContext) -> ProjectContext:
        if context.workflow_state != WorkflowState.GENERATING_IMAGES:
            raise ValueError("Image Pipeline requires GENERATING_IMAGES state")
        context.validate(require_complete_scenes=True)
        for expected_number, scene in enumerate(context.scenes, start=1):
            if scene.get("number") != expected_number:
                raise ValueError("Scenes must be ordered 1 through 6")
            image_prompt, motion_prompt = self.prompt_builder(scene)
            reference_paths: list[Path] = []
            reference_ids: list[str] = []
            warnings: list[str] = []
            if self.reference_selector is not None:
                reference_paths, reference_ids, warnings = self.reference_selector(
                    expected_number
                )
            existing_index = expected_number - 1
            if (
                existing_index < len(context.image_prompts)
                and context.image_prompts[existing_index] == image_prompt
                and existing_index < len(context.generated_images)
                and _valid_png(Path(context.generated_images[existing_index]))
            ):
                continue
            if reference_paths and self.reference_image_generator is not None:
                image_path = self.reference_image_generator(
                    expected_number, image_prompt, reference_paths
                )
            else:
                image_path = self.image_generator(expected_number, image_prompt)
                if reference_paths and self.reference_image_generator is None:
                    warnings.append(
                        "Image provider does not accept Reference Assets; "
                        "text-only generation was used"
                    )
            _set_slot(context.image_prompts, existing_index, image_prompt)
            _set_slot(context.motion_prompts, existing_index, motion_prompt)
            _set_slot(context.generated_images, existing_index, str(image_path))
            _set_slot(
                context.image_generation_records, existing_index, {
                    "scene_number": expected_number,
                    "reference_asset_ids": reference_ids,
                    "reference_paths": [str(path) for path in reference_paths],
                    "warnings": warnings,
                    "checkpoint": "completed",
                },
            )
            context.warnings.extend(warnings)
            if self.checkpoint_saver is not None:
                self.checkpoint_saver(context)
        self.validate(context)
        self.motion_prompt_path.write_text(
            "\n\n".join(
                f"Scene {number}\n{prompt}"
                for number, prompt in enumerate(
                    context.motion_prompts, start=1
                )
            ),
            encoding="utf-8",
        )
        context.transition_to(WorkflowState.IMAGES_READY)
        self.context_saver(context)
        context.transition_to(WorkflowState.IMAGES_REVIEW)
        self.context_saver(context)
        return context

    def validate(self, context: ProjectContext) -> bool:
        if not all(
            len(items) == 6
            for items in (
                context.image_prompts,
                context.motion_prompts,
                context.generated_images,
            )
        ):
            raise ValueError("Image Pipeline requires six complete scene results")
        if not all(Path(path).is_file() for path in context.generated_images):
            raise ValueError("One or more generated images are missing")
        return True

    def cleanup(self) -> None:
        """No automatic video processing occurs here."""


def _set_slot(values: list, index: int, value: object) -> None:
    while len(values) <= index:
        values.append("")
    values[index] = value


def _valid_png(path: Path) -> bool:
    try:
        return path.is_file() and path.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
    except OSError:
        return False
