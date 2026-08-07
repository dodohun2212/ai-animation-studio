"""Tests for JSON project persistence."""

from pathlib import Path
import tempfile
import unittest

from app.core.project_context import ProjectContext, WorkflowState
from app.services.memory_manager import MemoryError, MemoryManager


class MemoryManagerTest(unittest.TestCase):
    """Verify save, resume, filtering, and corruption handling."""

    def test_saves_and_resumes_waiting_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = MemoryManager(Path(directory) / "projects")
            context = ProjectContext(
                "project_0001",
                "topic",
                workflow_state=WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
            )
            manager.save(context)
            resumed = manager.load("project_0001")
            self.assertEqual(
                resumed.workflow_state, WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION
            )
            self.assertEqual(
                manager.list_projects(WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION)[0],
                resumed,
            )

    def test_rejects_corrupt_json(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = MemoryManager(Path(directory) / "projects")
            path = manager.project_directory("project_0001")
            path.mkdir(parents=True)
            (path / "project.json").write_text("{bad", encoding="utf-8")
            with self.assertRaises(MemoryError):
                manager.load("project_0001")

    def test_rejects_unsafe_project_id(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            manager = MemoryManager(Path(directory))
            with self.assertRaises(MemoryError):
                manager.project_directory("../outside")


if __name__ == "__main__":
    unittest.main()

