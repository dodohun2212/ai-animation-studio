"""Tests for application configuration."""

from pathlib import Path
import tempfile
import unittest

from app.config.config import AppConfig, ConfigurationError


class AppConfigTest(unittest.TestCase):
    """Validate defaults, overrides, and directory preparation."""

    def test_loads_documented_defaults(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(Path(directory), env={})
            self.assertEqual(config.monthly_budget_usd, 10.0)
            self.assertEqual(config.scene_count, 6)
            self.assertEqual(config.target_width, 1080)
            self.assertEqual(config.target_height, 1920)
            self.assertEqual(config.target_fps, 30)
            self.assertEqual(config.runway_model, "gen4_turbo")
            self.assertEqual(config.runway_ratio, "720:1280")
            self.assertEqual(config.runway_duration_seconds, 5)

    def test_environment_overrides_dotenv(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text(
                "MONTHLY_BUDGET=12\nLOG_LEVEL=WARNING\n",
                encoding="utf-8",
            )
            config = AppConfig.load(
                root, env={"MONTHLY_BUDGET": "8.5"}
            )
            self.assertEqual(config.monthly_budget_usd, 8.5)
            self.assertEqual(config.log_level, "WARNING")

    def test_runway_secret_prefers_official_name_with_legacy_fallback(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            legacy = AppConfig.load(
                root, env={"RUNWAY_API_SECRET": "legacy-secret"}
            )
            official = AppConfig.load(
                root,
                env={
                    "RUNWAY_API_SECRET": "legacy-secret",
                    "RUNWAYML_API_SECRET": "official-secret",
                },
            )
            self.assertEqual(legacy.runway_api_secret, "legacy-secret")
            self.assertEqual(official.runway_api_secret, "official-secret")

    def test_rejects_invalid_budget(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(ConfigurationError):
                AppConfig.load(
                    Path(directory), env={"MONTHLY_BUDGET": "0"}
                )

    def test_creates_documented_runtime_directories(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(Path(directory), env={})
            config.ensure_directories()
            self.assertTrue((Path(directory) / "videos/runway").is_dir())
            self.assertTrue((Path(directory) / "output/reels").is_dir())


if __name__ == "__main__":
    unittest.main()

