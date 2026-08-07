"""Free, restart-safe short-project image approval state transitions."""

from __future__ import annotations

from pathlib import Path

from app.core.project_context import ProjectContext, WorkflowState
from app.services.generated_image_manager import GeneratedImageManager
from app.services.asset_library import AssetLibrary
from app.services.memory_manager import MemoryManager


class ProjectImageReviewService:
    """Approve generated images without requiring an API key or provider."""

    def __init__(self, projects_root: Path) -> None:
        self.memory = MemoryManager(projects_root)

    def approve_scene(
        self, context: ProjectContext, scene_number: int
    ) -> ProjectContext:
        if context.workflow_state != WorkflowState.IMAGES_REVIEW:
            raise ValueError("Project is not in image review")
        if scene_number not in range(1, 7):
            raise ValueError("scene_number must be between 1 and 6")
        path = Path(context.generated_images[scene_number - 1])
        manager = GeneratedImageManager(
            self.memory.project_directory(context.project_id)
        )
        manager.set_status(scene_number, path, "approved")
        library = AssetLibrary(self.memory.projects_directory.parent)
        manager.sync_library_status(
            scene_number,
            library,
            "approved",
        )
        manager.sync_generated_project_folder_approval(library)
        approved = {
            item.scene_number for item in manager.load_all()
            if item.status == "approved"
        }
        if approved == set(range(1, 7)):
            context.transition_to(
                WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION
            )
            self.memory.append_event(context.project_id, "IMAGES_APPROVED")
        self.memory.save(context)
        return context
