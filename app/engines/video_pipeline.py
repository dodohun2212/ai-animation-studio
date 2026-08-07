"""Validate approved generated scene videos and coordinate rendering."""

from __future__ import annotations

from pathlib import Path
from typing import Callable

from app.core.project_context import ProjectContext, WorkflowState
from app.services.api_job_manager import APIJobManager


ClipProbe = Callable[[Path], dict[str, object]]
Renderer = Callable[[list[Path], Path], Path]
ContextSaver = Callable[[ProjectContext], object]


class MissingVideoClipsError(FileNotFoundError):
    """Contain every missing generated scene-video path."""

    def __init__(self, missing: list[Path]) -> None:
        self.missing = missing
        super().__init__(
            "Missing scene videos: " + ", ".join(path.name for path in missing)
        )


class VideoPipeline:
    """Validate and merge six approved Runway scene videos."""

    def __init__(
        self,
        video_directory: Path,
        output_path: Path,
        probe: ClipProbe,
        renderer: Renderer,
        context_saver: ContextSaver,
        job_manager: APIJobManager | None = None,
    ) -> None:
        self.video_directory = video_directory
        self.output_path = output_path
        self.probe = probe
        self.renderer = renderer
        self.context_saver = context_saver
        self.job_manager = job_manager

    def initialize(self) -> None:
        self.video_directory.mkdir(parents=True, exist_ok=True)
        self.output_path.parent.mkdir(parents=True, exist_ok=True)

    def expected_clips(self) -> list[Path]:
        return [
            self.video_directory / f"scene{number}.mp4"
            for number in range(1, 7)
        ]

    def validate_clips(self) -> list[Path]:
        clips = self.expected_clips()
        missing = [path for path in clips if not path.is_file() or path.stat().st_size == 0]
        if missing:
            raise MissingVideoClipsError(missing)
        for path in clips:
            metadata = self.probe(path)
            if not metadata.get("has_video"):
                raise ValueError(f"No video stream in {path.name}")
            if float(metadata.get("duration", 0)) <= 0:
                raise ValueError(f"Invalid duration in {path.name}")
        return clips

    def execute(self, context: ProjectContext) -> ProjectContext:
        if context.workflow_state != WorkflowState.VIDEOS_APPROVED:
            raise ValueError("Video Pipeline requires VIDEOS_APPROVED state")
        try:
            clips = self.validate_clips()
        except MissingVideoClipsError:
            self.context_saver(context)
            raise
        job = None
        if self.job_manager is not None:
            job = self.job_manager.begin(
                project_id=context.project_id,
                project_type=context.project_type,
                operation="ffmpeg_render",
                resource_key=f"{context.project_id}:ffmpeg_render",
                expected_api_calls=0,
            )
        context.generated_video_paths = [str(path) for path in clips]
        context.transition_to(WorkflowState.RENDERING)
        self.context_saver(context)
        try:
            result = self.renderer(clips, self.output_path)
        except Exception as exc:
            context.errors.append(str(exc))
            context.transition_to(WorkflowState.FAILED)
            self.context_saver(context)
            if job is not None:
                self.job_manager.finish(
                    job, "failed", error_category=type(exc).__name__
                )
            raise
        if not result.is_file() or result.stat().st_size == 0:
            context.errors.append("Rendered output is missing or empty")
            context.transition_to(WorkflowState.FAILED)
            self.context_saver(context)
            if job is not None:
                self.job_manager.finish(
                    job, "failed", error_category="missing_rendered_output"
                )
            raise ValueError("Rendered output is missing or empty")
        context.final_video_path = str(result)
        context.transition_to(WorkflowState.COMPLETED)
        self.context_saver(context)
        if job is not None:
            self.job_manager.finish(job, "completed")
        return context

    def validate(self, context: ProjectContext) -> bool:
        return (
            context.workflow_state == WorkflowState.COMPLETED
            and bool(context.final_video_path)
            and Path(context.final_video_path).is_file()
        )

    def cleanup(self) -> None:
        """Release no external process; generation is handled elsewhere."""
