"""Reference Assets project selection without opening Tkinter."""

from pathlib import Path
import json
import shutil
import tempfile
import unittest

from app.config.config import AppConfig
from app.long_story.service import LongStoryService
from app.services.reference_project_catalog import (
    ReferenceScreenState,
    create_empty_long_project,
    create_empty_short_project,
    list_reference_projects,
    resolve_reference_project,
)


class ReferenceProjectCatalogTest(unittest.TestCase):
    def setUp(self) -> None:
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        shutil.copytree(Path.cwd() / "prompts", self.root / "prompts")
        self.config = AppConfig.load(self.root, env={})
        self.config.ensure_directories()
        self.projects = self.root / "learning_data" / "projects"

    def tearDown(self) -> None:
        self.temporary.cleanup()

    def test_no_active_project_has_disabled_project_actions(self) -> None:
        state = ReferenceScreenState()
        self.assertIsNone(state.active_project)
        self.assertFalse(state.project_actions_enabled)
        self.assertEqual(list_reference_projects(self.projects), [])

    def test_new_short_project_is_immediately_selectable(self) -> None:
        option = create_empty_short_project(self.projects, "빈 단편")
        state = ReferenceScreenState(option)
        self.assertTrue(state.project_actions_enabled)
        self.assertEqual(
            resolve_reference_project(self.projects, option.project_id), option
        )

    def test_new_long_project_is_immediately_selectable(self) -> None:
        option = create_empty_long_project(
            LongStoryService(self.config), "긴 이야기", 12
        )
        self.assertEqual(option.project_type, "long_story_project")
        self.assertEqual(
            resolve_reference_project(self.projects, option.project_id), option
        )

    def test_project_switch_replaces_identity_without_mixing(self) -> None:
        first = create_empty_short_project(self.projects, "첫 프로젝트")
        second = create_empty_short_project(self.projects, "둘째 프로젝트")
        state = ReferenceScreenState(first)
        state.active_project = second
        self.assertEqual(state.active_project.project_id, second.project_id)
        self.assertNotEqual(state.active_project.project_id, first.project_id)
        self.assertEqual(len(list_reference_projects(self.projects)), 2)

    def test_missing_and_damaged_projects_are_not_resolved_or_created(self) -> None:
        missing = self.projects / "missing"
        self.assertIsNone(resolve_reference_project(self.projects, "missing"))
        self.assertFalse(missing.exists())
        damaged = self.projects / "damaged"
        damaged.mkdir()
        (damaged / "project.json").write_text("{bad", encoding="utf-8")
        self.assertIsNone(resolve_reference_project(self.projects, "damaged"))
        self.assertTrue(damaged.is_dir())

    def test_mismatched_stored_project_id_is_rejected(self) -> None:
        directory = self.projects / "expected"
        directory.mkdir()
        (directory / "project.json").write_text(
            json.dumps({
                "project_id": "different",
                "topic": "mismatch",
                "workflow_state": "INIT",
            }),
            encoding="utf-8",
        )
        self.assertIsNone(resolve_reference_project(self.projects, "expected"))


if __name__ == "__main__":
    unittest.main()

