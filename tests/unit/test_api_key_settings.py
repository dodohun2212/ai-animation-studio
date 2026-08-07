"""Local API-key persistence without provider calls."""

from pathlib import Path
import tempfile
import unittest

from app.config.config import AppConfig
from app.services.api_key_settings import (
    APIKeySettingsError,
    masked_api_key,
    save_openai_api_key,
    save_runway_api_secret,
)


class APIKeySettingsTest(unittest.TestCase):
    def test_updates_only_key_and_preserves_other_env_settings(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            env_path = root / ".env"
            env_path.write_text(
                "# local settings\nMONTHLY_BUDGET=7\nOPENAI_API_KEY=old-value\n"
                "MAX_RETRIES=1\n",
                encoding="utf-8",
            )
            key = "sk-test-abcdefghijklmnopqrstuvwxyz"
            save_openai_api_key(root, key)
            text = env_path.read_text(encoding="utf-8")
            self.assertIn("MONTHLY_BUDGET=7", text)
            self.assertIn("MAX_RETRIES=1", text)
            self.assertEqual(text.count("OPENAI_API_KEY="), 1)
            self.assertEqual(AppConfig.load(root, env={}).openai_api_key, key)

    def test_creates_dotenv_atomically_when_missing(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            save_openai_api_key(root, "sk-project-abcdefghijklmnopqrstuvwxyz")
            self.assertTrue((root / ".env").is_file())
            self.assertFalse((root / ".env.tmp").exists())

    def test_invalid_key_is_not_written(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaises(APIKeySettingsError):
                save_openai_api_key(root, "short key")
            self.assertFalse((root / ".env").exists())

    def test_runway_secret_migrates_legacy_name_to_official_name(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / ".env").write_text(
                "RUNWAY_API_SECRET=legacy-value\nMONTHLY_BUDGET=7\n",
                encoding="utf-8",
            )
            secret = "key_abcdefghijklmnopqrstuvwxyz"
            save_runway_api_secret(root, secret)
            text = (root / ".env").read_text(encoding="utf-8")
            self.assertNotIn("RUNWAY_API_SECRET=", text)
            self.assertEqual(text.count("RUNWAYML_API_SECRET="), 1)
            self.assertEqual(
                AppConfig.load(root, env={}).runway_api_secret, secret
            )

    def test_mask_never_exposes_full_key(self) -> None:
        key = "sk-test-abcdefghijklmnopqrstuvwxyz"
        masked = masked_api_key(key)
        self.assertNotEqual(masked, key)
        self.assertNotIn("test-abcdefghijklmnop", masked)
        self.assertTrue(masked.endswith(key[-4:]))
        self.assertEqual(masked_api_key(None), "미연결")

if __name__ == "__main__":
    unittest.main()

