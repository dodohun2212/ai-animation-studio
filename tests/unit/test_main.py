"""Tests for the local CLI entry point."""

from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
import tempfile
import unittest

from app.main import build_parser, run


class MainTest(unittest.TestCase):
    def test_parser_supports_documented_commands(self) -> None:
        options = build_parser().parse_args(["list", "--waiting"])
        self.assertEqual(options.command, "list")
        self.assertTrue(options.waiting)

    def test_list_empty_projects_succeeds(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            output = StringIO()
            with redirect_stdout(output):
                result = run(["list"], project_root=Path(directory))
            self.assertEqual(result, 0)
            self.assertEqual(output.getvalue().strip(), "[]")


if __name__ == "__main__":
    unittest.main()

