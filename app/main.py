"""Command-line entry point for local AI Animation Studio workflows."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
import json
from pathlib import Path
import shutil
import sys
from typing import Sequence

from app.config.config import AppConfig, ConfigurationError
from app.core.project_context import WorkflowState
from app.services.memory_manager import MemoryManager
from app.utils.logger import close_logging, configure_logging, get_logger


@dataclass(frozen=True, slots=True)
class EnvironmentReport:
    """User-facing readiness report with no secret values."""

    python_supported: bool
    ffmpeg_installed: bool
    ffprobe_installed: bool
    api_key_configured: bool
    project_root: str

    @property
    def ready_for_generation(self) -> bool:
        return (
            self.python_supported
            and self.ffmpeg_installed
            and self.ffprobe_installed
            and self.api_key_configured
        )


def inspect_environment(config: AppConfig) -> EnvironmentReport:
    """Inspect local dependencies without invoking external APIs."""
    return EnvironmentReport(
        python_supported=sys.version_info >= (3, 12),
        ffmpeg_installed=shutil.which(config.ffmpeg_binary) is not None,
        ffprobe_installed=shutil.which(config.ffprobe_binary) is not None,
        api_key_configured=bool(config.openai_api_key),
        project_root=str(config.project_root),
    )


def build_parser() -> argparse.ArgumentParser:
    """Create the stable local CLI."""
    parser = argparse.ArgumentParser(prog="ai-animation-studio")
    subparsers = parser.add_subparsers(dest="command")
    subparsers.add_parser("check", help="환경과 필수 도구를 점검합니다.")
    list_parser = subparsers.add_parser(
        "list", help="저장된 프로젝트를 조회합니다."
    )
    list_parser.add_argument(
        "--waiting",
        action="store_true",
        help="영상 생성 확인을 기다리는 프로젝트만 표시합니다.",
    )
    return parser


def run(
    arguments: Sequence[str] | None = None,
    *,
    project_root: Path | None = None,
) -> int:
    """Run a non-destructive CLI command and return an exit status."""
    parser = build_parser()
    options = parser.parse_args(arguments)
    if options.command is None:
        parser.print_help()
        return 0
    try:
        # Provider credentials for an app run come only from this project's
        # .env. Parent-process variables must not create a false connection.
        config = AppConfig.load(project_root=project_root, env={})
        config.ensure_directories()
        logger = configure_logging(
            config.project_root / "logs",
            config.log_level,
            secrets=(config.openai_api_key or "",),
        )
        logger.info("Application command started: %s", options.command)
        if options.command == "check":
            report = inspect_environment(config)
            print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
            return 0 if report.ready_for_generation else 1
        if options.command == "list":
            memory = MemoryManager(
                config.project_root / "learning_data" / "projects"
            )
            state = (
                WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION
                if options.waiting
                else None
            )
            projects = memory.list_projects(state)
            summary = [
                {
                    "project_id": item.project_id,
                    "topic": item.topic,
                    "workflow_state": item.workflow_state.value,
                    "updated_at": item.updated_at,
                }
                for item in projects
            ]
            print(json.dumps(summary, ensure_ascii=False, indent=2))
            return 0
        return 2
    except ConfigurationError as exc:
        get_logger("main").error("Configuration failed: %s", exc)
        print(f"설정 오류: {exc}", file=sys.stderr)
        return 2
    finally:
        close_logging()


def main() -> None:
    """Console-script compatible entry point."""
    raise SystemExit(run())


if __name__ == "__main__":
    main()
