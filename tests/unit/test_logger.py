"""Tests for safe logging."""

from pathlib import Path
import tempfile
import unittest

from app.utils.logger import close_logging, configure_logging, get_logger


class LoggerTest(unittest.TestCase):
    """Verify file output, component names, and secret redaction."""

    def test_writes_utf8_log_and_redacts_secret(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            log_path = Path(directory)
            secret = "sk-super-secret-value"
            logger = configure_logging(
                log_path, level="INFO", secrets=(secret,)
            )
            get_logger("budget").info("한국어 key=%s", secret)
            for handler in logger.handlers:
                handler.flush()
            content = (log_path / "workflow.log").read_text(
                encoding="utf-8"
            )
            self.assertIn("한국어", content)
            self.assertIn("[REDACTED]", content)
            self.assertNotIn(secret, content)
            self.assertIn("ai_animation_studio.budget", content)
            close_logging()

    def test_error_is_written_to_error_log(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            log_path = Path(directory)
            logger = configure_logging(log_path)
            logger.error("render failed")
            for handler in logger.handlers:
                handler.flush()
            self.assertIn(
                "render failed",
                (log_path / "error.log").read_text(encoding="utf-8"),
            )
            close_logging()


if __name__ == "__main__":
    unittest.main()

