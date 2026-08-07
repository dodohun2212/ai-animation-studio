"""Recoverable short and long project deletion."""

from pathlib import Path
import json
import tempfile
import unittest

from app.services.project_lifecycle import (
    ProjectLifecycleError,
    ProjectLifecycleService,
)


class ProjectLifecycleTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.projects = self.root / "learning_data" / "projects"
        self.archive = self.root / "output" / "archive" / "deleted_projects"
        self.jobs = self.root / "learning_data" / "api_jobs.json"
        self.service = ProjectLifecycleService(
            self.projects, self.archive, self.jobs
        )

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def create_project(self, project_id: str) -> Path:
        directory = self.projects / project_id
        (directory / "reference_assets").mkdir(parents=True)
        (directory / "project.json").write_text("{}", encoding="utf-8")
        (directory / "reference_assets" / "keep.png").write_bytes(b"image")
        return directory

    def test_archives_even_when_it_is_the_only_project(self) -> None:
        source = self.create_project("only_project")
        destination = self.service.archive_project("only_project")
        self.assertFalse(source.exists())
        self.assertTrue((destination / "project.json").is_file())
        self.assertTrue(
            (destination / "reference_assets" / "keep.png").is_file()
        )

    def test_one_project_archive_does_not_move_another_project(self) -> None:
        first = self.create_project("first")
        second = self.create_project("second")
        self.service.archive_project("first")
        self.assertFalse(first.exists())
        self.assertTrue(second.is_dir())

    def test_running_api_job_blocks_archive(self) -> None:
        source = self.create_project("busy")
        self.jobs.parent.mkdir(parents=True, exist_ok=True)
        self.jobs.write_text(
            json.dumps([{"project_id": "busy", "status": "running"}]),
            encoding="utf-8",
        )
        with self.assertRaisesRegex(ProjectLifecycleError, "진행 중"):
            self.service.archive_project("busy")
        self.assertTrue(source.is_dir())

    def test_missing_and_unsafe_ids_are_rejected(self) -> None:
        with self.assertRaises(ProjectLifecycleError):
            self.service.archive_project("../outside")
        with self.assertRaises(ProjectLifecycleError):
            self.service.archive_project("missing")


if __name__ == "__main__":
    unittest.main()

