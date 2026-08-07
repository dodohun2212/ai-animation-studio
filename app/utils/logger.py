"""Central logging with sensitive-value redaction."""

from __future__ import annotations

import logging
from logging.handlers import RotatingFileHandler
from pathlib import Path
import re
from typing import Iterable


LOGGER_NAMESPACE = "ai_animation_studio"
_SECRET_PATTERNS = (
    re.compile(r"(OPENAI_API_KEY\s*[=:]\s*)\S+", re.IGNORECASE),
    re.compile(r"\bsk-[A-Za-z0-9_-]{8,}\b"),
)


class SensitiveDataFilter(logging.Filter):
    """Redact configured secrets and known API-key patterns."""

    def __init__(self, secrets: Iterable[str] = ()) -> None:
        super().__init__()
        self._secrets = tuple(secret for secret in secrets if secret)

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        for secret in self._secrets:
            message = message.replace(secret, "[REDACTED]")
        for pattern in _SECRET_PATTERNS:
            message = pattern.sub(
                lambda match: (
                    f"{match.group(1)}[REDACTED]"
                    if match.lastindex
                    else "[REDACTED]"
                ),
                message,
            )
        record.msg = message
        record.args = ()
        return True


def configure_logging(
    log_directory: Path,
    level: str = "INFO",
    secrets: Iterable[str] = (),
) -> logging.Logger:
    """Configure the application logger once and return it."""
    log_directory.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger(LOGGER_NAMESPACE)
    logger.setLevel(getattr(logging, level.upper(), logging.INFO))
    logger.propagate = False
    for handler in logger.handlers:
        handler.close()
    logger.handlers.clear()

    formatter = logging.Formatter(
        "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
    )
    redaction_filter = SensitiveDataFilter(secrets)

    application_handler = RotatingFileHandler(
        log_directory / "workflow.log",
        maxBytes=2_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    application_handler.setFormatter(formatter)
    application_handler.addFilter(redaction_filter)
    logger.addHandler(application_handler)

    error_handler = RotatingFileHandler(
        log_directory / "error.log",
        maxBytes=2_000_000,
        backupCount=3,
        encoding="utf-8",
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(formatter)
    error_handler.addFilter(redaction_filter)
    logger.addHandler(error_handler)
    return logger


def get_logger(component: str | None = None) -> logging.Logger:
    """Return the root application logger or a component child."""
    if not component:
        return logging.getLogger(LOGGER_NAMESPACE)
    return logging.getLogger(f"{LOGGER_NAMESPACE}.{component}")


def close_logging() -> None:
    """Flush and close application handlers, primarily during shutdown."""
    logger = logging.getLogger(LOGGER_NAMESPACE)
    for handler in logger.handlers[:]:
        handler.flush()
        handler.close()
        logger.removeHandler(handler)
