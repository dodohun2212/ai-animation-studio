"""Environment-backed application configuration."""

from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path


class ConfigurationError(ValueError):
    """Raised when application configuration is invalid."""


def _load_env_file(path: Path) -> dict[str, str]:
    """Read a simple UTF-8 dotenv file without external dependencies."""
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line_number, raw_line in enumerate(
        path.read_text(encoding="utf-8").splitlines(), start=1
    ):
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            raise ConfigurationError(
                f"Invalid environment entry at {path}:{line_number}"
            )
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("\"'")
    return values


def _read_float(
    values: dict[str, str], key: str, default: float
) -> float:
    try:
        return float(values.get(key, default))
    except (TypeError, ValueError) as exc:
        raise ConfigurationError(f"{key} must be a number") from exc


def _read_int(values: dict[str, str], key: str, default: int) -> int:
    try:
        return int(values.get(key, default))
    except (TypeError, ValueError) as exc:
        raise ConfigurationError(f"{key} must be an integer") from exc


@dataclass(frozen=True, slots=True)
class AppConfig:
    """Validated settings and project-relative paths."""

    project_root: Path
    openai_api_key: str | None
    monthly_budget_usd: float = 10.0
    budget_warning_threshold: float = 0.8
    log_level: str = "INFO"
    output_directory: Path = Path("output")
    scene_count: int = 6
    target_width: int = 1080
    target_height: int = 1920
    target_fps: int = 30
    api_timeout_seconds: float = 60.0
    image_api_timeout_seconds: float = 300.0
    max_retries: int = 2
    ffmpeg_binary: str = "ffmpeg"
    ffprobe_binary: str = "ffprobe"
    face_check_enabled: bool = False
    face_pass_threshold: float = 0.60
    face_warning_threshold: float = 0.40
    face_model_name: str = "buffalo_l"
    face_model_directory: Path | None = None
    openai_story_model: str = "gpt-5.6-luna"
    openai_image_model: str = "gpt-image-2"
    openai_image_size: str = "1024x1536"
    openai_image_quality: str = "medium"
    openai_image_format: str = "png"
    runway_api_secret: str | None = None
    runway_model: str = "gen4_turbo"
    runway_ratio: str = "720:1280"
    runway_duration_seconds: int = 5
    runway_monthly_budget_usd: float = 10.0
    runway_request_timeout_seconds: float = 60.0
    runway_poll_interval_seconds: float = 5.0
    runway_task_timeout_seconds: float = 900.0
    app_max_image_calls_per_job: int = 6
    app_max_story_calls_per_job: int = 1
    app_max_plan_calls_per_job: int = 1
    app_max_summary_calls_per_job: int = 1
    app_max_regen_calls_per_scene: int = 3
    app_daily_api_call_limit: int = 50
    app_max_concurrent_api_jobs: int = 1
    app_confirm_before_paid_run: bool = True
    app_max_long_project_episodes: int = 60

    @classmethod
    def load(
        cls,
        project_root: Path | None = None,
        env: dict[str, str] | None = None,
    ) -> "AppConfig":
        """Load `.env`, then overlay process or supplied environment values."""
        root = (project_root or Path.cwd()).resolve()
        values = _load_env_file(root / ".env")
        values.update(dict(os.environ if env is None else env))
        output_value = values.get("OUTPUT_DIRECTORY", "output")
        output_path = Path(output_value)
        if not output_path.is_absolute():
            output_path = root / output_path

        config = cls(
            project_root=root,
            openai_api_key=values.get("OPENAI_API_KEY") or None,
            monthly_budget_usd=_read_float(
                values, "MONTHLY_BUDGET", 10.0
            ),
            budget_warning_threshold=_read_float(
                values, "BUDGET_WARNING_THRESHOLD", 0.8
            ),
            log_level=values.get("LOG_LEVEL", "INFO").upper(),
            output_directory=output_path.resolve(),
            api_timeout_seconds=_read_float(
                values, "API_TIMEOUT_SECONDS", 60.0
            ),
            image_api_timeout_seconds=_read_float(
                values, "IMAGE_API_TIMEOUT_SECONDS", 300.0
            ),
            max_retries=_read_int(values, "MAX_RETRIES", 2),
            ffmpeg_binary=values.get("FFMPEG_BINARY", "ffmpeg"),
            ffprobe_binary=values.get("FFPROBE_BINARY", "ffprobe"),
            face_check_enabled=values.get(
                "FACE_CHECK_ENABLED", "false"
            ).strip().lower() in {"1", "true", "yes", "on"},
            face_pass_threshold=_read_float(
                values, "FACE_PASS_THRESHOLD", 0.60
            ),
            face_warning_threshold=_read_float(
                values, "FACE_WARNING_THRESHOLD", 0.40
            ),
            face_model_name=values.get("FACE_MODEL_NAME", "buffalo_l"),
            face_model_directory=(
                Path(values["FACE_MODEL_DIRECTORY"]).expanduser().resolve()
                if values.get("FACE_MODEL_DIRECTORY")
                else None
            ),
            openai_story_model=values.get(
                "OPENAI_STORY_MODEL", "gpt-5.6-luna"
            ),
            openai_image_model=values.get(
                "OPENAI_IMAGE_MODEL", "gpt-image-2"
            ),
            openai_image_size=values.get(
                "OPENAI_IMAGE_SIZE", "1024x1536"
            ),
            openai_image_quality=values.get(
                "OPENAI_IMAGE_QUALITY", "medium"
            ),
            openai_image_format=values.get(
                "OPENAI_IMAGE_FORMAT", "png"
            ),
            runway_api_secret=(
                values.get("RUNWAYML_API_SECRET")
                or values.get("RUNWAY_API_SECRET")
                or None
            ),
            runway_model=values.get("RUNWAY_MODEL", "gen4_turbo"),
            runway_ratio=values.get("RUNWAY_RATIO", "720:1280"),
            runway_duration_seconds=_read_int(
                values, "RUNWAY_DURATION_SECONDS", 5
            ),
            runway_monthly_budget_usd=_read_float(
                values, "RUNWAY_MONTHLY_BUDGET", 10.0
            ),
            runway_request_timeout_seconds=_read_float(
                values, "RUNWAY_REQUEST_TIMEOUT_SECONDS", 60.0
            ),
            runway_poll_interval_seconds=_read_float(
                values, "RUNWAY_POLL_INTERVAL_SECONDS", 5.0
            ),
            runway_task_timeout_seconds=_read_float(
                values, "RUNWAY_TASK_TIMEOUT_SECONDS", 900.0
            ),
            app_max_image_calls_per_job=_read_int(
                values, "APP_MAX_IMAGE_CALLS_PER_JOB", 6
            ),
            app_max_story_calls_per_job=_read_int(
                values, "APP_MAX_STORY_CALLS_PER_JOB", 1
            ),
            app_max_plan_calls_per_job=_read_int(
                values, "APP_MAX_PLAN_CALLS_PER_JOB", 1
            ),
            app_max_summary_calls_per_job=_read_int(
                values, "APP_MAX_SUMMARY_CALLS_PER_JOB", 1
            ),
            app_max_regen_calls_per_scene=_read_int(
                values, "APP_MAX_REGEN_CALLS_PER_SCENE", 3
            ),
            app_daily_api_call_limit=_read_int(
                values, "APP_DAILY_API_CALL_LIMIT", 50
            ),
            app_max_concurrent_api_jobs=_read_int(
                values, "APP_MAX_CONCURRENT_API_JOBS", 1
            ),
            app_confirm_before_paid_run=values.get(
                "APP_CONFIRM_BEFORE_PAID_RUN", "true"
            ).strip().lower() in {"1", "true", "yes", "on"},
            app_max_long_project_episodes=_read_int(
                values, "APP_MAX_LONG_PROJECT_EPISODES", 60
            ),
        )
        config.validate()
        return config

    def validate(self, require_api_key: bool = False) -> None:
        """Validate ranges and optionally require the OpenAI key."""
        if require_api_key and not self.openai_api_key:
            raise ConfigurationError("OPENAI_API_KEY is required")
        if self.monthly_budget_usd <= 0:
            raise ConfigurationError("MONTHLY_BUDGET must be positive")
        if not 0 < self.budget_warning_threshold <= 1:
            raise ConfigurationError(
                "BUDGET_WARNING_THRESHOLD must be between 0 and 1"
            )
        if self.max_retries < 0:
            raise ConfigurationError("MAX_RETRIES cannot be negative")
        if self.api_timeout_seconds <= 0 or self.image_api_timeout_seconds <= 0:
            raise ConfigurationError("API timeouts must be positive")
        if self.scene_count != 6:
            raise ConfigurationError("The documented workflow requires 6 scenes")
        if not (
            -1
            <= self.face_warning_threshold
            <= self.face_pass_threshold
            <= 1
        ):
            raise ConfigurationError("Invalid face cosine similarity thresholds")
        if self.openai_image_size not in {
            "1024x1024", "1024x1536", "1536x1024", "auto"
        }:
            raise ConfigurationError("Unsupported OPENAI_IMAGE_SIZE")
        if self.openai_image_quality not in {"low", "medium", "high", "auto"}:
            raise ConfigurationError("Unsupported OPENAI_IMAGE_QUALITY")
        if self.openai_image_format != "png":
            raise ConfigurationError("Only PNG output is supported by ImageEngine")
        if self.runway_model != "gen4_turbo":
            raise ConfigurationError("RUNWAY_MODEL must be gen4_turbo")
        if self.runway_ratio not in {"720:1280", "1280:720"}:
            raise ConfigurationError(
                "RUNWAY_RATIO must be 720:1280 or 1280:720"
            )
        if not 2 <= self.runway_duration_seconds <= 10:
            raise ConfigurationError(
                "RUNWAY_DURATION_SECONDS must be between 2 and 10"
            )
        if self.runway_monthly_budget_usd <= 0:
            raise ConfigurationError(
                "RUNWAY_MONTHLY_BUDGET must be positive"
            )
        if min(
            self.runway_request_timeout_seconds,
            self.runway_poll_interval_seconds,
            self.runway_task_timeout_seconds,
        ) <= 0:
            raise ConfigurationError("Runway timeouts must be positive")
        if min(
            self.app_max_image_calls_per_job,
            self.app_max_story_calls_per_job,
            self.app_max_plan_calls_per_job,
            self.app_max_summary_calls_per_job,
            self.app_max_regen_calls_per_scene,
            self.app_daily_api_call_limit,
            self.app_max_concurrent_api_jobs,
            self.app_max_long_project_episodes,
        ) <= 0:
            raise ConfigurationError("API call limits must be positive")
        if self.app_max_long_project_episodes > 365:
            raise ConfigurationError(
                "APP_MAX_LONG_PROJECT_EPISODES cannot exceed 365"
            )

    def ensure_directories(self) -> None:
        """Create only the runtime directories defined by the documentation."""
        relative_paths = (
            "cache",
            "logs",
            "images/generated",
            "images/temp",
            "videos/runway",
            "videos/continuity",
            "videos/final",
            "videos/temp",
            "output/reels",
            "output/shorts",
            "output/thumbnails",
            "output/archive",
            "learning_data/projects",
            "learning_data/style_profile",
            "learning_data/lore",
        )
        for relative_path in relative_paths:
            (self.project_root / relative_path).mkdir(
                parents=True, exist_ok=True
            )
