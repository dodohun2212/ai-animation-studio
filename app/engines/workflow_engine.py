"""Top-level workflow orchestration and resume boundaries."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from app.core.project_context import ProjectContext, WorkflowState
from app.engines.video_pipeline import MissingVideoClipsError


ContextStage = Callable[[ProjectContext], ProjectContext]
ContextSaver = Callable[[ProjectContext], object]
EventRecorder = Callable[[str, str, dict[str, object] | None], object]


@dataclass(slots=True)
class WorkflowDependencies:
    """Injected stages keep engines independent from each other."""

    story_stage: ContextStage
    image_stage: ContextStage
    video_stage: ContextStage
    save_context: ContextSaver
    record_event: EventRecorder
    finalize_memory: ContextSaver = lambda context: None


class WorkflowEngine:
    """The only component allowed to sequence creative/media stages."""

    def __init__(self, dependencies: WorkflowDependencies) -> None:
        self.dependencies = dependencies
        self.initialized = False

    def initialize(self) -> None:
        self.initialized = True

    def _save_event(
        self,
        context: ProjectContext,
        event: str,
        payload: dict[str, object] | None = None,
    ) -> None:
        self.dependencies.save_context(context)
        self.dependencies.record_event(context.project_id, event, payload)

    def execute(self, context: ProjectContext) -> ProjectContext:
        """Run a new project through the image-review pause."""
        if not self.initialized:
            raise RuntimeError("Workflow Engine is not initialized")
        if context.workflow_state != WorkflowState.INIT:
            raise ValueError("New workflow must start at INIT")
        try:
            context.transition_to(WorkflowState.READY)
            self._save_event(context, "PROJECT_STARTED")
            context.transition_to(WorkflowState.GENERATING_STORY)
            self.dependencies.story_stage(context)
            if len(context.scenes) != 6:
                raise ValueError("Story stage must produce exactly 6 scenes")
            self._save_event(context, "STORY_GENERATED")
            # This legacy orchestration shell has no mapping-review UI of its
            # own. Preserve the real GenerationService checkpoints instead of
            # skipping directly from story generation to image generation.
            context.transition_to(
                WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW
            )
            self._save_event(context, "ASSET_MAPPING_REVIEW_READY")
            context.transition_to(WorkflowState.ASSET_MAPPING_APPROVED)
            self._save_event(context, "ASSET_MAPPING_APPROVED")
            context.transition_to(WorkflowState.GENERATING_IMAGES)
            self.dependencies.image_stage(context)
            if context.workflow_state not in {
                WorkflowState.IMAGES_REVIEW,
                WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
            }:
                raise ValueError(
                    "Image stage must stop at IMAGES_REVIEW or "
                    "WAITING_FOR_VIDEO_CONFIRMATION"
                )
            self._save_event(context, context.workflow_state.value)
            return context
        except Exception as exc:
            if context.workflow_state not in (
                WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
                WorkflowState.FAILED,
                WorkflowState.CANCELLED,
                WorkflowState.COMPLETED,
            ):
                context.errors.append(str(exc))
                context.transition_to(WorkflowState.FAILED)
                self._save_event(context, "PROJECT_FAILED")
            raise

    def resume(self, context: ProjectContext) -> ProjectContext:
        """Resume rendering after all generated videos are approved."""
        if not self.initialized:
            raise RuntimeError("Workflow Engine is not initialized")
        if context.workflow_state != WorkflowState.VIDEOS_APPROVED:
            raise ValueError("Only VIDEOS_APPROVED projects can resume")
        try:
            self.dependencies.video_stage(context)
        except MissingVideoClipsError:
            self._save_event(context, "VIDEOS_APPROVED")
            return context
        if context.workflow_state != WorkflowState.COMPLETED:
            raise ValueError("Video stage did not complete the project")
        self.dependencies.finalize_memory(context)
        self._save_event(context, "PROJECT_COMPLETED")
        return context

    def cancel(self, context: ProjectContext) -> None:
        context.transition_to(WorkflowState.CANCELLED)
        self._save_event(context, "PROJECT_CANCELLED")

    def validate(self, context: ProjectContext) -> bool:
        context.validate()
        return True

    def cleanup(self) -> None:
        self.initialized = False
