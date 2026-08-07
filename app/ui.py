"""Cinematic Tkinter production studio for AI Animation Studio."""

from __future__ import annotations

from dataclasses import asdict, dataclass, replace
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import threading
import time
import tkinter as tk
from tkinter import filedialog, messagebox, simpledialog, ttk
from typing import Callable
import unicodedata
from uuid import uuid4

from app.config.config import AppConfig, ConfigurationError
from app.core.project_context import ProjectContext, WorkflowState
from app.engines.ffmpeg_engine import FFmpegEngine, FFmpegError
from app.engines.video_pipeline import VideoPipeline
from app.main import EnvironmentReport, inspect_environment
from app.services.memory_manager import MemoryManager
from app.services.api_job_manager import APIJobManager
from app.services.budget_manager import BudgetManager
from app.services.project_lifecycle import (
    ProjectLifecycleError,
    ProjectLifecycleService,
)
from app.services.api_key_settings import (
    APIKeySettingsError,
    masked_api_key,
    save_openai_api_key,
    save_runway_api_secret,
)
from app.services.generated_image_manager import GeneratedImageManager
from app.services.generation_service import (
    build_project_character_cast,
    describe_character_cast,
    describe_story_assets,
    describe_scene_reference_assets,
    GenerationService,
    format_scene_composition,
    render_short_story_prompt,
    resolve_named_character_asset,
    short_scene_continuity_option,
    user_selected_short_scene_link,
    STORY_ASSET_TYPE_LABELS,
)
from app.engines.prompt_manager import PromptManager
from app.services.image_review_service import ProjectImageReviewService
from app.services.video_generation_service import (
    VideoGenerationService,
    VideoGenerationStopped,
    runway_ratio_for_project,
)
from app.services.asset_library import (
    CHARACTER_REFERENCE_ROLES,
    AssetLibrary,
    CharacterReferenceImage,
    LibraryAsset,
)
from app.services.project_asset_mapping import (
    ProjectAssetMappingStore,
    describe_reference_selection,
)
from app.services.reference_migration import LegacyReferenceMigrator
from app.services.face_consistency import (
    FaceConsistencyService,
    InsightFaceBackend,
)
from app.services.reference_asset_manager import (
    EpisodeScope,
    ProjectReferenceManager,
    ReferenceAssetError,
    SceneScope,
    validate_image_file,
)
from app.services.reference_project_catalog import (
    ReferenceProjectOption,
    ReferenceScreenState,
    create_empty_long_project,
    create_empty_short_project,
    list_reference_projects,
    resolve_reference_project,
)
from app.long_story.bible_manager import BibleCollectionManager
from app.long_story.models import ContinuityMemory, LongProject, StoryBible
from app.long_story.service import LongStoryService
from app.long_story.store import LongStoryStore
from app.long_story.ui_support import (
    STATE_PROGRESS,
    context_length,
    dashboard_metrics,
    effective_reference_groups,
    filter_episodes,
    filter_references,
    parse_scope,
    reference_scope_label,
    reference_type_label,
)
from app.utils.logger import close_logging, configure_logging, get_logger


def story_prompt_submission_error(prompt: str, api_key: str | None) -> str:
    """Return the blocking reason for a Story preview submission."""
    if not prompt.strip():
        return "Story Prompt가 비어 있어 요청할 수 없습니다."
    if not api_key:
        return (
            "OPENAI_API_KEY가 설정되지 않아 요청을 전송할 수 없습니다."
        )
    return ""


def runway_prompt_code_units(prompt: str) -> int:
    """Return the exact UTF-16 code-unit count enforced by Runway."""
    return len(prompt.encode("utf-16-le")) // 2


def set_story_prompt_text(
    widget: tk.Text, text: str, *, editable: bool
) -> None:
    """Replace preview text while preserving its intended edit state."""
    widget.configure(state="normal")
    widget.delete("1.0", "end")
    widget.insert("1.0", text)
    widget.configure(state="normal" if editable else "disabled")


def copy_story_prompt(owner: tk.Misc, prompt: str) -> None:
    """Copy one exact Story request string to the system clipboard."""
    owner.clipboard_clear()
    owner.clipboard_append(prompt)
    owner.update()


@dataclass(frozen=True, slots=True)
class DashboardData:
    """Display-ready environment and project information."""

    environment: EnvironmentReport
    projects: tuple[ProjectContext, ...]

    @property
    def waiting_count(self) -> int:
        return sum(
            project.workflow_state
            == WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION
            for project in self.projects
        )


SHORT_STATE_PROGRESS: dict[WorkflowState, tuple[int, str]] = {
    WorkflowState.INIT: (6, "IDEA"),
    WorkflowState.READY: (12, "IDEA"),
    WorkflowState.GENERATING_STORY: (28, "SCRIPT"),
    WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW: (36, "REVIEW"),
    WorkflowState.ASSET_MAPPING_APPROVED: (40, "VISUAL"),
    WorkflowState.GENERATING_IMAGES: (43, "VISUAL"),
    WorkflowState.IMAGES_READY: (56, "REVIEW"),
    WorkflowState.IMAGES_REVIEW: (62, "REVIEW"),
    WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION: (70, "VIDEO"),
    WorkflowState.GENERATING_VIDEOS: (76, "VIDEO"),
    WorkflowState.VIDEOS_READY: (82, "VIDEO"),
    WorkflowState.REVIEWING_VIDEOS: (86, "REVIEW"),
    WorkflowState.VIDEOS_APPROVED: (89, "FINAL"),
    WorkflowState.INTERRUPTED: (70, "INTERRUPTED"),
    WorkflowState.RENDERING: (91, "FINAL"),
    WorkflowState.COMPLETED: (100, "PUBLISH"),
    WorkflowState.FAILED: (0, "FAILED"),
    WorkflowState.CANCELLED: (0, "CANCELLED"),
}


def load_dashboard_data(config: AppConfig) -> DashboardData:
    """Load UI state without creating a window, enabling headless tests."""
    memory = MemoryManager(
        config.project_root / "learning_data" / "projects"
    )
    jobs = APIJobManager(
        config.project_root / "learning_data" / "api_jobs.json",
        config.app_max_concurrent_api_jobs,
    )
    memory.recover_interrupted(jobs.interrupted_project_ids())
    return DashboardData(
        environment=inspect_environment(config),
        projects=tuple(memory.list_projects()),
    )


def open_local_path(path: Path) -> None:
    """Open a project-local file or directory with the operating system."""
    resolved = path.resolve()
    if not resolved.exists():
        resolved.mkdir(parents=True, exist_ok=True)
    if sys.platform == "win32":
        os.startfile(resolved)  # type: ignore[attr-defined]
        return
    command = (
        ["open", str(resolved)]
        if sys.platform == "darwin"
        else ["xdg-open", str(resolved)]
    )
    subprocess.Popen(command)


def required_video_paths(video_directory: Path) -> list[Path]:
    """Return the six generated scene-video paths in scene order."""
    return [
        video_directory / f"scene{number}.mp4"
        for number in range(1, 7)
    ]


def inspect_video_clips(
    video_directory: Path,
    probe: Callable[[Path], dict[str, object]],
) -> tuple[list[Path], list[str]]:
    """Inspect generated scene videos and report every invalid file."""
    clips = required_video_paths(video_directory)
    problems: list[str] = []
    for clip in clips:
        if not clip.is_file():
            problems.append(f"{clip.name}: 파일 없음")
            continue
        if clip.stat().st_size == 0:
            problems.append(f"{clip.name}: 빈 파일")
            continue
        try:
            metadata = probe(clip)
            if not metadata.get("has_video"):
                problems.append(f"{clip.name}: 영상 스트림 없음")
            elif float(metadata.get("duration", 0)) <= 0:
                problems.append(f"{clip.name}: 영상 길이 오류")
        except (FFmpegError, OSError, TypeError, ValueError) as exc:
            problems.append(f"{clip.name}: 손상 또는 읽기 실패 ({exc})")
    return clips, problems


def highlight_search_matches(value: str, query: str) -> str:
    """Bracket case-insensitive partial matches for Tk list result emphasis."""
    highlighted = str(value)
    words = [
        word for word in re.split(r"[\s,]+", query.strip()) if word
    ]
    for word in sorted(set(words), key=len, reverse=True):
        highlighted = re.sub(
            re.escape(word),
            lambda match: f"[{match.group(0)}]",
            highlighted,
            flags=re.IGNORECASE,
        )
    return highlighted


ASSET_UX_LABELS = {
    "display_name": "대표 이름",
    "asset_type": "유형",
    "description": "설명",
    "tags": "검색 태그",
}

ASSET_SEARCH_GUIDANCE = (
    "다음 정보를 모두 검색합니다.\n"
    "• 대표 이름  • 설명  • 검색 태그"
)

# 검색 결과의 표시 우선순위다. 실제 검색 조건과 저장 구조는
# AssetLibrary.search()가 그대로 담당한다.
ASSET_SEARCH_DISPLAY_PRIORITY = (
    "display_name",
    "tags",
    "description",
)

ASSET_VISUAL_INPUT_FIELDS = {
    "character": (
        (
            "appearance",
            "외형·실루엣 *",
            "얼굴, 체형, 종족, 나이 인상처럼 캐릭터를 구별하는 특징",
        ),
        (
            "wardrobe",
            "복장·대표 색상·소품 *",
            "계속 유지할 의상, 색상, 액세서리와 고유 소품",
        ),
        (
            "consistency",
            "일관성 유지 기준",
            "장면이 바뀌어도 달라지면 안 되는 특징",
        ),
    ),
    "background": (
        (
            "setting",
            "장소·공간 구조 *",
            "실내·실외, 공간의 용도, 지형과 눈에 띄는 구조물",
        ),
        (
            "conditions",
            "시간대·계절·날씨",
            "낮·밤, 계절, 날씨와 공기 상태",
        ),
        (
            "atmosphere",
            "분위기·색감·조명 *",
            "장면의 감정, 주조색, 명암과 광원의 느낌",
        ),
    ),
    "object": (
        ("appearance", "형태·재질·색상 *", "물건을 알아볼 수 있는 외형"),
        ("scale", "크기·사용 방식", "인물 대비 크기와 장면에서의 용도"),
    ),
    "style": (
        ("style", "시각적 표현 방식 *", "선, 질감, 형태 단순화 방식"),
        ("palette", "색감·조명·대비 *", "주조색, 채도, 명암과 광원"),
        ("composition", "구도·카메라 느낌", "화면 구성과 렌즈의 전반적 느낌"),
    ),
    "general_reference": (
        ("focus", "참고할 시각 요소 *", "이 사진에서 참고해야 할 핵심 요소"),
        ("atmosphere", "분위기·색감·조명", "감정, 주조색과 광원의 느낌"),
    ),
}

ASSET_VISUAL_FIELD_PREFIXES = {
    "appearance": "외형·실루엣",
    "wardrobe": "복장·대표 색상·소품",
    "consistency": "일관성 유지 기준",
    "setting": "장소·공간 구조",
    "conditions": "시간대·계절·날씨",
    "atmosphere": "분위기·색감·조명",
    "scale": "크기·사용 방식",
    "style": "시각적 표현 방식",
    "palette": "색감·조명·대비",
    "composition": "구도·카메라 느낌",
    "focus": "참고할 시각 요소",
}

REFERENCE_ROLE_OPTIONS = {
    "character": (
        "front", "left45", "right45", "side", "back",
        "expression", "detail", "other",
    ),
    "background": (
        "미지정", "전체 전경", "실내", "실외", "낮", "밤", "세부",
    ),
    "object": (
        "미지정", "정면", "측면", "세부", "사용 모습",
    ),
    "style": (
        "미지정", "색감", "조명", "질감", "구도",
    ),
    "general_reference": (
        "미지정", "분위기", "색감", "조명", "구도", "기타",
    ),
}

REFERENCE_ROLE_DESCRIPTIONS = {
    "front": "대상의 정면 형태",
    "left45": "대상의 왼쪽 45도 형태",
    "right45": "대상의 오른쪽 45도 형태",
    "side": "대상의 측면 실루엣",
    "back": "대상의 후면 형태",
    "expression": "얼굴 표정과 감정 표현",
    "detail": "복장·소품·재질 같은 세부 특징",
    "other": "사용자가 정한 기타 용도",
    "미지정": "별도 용도를 지정하지 않고 이미지 내용을 직접 참고",
    "전체 전경": "장소 전체의 구조와 배치",
    "실내": "실내 공간의 구조와 분위기",
    "실외": "외부 공간과 주변 환경",
    "낮": "낮 시간대의 색감과 조명",
    "밤": "밤 시간대의 색감과 조명",
    "세부": "형태·재질·장식 같은 세부 요소",
    "정면": "대상의 정면 형태",
    "측면": "대상의 측면 형태",
    "사용 모습": "소품이 실제로 사용되는 방식",
    "색감": "주조색·채도·색상 조합",
    "조명": "광원·명암·빛의 분위기",
    "질감": "선·표면·재료의 표현 방식",
    "구도": "화면 배치와 카메라 구성",
    "분위기": "이미지 전체의 감정과 분위기",
    "기타": "사용자가 정한 기타 참고 용도",
}


def reference_role_options(asset_type: str) -> tuple[str, ...]:
    """Return user-facing Reference roles appropriate to one Asset type."""
    return REFERENCE_ROLE_OPTIONS.get(
        asset_type, REFERENCE_ROLE_OPTIONS["general_reference"]
    )


def compose_asset_visual_description(
    asset_type: str,
    values: dict[str, str],
) -> str:
    """Compose prompt-ready Asset description from type-specific inputs."""
    fields = ASSET_VISUAL_INPUT_FIELDS.get(
        asset_type,
        ASSET_VISUAL_INPUT_FIELDS["general_reference"],
    )
    lines = []
    for key, _label, _guidance in fields:
        value = values.get(key, "").strip()
        if value:
            lines.append(f"{ASSET_VISUAL_FIELD_PREFIXES[key]}: {value}")
    return "\n".join(lines)


def parse_asset_visual_description(
    asset_type: str,
    description: str,
) -> dict[str, str]:
    """Restore type-specific editor values from a prompt description."""
    fields = ASSET_VISUAL_INPUT_FIELDS.get(
        asset_type,
        ASSET_VISUAL_INPUT_FIELDS["general_reference"],
    )
    result = {key: "" for key, _label, _guidance in fields}
    prefix_to_key = {
        ASSET_VISUAL_FIELD_PREFIXES[key]: key
        for key, _label, _guidance in fields
    }
    unmatched: list[str] = []
    for raw_line in description.splitlines():
        line = raw_line.strip()
        if not line:
            continue
        matched = False
        for prefix, key in prefix_to_key.items():
            marker = f"{prefix}:"
            if line.startswith(marker):
                value = line[len(marker):].strip()
                result[key] = "\n".join(
                    part for part in (result[key], value) if part
                )
                matched = True
                break
        if not matched:
            unmatched.append(line)
    if unmatched and fields:
        first_key = fields[0][0]
        result[first_key] = "\n".join(
            part for part in (result[first_key], *unmatched) if part
        )
    return result


def migrate_asset_visual_values(
    previous_type: str,
    next_type: str,
    values: dict[str, str],
) -> dict[str, str]:
    """Keep only visual fields with the same meaning in both Asset types.

    Folder name, tags, and Reference links are stored separately and remain
    untouched. Previous type-only values are cleared so stale details cannot
    leak into Story or Image prompts after a Folder changes purpose.
    """
    previous_keys = {
        key for key, _label, _guidance in ASSET_VISUAL_INPUT_FIELDS.get(
            previous_type,
            ASSET_VISUAL_INPUT_FIELDS["general_reference"],
        )
    }
    next_keys = {
        key for key, _label, _guidance in ASSET_VISUAL_INPUT_FIELDS.get(
            next_type,
            ASSET_VISUAL_INPUT_FIELDS["general_reference"],
        )
    }
    compatible_keys = previous_keys.intersection(next_keys)
    return {
        key: value if key in compatible_keys else ""
        for key, value in values.items()
    }


def project_delete_confirmation_matches(
    typed: str | None,
    *expected_values: str,
) -> bool:
    """Match a deletion confirmation despite harmless input differences."""
    if typed is None:
        return False

    def normalize(value: str) -> str:
        normalized = unicodedata.normalize("NFKC", str(value)).casefold()
        return "".join(character for character in normalized if character.isalnum())

    candidate = normalize(typed)
    return bool(candidate) and candidate in {
        normalize(value) for value in expected_values if str(value).strip()
    }


def asset_search_match_summary(asset: LibraryAsset, query: str) -> str:
    """Return searchable metadata fields containing the current query."""
    if not query.strip():
        return ""
    searchable = {
        "display_name": asset.display_name,
        "aliases": ", ".join(asset.aliases),
        "tags": ", ".join(asset.tags),
        "description": asset.description,
        "asset_type": asset.asset_type,
    }
    values = [
        (ASSET_UX_LABELS[key], searchable[key])
        for key in (*ASSET_SEARCH_DISPLAY_PRIORITY, "asset_type")
    ]
    words = [
        word.casefold()
        for word in re.split(r"[\s,]+", query.strip())
        if word
    ]
    matched = [
        f"{label}: {highlight_search_matches(value, query)}"
        for label, value in values
        if value and any(word in value.casefold() for word in words)
    ]
    return " · ".join(matched)


def reference_review_debug_text(
    reference_details: list[dict[str, str]],
    prompt_length: int,
    image_api_calls: int | str,
) -> str:
    """Format persisted Resolver evidence for the shared Image Review."""
    roles = ", ".join(
        str(item.get("role") or "reference")
        for item in reference_details
    ) or "Text Only"
    return (
        f"Reference Count  {len(reference_details)}\n"
        f"Reference Used   {roles}\n"
        f"Prompt Length    {prompt_length}\n"
        f"Image API Calls  {image_api_calls}"
    )


def candidate_asset_debug_text(counts: dict[str, int]) -> str:
    """Format Candidate collection counts for the default Image Review."""
    return (
        f"전달한 Candidate Asset 수  {counts.get('total', 0)}\n"
        f"Character Asset 수         {counts.get('character', 0)}\n"
        f"Background 수              {counts.get('background', 0)}\n"
        f"Object 수                  {counts.get('object', 0)}\n"
        f"Style 수                   {counts.get('style', 0)}"
    )


def project_progress(project: ProjectContext) -> tuple[int, str]:
    """Map persisted workflow state to the visual studio pipeline."""
    if project.workflow_state == WorkflowState.GENERATING_IMAGES:
        # VISUAL spans 40–56%. Advance only for images that have actually
        # completed, rather than presenting an invented provider percentage.
        completed = min(6, len(project.generated_images))
        return 40 + round((completed / 6) * 16), "VISUAL"
    return SHORT_STATE_PROGRESS[project.workflow_state]


class HoverButton(tk.Label):
    """Flat studio button with keyboard focus and restrained interaction."""

    def __init__(
        self,
        parent: tk.Misc,
        text: str,
        command: Callable[[], None],
        *,
        background: str,
        hover: str,
        foreground: str = "#F7F3EA",
        font: tuple[str, int, str] = ("Malgun Gothic", 10, "bold"),
        padx: int = 18,
        pady: int = 10,
        cursor: str = "hand2",
    ) -> None:
        super().__init__(
            parent,
            text=text,
            bg=background,
            fg=foreground,
            font=font,
            padx=padx,
            pady=pady,
            cursor=cursor,
            takefocus=True,
            highlightthickness=1,
            highlightbackground="#2A3749",
            highlightcolor=hover,
            relief="flat",
            bd=0,
        )
        self._base = background
        self._hover = hover
        self._command = command
        self.bind("<Enter>", self._enter)
        self.bind("<Leave>", self._leave)
        self.bind("<ButtonPress-1>", self._press)
        self.bind("<ButtonRelease-1>", self._release)
        self.bind("<Return>", lambda event: self._invoke())
        self.bind("<space>", lambda event: self._invoke())

    def _enabled(self) -> bool:
        return str(self.cget("state")) != "disabled"

    def _enter(self, event: tk.Event[tk.Misc]) -> None:
        if self._enabled():
            self.configure(
                bg=self._hover,
                highlightbackground=self._hover,
                relief="flat",
            )

    def _leave(self, event: tk.Event[tk.Misc]) -> None:
        if self._enabled():
            self.configure(
                bg=self._base,
                highlightbackground="#2A3749",
                relief="flat",
            )

    def _press(self, event: tk.Event[tk.Misc]) -> None:
        if not self._enabled():
            return
        self.configure(bg="#4E38B5", relief="flat")

    def _release(self, event: tk.Event[tk.Misc]) -> None:
        if not self._enabled():
            return
        self.configure(bg=self._hover, relief="flat")
        self.after(80, self._invoke)

    def _invoke(self) -> None:
        if self._enabled():
            self._command()


class HoverCard(tk.Frame):
    """Card with subtle border emphasis on hover."""

    def __init__(
        self,
        parent: tk.Misc,
        *,
        background: str,
        border: str,
        hover_border: str,
        **kwargs: object,
    ) -> None:
        super().__init__(
            parent,
            bg=background,
            highlightbackground=border,
            highlightthickness=1,
            **kwargs,
        )
        self._border = border
        self._hover_border = hover_border
        self.bind("<Enter>", self._enter)
        self.bind("<Leave>", self._leave)

    def _enter(self, event: tk.Event[tk.Misc]) -> None:
        self.configure(
            highlightbackground=self._hover_border,
            highlightthickness=2,
            relief="flat",
            borderwidth=0,
        )

    def _leave(self, event: tk.Event[tk.Misc]) -> None:
        self.configure(
            highlightbackground=self._border,
            highlightthickness=1,
            relief="flat",
            borderwidth=0,
        )


class StudioApp(tk.Tk):
    """Professional local production UI that keeps Runway user-operated."""

    BG = "#070B12"
    SURFACE = "#0F1722"
    SURFACE_2 = "#121C29"
    SURFACE_3 = "#192536"
    BORDER = "#29384B"
    BORDER_SOFT = "#1D2938"
    TEXT = "#F4F7FB"
    TEXT_SOFT = "#CAD2DE"
    MUTED = "#8C99AA"
    DIM = "#667486"
    GOLD = "#20B8CF"
    GOLD_LIGHT = "#72D9E8"
    PURPLE = "#6246D9"
    PURPLE_DARK = "#4932B2"
    GREEN = "#28C98B"
    RED = "#F05D72"
    ORANGE = "#F07A3F"
    PAPER = "#DDE7F7"
    INK = "#10182A"
    FONT = "Malgun Gothic"

    def __init__(
        self,
        config: AppConfig,
        data_loader: Callable[[AppConfig], DashboardData] = load_dashboard_data,
    ) -> None:
        super().__init__()
        self.config_data = config
        self.data_loader = data_loader
        self.character_path: Path | None = None
        self.reference_paths: list[Path] = []
        self.reference_source_project_id: str | None = None
        self.validated_clips: list[Path] = []
        self.ffmpeg_engine = FFmpegEngine(
            config.ffmpeg_binary, config.ffprobe_binary
        )
        self.dashboard_data: DashboardData | None = None
        self._resize_job: str | None = None
        self._toast_job: str | None = None
        self._hero_job: str | None = None
        self._hero_phase = 0
        self._scroll_targets: dict[str, tk.Canvas] = {}
        self.face_consistency_service: FaceConsistencyService | None = None
        self.generation_service: GenerationService | None = None
        self.video_generation_service: VideoGenerationService | None = None
        self.project_lifecycle = ProjectLifecycleService(
            config.project_root / "learning_data" / "projects",
            config.project_root / "output" / "archive" / "deleted_projects",
            config.project_root / "learning_data" / "api_jobs.json",
        )
        self._generation_running = False
        self._api_session_disconnected = False
        self._runway_session_disconnected = False
        self._story_preview_window: tk.Toplevel | None = None
        self._generation_progress_window: tk.Toplevel | None = None
        self._generation_progress_value: tk.DoubleVar | None = None
        self._generation_progress_status: tk.StringVar | None = None
        self._generation_progress_detail: tk.StringVar | None = None
        self._generation_progress_steps: list[tk.Label] = []
        self.advanced_mode = os.environ.get(
            "PRISM_ADVANCED_MODE", ""
        ).strip().lower() in {"1", "true", "yes", "on"}
        self.reduced_motion = os.environ.get(
            "REDUCED_MOTION", ""
        ).strip().lower() in {"1", "true", "yes", "on"}

        self.title("PRISM FORGE — AI Animation Creative Console")
        self._fit_window(self, 1360, 900, 1000, 640)
        self.configure(bg=self.BG)
        self.option_add("*Font", (self.FONT, 9))
        self.option_add("*Entry.background", self.SURFACE_3)
        self.option_add("*Entry.foreground", self.TEXT)
        self.option_add("*Entry.insertBackground", self.GOLD)
        self.option_add("*Entry.relief", "flat")
        self.option_add("*Listbox.background", self.SURFACE)
        self.option_add("*Listbox.foreground", self.TEXT_SOFT)
        self.option_add("*Listbox.selectBackground", self.PURPLE_DARK)
        self.option_add("*Listbox.selectForeground", self.TEXT)
        self.option_add("*Listbox.relief", "flat")
        self.protocol("WM_DELETE_WINDOW", self._close)
        self._configure_styles()
        self._build_shell()
        self.bind("<Configure>", self._on_resize)
        self.after(80, self.refresh)

    def _configure_styles(self) -> None:
        style = ttk.Style(self)
        style.theme_use("clam")
        style.configure(
            "Studio.TCombobox",
            fieldbackground=self.SURFACE_3,
            background=self.SURFACE_3,
            foreground=self.TEXT,
            arrowcolor=self.GOLD,
            bordercolor=self.BORDER,
            lightcolor=self.BORDER,
            darkcolor=self.BORDER,
            padding=8,
            relief="flat",
        )
        style.map(
            "Studio.TCombobox",
            fieldbackground=[("readonly", self.SURFACE_3)],
            foreground=[("readonly", self.TEXT)],
            bordercolor=[("focus", self.PURPLE), ("!focus", self.BORDER)],
        )
        style.configure(
            "Studio.Horizontal.TProgressbar",
            troughcolor=self.SURFACE_3,
            background=self.PURPLE,
            bordercolor=self.SURFACE_3,
            lightcolor=self.PURPLE,
            darkcolor=self.PURPLE,
            thickness=6,
        )
        style.configure(
            "Studio.Vertical.TScrollbar",
            troughcolor=self.BG,
            background=self.SURFACE_3,
            bordercolor=self.BG,
            arrowcolor=self.MUTED,
        )

    def _fit_window(
        self,
        window: tk.Tk | tk.Toplevel,
        width: int,
        height: int,
        minimum_width: int = 640,
        minimum_height: int = 480,
    ) -> None:
        """Fit and center a workspace inside high-DPI desktop bounds."""
        physical_width = max(800, window.winfo_screenwidth())
        physical_height = max(600, window.winfo_screenheight())
        try:
            tk_scale = float(window.tk.call("tk", "scaling"))
        except (tk.TclError, TypeError, ValueError):
            tk_scale = 96 / 72
        dpi_factor = max(1.0, tk_scale / (96 / 72))
        if sys.platform == "win32":
            try:
                import ctypes

                dpi_factor = max(
                    dpi_factor,
                    float(
                        ctypes.windll.shcore.GetScaleFactorForDevice(0)
                    ) / 100,
                )
            except (AttributeError, OSError, TypeError, ValueError):
                pass
        screen_width = max(800, int(physical_width / dpi_factor))
        screen_height = max(600, int(physical_height / dpi_factor))
        available_width = max(760, screen_width - 32)
        available_height = max(540, screen_height - 80)
        actual_width = min(width, available_width)
        actual_height = min(height, available_height)
        x = max(0, (screen_width - actual_width) // 2)
        y = max(0, (screen_height - actual_height) // 3)
        window.geometry(f"{actual_width}x{actual_height}+{x}+{y}")
        window.minsize(
            min(minimum_width, actual_width),
            min(minimum_height, actual_height),
        )

    def _bind_scroll_canvas(self, canvas: tk.Canvas) -> None:
        """Route wheel input to one Canvas owned by the active Toplevel."""
        top = canvas.winfo_toplevel()
        key = str(top)

        def activate(_event: tk.Event[tk.Misc] | None = None) -> None:
            self._scroll_targets[key] = canvas

        def cleanup(event: tk.Event[tk.Misc]) -> None:
            if event.widget is top:
                self._scroll_targets.pop(key, None)

        canvas.bind("<Enter>", activate, add="+")
        top.bind("<Destroy>", cleanup, add="+")
        if top is self:
            activate()

    def _build_shell(self) -> None:
        self._build_navigation()
        body = tk.Frame(self, bg=self.BG)
        body.pack(fill="both", expand=True)
        self._build_workspace_header(body)
        self._build_footer(body)

        self.canvas = tk.Canvas(
            body,
            bg=self.BG,
            highlightthickness=0,
            bd=0,
        )
        scrollbar = ttk.Scrollbar(
            body, orient="vertical", command=self.canvas.yview
        )
        self.canvas.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        self.canvas.pack(side="left", fill="both", expand=True)
        self.page = tk.Frame(self.canvas, bg=self.BG)
        self.page_window = self.canvas.create_window(
            (0, 0), window=self.page, anchor="nw"
        )
        self.page.bind(
            "<Configure>",
            lambda event: self.canvas.configure(
                scrollregion=self.canvas.bbox("all")
            ),
        )
        self.canvas.bind(
            "<Configure>",
            lambda event: self.canvas.itemconfigure(
                self.page_window, width=event.width
            ),
        )
        # Child widgets need a shared wheel binding, but the handler rejects
        # input originating in Long Story and every other Toplevel workspace.
        self.canvas.bind_all("<MouseWheel>", self._on_mousewheel)
        self._bind_scroll_canvas(self.canvas)

        self._build_hero()
        self._build_projects_section()
        self._build_quick_actions()
        self._show_skeleton()

    def _build_navigation(self) -> None:
        nav = tk.Frame(
            self,
            bg="#0A1019",
            width=232,
            highlightbackground=self.BORDER_SOFT,
            highlightthickness=1,
        )
        nav.pack(side="left", fill="y")
        nav.pack_propagate(False)
        inner = tk.Frame(nav, bg="#0A1019")
        inner.pack(fill="both", expand=True, padx=14, pady=12)

        tk.Label(
            inner,
            text="◇  PRISM FORGE",
            bg="#0A1019",
            fg=self.TEXT,
            font=(self.FONT, 13, "bold"),
        ).pack(anchor="w", padx=8, pady=(8, 18))

        status = tk.Frame(inner, bg="#0D172A")
        status.pack(side="bottom", fill="x", padx=5, pady=4)
        self.nav_status_dot = tk.Label(
            status,
            text="●",
            bg="#0D172A",
            fg=self.GOLD,
            font=("Segoe UI", 9),
        )
        self.nav_status_dot.pack(side="left", padx=(0, 7))
        self.nav_status = tk.Label(
            status,
            text="시스템 확인 중",
            bg="#0D172A",
            fg=self.MUTED,
            font=(self.FONT, 8),
        )
        self.nav_status.pack(side="left")

        nav_items: list[tuple[str, Callable[[], None]]] = [
            ("⌂  대시보드", lambda: self.canvas.yview_moveto(0)),
            ("＋  새 단기 프로젝트", self._open_project_brief),
            ("▤  장기 프로젝트", self._open_long_story_studio),
            (
                "▣  단기 프로젝트 목록",
                lambda: self._scroll_to(self.projects_anchor),
            ),
            ("◫  이미지 검토", self._choose_short_image_review),
            ("▶  영상 생성·진행", self._choose_short_video_generation),
            ("▦  생성 이미지 모음", self._open_project_image_gallery),
            ("▥  생성 영상 모음", self._open_project_video_gallery),
            ("◇  Asset Library", self._open_asset_library),
            ("⚙  설정·환경", self._show_settings),
        ]
        if self.advanced_mode:
            nav_items[8:8] = [
                ("◇  Project Assets · 고급", self._open_project_assets),
                ("◇  Scene Mapping · 고급", self._open_scene_mapping),
            ]
        for item_index, (text, command) in enumerate(nav_items):
            HoverButton(
                inner,
                text,
                command,
                background=self.SURFACE_3 if item_index == 0 else "#0A1019",
                hover="#172235",
                foreground=self.TEXT if item_index == 0 else self.TEXT_SOFT,
                font=(self.FONT, 9, "bold"),
                padx=14,
                pady=5,
            ).pack(fill="x", pady=2)

    def _build_workspace_header(self, parent: tk.Misc) -> None:
        """Keep core workspace identity and API connection visible at a glance."""
        bar = tk.Frame(
            parent, bg="#0A1019", height=82,
            highlightbackground=self.BORDER_SOFT, highlightthickness=1,
        )
        bar.pack(fill="x")
        bar.pack_propagate(False)
        self._build_api_key_panel(bar)
        title = tk.Frame(bar, bg="#0A1019")
        title.pack(side="left", padx=24, pady=14)
        tk.Label(
            title, text="PRODUCTION CONTROL DECK", bg="#0A1019",
            fg=self.GOLD, font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w")
        tk.Label(
            title, text="AI 애니메이션 제작 스튜디오", bg="#0A1019",
            fg=self.TEXT, font=(self.FONT, 13, "bold"),
        ).pack(anchor="w", pady=(3, 0))

    def _build_api_key_panel(self, parent: tk.Misc) -> None:
        """Build a masked local key connector in the upper-right corner."""
        panel = tk.Frame(
            parent, bg="#0D172A", highlightbackground=self.BORDER,
            highlightthickness=1,
        )
        panel.pack(side="right", fill="y", padx=(10, 18), pady=8)
        tk.Label(
            panel, text="OPENAI CONNECTION", bg="#0D172A", fg=self.GOLD,
            font=("Segoe UI", 7, "bold"),
        ).grid(row=0, column=0, sticky="w", padx=(10, 7), pady=(7, 1))
        connection_text = (
            "연결 해제됨 · 키 저장됨"
            if self._api_session_disconnected
            else masked_api_key(self.config_data.openai_api_key)
        )
        self.api_key_status = tk.StringVar(value=connection_text)
        self.api_key_status_label = tk.Label(
            panel, textvariable=self.api_key_status, bg="#0D172A",
            fg=(
                self.GREEN
                if self.config_data.openai_api_key
                and not self._api_session_disconnected
                else self.ORANGE
            ),
            font=(self.FONT, 7, "bold"),
        )
        self.api_key_status_label.grid(
            row=1, column=0, sticky="w", padx=(10, 7), pady=(0, 7)
        )
        self.api_key_entry = tk.Entry(
            panel, show="•", bg=self.SURFACE_3, fg=self.TEXT,
            insertbackground=self.GOLD, relief="flat", bd=0,
            highlightbackground=self.BORDER, highlightcolor=self.PURPLE,
            highlightthickness=1,
            font=("Consolas", 8), width=24,
        )
        self.api_key_entry.grid(
            row=0, column=1, rowspan=2, sticky="ew", padx=5, pady=10, ipady=5
        )
        self.api_key_entry.bind(
            "<Return>", lambda _event: self._connect_api_key()
        )
        HoverButton(
            panel, "키 저장·연결", self._connect_api_key,
            background=self.PURPLE, hover=self.GOLD,
            font=(self.FONT, 7, "bold"), padx=9, pady=5,
        ).grid(row=0, column=2, rowspan=2, padx=5, pady=10)
        HoverButton(
            panel, "보기", self._toggle_api_key_visibility,
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 7, "bold"), padx=7, pady=5,
        ).grid(row=0, column=3, rowspan=2, padx=(0, 5), pady=10)
        self.api_disconnect_button = HoverButton(
            panel,
            "다시 연결" if self._api_session_disconnected else "연결 해제",
            (
                self._connect_api_key
                if self._api_session_disconnected
                else self._disconnect_api_key
            ),
            background=self.SURFACE_3, hover=self.RED,
            font=(self.FONT, 7, "bold"), padx=7, pady=5,
        )
        self.api_disconnect_button.grid(
            row=0, column=4, rowspan=2, padx=(0, 9), pady=10
        )
        if (
            not self.config_data.openai_api_key
            and not self._api_session_disconnected
        ):
            self.api_disconnect_button.configure(state="disabled", fg=self.MUTED)

        separator = tk.Frame(panel, bg=self.BORDER, width=1)
        separator.grid(row=0, column=5, rowspan=2, sticky="ns", padx=7, pady=8)
        tk.Label(
            panel, text="RUNWAY VIDEO", bg="#0D172A", fg=self.GOLD_LIGHT,
            font=("Segoe UI", 7, "bold"),
        ).grid(row=0, column=6, sticky="w", padx=(3, 7), pady=(7, 1))
        runway_connection_text = (
            "연결 해제됨 · 키 저장됨"
            if self._runway_session_disconnected
            else masked_api_key(self.config_data.runway_api_secret)
        )
        self.runway_key_status = tk.StringVar(value=runway_connection_text)
        self.runway_key_status_label = tk.Label(
            panel, textvariable=self.runway_key_status, bg="#0D172A",
            fg=(
                self.GREEN
                if self.config_data.runway_api_secret
                and not self._runway_session_disconnected
                else self.ORANGE
            ),
            font=(self.FONT, 7, "bold"),
        )
        self.runway_key_status_label.grid(
            row=1, column=6, sticky="w", padx=(3, 7), pady=(0, 7)
        )
        self.runway_key_entry = tk.Entry(
            panel, show="*", bg=self.SURFACE_3, fg=self.TEXT,
            insertbackground=self.GOLD, relief="flat", bd=0,
            highlightbackground=self.BORDER, highlightcolor=self.PURPLE,
            highlightthickness=1, font=("Consolas", 8), width=22,
        )
        self.runway_key_entry.grid(
            row=0, column=7, rowspan=2, sticky="ew", padx=4, pady=10,
            ipady=5,
        )
        self.runway_key_entry.bind(
            "<Return>", lambda _event: self._connect_runway_key()
        )
        HoverButton(
            panel, "키 저장·연결", self._connect_runway_key,
            background=self.PURPLE, hover=self.GOLD,
            font=(self.FONT, 7, "bold"), padx=8, pady=5,
        ).grid(row=0, column=8, rowspan=2, padx=4, pady=10)
        HoverButton(
            panel, "보기", self._toggle_runway_key_visibility,
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 7, "bold"), padx=7, pady=5,
        ).grid(row=0, column=9, rowspan=2, padx=(0, 4), pady=10)
        self.runway_disconnect_button = HoverButton(
            panel,
            "다시 연결" if self._runway_session_disconnected else "연결 해제",
            (
                self._reconnect_runway
                if self._runway_session_disconnected
                else self._disconnect_runway
            ),
            background=self.SURFACE_3, hover=self.RED,
            font=(self.FONT, 7, "bold"), padx=7, pady=5,
        )
        self.runway_disconnect_button.grid(
            row=0, column=10, rowspan=2, padx=(0, 9), pady=10
        )
        if (
            not self.config_data.runway_api_secret
            and not self._runway_session_disconnected
        ):
            self.runway_disconnect_button.configure(
                state="disabled", fg=self.MUTED
            )

    def _toggle_runway_key_visibility(self) -> None:
        """Toggle visibility of the unsaved Runway key field."""
        self.runway_key_entry.configure(
            show="" if self.runway_key_entry.cget("show") else "*"
        )

    def _connect_runway_key(self) -> None:
        """Save and activate the key typed in the Runway header field."""
        value = self.runway_key_entry.get().strip()
        if not value:
            messagebox.showwarning(
                "Runway API 키 입력",
                "Runway API 키를 입력한 뒤 ‘키 저장·연결’을 눌러주세요.",
                parent=self,
            )
            self.runway_key_entry.focus_set()
            return
        self._save_and_activate_runway_key(value)

    def _build_hero(self) -> None:
        outer = tk.Frame(self.page, bg=self.BG)
        outer.pack(fill="x", padx=28, pady=(24, 20))
        self.hero = tk.Canvas(
            outer,
            height=320,
            bg=self.SURFACE,
            highlightbackground=self.BORDER,
            highlightthickness=1,
        )
        self.hero.pack(fill="x")
        self.hero.bind("<Configure>", self._draw_hero)

        copy = tk.Frame(self.hero, bg="#09101F")
        self.hero_copy_window = self.hero.create_window(
            42, 32, window=copy, anchor="nw"
        )
        self.hero_eyebrow = tk.Label(
            copy,
            text="ACTIVE WORKSPACE  /  AI ANIMATION  /  30 SEC",
            bg="#09101F",
            fg=self.GOLD_LIGHT,
            font=("Segoe UI", 8, "bold"),
        )
        self.hero_eyebrow.pack(anchor="w")
        self.hero_title = tk.Label(
            copy,
            text="첫 번째 이야기를 시작하세요",
            bg="#09101F",
            fg=self.TEXT,
            font=(self.FONT, 24, "bold"),
            justify="left",
            anchor="w",
        )
        self.hero_title.pack(anchor="w", pady=(10, 7))
        self.hero_summary = tk.Label(
            copy,
            text=(
                "주제 하나로 대본과 장면 이미지 6장을 설계하세요.\n"
                "AI 생성 결과를 검토한 뒤 Runway에서 직접 편집하고, 앱에서 최종 병합합니다."
            ),
            justify="left",
            bg="#09101F",
            fg=self.TEXT_SOFT,
            font=(self.FONT, 10),
            pady=2,
        )
        self.hero_summary.pack(anchor="w")
        self.hero_status_row = tk.Frame(copy, bg="#09101F")
        self.hero_status_row.pack(anchor="w", pady=(14, 0))
        self.hero_stage_badge = self._status_badge(
            self.hero_status_row, "IDEA · 설정 준비", color=self.PURPLE
        )
        self.hero_stage_badge.pack(side="left")
        self.hero_api_badge = self._status_badge(
            self.hero_status_row,
            "API 연결" if self.config_data.openai_api_key else "API 미연결",
            color=(
                self.GREEN if self.config_data.openai_api_key else self.ORANGE
            ),
        )
        self.hero_api_badge.pack(side="left", padx=8)
        self._status_badge(
            self.hero_status_row, "6 SCENES", color=self.GOLD_LIGHT
        ).pack(side="left")
        cta_row = tk.Frame(copy, bg="#09101F")
        cta_row.pack(anchor="w", pady=(16, 0))
        self.hero_primary_button = HoverButton(
            cta_row,
            "＋  새 단기 프로젝트",
            self._continue_current_project,
            background=self.PURPLE,
            hover="#765DE4",
            font=(self.FONT, 10, "bold"),
            padx=22,
            pady=12,
        )
        self.hero_primary_button.pack(side="left")
        HoverButton(
            cta_row,
            "최근 단기 프로젝트  →",
            lambda: self._scroll_to(self.projects_anchor),
            background=self.SURFACE_3,
            hover=self.BORDER,
            foreground=self.TEXT_SOFT,
            font=(self.FONT, 9, "bold"),
            padx=18,
            pady=12,
        ).pack(side="left", padx=(10, 0))

    def _draw_hero(self, event: tk.Event[tk.Canvas]) -> None:
        width = max(event.width, 900)
        content_width = max(620, width - 150)
        title_text = self.hero_title.cget("text")
        title_length = len(str(title_text))
        title_size = 24 if title_length <= 34 else 20 if title_length <= 58 else 17
        self.hero_title.configure(
            wraplength=content_width,
            font=(self.FONT, title_size, "bold"),
        )
        self.hero_summary.configure(wraplength=content_width)
        self.hero.delete("art")
        bands = (
            "#09101F",
            "#0A1225",
            "#0B1730",
            "#101B39",
            "#151C43",
            "#1B1D49",
        )
        band_width = max(1, width // len(bands))
        for index, color in enumerate(bands):
            self.hero.create_rectangle(
                index * band_width,
                0,
                (index + 1) * band_width + 2,
                320,
                fill=color,
                outline="",
                tags="art",
            )
        art_left = int(width * 0.72)
        center_x = art_left + (width - art_left) // 2
        center_y = 156
        # Layered projection rings and a floating storyboard slab create depth
        # without requiring OpenGL or external artwork.
        for radius, color, line_width in (
            (138, "#182A52", 2),
            (108, "#24457C", 2),
            (76, self.PURPLE, 3),
        ):
            self.hero.create_oval(
                center_x - radius, center_y - radius // 2,
                center_x + radius, center_y + radius // 2,
                outline=color, width=line_width, tags="art",
            )
        phase = self._hero_phase * 4
        self.hero.create_arc(
            center_x - 146, center_y - 73, center_x + 146, center_y + 73,
            start=phase, extent=74, outline=self.GOLD_LIGHT,
            width=4, style="arc", tags="art",
        )
        self.hero.create_polygon(
            center_x - 116, center_y - 54,
            center_x + 84, center_y - 76,
            center_x + 125, center_y + 51,
            center_x - 80, center_y + 76,
            fill="#101B33", outline="#3D65A4", width=2, tags="art",
        )
        self.hero.create_polygon(
            center_x - 84, center_y - 25,
            center_x + 57, center_y - 40,
            center_x + 80, center_y + 29,
            center_x - 61, center_y + 44,
            fill="#1A2850", outline=self.GOLD, width=2, tags="art",
        )
        self.hero.create_polygon(
            center_x - 18, center_y - 21,
            center_x + 34, center_y + 3,
            center_x - 12, center_y + 35,
            fill=self.ORANGE, outline="#FFC0A3", tags="art",
        )
        for index in range(12):
            x = art_left + ((index * 71 + self._hero_phase * 5) % max(180, width - art_left))
            y = 34 + ((index * 43) % 292)
            self.hero.create_oval(
                x - 2, y - 2, x + 2, y + 2,
                fill=self.GOLD_LIGHT if index % 3 else self.PURPLE,
                outline="", tags="art",
            )
        self.hero.create_text(
            width - 62,
            294,
            text="CREATIVE CORE  /  06 SCENES  /  READY",
            fill="#6F83A9",
            anchor="e",
            font=("Consolas", 8),
            tags="art",
        )
        self.hero.tag_lower("art")

    def _animate_hero(self) -> None:
        self._hero_job = None
        if not self.winfo_exists() or self.reduced_motion:
            return
        self._hero_phase = (self._hero_phase + 1) % 20
        self._draw_hero(
            type(
                "HeroEvent",
                (),
                {"width": self.hero.winfo_width()},
            )()
        )

    def _section_header(
        self,
        parent: tk.Misc,
        eyebrow: str,
        title: str,
        description: str,
    ) -> None:
        row = tk.Frame(parent, bg=self.BG)
        row.pack(fill="x", pady=(0, 15))
        left = tk.Frame(row, bg=self.BG)
        left.pack(side="left")
        tk.Label(
            left,
            text=eyebrow,
            bg=self.BG,
            fg=self.GOLD,
            font=("Segoe UI", 8, "bold"),
        ).pack(anchor="w")
        tk.Label(
            left,
            text=title,
            bg=self.BG,
            fg=self.TEXT,
            font=(self.FONT, 18, "bold"),
        ).pack(anchor="w", pady=(5, 0))
        tk.Label(
            row,
            text=description,
            bg=self.BG,
            fg=self.MUTED,
            font=(self.FONT, 9),
        ).pack(side="right", anchor="s", pady=(0, 3))

    def _window_header(
        self,
        window: tk.Toplevel,
        eyebrow: str,
        title: str,
        description: str = "",
    ) -> tk.Frame:
        """Build one consistent header for every production workspace."""
        header = tk.Frame(
            window, bg="#0A1019", height=88,
            highlightbackground=self.BORDER_SOFT, highlightthickness=1,
        )
        header.pack(fill="x")
        header.pack_propagate(False)
        copy = tk.Frame(header, bg="#0A1019")
        copy.pack(side="left", padx=24, pady=11)
        tk.Label(
            copy, text=eyebrow, bg="#0A1019", fg=self.GOLD,
            font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w")
        tk.Label(
            copy, text=title, bg="#0A1019", fg=self.TEXT,
            font=(self.FONT, 16, "bold"),
        ).pack(anchor="w", pady=(3, 0))
        if description:
            tk.Label(
                copy, text=description, bg="#0A1019", fg=self.MUTED,
                font=(self.FONT, 8),
            ).pack(anchor="w", pady=(2, 0))
        HoverButton(
            header, "닫기", window.destroy,
            background=self.SURFACE_2, hover=self.BORDER,
            foreground=self.TEXT_SOFT, font=(self.FONT, 8, "bold"),
            padx=13, pady=7,
        ).pack(side="right", padx=24)
        return header

    def _card(
        self, parent: tk.Misc, *, background: str | None = None
    ) -> tk.Frame:
        """Return the shared bordered content surface."""
        return tk.Frame(
            parent,
            bg=background or self.SURFACE,
            highlightbackground=self.BORDER_SOFT,
            highlightthickness=1,
            relief="flat",
            borderwidth=0,
        )

    def _status_badge(
        self,
        parent: tk.Misc,
        text: str,
        *,
        color: str | None = None,
        background: str | None = None,
    ) -> tk.Label:
        """Create a compact, consistent state indicator."""
        return tk.Label(
            parent,
            text=f"  {text}  ",
            bg=background or "#172334",
            fg=color or self.TEXT_SOFT,
            font=(self.FONT, 7, "bold"),
            padx=5,
            pady=3,
        )

    def _continue_current_project(self) -> None:
        if self.dashboard_data and self.dashboard_data.projects:
            self._open_project(self.dashboard_data.projects[0])
            return
        self._open_project_brief()

    def _build_projects_section(self) -> None:
        self.projects_anchor = tk.Frame(self.page, bg=self.BG)
        self.projects_anchor.pack(fill="x", padx=34, pady=(2, 26))
        header = tk.Frame(self.projects_anchor, bg=self.BG)
        header.pack(fill="x", pady=(0, 15))
        left = tk.Frame(header, bg=self.BG)
        left.pack(side="left")
        tk.Label(
            left,
            text="RECENT SHORT PROJECTS",
            bg=self.BG,
            fg=self.GOLD,
            font=("Segoe UI", 8, "bold"),
        ).pack(anchor="w")
        tk.Label(
            left,
            text="최근 단기 프로젝트",
            bg=self.BG,
            fg=self.TEXT,
            font=(self.FONT, 18, "bold"),
        ).pack(anchor="w", pady=(5, 0))
        self.projects_grid = tk.Frame(self.projects_anchor, bg=self.BG)
        self.projects_grid.pack(fill="x")

    def _render_projects(self, projects: tuple[ProjectContext, ...]) -> None:
        for child in self.projects_grid.winfo_children():
            child.destroy()
        if not projects:
            self._render_empty_projects()
            return
        width = max(self.winfo_width(), 1040)
        columns = 3 if width >= 1260 else 2
        for column in range(columns):
            self.projects_grid.columnconfigure(column, weight=1, uniform="poster")
        for index, project in enumerate(projects[:6]):
            card = self._project_card(self.projects_grid, project, index)
            card.grid(
                row=index // columns,
                column=index % columns,
                sticky="nsew",
                padx=(0, 12) if index % columns < columns - 1 else 0,
                pady=(0, 12),
            )

    def _project_card(
        self,
        parent: tk.Misc,
        project: ProjectContext,
        index: int,
    ) -> HoverCard:
        card = HoverCard(
            parent,
            background=self.SURFACE,
            border=self.BORDER,
            hover_border=self.GOLD,
            height=258,
        )
        card.grid_propagate(False)
        card.columnconfigure(1, weight=1)
        poster = tk.Canvas(
            card,
            width=132,
            height=232,
            bg=self.SURFACE_2,
            highlightthickness=0,
        )
        poster.grid(row=0, column=0, rowspan=5, padx=12, pady=12)
        poster_colors = (
            ("#211B35", "#8B5CF6"),
            ("#18272D", "#D6A756"),
            ("#2B1C24", "#DB6A75"),
        )
        dark, accent = poster_colors[index % len(poster_colors)]
        poster.create_rectangle(0, 0, 132, 232, fill=dark, outline="")
        poster.create_oval(42, 22, 150, 130, fill=accent, outline="")
        poster.create_rectangle(0, 145, 132, 232, fill="#0B0F17", outline="")
        poster.create_line(12, 190, 116, 112, fill=self.GOLD_LIGHT, width=2)
        poster.create_text(
            12,
            214,
            text=f"SHORT {index + 1:02}",
            anchor="w",
            fill="#BEB7A8",
            font=("Consolas", 7),
        )

        title = str(project.story.get("title") or project.topic)
        genre = str(project.story.get("genre") or "AI ANIMATION")
        progress, stage = project_progress(project)
        tk.Label(
            card,
            text=genre.upper(),
            bg=self.SURFACE,
            fg=self.GOLD,
            font=("Segoe UI", 7, "bold"),
        ).grid(row=0, column=1, sticky="sw", padx=(4, 16), pady=(20, 0))
        tk.Label(
            card,
            text=title,
            bg=self.SURFACE,
            fg=self.TEXT,
            font=(self.FONT, 12 if len(title) <= 36 else 10, "bold"),
            anchor="w",
            justify="left",
            wraplength=290,
        ).grid(row=1, column=1, sticky="new", padx=(4, 16), pady=(5, 0))
        tk.Label(
            card,
            text=f"{stage}  ·  {progress}%",
            bg=self.SURFACE,
            fg=self.TEXT_SOFT,
            font=("Segoe UI", 8, "bold"),
        ).grid(row=2, column=1, sticky="sw", padx=(4, 16), pady=(8, 3))
        meter = tk.Canvas(
            card,
            height=5,
            bg=self.SURFACE,
            highlightthickness=0,
        )
        meter.grid(row=3, column=1, sticky="ew", padx=(4, 16))
        meter.bind(
            "<Configure>",
            lambda event, value=progress, widget=meter: self._draw_meter(
                widget, event.width, value
            ),
        )
        bottom = tk.Frame(card, bg=self.SURFACE)
        bottom.grid(row=4, column=1, sticky="sew", padx=(4, 16), pady=(10, 18))
        tk.Label(
            bottom,
            text=project.updated_at[:10],
            bg=self.SURFACE,
            fg=self.DIM,
            font=("Segoe UI", 7),
        ).pack(side="left")
        HoverButton(
            bottom,
            "단기 프로젝트 열기",
            lambda item=project: self._open_project(item),
            background=self.SURFACE_3,
            hover=self.PURPLE_DARK,
            foreground=self.TEXT,
            font=(self.FONT, 8, "bold"),
            padx=12,
            pady=6,
        ).pack(side="right")
        HoverButton(
            bottom,
            "삭제",
            lambda item=project: self._delete_short_project(item),
            background="#3A1822",
            hover=self.RED,
            foreground=self.TEXT,
            font=(self.FONT, 8, "bold"),
            padx=9,
            pady=6,
        ).pack(side="right", padx=(0, 6))
        return card

    def _draw_meter(self, canvas: tk.Canvas, width: int, progress: int) -> None:
        canvas.delete("all")
        canvas.create_rectangle(0, 1, width, 5, fill=self.BORDER, outline="")
        canvas.create_rectangle(
            0,
            1,
            int(width * progress / 100),
            5,
            fill=self.GOLD if progress == 100 else self.PURPLE,
            outline="",
        )

    def _render_empty_projects(self) -> None:
        empty = HoverCard(
            self.projects_grid,
            background=self.SURFACE,
            border=self.BORDER,
            hover_border=self.BORDER,
            height=238,
        )
        empty.pack(fill="x")
        empty.pack_propagate(False)
        canvas = tk.Canvas(
            empty,
            width=138,
            height=102,
            bg=self.SURFACE,
            highlightthickness=0,
        )
        canvas.pack(pady=(24, 2))
        canvas.create_rectangle(
            27, 22, 111, 81, fill=self.SURFACE_2, outline=self.BORDER, width=2
        )
        canvas.create_polygon(
            59,
            38,
            59,
            66,
            82,
            52,
            fill=self.GOLD,
        )
        canvas.create_line(18, 13, 18, 89, fill=self.PURPLE, width=2)
        canvas.create_line(120, 13, 120, 89, fill=self.GOLD, width=2)
        tk.Label(
            empty,
            text="첫 번째 이야기를 시작하세요",
            bg=self.SURFACE,
            fg=self.TEXT,
            font=(self.FONT, 13, "bold"),
        ).pack()
        tk.Label(
            empty,
            text="주제를 입력하면 AI가 대본과 장면 이미지 6장을 설계합니다.",
            bg=self.SURFACE,
            fg=self.MUTED,
            font=(self.FONT, 8),
        ).pack(pady=(5, 11))
        HoverButton(
            empty,
            "새 단기 프로젝트",
            self._open_project_brief,
            background=self.PURPLE,
            hover="#765DE4",
            font=(self.FONT, 8, "bold"),
            padx=15,
            pady=7,
        ).pack()

    def _build_quick_actions(self) -> None:
        self.quick_anchor = tk.Frame(self.page, bg=self.BG)
        self.quick_anchor.pack(fill="x", padx=34, pady=(0, 34))
        self._section_header(
            self.quick_anchor,
            "ACTION MATRIX",
            "빠른 작업",
            "가장 자주 쓰는 제작 작업을 우선순위에 따라 배치했습니다.",
        )
        grid = tk.Frame(self.quick_anchor, bg=self.BG)
        grid.pack(fill="x")
        actions = (
            (
                "◇",
                "Asset Library",
                "전역 캐릭터·배경·소품·스타일",
                self._open_asset_library,
                self.GOLD,
            ),
            (
                "V",
                "이미지 검토",
                "장면 1~6 · 승인 · 재생성",
                self._choose_short_image_review,
                self.GOLD,
            ),
            (
                "⚙",
                "설정·환경",
                "API·예산·출력 환경",
                self._show_settings,
                self.DIM,
            ),
        )
        for column in range(3):
            grid.columnconfigure(column, weight=1, uniform="quick")
        for index, (icon, title, caption, command, accent) in enumerate(actions):
            row, column, columnspan = index // 3, index % 3, 1
            card = HoverCard(
                grid,
                background=self.SURFACE,
                border=self.BORDER,
                hover_border=accent,
                height=104,
                cursor="hand2",
            )
            card.grid(
                row=row,
                column=column,
                columnspan=columnspan,
                sticky="nsew",
                padx=(0, 10) if column < 2 else 0,
                pady=(0, 12),
            )
            card.grid_propagate(False)
            icon_label = tk.Label(
                card,
                text=icon,
                bg=self.SURFACE_3,
                fg=accent,
                width=3,
                height=1,
                font=("Segoe UI", 13, "bold"),
            )
            icon_label.pack(side="left", padx=16)
            copy = tk.Frame(card, bg=self.SURFACE)
            copy.pack(side="left", fill="both", expand=True, pady=18)
            tk.Label(
                copy,
                text=title,
                bg=self.SURFACE,
                fg=self.TEXT,
                font=(self.FONT, 10, "bold"),
            ).pack(anchor="w")
            tk.Label(
                copy,
                text=caption,
                bg=self.SURFACE,
                fg=self.MUTED,
                font=(self.FONT, 8),
            ).pack(anchor="w", pady=(5, 0))
            arrow = tk.Label(
                card,
                text="→",
                bg=self.SURFACE,
                fg=self.DIM,
                font=("Segoe UI", 12),
            )
            arrow.pack(side="right", padx=16)
            for widget in (card, icon_label, copy, arrow):
                widget.bind("<Button-1>", lambda event, action=command: action())

    def _build_footer(self, parent: tk.Misc) -> None:
        footer = tk.Frame(
            parent,
            bg="#070B15",
            highlightbackground=self.BORDER_SOFT,
            highlightthickness=1,
        )
        footer.pack(side="bottom", fill="x")
        inner = tk.Frame(footer, bg="#070B15")
        inner.pack(fill="x", padx=24, pady=9)
        self.footer_status = tk.Label(
            inner,
            text="단기 프로젝트 데이터를 불러오는 중입니다.",
            bg="#070B15",
            fg=self.MUTED,
            font=(self.FONT, 8),
        )
        self.footer_status.pack(side="left")
        tk.Label(
            inner,
            text="OPENAI 이미지 생성  ·  RUNWAY 영상 생성  ·  FFMPEG 자동 병합",
            bg="#070B15",
            fg=self.DIM,
            font=("Segoe UI", 7, "bold"),
        ).pack(side="right")

    def _show_skeleton(self) -> None:
        for child in self.projects_grid.winfo_children():
            child.destroy()
        skeleton = tk.Frame(self.projects_grid, bg=self.BG)
        skeleton.pack(fill="x")
        tk.Label(
            skeleton,
            text="단기 프로젝트 상태를 동기화하는 중…",
            bg=self.BG,
            fg=self.GOLD,
            font=(self.FONT, 8, "bold"),
        ).pack(anchor="w", pady=(0, 10))
        for column in range(3):
            card = tk.Frame(
                skeleton,
                bg=self.SURFACE,
                height=170,
                highlightbackground=self.BORDER,
                highlightthickness=1,
            )
            card.pack(
                side="left",
                fill="x",
                expand=True,
                padx=(0, 12) if column < 2 else 0,
            )
            card.pack_propagate(False)
            for width in (18, 31, 24):
                tk.Frame(
                    card,
                    bg=self.SURFACE_3,
                    height=10,
                    width=width * 6,
                ).pack(anchor="w", padx=18, pady=(20 if width == 18 else 6, 0))

    def _open_project_brief(
        self,
        *,
        episode_store: LongStoryStore | None = None,
        episode_number: int | None = None,
        episode_service: LongStoryService | None = None,
        parent: tk.Misc | None = None,
        on_episode_complete: Callable[[], None] | None = None,
        existing_project: ProjectContext | None = None,
        initial_step: int = 0,
        on_project_saved: Callable[[ProjectContext], None] | None = None,
    ) -> None:
        window = tk.Toplevel(self)
        self._build_short_project_wizard(
            window,
            episode_store=episode_store,
            episode_number=episode_number,
            episode_service=episode_service,
            parent=parent,
            on_episode_complete=on_episode_complete,
            existing_project=existing_project,
            initial_step=initial_step,
            on_project_saved=on_project_saved,
        )
        return
        window.title("PRISM FORGE — New Project Board")
        self._fit_window(window, 1220, 720, 960, 600)
        window.configure(bg=self.BG)
        window.transient(self)
        window.grab_set()

        top = tk.Frame(window, bg="#080D1A", height=78)
        top.pack(fill="x")
        top.pack_propagate(False)
        copy = tk.Frame(top, bg="#080D1A")
        copy.pack(side="left", padx=24, pady=13)
        tk.Label(
            copy,
            text="PRISM FORGE  /  NEW PROJECT BOARD",
            bg="#080D1A",
            fg=self.GOLD,
            font=("Segoe UI", 8, "bold"),
        ).pack(anchor="w")
        tk.Label(
            copy,
            text="새로운 30초 작품 설계",
            bg="#080D1A",
            fg=self.TEXT,
            font=(self.FONT, 17, "bold"),
        ).pack(anchor="w", pady=(5, 0))
        HoverButton(
            top,
            "취소",
            window.destroy,
            background=self.SURFACE_2,
            hover=self.SURFACE_3,
            foreground=self.MUTED,
            font=(self.FONT, 8, "bold"),
            padx=13,
            pady=7,
        ).pack(side="right", padx=28)

        body = tk.Frame(window, bg=self.BG)
        body.pack(fill="both", expand=True, padx=20, pady=18)
        body.columnconfigure(0, minsize=170)
        body.columnconfigure(1, weight=3)
        body.columnconfigure(2, weight=1, minsize=240)
        body.rowconfigure(0, weight=1)

        steps = tk.Frame(
            body,
            bg="#0B1422",
            highlightbackground=self.BORDER,
            highlightthickness=1,
        )
        steps.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        tk.Label(
            steps,
            text="PROJECT SETUP",
            bg="#0B1422",
            fg=self.MUTED,
            font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w", padx=16, pady=(18, 12))
        step_names = (
            "프로젝트 개요",
            "분위기 & 스타일",
            "씬 설정",
            "후보 Asset 선택",
            "최종 확인",
        )
        for index, step_name in enumerate(step_names, start=1):
            active = index == 1
            step = tk.Frame(
                steps,
                bg="#192744" if active else "#0B1422",
                height=42,
            )
            step.pack(fill="x", padx=8, pady=2)
            step.pack_propagate(False)
            tk.Label(
                step,
                text=str(index),
                bg=self.PURPLE if active else "#0B1422",
                fg=self.TEXT if active else self.MUTED,
                font=("Segoe UI", 8, "bold"),
                width=2,
            ).pack(side="left", padx=(8, 7), pady=9)
            tk.Label(
                step,
                text=step_name,
                bg="#192744" if active else "#0B1422",
                fg=self.TEXT if active else self.TEXT_SOFT,
                font=(self.FONT, 8, "bold" if active else "normal"),
            ).pack(side="left")

        form = tk.Frame(
            body,
            bg=self.SURFACE,
            highlightbackground=self.BORDER,
            highlightthickness=1,
        )
        form.grid(row=0, column=1, sticky="nsew", padx=(0, 12))
        form.columnconfigure(0, weight=1)
        form.columnconfigure(1, weight=1)
        self.brief_topic = self._brief_entry(
            form,
            "PROJECT IDEA",
            "영상 주제",
            0,
            columnspan=2,
            multiline=True,
        )
        self.brief_genre = self._brief_combo(
            form,
            "GENRE",
            "장르",
            (
                "미스터리",
                "모험",
                "판타지",
                "코미디",
                "드라마",
                "액션",
            ),
            2,
            0,
        )
        self.brief_mood = self._brief_combo(
            form,
            "ATMOSPHERE",
            "전체 분위기",
            (
                "시네마틱",
                "따뜻하고 유쾌함",
                "긴장감",
                "몽환적",
                "에너지 넘침",
                "감성적",
            ),
            2,
            1,
        )
        self.brief_duration = self._brief_combo(
            form,
            "RUNTIME",
            "영상 길이",
            ("15초", "30초", "45초", "60초"),
            4,
            0,
        )
        self.brief_scenes = self._brief_combo(
            form,
            "SCENE PLAN",
            "장면 수",
            ("6개 장면",),
            4,
            1,
        )

        side = tk.Frame(body, bg=self.BG)
        side.grid(row=0, column=2, sticky="nsew")
        reference_summary = "선택된 Reference 프로젝트 없음"
        if self.reference_source_project_id:
            try:
                source_manager = ProjectReferenceManager(
                    self.config_data.project_root
                    / "learning_data"
                    / "projects",
                    self.reference_source_project_id,
                )
                enabled_count = sum(
                    asset.enabled for asset in source_manager.load_all()
                )
                reference_summary = (
                    f"선택 프로젝트의 활성 자산 {enabled_count}개를 사용합니다."
                )
            except (OSError, TypeError, ValueError):
                self.reference_source_project_id = None
        ref_card = tk.Frame(
            side,
            bg=self.SURFACE,
            highlightbackground=self.BORDER,
            highlightthickness=1,
        )
        ref_card.pack(fill="x")
        tk.Label(
            ref_card,
            text="ASSET LIBRARY",
            bg=self.SURFACE,
            fg=self.GOLD,
            font=("Segoe UI", 8, "bold"),
        ).pack(anchor="w", padx=18, pady=(18, 3))
        tk.Label(
            ref_card,
            text="후보 Asset 전체 전달",
            bg=self.SURFACE,
            fg=self.TEXT,
            font=(self.FONT, 11, "bold"),
        ).pack(anchor="w", padx=18)
        tk.Label(
            ref_card,
            text=(
                "캐릭터 참고 이미지를 다시 올리지 않습니다.\n"
                "Asset Library의 캐릭터·스타일·배경을\n"
                f"프로젝트 후보로 자동 연결합니다.\n\n{reference_summary}"
            ),
            justify="left",
            bg=self.SURFACE,
            fg=self.MUTED,
            font=(self.FONT, 8),
        ).pack(anchor="w", padx=18, pady=(7, 18))

        info = tk.Frame(
            side,
            bg="#101B32",
            highlightbackground=self.BORDER,
            highlightthickness=1,
        )
        info.pack(fill="x", pady=(14, 0))
        tk.Label(
            info,
            text="실시간 요약",
            bg="#101B32",
            fg=self.GOLD,
            font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w", padx=16, pady=(14, 4))
        self.brief_summary_var = tk.StringVar(
            value="미스터리 · 시네마틱 · 30초 · 장면 6개"
        )
        tk.Label(
            info,
            textvariable=self.brief_summary_var,
            justify="left",
            bg="#101B32",
            fg=self.TEXT_SOFT,
            font=(self.FONT, 8),
        ).pack(anchor="w", padx=16, pady=(0, 14))

        def update_summary(event: tk.Event[tk.Misc] | None = None) -> None:
            self.brief_summary_var.set(
                f"{self.brief_genre.get()} · {self.brief_mood.get()} · "
                f"{self.brief_duration.get()} · {self.brief_scenes.get()}\n"
                "OpenAI 생성 → 사용자 검토 → 외부 Runway 영상 생성"
            )

        for combo in (
            self.brief_genre,
            self.brief_mood,
            self.brief_duration,
            self.brief_scenes,
        ):
            combo.bind("<<ComboboxSelected>>", update_summary)
            combo.bind("<KeyRelease>", update_summary)
        update_summary()

        instructions = tk.Frame(
            side,
            bg=self.SURFACE,
            highlightbackground=self.BORDER,
            highlightthickness=1,
        )
        instructions.pack(fill="both", expand=True, pady=(14, 0))
        tk.Label(
            instructions,
            text="ADDITIONAL NOTES",
            bg=self.SURFACE,
            fg=self.GOLD,
            font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w", padx=16, pady=(14, 3))
        tk.Label(
            instructions,
            text="추가 지시사항",
            bg=self.SURFACE,
            fg=self.TEXT,
            font=(self.FONT, 9, "bold"),
        ).pack(anchor="w", padx=16)
        self.brief_notes = tk.Text(
            instructions,
            height=3,
            wrap="word",
            bg=self.SURFACE_3,
            fg=self.TEXT,
            insertbackground=self.GOLD,
            relief="flat",
            font=(self.FONT, 9),
            padx=10,
            pady=9,
            highlightbackground=self.BORDER,
            highlightcolor=self.ORANGE,
            highlightthickness=1,
        )
        self.brief_notes.pack(fill="both", expand=True, padx=16, pady=(9, 14))

        action = tk.Frame(window, bg="#080D1A", height=74)
        action.pack(fill="x", side="bottom")
        action.pack_propagate(False)
        tk.Label(
            action,
            text="예상 결과  ·  대본 1개  ·  장면 6개  ·  이미지 6장",
            bg="#080D1A",
            fg=self.MUTED,
            font=(self.FONT, 8),
        ).pack(side="left", padx=34)
        HoverButton(
            action,
            "최종 확인·생성  →",
            lambda: self._submit_brief(window),
            background=self.PURPLE,
            hover="#765DE4",
            font=(self.FONT, 10, "bold"),
            padx=24,
            pady=11,
        ).pack(side="right", padx=34)
        # Reserve the action bar before the expanding body, including on
        # Windows displays using 125–150% scaling.
        action.pack_forget()
        action.pack(fill="x", side="bottom", before=body)
        self._fade_in(window)

    def _build_short_project_wizard(
        self,
        window: tk.Toplevel,
        *,
        episode_store: LongStoryStore | None = None,
        episode_number: int | None = None,
        episode_service: LongStoryService | None = None,
        parent: tk.Misc | None = None,
        on_episode_complete: Callable[[], None] | None = None,
        existing_project: ProjectContext | None = None,
        initial_step: int = 0,
        on_project_saved: Callable[[ProjectContext], None] | None = None,
    ) -> None:
        """Build the five working steps for a short-project production brief."""
        episode_mode = (
            episode_store is not None
            and episode_number is not None
            and episode_service is not None
        )
        long_project = episode_store.load_project() if episode_mode else None
        long_episode = (
            episode_store.load_episode(episode_number)
            if episode_mode and episode_number is not None else None
        )
        window.title(
            "PRISM FORGE — Episode Production Wizard"
            if episode_mode
            else (
                "PRISM FORGE — 프로젝트 설정"
                if existing_project is not None
                else "PRISM FORGE — New Project Wizard"
            )
        )
        self._fit_window(window, 1220, 720, 960, 600)
        window.configure(bg=self.BG)
        window.transient(parent or self)
        window.grab_set()

        values: dict[str, tk.Variable] = {
            "name": tk.StringVar(),
            "topic": tk.StringVar(),
            "genre": tk.StringVar(value="미스터리"),
            "logline": tk.StringVar(),
            "character": tk.StringVar(),
            "lore": tk.StringVar(),
            "mood": tk.StringVar(value="시네마틱"),
            "visual_style": tk.StringVar(),
            "color": tk.StringVar(),
            "lighting": tk.StringVar(),
            "camera": tk.StringVar(),
            "dialogue": tk.StringVar(),
            "avoid": tk.StringVar(),
            "duration": tk.StringVar(value="30초"),
            "scenes": tk.StringVar(value="6개 장면"),
            "aspect": tk.StringVar(value="16:9"),
        }
        notes_value = tk.StringVar()
        values["notes"] = notes_value
        if existing_project is not None and not episode_mode:
            lore = existing_project.lore_context
            style_notes = lore.get("style_notes", {})
            values["name"].set(str(
                lore.get("project_name")
                or existing_project.story.get("title")
                or "단기 프로젝트"
            ))
            values["topic"].set(existing_project.topic)
            values["genre"].set(str(
                existing_project.style_profile.get("genre", "미스터리")
            ))
            values["logline"].set(str(lore.get("full_story", "")))
            values["character"].set(str(
                existing_project.character_profile.get("name", "")
            ))
            values["lore"].set(str(lore.get("lore", "")))
            values["mood"].set(str(
                existing_project.style_profile.get("mood", "시네마틱")
            ))
            for key in (
                "visual_style", "color", "lighting", "camera",
                "dialogue", "avoid", "aspect",
            ):
                values[key].set(str(style_notes.get(key, "")))
            values["duration"].set(
                f"{int(lore.get('duration_seconds', 30))}초"
            )
            values["scenes"].set(
                f"{int(lore.get('scene_count', 6))}개 장면"
            )
            notes_value.set(str(lore.get("additional_notes", "")))
        if long_project is not None and long_episode is not None:
            outline = long_episode.outline or {}
            values["name"].set(
                long_episode.title or f"Episode {long_episode.number:02d}"
            )
            values["topic"].set(str(
                outline.get("main_event")
                or outline.get("core_event")
                or long_episode.core_event
                or outline.get("summary")
                or long_episode.summary
            ))
            values["genre"].set(long_project.genre or "미스터리")
            values["logline"].set(str(
                outline.get("summary") or long_episode.summary
            ))
            values["lore"].set(long_project.overview)
            values["mood"].set(long_project.tone or "시네마틱")
            values["duration"].set(
                f"{long_episode.duration_seconds or long_project.episode_duration_seconds}초"
            )
            values["scenes"].set("6개 장면")
            values["aspect"].set(long_project.aspect_ratio or "9:16")
        selected_ids: set[str] = set()
        folder_selections: dict[str, list[str]] = {}
        character_cast: dict[str, dict[str, str]] = {}
        atmosphere_asset_ids: set[str] = set()
        scene_reference_assets: dict[str, str] = {}
        previous_scene_link: dict[str, object] = {}
        auto_folder_opened: set[str] = set()
        episode_script_editor: dict[str, tk.Text | None] = {"widget": None}
        if existing_project is not None and not episode_mode:
            saved_previous_link = user_selected_short_scene_link(
                existing_project.lore_context.get("previous_scene_link", {})
            )
            if saved_previous_link:
                previous_scene_link.update(saved_previous_link)
            saved_atmosphere = existing_project.lore_context.get(
                "atmosphere_asset_ids", []
            )
            if isinstance(saved_atmosphere, list):
                atmosphere_asset_ids.update(
                    str(asset_id) for asset_id in saved_atmosphere
                )
            saved_scene_references = existing_project.lore_context.get(
                "scene_reference_assets", {}
            )
            if isinstance(saved_scene_references, dict):
                scene_reference_assets.update({
                    str(asset_id): str(purpose)
                    for asset_id, purpose in saved_scene_references.items()
                })
            saved_cast = existing_project.character_profile.get("cast", [])
            if isinstance(saved_cast, list):
                character_cast.update({
                    str(item["asset_id"]): {
                        "asset_id": str(item["asset_id"]),
                        "cast_role": str(item.get("cast_role", "supporting")),
                        "story_role": str(
                            item.get("story_role", "서브 캐릭터")
                        ),
                    }
                    for item in saved_cast
                    if isinstance(item, dict) and item.get("asset_id")
                })
            existing_mappings = ProjectAssetMappingStore(
                self.config_data.project_root / "learning_data" / "projects",
                existing_project.project_id,
            ).load_all()
            selected_ids.update(
                item.asset_id for item in existing_mappings
                if item.candidate_only and item.enabled
            )
            folder_selections.update({
                item.asset_id: list(item.selected_child_asset_ids)
                for item in existing_mappings
                if item.candidate_only and item.selected_child_asset_ids
            })
        if episode_mode and long_project is not None and episode_number is not None:
            saved_previous_link = (
                long_episode.outline.get("previous_scene_link", {})
                if long_episode is not None else {}
            )
            if isinstance(saved_previous_link, dict):
                previous_scene_link.update(saved_previous_link)
            episode_mappings = ProjectAssetMappingStore(
                self.config_data.project_root / "learning_data" / "projects",
                long_project.project_id,
            ).load_all()
            selected_ids.update(
                item.asset_id for item in episode_mappings
                if item.candidate_only and item.enabled
                and item.episode_scope.includes(episode_number)
            )
            for item in episode_mappings:
                if item.candidate_only and item.selected_child_asset_ids:
                    folder_selections[item.asset_id] = list(
                        item.selected_child_asset_ids
                    )
        if not episode_mode:
            library = AssetLibrary(
                self.config_data.project_root / "learning_data"
            )
            selected_ids.intersection_update({
                asset.asset_id for asset in library.search(
                    asset_type="character", include_disabled=False
                )
                if not asset.parent_folder_id
            })
            character_cast = {
                asset_id: item
                for asset_id, item in character_cast.items()
                if asset_id in selected_ids
            }

        def all_delivery_asset_ids() -> set[str]:
            """Combine separately managed Character and atmosphere Assets."""
            return (
                set(selected_ids)
                | set(atmosphere_asset_ids)
                | set(scene_reference_assets)
            )

        current = {"step": 0}
        step_names = (
            "프로젝트 개요",
            "분위기 & 스타일",
            "씬 설정",
            "후보 Asset 선택" if episode_mode else "등장 캐릭터 선택",
            "최종 확인",
        )

        top = tk.Frame(window, bg="#070D17", height=76)
        top.pack(fill="x")
        top.pack_propagate(False)
        tk.Label(
            top,
            text=(
                f"Episode {episode_number:02d} 제작"
                if episode_mode and episode_number is not None
                else "새로운 30초 작품 설계"
            ),
            bg="#070D17", fg=self.TEXT,
            font=(self.FONT, 17, "bold"),
        ).pack(side="left", padx=24, pady=20)
        api_label = (
            "API 준비됨" if self.config_data.openai_api_key
            else "API 키 미설정 · 프로젝트 저장만 가능"
        )
        tk.Label(
            top, text=api_label, bg="#070D17",
            fg=self.GREEN if self.config_data.openai_api_key else self.ORANGE,
            font=(self.FONT, 8, "bold"),
        ).pack(side="right", padx=24)

        body = tk.Frame(window, bg=self.BG, name="short_wizard_body")
        body.pack(fill="both", expand=True, padx=20, pady=16)
        body.columnconfigure(0, minsize=190)
        body.columnconfigure(1, weight=1)
        body.columnconfigure(2, minsize=250)
        body.rowconfigure(0, weight=1)
        steps = self._card(body, background="#0B1422")
        steps.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        center = self._card(body, background=self.SURFACE)
        center.grid(row=0, column=1, sticky="nsew", padx=(0, 12))
        summary_panel = self._card(body, background="#0B1422")
        summary_panel.grid(row=0, column=2, sticky="nsew")
        tk.Label(
            steps, text="PROJECT SETUP", bg="#0B1422", fg=self.MUTED,
            font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w", padx=14, pady=(18, 10))
        step_buttons: list[HoverButton] = []

        error_value = tk.StringVar()
        error_label = tk.Label(
            center, textvariable=error_value, bg=self.SURFACE, fg=self.RED,
            font=(self.FONT, 8, "bold"),
        )
        footer = tk.Frame(
            window, bg="#070D17", height=68, name="short_wizard_footer"
        )
        footer.pack(fill="x", side="bottom")
        footer.pack_propagate(False)
        # Reserve the navigation bar before the expanding Wizard body. Without
        # this order Windows display scaling can push the bar below the screen.
        footer.pack_forget()
        footer.pack(fill="x", side="bottom", before=body)
        back_button = HoverButton(
            footer, "이전 단계", lambda: show_step(current["step"] - 1),
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 8, "bold"), padx=16, pady=9,
        )
        back_button.pack(side="left", padx=22, pady=13)
        next_button = HoverButton(
            footer, "다음 단계", lambda: show_step(current["step"] + 1),
            background=self.PURPLE, hover="#7048D9",
            font=(self.FONT, 8, "bold"), padx=18, pady=9,
        )
        next_button.pack(side="right", padx=22, pady=13)

        def field(
            parent: tk.Misc, label: str, key: str, row: int, column: int = 0,
            *, choices: tuple[str, ...] | None = None,
            columnspan: int = 1, multiline: bool = False,
        ) -> tk.Widget:
            area = tk.Frame(parent, bg=self.SURFACE)
            area.grid(
                row=row, column=column, columnspan=columnspan,
                sticky="ew", padx=16, pady=(9, 2)
            )
            tk.Label(
                area, text=label, bg=self.SURFACE, fg=self.TEXT_SOFT,
                font=(self.FONT, 8, "bold"),
            ).pack(anchor="w", pady=(0, 5))
            if multiline:
                text = tk.Text(
                    area, height=4, wrap="word", bg=self.SURFACE_3,
                    fg=self.TEXT, insertbackground=self.GOLD, relief="flat",
                    font=(self.FONT, 9), padx=8, pady=6,
                )
                text.insert("1.0", str(values[key].get()))
                text.bind(
                    "<KeyRelease>",
                    lambda _event, target=text, variable=values[key]:
                    variable.set(target.get("1.0", "end-1c")),
                )
                widget = text
            elif choices:
                widget: tk.Widget = ttk.Combobox(
                    area, textvariable=values[key], values=choices,
                    state="normal", style="Studio.TCombobox",
                )
            else:
                widget = tk.Entry(
                    area, textvariable=values[key], bg=self.SURFACE_3,
                    fg=self.TEXT, insertbackground=self.GOLD, relief="flat",
                    font=(self.FONT, 9),
                )
            widget.pack(fill="x", ipady=5)
            return widget

        def clear_center() -> tk.Frame:
            for child in center.winfo_children():
                if child is not error_label:
                    child.destroy()
            page = tk.Frame(center, bg=self.SURFACE)
            page.pack(fill="both", expand=True, padx=10, pady=8)
            page.columnconfigure(0, weight=1)
            page.columnconfigure(1, weight=1)
            return page

        asset_state: dict[str, object] = {"assets": [], "listbox": None}

        def choose_folder_references(
            asset: LibraryAsset,
            on_saved: Callable[[bool], None],
            *,
            assign_default_cast: bool = False,
        ) -> None:
            """Reuse one Folder child selector across Wizard steps."""
            library = AssetLibrary(
                self.config_data.project_root / "learning_data"
            )
            children = library.folder_children(asset)
            picker = tk.Toplevel(window)
            picker.title(f"Asset Folder — {asset.display_name}")
            self._fit_window(picker, 720, 560, 620, 480)
            picker.configure(bg=self.BG)
            picker.transient(window)
            picker.grab_set()
            self._window_header(
                picker, "ASSET FOLDER  /  REFERENCE SELECT",
                asset.display_name,
                "Image AI에 전달할 Folder 내부 Reference를 선택하세요.",
            )
            listing = tk.Listbox(
                picker, selectmode="multiple", bg=self.SURFACE,
                fg=self.TEXT, selectbackground=self.PURPLE,
                relief="flat", font=(self.FONT, 9),
            )
            listing.pack(fill="both", expand=True, padx=22, pady=14)
            selected = set(folder_selections.get(asset.asset_id, []))
            if not selected:
                selected = {child.asset_id for child in children}
            for index, child in enumerate(children):
                try:
                    library.resolve_path(child)
                    file_state = "정상"
                except ReferenceAssetError:
                    file_state = "누락"
                listing.insert(
                    "end",
                    f"{child.role or 'other'} · {child.display_name} · "
                    f"{child.original_filename} · {file_state}",
                )
                if child.asset_id in selected:
                    listing.selection_set(index)
            status = tk.StringVar()

            def update_status(_event: object | None = None) -> None:
                status.set(
                    f"선택한 Reference {len(listing.curselection())} / "
                    f"전체 {len(children)}"
                )

            listing.bind("<<ListboxSelect>>", update_status)
            update_status()
            tk.Label(
                picker, textvariable=status, bg=self.BG, fg=self.GREEN,
                font=(self.FONT, 8, "bold"),
            ).pack(anchor="w", padx=22)
            actions = tk.Frame(picker, bg=self.BG)
            actions.pack(fill="x", padx=22, pady=(10, 18))

            def save_selection() -> None:
                chosen = [
                    children[index].asset_id
                    for index in listing.curselection()
                ]
                if not chosen:
                    self._toast(
                        "사용할 Reference를 한 장 이상 선택하세요.",
                        kind="warning",
                    )
                    return
                folder_selections[asset.asset_id] = chosen
                if (
                    assign_default_cast
                    and asset.asset_type == "character"
                    and asset.asset_id not in character_cast
                ):
                    character_cast[asset.asset_id] = {
                        "asset_id": asset.asset_id,
                        "cast_role": "supporting",
                        "story_role": "서브 캐릭터",
                    }
                picker.destroy()
                on_saved(True)

            HoverButton(
                actions, "전체 선택",
                lambda: (
                    listing.selection_set(0, "end"),
                    update_status(),
                ),
                background=self.SURFACE_3, hover=self.BORDER,
                font=(self.FONT, 8, "bold"), padx=12, pady=7,
            ).pack(side="left", padx=(0, 6))
            HoverButton(
                actions, "전체 해제",
                lambda: (
                    listing.selection_clear(0, "end"),
                    update_status(),
                ),
                background=self.SURFACE_3, hover=self.BORDER,
                font=(self.FONT, 8, "bold"), padx=12, pady=7,
            ).pack(side="left")
            HoverButton(
                actions, "선택 완료", save_selection,
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 8, "bold"), padx=16, pady=8,
            ).pack(side="right")
            self._fade_in(picker)

        def render_overview() -> None:
            host = clear_center()
            overview_canvas = tk.Canvas(
                host, bg=self.SURFACE, highlightthickness=0
            )
            overview_scroll = ttk.Scrollbar(
                host, orient="vertical", command=overview_canvas.yview
            )
            page = tk.Frame(overview_canvas, bg=self.SURFACE)
            page.columnconfigure(0, weight=1)
            page.columnconfigure(1, weight=1)
            page_window = overview_canvas.create_window(
                (0, 0), window=page, anchor="nw"
            )
            page.bind(
                "<Configure>",
                lambda _event: overview_canvas.configure(
                    scrollregion=overview_canvas.bbox("all")
                ),
            )
            overview_canvas.bind(
                "<Configure>",
                lambda event: overview_canvas.itemconfigure(
                    page_window, width=event.width
                ),
            )
            overview_canvas.configure(yscrollcommand=overview_scroll.set)
            overview_scroll.pack(side="right", fill="y")
            overview_canvas.pack(side="left", fill="both", expand=True)
            self._bind_scroll_canvas(overview_canvas)
            tk.Label(
                page, text="1. 프로젝트 개요", bg=self.SURFACE, fg=self.TEXT,
                font=(self.FONT, 14, "bold"),
            ).grid(row=0, column=0, columnspan=2, sticky="w", padx=16, pady=10)
            field(page, "프로젝트 이름 *", "name", 1)
            field(page, "영상 주제 *", "topic", 1, 1)
            field(
                page, "장르", "genre", 2, choices=(
                    "미스터리", "모험", "판타지", "코미디", "드라마", "액션"
                ),
            )
            lead_area = tk.Frame(page, bg=self.SURFACE)
            lead_area.grid(
                row=2, column=1, sticky="ew", padx=16, pady=(9, 2)
            )
            tk.Label(
                lead_area, text="대표 캐릭터 (Character Asset)",
                bg=self.SURFACE, fg=self.TEXT_SOFT,
                font=(self.FONT, 8, "bold"),
            ).pack(anchor="w", pady=(0, 5))
            lead_body = tk.Frame(lead_area, bg=self.SURFACE_3)
            lead_body.pack(fill="x")
            tk.Label(
                lead_body, textvariable=values["character"],
                bg=self.SURFACE_3, fg=self.TEXT,
                font=(self.FONT, 9), anchor="w",
            ).pack(side="left", fill="x", expand=True, padx=8, pady=7)

            def choose_lead_character() -> None:
                assets = [
                    asset for asset in supporting_assets()
                    if asset.asset_id not in {
                        item["asset_id"]
                        for item in character_cast.values()
                        if item.get("cast_role") == "supporting"
                    }
                ]
                if not assets:
                    self._toast(
                        "선택할 Character Asset이 없습니다.",
                        kind="warning",
                    )
                    return
                picker = tk.Toplevel(window)
                picker.title("PRISM FORGE — 대표 캐릭터 선택")
                self._fit_window(picker, 620, 460, 520, 380)
                picker.configure(bg=self.BG)
                picker.transient(window)
                picker.grab_set()
                self._window_header(
                    picker, "PROJECT CAST  /  LEAD CHARACTER",
                    "대표 캐릭터 선택",
                    "Asset 카드를 클릭하고 대표 캐릭터로 지정하세요.",
                )
                body = self._card(picker)
                body.pack(fill="both", expand=True, padx=20, pady=14)
                listing = tk.Listbox(
                    body, bg=self.SURFACE_3, fg=self.TEXT,
                    selectbackground=self.PURPLE, relief="flat",
                    font=(self.FONT, 9), activestyle="none",
                )
                listing.pack(
                    fill="both", expand=True, padx=14, pady=(14, 8)
                )
                for asset in assets:
                    listing.insert(
                        "end",
                        f"{asset.display_name}  ·  "
                        f"{asset.description or '설명 없음'}",
                    )
                current_name = values["character"].get().strip().casefold()
                for index, asset in enumerate(assets):
                    if asset.display_name.casefold() == current_name:
                        listing.selection_set(index)
                        listing.see(index)
                        break

                def save_lead() -> None:
                    selection = listing.curselection()
                    if not selection:
                        self._toast(
                            "대표 캐릭터 Asset을 클릭해 선택하세요.",
                            kind="warning",
                        )
                        return
                    asset = assets[selection[0]]
                    for item in character_cast.values():
                        if item.get("cast_role") == "lead":
                            item["cast_role"] = "supporting"
                            item["story_role"] = "서브 캐릭터"
                    selected_ids.add(asset.asset_id)
                    character_cast[asset.asset_id] = {
                        "asset_id": asset.asset_id,
                        "cast_role": "lead",
                        "story_role": "주인공",
                    }
                    values["character"].set(asset.display_name)
                    if asset.is_folder:
                        library = AssetLibrary(
                            self.config_data.project_root / "learning_data"
                        )
                        folder_selections[asset.asset_id] = [
                            child.asset_id
                            for child in library.folder_children(asset)
                        ]
                    picker.destroy()
                    refresh_supporting_list()
                    update_side_summary()

                listing.bind(
                    "<Double-Button-1>", lambda _event: save_lead()
                )
                HoverButton(
                    body, "대표 캐릭터로 지정", save_lead,
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=14, pady=8,
                ).pack(anchor="e", padx=14, pady=(0, 14))
                self._fade_in(picker)

            HoverButton(
                lead_body, "Asset 선택", choose_lead_character,
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 7, "bold"), padx=11, pady=6,
            ).pack(side="right", padx=5, pady=4)
            supporting_area = tk.Frame(page, bg=self.SURFACE)
            supporting_area.grid(
                row=3, column=0, columnspan=2, sticky="ew",
                padx=16, pady=(9, 2),
            )
            tk.Label(
                supporting_area,
                text="서브 캐릭터 (Character Asset)",
                bg=self.SURFACE, fg=self.TEXT_SOFT,
                font=(self.FONT, 8, "bold"),
            ).pack(anchor="w", pady=(0, 5))
            supporting_body = tk.Frame(supporting_area, bg=self.SURFACE_3)
            supporting_body.pack(fill="x")
            supporting_list = tk.Listbox(
                supporting_body, height=2, bg=self.SURFACE_3,
                fg=self.TEXT, selectbackground=self.PURPLE,
                relief="flat", font=(self.FONT, 8),
                activestyle="none",
            )
            supporting_list.pack(
                side="left", fill="both", expand=True, padx=6, pady=6
            )
            supporting_actions = tk.Frame(
                supporting_body, bg=self.SURFACE_3
            )
            supporting_actions.pack(side="right", padx=6, pady=5)

            def supporting_assets() -> list[LibraryAsset]:
                library = AssetLibrary(
                    self.config_data.project_root / "learning_data"
                )
                return [
                    asset for asset in library.search(
                        asset_type="character", include_disabled=False
                    )
                    if not asset.parent_folder_id
                ]

            def refresh_supporting_list() -> None:
                supporting_list.delete(0, "end")
                library = AssetLibrary(
                    self.config_data.project_root / "learning_data"
                )
                for item in character_cast.values():
                    if item.get("cast_role") != "supporting":
                        continue
                    try:
                        name = library.get(item["asset_id"]).display_name
                    except ReferenceAssetError:
                        name = item["asset_id"]
                    supporting_list.insert(
                        "end",
                        f"{name}  ·  {item.get('story_role') or '서브 캐릭터'}",
                    )

            def edit_supporting(
                asset_id: str | None = None,
            ) -> None:
                assets = supporting_assets()
                if not assets:
                    self._toast(
                        "Asset Library에 Character Asset을 먼저 등록하세요.",
                        kind="warning",
                    )
                    return
                dialog = tk.Toplevel(window)
                dialog.title("PRISM FORGE — 서브 캐릭터 추가")
                self._fit_window(dialog, 560, 360, 500, 330)
                dialog.configure(bg=self.BG)
                dialog.transient(window)
                dialog.grab_set()
                self._window_header(
                    dialog,
                    "PROJECT CAST  /  SUPPORTING CHARACTER",
                    "서브 캐릭터 추가",
                    "Character Asset과 이 프로젝트에서 맡을 역할을 선택하세요.",
                )
                body = self._card(dialog)
                body.pack(fill="both", expand=True, padx=20, pady=14)
                initial = (
                    next(
                        (
                            asset.display_name for asset in assets
                            if asset.asset_id == asset_id
                        ),
                        assets[0].display_name,
                    )
                )
                name_value = tk.StringVar(value=initial)
                role_value = tk.StringVar(value=(
                    character_cast.get(asset_id or "", {})
                    .get("story_role", "서브 캐릭터")
                ))
                tk.Label(
                    body, text="Character Asset", bg=self.SURFACE,
                    fg=self.TEXT_SOFT, font=(self.FONT, 8, "bold"),
                ).pack(anchor="w", padx=14, pady=(14, 5))
                ttk.Combobox(
                    body, textvariable=name_value,
                    values=tuple(asset.display_name for asset in assets),
                    state="readonly", style="Studio.TCombobox",
                ).pack(fill="x", padx=14, ipady=4)
                tk.Label(
                    body, text="이야기 속 역할", bg=self.SURFACE,
                    fg=self.TEXT_SOFT, font=(self.FONT, 8, "bold"),
                ).pack(anchor="w", padx=14, pady=(12, 5))
                role_entry = tk.Entry(
                    body, textvariable=role_value, bg=self.SURFACE_3,
                    fg=self.TEXT, insertbackground=self.GOLD,
                    relief="flat", font=(self.FONT, 9),
                )
                role_entry.pack(fill="x", padx=14, ipady=6)
                presets = tk.Frame(body, bg=self.SURFACE)
                presets.pack(fill="x", padx=14, pady=(7, 2))
                for preset in (
                    "친구", "조력자", "안내자", "라이벌", "가족", "적대자"
                ):
                    HoverButton(
                        presets, preset,
                        lambda value=preset: role_value.set(value),
                        background=self.SURFACE_3, hover=self.BORDER,
                        font=(self.FONT, 7), padx=8, pady=4,
                    ).pack(side="left", padx=(0, 5))
                tk.Label(
                    body,
                    text=(
                        "이 캐릭터가 이야기에서 하는 일을 구체적으로 "
                        "적거나 위 역할을 클릭하세요."
                    ),
                    bg=self.SURFACE, fg=self.MUTED,
                    font=(self.FONT, 7),
                ).pack(anchor="w", padx=14, pady=(4, 10))

                def save_supporting() -> None:
                    selected_asset = next(
                        asset for asset in assets
                        if asset.display_name == name_value.get()
                    )
                    lead_name = values["character"].get().strip().casefold()
                    if selected_asset.display_name.casefold() == lead_name:
                        self._toast(
                            "대표 캐릭터와 같은 Asset은 서브로 추가할 수 없습니다.",
                            kind="warning",
                        )
                        return
                    if asset_id and asset_id != selected_asset.asset_id:
                        character_cast.pop(asset_id, None)
                        selected_ids.discard(asset_id)
                        folder_selections.pop(asset_id, None)
                    selected_ids.add(selected_asset.asset_id)
                    character_cast[selected_asset.asset_id] = {
                        "asset_id": selected_asset.asset_id,
                        "cast_role": "supporting",
                        "story_role": (
                            role_value.get().strip() or "서브 캐릭터"
                        ),
                    }
                    if selected_asset.is_folder:
                        children = AssetLibrary(
                            self.config_data.project_root / "learning_data"
                        ).folder_children(selected_asset)
                        folder_selections[selected_asset.asset_id] = [
                            child.asset_id for child in children
                        ]
                    dialog.destroy()
                    refresh_supporting_list()
                    update_side_summary()

                HoverButton(
                    body, "추가·저장", save_supporting,
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=14, pady=8,
                ).pack(anchor="e", padx=14, pady=(0, 14))
                self._fade_in(dialog)

            def selected_supporting_id() -> str | None:
                selection = supporting_list.curselection()
                supporting_ids = [
                    asset_id for asset_id, item in character_cast.items()
                    if item.get("cast_role") == "supporting"
                ]
                if not selection or selection[0] >= len(supporting_ids):
                    return None
                return supporting_ids[selection[0]]

            def remove_supporting() -> None:
                asset_id = selected_supporting_id()
                if not asset_id:
                    return
                character_cast.pop(asset_id, None)
                selected_ids.discard(asset_id)
                folder_selections.pop(asset_id, None)
                refresh_supporting_list()
                update_side_summary()

            HoverButton(
                supporting_actions, "+ 추가",
                edit_supporting,
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 7, "bold"), padx=10, pady=6,
            ).pack(fill="x", pady=2)
            HoverButton(
                supporting_actions, "역할 수정",
                lambda: (
                    edit_supporting(selected_supporting_id())
                    if selected_supporting_id() else None
                ),
                background=self.SURFACE_2, hover=self.BORDER,
                font=(self.FONT, 7, "bold"), padx=10, pady=6,
            ).pack(fill="x", pady=2)
            HoverButton(
                supporting_actions, "삭제",
                remove_supporting,
                background="#4A2028", hover=self.RED,
                font=(self.FONT, 7, "bold"), padx=10, pady=6,
            ).pack(fill="x", pady=2)
            supporting_list.bind(
                "<Double-Button-1>",
                lambda _event: (
                    edit_supporting(selected_supporting_id())
                    if selected_supporting_id() else None
                ),
            )
            refresh_supporting_list()
            continuity_area = tk.Frame(page, bg=self.SURFACE)
            continuity_area.grid(
                row=4, column=0, columnspan=2, sticky="ew",
                padx=16, pady=(10, 2),
            )
            tk.Label(
                continuity_area, text="이전 장면 연결",
                bg=self.SURFACE, fg=self.TEXT_SOFT,
                font=(self.FONT, 8, "bold"),
            ).pack(anchor="w", pady=(0, 5))
            continuity_body = tk.Frame(
                continuity_area, bg=self.SURFACE_3
            )
            continuity_body.pack(fill="x")
            continuity_summary = tk.StringVar()
            tk.Label(
                continuity_body, textvariable=continuity_summary,
                bg=self.SURFACE_3, fg=self.TEXT, anchor="w",
                justify="left", wraplength=540,
                font=(self.FONT, 8),
            ).pack(
                side="left", fill="x", expand=True, padx=9, pady=8
            )
            continuity_actions = tk.Frame(
                continuity_body, bg=self.SURFACE_3
            )
            continuity_actions.pack(side="right", padx=6, pady=5)

            def refresh_continuity_summary() -> None:
                if previous_scene_link:
                    continuity_summary.set(
                        f"{previous_scene_link.get('label') or previous_scene_link.get('project_name')}\n"
                        "Story AI에는 마지막 상황, Image AI에는 마지막 장면을 "
                        "Scene 1 연속성 Reference로 전달"
                    )
                else:
                    continuity_summary.set(
                        "연결 안 함\n독립적인 새 이야기와 장면으로 시작합니다."
                    )

            def previous_episode_option() -> dict[str, object] | None:
                if (
                    not episode_mode or episode_store is None
                    or episode_number is None or episode_number <= 1
                    or long_project is None
                ):
                    return None
                try:
                    previous = episode_store.load_episode(
                        episode_number - 1
                    )
                except ValueError:
                    return None
                if (
                    previous.state not in {
                        "waiting_for_video_confirmation", "edited", "upload_ready",
                        "uploaded", "completed",
                    }
                    or len(previous.generated_images) < 6
                ):
                    return None
                path = Path(previous.generated_images[5]).resolve()
                previous_root = episode_store.episode_root(
                    previous.number
                ).resolve()
                if (
                    previous_root not in path.parents
                    or not path.is_file()
                ):
                    return None
                scenes = previous.script.get("scenes", [])
                last_scene = next(
                    (
                        item for item in scenes
                        if int(item.get("number", 0)) == 6
                    ),
                    scenes[-1] if scenes else {},
                )
                story_context = "\n".join((
                    f"이전 Episode: {previous.number:02d}화 {previous.title}",
                    f"이전 Episode 요약: {previous.summary or '별도 요약 없음'}",
                    "마지막 장면: "
                    + str(last_scene.get("description", "별도 설명 없음")),
                    "이전 결말: "
                    + str(previous.script.get("ending", "별도 결말 없음")),
                    "위 마지막 상황과 자연스럽게 이어서 시작하십시오.",
                ))
                return {
                    "source_kind": "long_episode",
                    "project_id": long_project.project_id,
                    "episode_number": previous.number,
                    "scene_number": 6,
                    "project_name": long_project.title,
                    "label": (
                        f"{previous.number:02d}화 {previous.title} · 마지막 장면"
                    ),
                    "story_context": story_context,
                    "image_path": str(path),
                }

            def choose_previous_scene() -> None:
                if episode_mode:
                    option = previous_episode_option()
                    if option is None:
                        self._toast(
                            "바로 전 Episode의 이미지 승인과 마지막 장면이 "
                            "완료되어야 연결할 수 있습니다.",
                            kind="warning",
                        )
                        return
                    previous_scene_link.clear()
                    previous_scene_link.update(option)
                    refresh_continuity_summary()
                    update_side_summary()
                    return

                memory = MemoryManager(
                    self.config_data.project_root
                    / "learning_data" / "projects"
                )
                options: list[dict[str, object]] = []
                for project in memory.list_projects():
                    if (
                        existing_project is not None
                        and project.project_id == existing_project.project_id
                    ):
                        continue
                    try:
                        option = short_scene_continuity_option(
                            memory.projects_directory, project.project_id
                        )
                    except (OSError, ValueError):
                        continue
                    option["label"] = (
                        f"{option['project_name']} · Scene 6"
                    )
                    options.append(option)
                if not options:
                    self._toast(
                        "연결 가능한 이미지 승인 완료 단기 프로젝트가 없습니다.",
                        kind="warning",
                    )
                    return
                picker = tk.Toplevel(window)
                picker.title("PRISM FORGE — 이전 장면 연결")
                self._fit_window(picker, 660, 470, 540, 390)
                picker.configure(bg=self.BG)
                picker.transient(window)
                picker.grab_set()
                self._window_header(
                    picker, "STORY CONTINUITY  /  PREVIOUS SCENE",
                    "이전 장면 연결",
                    "이전 프로젝트의 승인된 마지막 장면과 이야기를 이어갑니다.",
                )
                card = self._card(picker)
                card.pack(fill="both", expand=True, padx=20, pady=14)
                listing = tk.Listbox(
                    card, bg=self.SURFACE_3, fg=self.TEXT,
                    selectbackground=self.PURPLE, relief="flat",
                    font=(self.FONT, 9), activestyle="none",
                )
                listing.pack(
                    fill="both", expand=True, padx=14, pady=(14, 8)
                )
                for option in options:
                    listing.insert("end", str(option["label"]))

                def save_previous_scene() -> None:
                    selection = listing.curselection()
                    if not selection:
                        self._toast("이전 프로젝트를 선택하세요.", kind="warning")
                        return
                    previous_scene_link.clear()
                    previous_scene_link.update(options[selection[0]])
                    picker.destroy()
                    refresh_continuity_summary()
                    update_side_summary()

                listing.bind(
                    "<Double-Button-1>",
                    lambda _event: save_previous_scene(),
                )
                HoverButton(
                    card, "선택한 마지막 장면 연결", save_previous_scene,
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=14, pady=8,
                ).pack(anchor="e", padx=14, pady=(0, 14))

            def disconnect_previous_scene() -> None:
                previous_scene_link.clear()
                refresh_continuity_summary()
                update_side_summary()

            HoverButton(
                continuity_actions,
                (
                    "이전 Episode 연결"
                    if episode_mode else "이전 프로젝트 선택"
                ),
                choose_previous_scene,
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 7, "bold"), padx=10, pady=6,
            ).pack(fill="x", pady=2)
            HoverButton(
                continuity_actions, "연결 해제",
                disconnect_previous_scene,
                background="#4A2028", hover=self.RED,
                font=(self.FONT, 7, "bold"), padx=10, pady=6,
            ).pack(fill="x", pady=2)
            refresh_continuity_summary()

            field(page, "세계관", "lore", 5, columnspan=2)
            field(
                page, "전체 줄거리", "logline", 6,
                columnspan=2, multiline=True,
            )
            field(page, "추가 지시사항", "notes", 7, columnspan=2)

        def render_style() -> None:
            # This step is taller than the available center column on smaller
            # displays. Scroll only its content; the Wizard footer stays fixed.
            host = clear_center()
            style_canvas = tk.Canvas(
                host, bg=self.SURFACE, highlightthickness=0
            )
            style_scroll = ttk.Scrollbar(
                host, orient="vertical", command=style_canvas.yview
            )
            page = tk.Frame(style_canvas, bg=self.SURFACE)
            page.columnconfigure(0, weight=1)
            page.columnconfigure(1, weight=1)
            page_window = style_canvas.create_window(
                (0, 0), window=page, anchor="nw"
            )
            page.bind(
                "<Configure>",
                lambda _event: style_canvas.configure(
                    scrollregion=style_canvas.bbox("all")
                ),
            )
            style_canvas.bind(
                "<Configure>",
                lambda event: style_canvas.itemconfigure(
                    page_window, width=event.width
                ),
            )
            style_canvas.configure(yscrollcommand=style_scroll.set)
            style_scroll.pack(side="right", fill="y")
            style_canvas.pack(side="left", fill="both", expand=True)
            self._bind_scroll_canvas(style_canvas)
            tk.Label(
                page, text="2. 분위기 & 스타일", bg=self.SURFACE, fg=self.TEXT,
                font=(self.FONT, 14, "bold"),
            ).grid(row=0, column=0, columnspan=2, sticky="w", padx=16, pady=10)
            labels = (
                ("전체 분위기", "mood"), ("시각적 스타일", "visual_style"),
                ("색감", "color"), ("조명", "lighting"),
                ("카메라 느낌", "camera"), ("대사 스타일", "dialogue"),
                ("피해야 할 요소", "avoid"),
            )
            for index, (label, key) in enumerate(labels):
                field(page, label, key, 1 + index // 2, index % 2)
            atmosphere_area = tk.Frame(page, bg=self.SURFACE)
            atmosphere_area.grid(
                row=5, column=0, columnspan=2, sticky="ew",
                padx=16, pady=(10, 4),
            )
            atmosphere_heading = tk.Frame(
                atmosphere_area, bg=self.SURFACE
            )
            atmosphere_heading.pack(fill="x", pady=(0, 5))
            tk.Label(
                atmosphere_heading,
                text="영상·장면 전체 분위기 Reference Asset",
                bg=self.SURFACE, fg=self.TEXT_SOFT,
                font=(self.FONT, 8, "bold"),
            ).pack(side="left", anchor="w")
            tk.Label(
                atmosphere_heading,
                text=(
                    "권장 유형: Style · General Reference · Background\n"
                    "색감·조명·배경 분위기·전체 그림체를 보여주는 Asset"
                ),
                bg=self.SURFACE, fg=self.MUTED,
                font=(self.FONT, 7), justify="left",
                wraplength=390,
            ).pack(side="left", anchor="w", padx=(14, 0))
            atmosphere_body = tk.Frame(
                atmosphere_area, bg=self.SURFACE_3
            )
            atmosphere_body.pack(fill="x")
            atmosphere_list = tk.Listbox(
                atmosphere_body, height=2, bg=self.SURFACE_3,
                fg=self.TEXT, selectbackground=self.PURPLE,
                relief="flat", font=(self.FONT, 8),
                activestyle="none",
            )
            atmosphere_list.pack(
                side="left", fill="both", expand=True, padx=6, pady=6
            )
            atmosphere_actions = tk.Frame(
                atmosphere_body, bg=self.SURFACE_3
            )
            atmosphere_actions.pack(side="right", padx=6, pady=5)

            def available_atmosphere_assets() -> list[LibraryAsset]:
                library = AssetLibrary(
                    self.config_data.project_root / "learning_data"
                )
                allowed_types = {
                    "style", "general_reference", "background"
                }
                return [
                    asset for asset in library.search(
                        include_disabled=False
                    )
                    if not asset.parent_folder_id
                    and asset.asset_type in allowed_types
                ]

            def refresh_atmosphere_list() -> None:
                atmosphere_list.delete(0, "end")
                library = AssetLibrary(
                    self.config_data.project_root / "learning_data"
                )
                for asset_id in sorted(atmosphere_asset_ids):
                    try:
                        asset = library.get(asset_id)
                    except ReferenceAssetError:
                        continue
                    atmosphere_list.insert(
                        "end",
                        f"{asset.display_name}  ·  {asset.asset_type}  ·  "
                        f"{asset.description or '설명 없음'}",
                    )

            def add_atmosphere_asset() -> None:
                assets = available_atmosphere_assets()
                picker = tk.Toplevel(window)
                picker.title("PRISM FORGE — 전체 분위기 Asset 추가")
                self._fit_window(picker, 620, 400, 520, 350)
                picker.configure(bg=self.BG)
                picker.transient(window)
                picker.grab_set()
                self._window_header(
                    picker,
                    "PROJECT MOOD  /  GLOBAL REFERENCE",
                    "전체 분위기 Reference Asset",
                    "모든 장면의 공통 분위기와 시각 방향에 사용할 Asset입니다.",
                )
                body = self._card(picker)
                body.pack(fill="both", expand=True, padx=20, pady=14)
                tk.Label(
                    body, text="분위기 Reference Asset", bg=self.SURFACE,
                    fg=self.TEXT_SOFT, font=(self.FONT, 8, "bold"),
                ).pack(anchor="w", padx=14, pady=(16, 5))
                asset_value = tk.StringVar(
                    value=assets[0].display_name if assets else ""
                )
                selector = ttk.Combobox(
                    body, textvariable=asset_value,
                    values=tuple(asset.display_name for asset in assets),
                    state="readonly", style="Studio.TCombobox",
                )
                selector.pack(fill="x", padx=14, ipady=4)
                detail_value = tk.StringVar()
                tk.Label(
                    body, textvariable=detail_value,
                    bg=self.SURFACE_3, fg=self.TEXT_SOFT,
                    font=(self.FONT, 8), justify="left",
                    anchor="nw", wraplength=510, padx=10, pady=9,
                ).pack(fill="both", expand=True, padx=14, pady=(10, 4))

                def selected_asset() -> LibraryAsset | None:
                    return next(
                        (
                            asset for asset in assets
                            if asset.display_name == asset_value.get()
                        ),
                        None,
                    )

                def refresh_detail(_event: object | None = None) -> None:
                    asset = selected_asset()
                    if asset is None:
                        detail_value.set(
                            "선택 가능한 Style·General Reference·Background "
                            "Asset이 없습니다.\nAsset Library에서 먼저 등록하세요."
                        )
                        return
                    folder_note = (
                        "\n다음 단계에서 Folder 내부 Reference를 선택합니다."
                        if asset.is_folder else ""
                    )
                    detail_value.set(
                        f"유형  {asset.asset_type}\n"
                        f"설명  {asset.description or '설명 없음'}"
                        f"{folder_note}"
                    )

                selector.bind("<<ComboboxSelected>>", refresh_detail)
                refresh_detail()
                tk.Label(
                    body,
                    text=(
                        "Story AI에는 이름·유형·설명이 전달되고, "
                        "Image AI에는 실제 이미지도 함께 전달됩니다."
                    ),
                    bg=self.SURFACE, fg=self.MUTED,
                    font=(self.FONT, 7), wraplength=500,
                    justify="left",
                ).pack(anchor="w", padx=14, pady=10)

                def save_atmosphere_asset() -> None:
                    asset = selected_asset()
                    if asset is None:
                        self._toast(
                            "추가할 분위기 Asset이 없습니다.",
                            kind="warning",
                        )
                        return

                    def finish_add(_saved: bool = True) -> None:
                        atmosphere_asset_ids.add(asset.asset_id)
                        refresh_atmosphere_list()
                        update_side_summary()

                    picker.destroy()
                    if asset.is_folder:
                        choose_folder_references(
                            asset,
                            finish_add,
                        )
                        return
                    finish_add()

                HoverButton(
                    body, "선택한 Asset 추가", save_atmosphere_asset,
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=14, pady=8,
                ).pack(anchor="e", padx=14, pady=(0, 14))
                self._fade_in(picker)

            def remove_atmosphere_asset() -> None:
                selection = atmosphere_list.curselection()
                ordered = sorted(atmosphere_asset_ids)
                if not selection or selection[0] >= len(ordered):
                    return
                removed_id = ordered[selection[0]]
                atmosphere_asset_ids.discard(removed_id)
                folder_selections.pop(removed_id, None)
                refresh_atmosphere_list()
                update_side_summary()

            HoverButton(
                atmosphere_actions, "+ Asset 추가",
                add_atmosphere_asset,
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 7, "bold"), padx=10, pady=6,
            ).pack(fill="x", pady=2)
            HoverButton(
                atmosphere_actions, "분위기 연결 해제",
                remove_atmosphere_asset,
                background="#4A2028", hover=self.RED,
                font=(self.FONT, 7, "bold"), padx=10, pady=6,
            ).pack(fill="x", pady=2)
            refresh_atmosphere_list()

            scene_reference_area = tk.Frame(page, bg=self.SURFACE)
            scene_reference_area.grid(
                row=6, column=0, columnspan=2, sticky="ew",
                padx=16, pady=(8, 4),
            )
            tk.Label(
                scene_reference_area,
                text="장면 참고 Asset",
                bg=self.SURFACE, fg=self.TEXT_SOFT,
                font=(self.FONT, 8, "bold"),
            ).pack(anchor="w")
            tk.Label(
                scene_reference_area,
                text=(
                    "배경·소품·시각 스타일·일반 참고자료를 추가하고 "
                    "이 프로젝트에서의 사용 목적을 적습니다."
                ),
                bg=self.SURFACE, fg=self.MUTED,
                font=(self.FONT, 7), wraplength=650, justify="left",
            ).pack(anchor="w", pady=(2, 5))
            scene_reference_body = tk.Frame(
                scene_reference_area, bg=self.SURFACE_3
            )
            scene_reference_body.pack(fill="x")
            scene_reference_list = tk.Listbox(
                scene_reference_body, height=2, bg=self.SURFACE_3,
                fg=self.TEXT, selectbackground=self.PURPLE,
                relief="flat", font=(self.FONT, 8), activestyle="none",
            )
            scene_reference_list.pack(
                side="left", fill="both", expand=True, padx=6, pady=6
            )
            scene_reference_actions = tk.Frame(
                scene_reference_body, bg=self.SURFACE_3
            )
            scene_reference_actions.pack(side="right", padx=6, pady=5)

            def ordered_scene_reference_ids() -> list[str]:
                return sorted(scene_reference_assets)

            def refresh_scene_reference_list() -> None:
                scene_reference_list.delete(0, "end")
                library = AssetLibrary(
                    self.config_data.project_root / "learning_data"
                )
                missing: list[str] = []
                for asset_id in ordered_scene_reference_ids():
                    try:
                        asset = library.get(asset_id)
                    except ReferenceAssetError:
                        missing.append(asset_id)
                        continue
                    scene_reference_list.insert(
                        "end",
                        f"{asset.display_name} · "
                        f"{STORY_ASSET_TYPE_LABELS.get(asset.asset_type, asset.asset_type)}"
                        f" · 목적: {scene_reference_assets[asset_id]}",
                    )
                for asset_id in missing:
                    scene_reference_assets.pop(asset_id, None)

            def selected_scene_reference_id() -> str | None:
                selection = scene_reference_list.curselection()
                ordered = ordered_scene_reference_ids()
                if not selection or selection[0] >= len(ordered):
                    return None
                return ordered[selection[0]]

            def add_scene_reference() -> None:
                asset = self._choose_library_asset(
                    window,
                    title="장면 참고 Asset 선택",
                    asset_filter=lambda item: (
                        not item.parent_folder_id
                        and item.asset_type in {
                            "background", "object", "style",
                            "general_reference",
                        }
                        and item.asset_id not in atmosphere_asset_ids
                    ),
                )
                if asset is None:
                    return
                purpose = simpledialog.askstring(
                    "장면 참고 Asset 사용 목적",
                    (
                        f"'{asset.display_name}'을 이 프로젝트에서 어떻게 "
                        "사용할지 적어주세요.\n\n"
                        "예: 주인공이 항상 들고 다니는 열쇠\n"
                        "예: 야간 장면의 기본 골목 배경"
                    ),
                    initialvalue=scene_reference_assets.get(asset.asset_id, ""),
                    parent=window,
                )
                if purpose is None:
                    return
                purpose = purpose.strip()
                if not purpose:
                    self._toast("장면 참고 Asset의 사용 목적을 입력하세요.", kind="warning")
                    return

                def finish_add(_saved: bool = True) -> None:
                    scene_reference_assets[asset.asset_id] = purpose
                    refresh_scene_reference_list()
                    update_side_summary()

                if asset.is_folder:
                    choose_folder_references(asset, finish_add)
                else:
                    finish_add()

            def edit_scene_reference_purpose() -> None:
                asset_id = selected_scene_reference_id()
                if asset_id is None:
                    self._toast("수정할 장면 참고 Asset을 선택하세요.", kind="warning")
                    return
                purpose = simpledialog.askstring(
                    "사용 목적 수정",
                    "이 Asset의 프로젝트 내 사용 목적을 수정하세요.",
                    initialvalue=scene_reference_assets.get(asset_id, ""),
                    parent=window,
                )
                if purpose is None:
                    return
                if not purpose.strip():
                    self._toast("사용 목적은 비워둘 수 없습니다.", kind="warning")
                    return
                scene_reference_assets[asset_id] = purpose.strip()
                refresh_scene_reference_list()
                update_side_summary()

            def remove_scene_reference() -> None:
                asset_id = selected_scene_reference_id()
                if asset_id is None:
                    return
                scene_reference_assets.pop(asset_id, None)
                folder_selections.pop(asset_id, None)
                refresh_scene_reference_list()
                update_side_summary()

            HoverButton(
                scene_reference_actions, "+ Asset 추가",
                add_scene_reference,
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 7, "bold"), padx=10, pady=6,
            ).pack(fill="x", pady=2)
            HoverButton(
                scene_reference_actions, "사용 목적 수정",
                edit_scene_reference_purpose,
                background=self.SURFACE_2, hover=self.BORDER,
                font=(self.FONT, 7, "bold"), padx=10, pady=6,
            ).pack(fill="x", pady=2)
            HoverButton(
                scene_reference_actions, "제거",
                remove_scene_reference,
                background="#4A2028", hover=self.RED,
                font=(self.FONT, 7, "bold"), padx=10, pady=6,
            ).pack(fill="x", pady=2)
            scene_reference_list.bind(
                "<Double-Button-1>",
                lambda _event: edit_scene_reference_purpose(),
            )
            refresh_scene_reference_list()

        def render_runtime() -> None:
            page = clear_center()
            tk.Label(
                page, text="3. 실행 설정", bg=self.SURFACE, fg=self.TEXT,
                font=(self.FONT, 14, "bold"),
            ).grid(row=0, column=0, columnspan=2, sticky="w", padx=16, pady=10)
            field(
                page, "영상 길이", "duration", 1, choices=(
                    "15초", "30초", "45초", "60초"
                ),
            )
            field(page, "장면 수", "scenes", 1, 1, choices=("6개 장면",))
            field(
                page, "화면 비율", "aspect", 2, choices=("16:9", "9:16", "1:1")
            )
            tk.Label(
                page,
                text=(
                    "현재 Workflow는 장면 6개와 프로젝트 설정에 저장되는 "
                    "화면 비율만 지원합니다."
                ),
                bg=self.SURFACE, fg=self.MUTED, justify="left",
                font=(self.FONT, 8),
            ).grid(row=3, column=0, columnspan=2, sticky="w", padx=16, pady=18)

        def render_assets() -> None:
            page = clear_center()
            library = AssetLibrary(
                self.config_data.project_root / "learning_data"
            )
            page.columnconfigure(0, weight=3)
            page.columnconfigure(1, weight=2)
            page.rowconfigure(2, weight=1)
            tk.Label(
                page,
                text=(
                    "4. 후보 Asset 선택"
                    if episode_mode else "4. 등장 캐릭터 선택"
                ),
                bg=self.SURFACE, fg=self.TEXT,
                font=(self.FONT, 14, "bold"),
            ).grid(row=0, column=0, columnspan=2, sticky="w", padx=16, pady=8)
            query = tk.StringVar()
            kind = tk.StringVar(value="all" if episode_mode else "character")
            search = tk.Entry(
                page, textvariable=query, bg=self.SURFACE_3, fg=self.TEXT,
                insertbackground=self.GOLD, relief="flat",
            )
            search.grid(row=1, column=0, sticky="ew", padx=(16, 6), pady=5)
            filter_row = tk.Frame(page, bg=self.SURFACE)
            filter_row.grid(row=1, column=1, sticky="ew", padx=(6, 16), pady=5)
            if episode_mode:
                kinds = ttk.Combobox(
                    filter_row, textvariable=kind, state="readonly", width=13,
                    values=(
                        "all", "character", "background", "object", "style",
                        "general_reference",
                    ),
                )
                kinds.pack(side="left", fill="x", expand=True)
            else:
                tk.Label(
                    filter_row,
                    text=(
                        "Character Asset만 표시 · 대표 또는 서브 역할 지정"
                    ),
                    bg=self.SURFACE, fg=self.MUTED,
                    font=(self.FONT, 7), justify="left",
                ).pack(side="left", fill="x", expand=True)

            gallery_shell = tk.Frame(page, bg=self.SURFACE_3)
            gallery_shell.grid(
                row=2, column=0, sticky="nsew", padx=(16, 6), pady=7
            )
            gallery_canvas = tk.Canvas(
                gallery_shell, bg=self.SURFACE_3, highlightthickness=0
            )
            gallery_scroll = ttk.Scrollbar(
                gallery_shell, orient="vertical", command=gallery_canvas.yview
            )
            gallery = tk.Frame(gallery_canvas, bg=self.SURFACE_3)
            gallery.bind(
                "<Configure>",
                lambda event: gallery_canvas.configure(
                    scrollregion=gallery_canvas.bbox("all")
                ),
            )
            gallery_window = gallery_canvas.create_window(
                (0, 0), window=gallery, anchor="nw"
            )
            gallery_canvas.configure(yscrollcommand=gallery_scroll.set)
            gallery_scroll.pack(side="right", fill="y")
            gallery_canvas.pack(fill="both", expand=True)
            self._bind_scroll_canvas(gallery_canvas)

            detail = tk.Frame(page, bg="#0B1422")
            detail.grid(row=2, column=1, sticky="nsew", padx=(6, 16), pady=7)
            preview = tk.Canvas(
                detail, height=125, bg="#070D17", highlightthickness=0
            )
            preview.pack(fill="x", padx=10, pady=10)
            detail_value = tk.StringVar(value="Asset 카드를 선택하면 상세 정보가 표시됩니다.")
            tk.Label(
                detail, textvariable=detail_value, justify="left",
                wraplength=230, bg="#0B1422", fg=self.TEXT_SOFT,
                font=(self.FONT, 7),
            ).pack(fill="both", expand=True, anchor="nw", padx=12, pady=(0, 8))
            count = tk.StringVar()
            tk.Label(
                page, textvariable=count, bg=self.SURFACE, fg=self.GREEN,
                font=(self.FONT, 8, "bold"),
            ).grid(row=4, column=0, sticky="w", padx=16, pady=4)
            photos: dict[str, tk.PhotoImage] = {}
            shown_asset = {"id": ""}
            gallery_layout = {"columns": 0, "reload_pending": False}
            cast_status = tk.StringVar(
                value="Character Asset을 선택하면 프로젝트 역할을 지정할 수 있습니다."
            )
            cast_panel = tk.Frame(page, bg="#101C2D")
            cast_panel.grid(
                row=3, column=0, columnspan=2, sticky="ew",
                padx=16, pady=(2, 4),
            )
            cast_panel.grid_remove()
            tk.Label(
                cast_panel, text="프로젝트 등장 역할",
                bg="#101C2D", fg=self.GOLD,
                font=(self.FONT, 8, "bold"),
            ).pack(anchor="w", padx=9, pady=(8, 2))
            tk.Label(
                cast_panel, textvariable=cast_status,
                bg="#101C2D", fg=self.TEXT_SOFT,
                font=(self.FONT, 7), justify="left", wraplength=225,
            ).pack(anchor="w", padx=9, pady=(0, 7))
            cast_actions = tk.Frame(cast_panel, bg="#101C2D")
            cast_actions.pack(fill="x", padx=7, pady=(0, 8))
            cast_actions.columnconfigure(0, weight=1)
            cast_actions.columnconfigure(1, weight=1)
            cast_actions.columnconfigure(2, weight=1)

            def set_character_role(cast_role: str) -> None:
                asset_id = shown_asset["id"]
                if not asset_id:
                    return
                asset = library.get(asset_id)
                if asset.asset_type != "character":
                    return
                selected_ids.add(asset.asset_id)
                if cast_role == "lead":
                    for item in character_cast.values():
                        item["cast_role"] = "supporting"
                        if item.get("story_role") == "주인공":
                            item["story_role"] = "서브 캐릭터"
                    story_role = "주인공"
                    values["character"].set(asset.display_name)
                else:
                    role_dialog = tk.Toplevel(window)
                    role_dialog.title("PRISM FORGE — 서브 캐릭터 역할")
                    self._fit_window(role_dialog, 560, 350, 500, 320)
                    role_dialog.configure(bg=self.BG)
                    role_dialog.transient(window)
                    role_dialog.grab_set()
                    self._window_header(
                        role_dialog,
                        "PROJECT CAST  /  STORY ROLE",
                        asset.display_name,
                        "이 캐릭터가 이야기에서 맡는 역할을 지정하세요.",
                    )
                    body = self._card(role_dialog)
                    body.pack(fill="both", expand=True, padx=20, pady=14)
                    role_value = tk.StringVar(value=(
                        character_cast.get(asset.asset_id, {})
                        .get("story_role", "서브 캐릭터")
                    ))
                    tk.Label(
                        body, text="이야기 속 역할", bg=self.SURFACE,
                        fg=self.TEXT_SOFT, font=(self.FONT, 8, "bold"),
                    ).pack(anchor="w", padx=14, pady=(14, 5))
                    tk.Entry(
                        body, textvariable=role_value, bg=self.SURFACE_3,
                        fg=self.TEXT, insertbackground=self.GOLD,
                        relief="flat", font=(self.FONT, 9),
                    ).pack(fill="x", padx=14, ipady=6)
                    presets = tk.Frame(body, bg=self.SURFACE)
                    presets.pack(fill="x", padx=14, pady=8)
                    for preset in (
                        "친구", "조력자", "안내자",
                        "라이벌", "가족", "적대자",
                    ):
                        HoverButton(
                            presets, preset,
                            lambda value=preset: role_value.set(value),
                            background=self.SURFACE_3, hover=self.BORDER,
                            font=(self.FONT, 7), padx=8, pady=4,
                        ).pack(side="left", padx=(0, 5))

                    def save_role() -> None:
                        character_cast[asset.asset_id] = {
                            "asset_id": asset.asset_id,
                            "cast_role": "supporting",
                            "story_role": (
                                role_value.get().strip() or "서브 캐릭터"
                            ),
                        }
                        role_dialog.destroy()
                        show_detail(asset)
                        load_assets()
                        update_side_summary()

                    HoverButton(
                        body, "역할 저장", save_role,
                        background=self.PURPLE, hover="#7048D9",
                        font=(self.FONT, 8, "bold"), padx=14, pady=8,
                    ).pack(anchor="e", padx=14, pady=(0, 14))
                    self._fade_in(role_dialog)
                    return
                character_cast[asset.asset_id] = {
                    "asset_id": asset.asset_id,
                    "cast_role": cast_role,
                    "story_role": story_role,
                }
                show_detail(asset)
                load_assets()
                update_side_summary()

            HoverButton(
                cast_actions, "대표로 지정",
                lambda: set_character_role("lead"),
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 7, "bold"), padx=9, pady=6,
            ).grid(row=0, column=0, sticky="ew", padx=2)
            HoverButton(
                cast_actions, "서브로 지정·역할",
                lambda: set_character_role("supporting"),
                background=self.SURFACE_3, hover=self.BORDER,
                font=(self.FONT, 7, "bold"), padx=9, pady=6,
            ).grid(row=0, column=1, sticky="ew", padx=2)

            def remove_current_candidate() -> None:
                asset_id = shown_asset["id"]
                if not asset_id:
                    return
                selected_ids.discard(asset_id)
                folder_selections.pop(asset_id, None)
                character_cast.pop(asset_id, None)
                cast_status.set("후보에서 제외했습니다.")
                cast_panel.grid_remove()
                load_assets()
                update_side_summary()

            HoverButton(
                cast_actions, "등장 캐릭터에서 제외",
                remove_current_candidate,
                background="#4A2028", hover=self.RED,
                font=(self.FONT, 7, "bold"), padx=9, pady=6,
            ).grid(row=0, column=2, sticky="ew", padx=2)

            def show_detail(asset: LibraryAsset) -> None:
                shown_asset["id"] = asset.asset_id
                preview.delete("all")
                library = AssetLibrary(
                    self.config_data.project_root / "learning_data"
                )
                exists = False
                try:
                    path = library.resolve_path(asset)
                    exists = path.is_file()
                    photo = tk.PhotoImage(file=str(path))
                    scale = max(
                        1, (photo.width() + 229) // 230,
                        (photo.height() + 104) // 105,
                    )
                    photo = photo.subsample(scale, scale)
                    photos[f"preview:{asset.asset_id}"] = photo
                    preview.create_image(120, 62, image=photo)
                except (OSError, tk.TclError, ReferenceAssetError):
                    preview.create_text(
                        120, 62, text="파일 없음 / Preview 불가",
                        fill=self.MUTED, font=(self.FONT, 8),
                    )
                detail_value.set(
                    f"{asset.display_name or '등록 이미지'}\n\n"
                    f"유형  {asset.asset_type}\n"
                    f"설명  {asset.description or '—'}\n"
                    f"태그  {', '.join(asset.tags) or '—'}\n"
                    f"별칭  {', '.join(asset.aliases) or '—'}\n"
                    f"출처  {asset.source_project_id or '—'}\n"
                    f"장면  {asset.source_scene_number or '—'}\n"
                    f"파일  {'정상' if exists else '없음'}"
                )
                if asset.asset_type == "character":
                    cast_panel.grid()
                    role = character_cast.get(asset.asset_id)
                    if role:
                        label = (
                            "대표 캐릭터"
                            if role.get("cast_role") == "lead"
                            else "서브 캐릭터"
                        )
                        cast_status.set(
                            f"현재 역할: {label}\n"
                            f"이야기 역할: {role.get('story_role') or '—'}"
                        )
                    else:
                        cast_status.set(
                            "후보로 선택한 뒤 대표 또는 서브 역할을 지정하세요."
                        )
                else:
                    cast_panel.grid_remove()

            def choose_folder_children(asset: LibraryAsset) -> None:
                library = AssetLibrary(
                    self.config_data.project_root / "learning_data"
                )
                children = library.folder_children(asset)
                picker = tk.Toplevel(window)
                picker.title(f"Asset Folder — {asset.display_name}")
                self._fit_window(picker, 720, 560, 620, 480)
                picker.configure(bg=self.BG)
                picker.transient(window)
                picker.grab_set()
                self._window_header(
                    picker, "ASSET FOLDER  /  CHILD SELECT",
                    asset.display_name,
                    f"{asset.asset_type} · {asset.description or '설명 없음'}",
                )
                listing = tk.Listbox(
                    picker, selectmode="multiple", bg=self.SURFACE,
                    fg=self.TEXT, selectbackground=self.PURPLE,
                    relief="flat", font=(self.FONT, 9),
                )
                listing.pack(fill="both", expand=True, padx=22, pady=14)
                selected = set(folder_selections.get(asset.asset_id, []))
                for index, child in enumerate(children):
                    try:
                        library.resolve_path(child)
                        file_state = "정상"
                    except ReferenceAssetError:
                        file_state = "누락"
                    listing.insert(
                        "end",
                        f"{child.role or 'other'} · {child.display_name} · "
                        f"{child.original_filename} · "
                        f"{'승인' if child.approved else '미승인'} · "
                        f"{file_state}",
                    )
                    if child.asset_id in selected:
                        listing.selection_set(index)
                status = tk.StringVar()

                def update_status(_event: object | None = None) -> None:
                    status.set(
                        f"선택한 이미지 {len(listing.curselection())} / "
                        f"전체 {len(children)}"
                    )

                listing.bind("<<ListboxSelect>>", update_status)
                tk.Label(
                    picker, textvariable=status, bg=self.BG, fg=self.GREEN,
                    font=(self.FONT, 8, "bold"),
                ).pack(anchor="w", padx=22)

                def save_selection() -> None:
                    chosen = [
                        children[index].asset_id
                        for index in listing.curselection()
                    ]
                    if chosen:
                        selected_ids.add(asset.asset_id)
                        folder_selections[asset.asset_id] = chosen
                        if (
                            asset.asset_type == "character"
                            and asset.asset_id not in character_cast
                        ):
                            character_cast[asset.asset_id] = {
                                "asset_id": asset.asset_id,
                                "cast_role": "supporting",
                                "story_role": "서브 캐릭터",
                            }
                    else:
                        selected_ids.discard(asset.asset_id)
                        folder_selections.pop(asset.asset_id, None)
                        character_cast.pop(asset.asset_id, None)
                    picker.destroy()
                    show_detail(asset)
                    load_assets()
                    update_side_summary()

                def select_role() -> None:
                    role = simpledialog.askstring(
                        "역할별 선택",
                        "선택할 역할 이름",
                        parent=picker,
                    )
                    if not role:
                        return
                    for index, child in enumerate(children):
                        if child.role.casefold() == role.strip().casefold():
                            listing.selection_set(index)
                    update_status()

                def preview_selected(
                    _event: tk.Event[tk.Misc] | None = None,
                ) -> None:
                    selection = listing.curselection()
                    if not selection:
                        return
                    child = children[selection[-1]]
                    image = tk.Toplevel(picker)
                    image.title(child.display_name)
                    self._fit_window(image, 700, 620, 560, 480)
                    image.configure(bg=self.BG)
                    canvas = tk.Canvas(
                        image, bg="#080D14", highlightthickness=0
                    )
                    canvas.pack(fill="both", expand=True, padx=16, pady=16)
                    try:
                        photo = tk.PhotoImage(
                            file=str(library.resolve_path(child))
                        )
                        scale = max(
                            1, photo.width() // 620, photo.height() // 520
                        )
                        photo = photo.subsample(scale, scale)
                        canvas.create_image(350, 290, image=photo)
                        image._preview_photo = photo  # type: ignore[attr-defined]
                    except (tk.TclError, ReferenceAssetError):
                        canvas.create_text(
                            350, 290, text="Preview 불가", fill=self.MUTED
                        )

                listing.bind("<Double-Button-1>", preview_selected)

                actions = tk.Frame(picker, bg=self.BG)
                actions.pack(fill="x", padx=22, pady=14)
                HoverButton(
                    actions, "전체 선택",
                    lambda: (
                        listing.selection_set(0, "end"), update_status()
                    ),
                    background=self.SURFACE_3, hover=self.BORDER,
                    font=(self.FONT, 8, "bold"), padx=11, pady=7,
                ).pack(side="left", padx=(0, 6))
                HoverButton(
                    actions, "전체 해제",
                    lambda: (
                        listing.selection_clear(0, "end"), update_status()
                    ),
                    background=self.SURFACE_3, hover=self.BORDER,
                    font=(self.FONT, 8, "bold"), padx=11, pady=7,
                ).pack(side="left")
                HoverButton(
                    actions, "역할별 선택", select_role,
                    background=self.SURFACE_3, hover=self.BORDER,
                    font=(self.FONT, 8, "bold"), padx=11, pady=7,
                ).pack(side="left", padx=(6, 0))
                HoverButton(
                    actions, "선택 완료", save_selection,
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=13, pady=7,
                ).pack(side="right")
                update_status()
                self._fade_in(picker)

            def toggle_asset(asset: LibraryAsset) -> None:
                library = AssetLibrary(
                    self.config_data.project_root / "learning_data"
                )
                try:
                    library.resolve_path(asset)
                except ReferenceAssetError:
                    self._toast(
                        f"{asset.display_name} 파일이 없어 선택할 수 없습니다.",
                        kind="warning",
                    )
                    show_detail(asset)
                    return
                if asset.is_folder:
                    choose_folder_children(asset)
                    return
                if asset.asset_id in selected_ids:
                    # A selected Character is commonly clicked again to change
                    # its lead/supporting classification. Keep it selected and
                    # reopen the fixed role controls; explicit removal has its
                    # own button.
                    if asset.asset_type == "character":
                        show_detail(asset)
                        return
                    selected_ids.remove(asset.asset_id)
                else:
                    selected_ids.add(asset.asset_id)
                    if asset.asset_type == "character":
                        character_cast.setdefault(asset.asset_id, {
                            "asset_id": asset.asset_id,
                            "cast_role": "supporting",
                            "story_role": "서브 캐릭터",
                        })
                show_detail(asset)
                load_assets()
                update_side_summary()

            def load_assets(*_args: object) -> None:
                library = AssetLibrary(
                    self.config_data.project_root / "learning_data"
                )
                chosen_type = None if kind.get() == "all" else kind.get()
                assets = library.search(
                    query.get(), asset_type=chosen_type,
                    include_disabled=False,
                )
                assets = [
                    asset for asset in assets if not asset.parent_folder_id
                ]
                healthy_assets = []
                for asset in assets:
                    try:
                        library.resolve_path(asset)
                    except ReferenceAssetError:
                        continue
                    healthy_assets.append(asset)
                assets = healthy_assets
                asset_state["assets"] = assets
                for child in gallery.winfo_children():
                    child.destroy()
                available_width = max(1, gallery_canvas.winfo_width())
                gallery_columns = 1 if available_width < 500 else 2
                gallery_layout["columns"] = gallery_columns
                for column in range(gallery_columns):
                    gallery.columnconfigure(column, weight=1, uniform="asset")
                for index, asset in enumerate(assets):
                    selected = asset.asset_id in selected_ids
                    cast_item = character_cast.get(asset.asset_id)
                    cast_label = ""
                    if cast_item:
                        cast_label = (
                            " · 대표"
                            if cast_item.get("cast_role") == "lead"
                            else " · 서브"
                        )
                    card = tk.Frame(
                        gallery,
                        bg="#192744" if selected else self.SURFACE_2,
                        highlightbackground=(
                            self.PURPLE if selected else self.BORDER
                        ),
                        highlightthickness=2 if selected else 1,
                    )
                    card.grid(
                        row=index // gallery_columns,
                        column=index % gallery_columns,
                        sticky="nsew",
                        padx=5, pady=5,
                    )
                    thumb = tk.Canvas(
                        card, width=112, height=74, bg="#070D17",
                        highlightthickness=0,
                    )
                    thumb.pack(fill="x", padx=6, pady=(6, 3))
                    try:
                        photo = tk.PhotoImage(file=str(library.resolve_path(asset)))
                        scale = max(
                            1, (photo.width() + 105) // 106,
                            (photo.height() + 67) // 68,
                        )
                        photo = photo.subsample(scale, scale)
                        photos[asset.asset_id] = photo
                        thumb.create_image(56, 37, image=photo)
                    except (OSError, tk.TclError, ReferenceAssetError):
                        thumb.create_text(
                            56, 37, text="파일 없음", fill=self.MUTED
                        )
                    label = tk.Label(
                        card,
                        text=(
                            f"{'☑' if selected else '☐'} "
                            f"{asset.display_name or '등록 이미지'}\n"
                            f"{asset.asset_type} · "
                            + (
                                f"Folder {len(asset.child_asset_ids)}장"
                                if asset.is_folder
                                else "Reference"
                            )
                            + cast_label
                        ),
                        bg=card.cget("bg"), fg=self.TEXT, justify="left",
                        font=(self.FONT, 7),
                        wraplength=max(
                            120,
                            (available_width // gallery_columns) - 28,
                        ),
                    )
                    label.pack(anchor="w", padx=7, pady=(1, 6))
                    for widget in (card, thumb, label):
                        widget.bind(
                            "<Button-1>",
                            lambda _event, value=asset: toggle_asset(value),
                        )
                        widget.bind(
                            "<Button-3>",
                            lambda _event, value=asset: show_detail(value),
                        )
                count.set(
                    (
                        f"선택된 후보 Asset {len(selected_ids)}개"
                        if episode_mode
                        else f"선택된 등장 캐릭터 {len(selected_ids)}명"
                    )
                )

            def resize_gallery(event: tk.Event[tk.Canvas]) -> None:
                gallery_canvas.itemconfigure(
                    gallery_window, width=max(1, event.width)
                )
                desired_columns = 1 if event.width < 500 else 2
                if (
                    desired_columns == gallery_layout["columns"]
                    or gallery_layout["reload_pending"]
                ):
                    return
                gallery_layout["reload_pending"] = True

                def reload_for_width() -> None:
                    gallery_layout["reload_pending"] = False
                    if gallery_canvas.winfo_exists():
                        load_assets()

                gallery_canvas.after_idle(reload_for_width)

            gallery_canvas.bind("<Configure>", resize_gallery, add="+")
            query.trace_add("write", load_assets)
            kind.trace_add("write", load_assets)
            load_assets()
            character_name = values["character"].get().strip()
            if character_name:
                try:
                    matched = library.find_character_by_representative_name(
                        character_name
                    )
                except ReferenceAssetError:
                    matched = None
                if (
                    matched is not None and matched.is_folder
                    and matched.asset_id not in auto_folder_opened
                ):
                    auto_folder_opened.add(matched.asset_id)
                    children = library.folder_children(matched)
                    defaults = [
                        child.asset_id for child in children
                        if child.asset_id == matched.thumbnail_asset_id
                        or child.role == "front"
                    ]
                    folder_selections.setdefault(
                        matched.asset_id,
                        defaults[:2] or [
                            child.asset_id for child in children[:1]
                        ],
                    )
                    selected_ids.add(matched.asset_id)
                    for item in character_cast.values():
                        item["cast_role"] = "supporting"
                    character_cast[matched.asset_id] = {
                        "asset_id": matched.asset_id,
                        "cast_role": "lead",
                        "story_role": "주인공",
                    }
                    window.after(
                        50,
                        lambda value=matched: choose_folder_children(value),
                    )

        def render_final() -> None:
            page = clear_center()
            cast = current_character_cast()
            lead = next(
                (item["name"] for item in cast if item["cast_role"] == "lead"),
                values["character"].get() or "없음",
            )
            supporting = ", ".join(
                f"{item['name']}({item['story_role']})"
                for item in cast if item["cast_role"] == "supporting"
            ) or "없음"
            tk.Label(
                page, text="5. 최종 확인", bg=self.SURFACE, fg=self.TEXT,
                font=(self.FONT, 14, "bold"),
            ).pack(anchor="w", padx=16, pady=10)
            text = (
                f"{'Episode 제목' if episode_mode else '프로젝트 이름'}  "
                f"{values['name'].get()}\n"
                f"주제  {values['topic'].get()}\n"
                f"장르 / 분위기  {values['genre'].get()} / {values['mood'].get()}\n"
                f"길이 / 장면  {values['duration'].get()} / {values['scenes'].get()}\n"
                f"화면 비율  {values['aspect'].get()}\n"
                f"대표 캐릭터  {lead}\n"
                f"서브 캐릭터  {supporting}\n"
                f"등장 캐릭터  {len(selected_ids)}명\n"
                f"전체 분위기 Reference  {len(atmosphere_asset_ids)}개\n"
                f"장면 참고 Asset  {len(scene_reference_assets)}개\n"
                f"실제 전달 Asset 합계  {len(all_delivery_asset_ids())}개\n"
                f"추가 지시사항  {notes_value.get() or '없음'}\n\n"
                "예상 Story API 호출  최대 1회\n"
                "예상 Image API 호출  Mapping 승인 후 최대 6회\n"
                f"API 키  {'설정됨' if self.config_data.openai_api_key else '미설정'}"
            )
            tk.Label(
                page, text=text, justify="left", bg=self.SURFACE,
                fg=self.TEXT_SOFT, font=(self.FONT, 9), wraplength=540,
            ).pack(anchor="w", padx=16, pady=8)
            if (
                episode_mode and episode_store is not None
                and episode_number is not None
            ):
                current_episode = episode_store.load_episode(episode_number)
                if current_episode.state == "script_review" and current_episode.script:
                    tk.Label(
                        page, text="Episode 상세 대본 검토·수정",
                        bg=self.SURFACE, fg=self.TEXT,
                        font=(self.FONT, 9, "bold"),
                    ).pack(anchor="w", padx=16, pady=(8, 4))
                    editor = tk.Text(
                        page, height=10, wrap="none", bg=self.SURFACE_3,
                        fg=self.TEXT, insertbackground=self.GOLD,
                        relief="flat", font=("Consolas", 8),
                    )
                    editor.pack(fill="both", expand=True, padx=16, pady=(0, 6))
                    editor.insert(
                        "1.0",
                        json.dumps(
                            current_episode.script, ensure_ascii=False, indent=2
                        ),
                    )
                    episode_script_editor["widget"] = editor
            actions = tk.Frame(page, bg=self.SURFACE)
            actions.pack(anchor="w", padx=12, pady=14)
            candidate_reselection = (
                existing_project is not None
                and on_project_saved is not None
                and not episode_mode
            )
            HoverButton(
                actions,
                (
                    "후보 Asset 저장·다시 확인"
                    if candidate_reselection
                    else "Episode 설정 저장"
                    if episode_mode
                    else "프로젝트 저장"
                ),
                save_draft,
                background=(
                    self.PURPLE if candidate_reselection else self.SURFACE_3
                ),
                hover="#765DE4" if candidate_reselection else self.BORDER,
                font=(self.FONT, 8, "bold"), padx=14, pady=8,
            ).pack(side="left", padx=4)
            generate = HoverButton(
                actions,
                (
                    {
                        "script_review": "상세 대본 승인",
                        "waiting_for_asset_mapping_review": "Reference 확인·이미지 생성",
                        "asset_mapping_approved": "이미지 생성",
                        "images_partial": "누락 이미지 계속 생성",
                        "images_review": "이미지 검토 상태 확인",
                        "waiting_for_video_confirmation": "영상 생성 확인 대기 상태 확인",
                    }.get(
                        episode_store.load_episode(episode_number).state,
                        "Episode 상세 대본 생성",
                    )
                    if episode_mode and episode_store is not None
                    and episode_number is not None
                    else "대본 생성"
                ),
                generate_story,
                background=self.PURPLE, hover="#765DE4",
                font=(self.FONT, 8, "bold"), padx=14, pady=8,
            )
            if not candidate_reselection:
                generate.pack(side="left", padx=4)
            if (
                episode_mode
                and not self.config_data.openai_api_key
                and not (
                    episode_mode and episode_store is not None
                    and episode_number is not None
                    and episode_store.load_episode(episode_number).state
                    in {"script_review", "images_review", "waiting_for_video_confirmation"}
                )
            ):
                generate.configure(state="disabled", fg=self.MUTED)

        renderers = (
            render_overview, render_style, render_runtime,
            render_assets, render_final,
        )

        def validate_step(index: int) -> bool:
            if index == 0:
                missing = []
                if not values["name"].get().strip():
                    missing.append("프로젝트 이름")
                if not values["topic"].get().strip():
                    missing.append("영상 주제")
                if missing:
                    error_value.set("필수 입력: " + ", ".join(missing))
                    return False
            error_value.set("")
            return True

        def show_step(index: int) -> None:
            index = max(0, min(4, index))
            if index > current["step"] and not validate_step(current["step"]):
                return
            current["step"] = index
            renderers[index]()
            error_label.pack(side="bottom", anchor="w", padx=24, pady=4)
            back_button.configure(
                state="normal" if index else "disabled",
                fg=self.TEXT if index else self.MUTED,
            )
            next_button.configure(
                state="normal" if index < 4 else "disabled",
                fg=self.TEXT if index < 4 else self.MUTED,
            )
            for position, button in enumerate(step_buttons):
                completed = position < index
                active = position == index
                color = (
                    "#15382F" if completed
                    else "#1A2740" if active
                    else "#0B1422"
                )
                button.configure(
                    text=(
                        f"✓  {step_names[position]}"
                        if completed
                        else f"{position + 1}   {step_names[position]}"
                    ),
                    bg=color,
                    fg=(
                        self.GREEN if completed
                        else self.TEXT if active
                        else self.TEXT_SOFT
                    ),
                    highlightbackground=(
                        self.GREEN if completed
                        else self.PURPLE if active
                        else "#0B1422"
                    ),
                )
                button._base = color
            update_side_summary()

        def style_notes() -> dict[str, str]:
            return {
                key: str(values[key].get()).strip() for key in (
                    "visual_style", "color", "lighting", "camera",
                    "dialogue", "avoid", "aspect",
                ) if str(values[key].get()).strip()
            }

        def current_character_cast() -> list[dict[str, str]]:
            """Resolve project-local lead/supporting roles from selected Assets."""
            return build_project_character_cast(
                AssetLibrary(
                    self.config_data.project_root / "learning_data"
                ),
                values["character"].get().strip(),
                selected_ids,
                list(character_cast.values()),
            )

        def draft_context() -> ProjectContext:
            project_id = (
                existing_project.project_id
                if existing_project is not None
                else f"project_{uuid4().hex[:12]}"
            )
            context = (
                existing_project
                if existing_project is not None
                else ProjectContext(project_id, values["topic"].get().strip())
            )
            context.topic = values["topic"].get().strip()
            context.style_profile = {
                "genre": values["genre"].get().strip(),
                "mood": values["mood"].get().strip(),
            }
            context.character_profile = {
                "name": (
                    values["character"].get().strip()
                    or "대표 캐릭터"
                ),
                "cast": current_character_cast(),
            }
            context.lore_context = {
                "lore": (
                    values["lore"].get().strip() or "자율"
                ),
                "full_story": values["logline"].get().strip(),
                "project_name": values["name"].get().strip(),
                "duration_seconds": int(
                    "".join(filter(str.isdigit, values["duration"].get()))
                ),
                "scene_count": 6,
                "additional_notes": notes_value.get().strip(),
                "style_notes": style_notes(),
                "candidate_asset_ids": sorted(all_delivery_asset_ids()),
                "folder_child_selections": dict(folder_selections),
                "atmosphere_asset_ids": sorted(atmosphere_asset_ids),
                "scene_reference_assets": dict(scene_reference_assets),
                "previous_scene_link": dict(previous_scene_link),
            }
            if context.workflow_state == WorkflowState.INIT:
                context.transition_to(WorkflowState.READY)
            return context

        def save_draft() -> None:
            if not validate_step(0):
                show_step(0)
                return
            if episode_mode:
                save_episode_configuration()
                self._toast(
                    f"Episode {episode_number} Wizard 설정을 저장했습니다."
                )
                if on_episode_complete:
                    on_episode_complete()
                window.destroy()
                return
            context = draft_context()
            memory = MemoryManager(
                self.config_data.project_root / "learning_data" / "projects"
            )
            memory.save(context)
            store = ProjectAssetMappingStore(
                self.config_data.project_root / "learning_data" / "projects",
                context.project_id,
            )
            library = AssetLibrary(
                self.config_data.project_root / "learning_data"
            )
            if existing_project is not None:
                store.save_all([
                    item for item in store.load_all() if not item.candidate_only
                ])
            for asset_id in sorted(all_delivery_asset_ids()):
                store.add_candidate(
                    library.get(asset_id), usage_role="candidate",
                    selected_child_asset_ids=folder_selections.get(asset_id),
                )
            self._toast(
                "단기 프로젝트 설정을 수정했습니다."
                if existing_project is not None
                else "단기 프로젝트를 저장했습니다."
            )
            self.refresh()
            window.destroy()
            if on_project_saved is not None:
                self.after(0, lambda: on_project_saved(context))

        def generate_story() -> None:
            if not validate_step(0):
                show_step(0)
                return
            if (
                episode_mode and episode_store is not None
                and episode_number is not None and episode_service is not None
            ):
                save_episode_configuration()
                current_episode = episode_store.load_episode(episode_number)
                if current_episode.state == "script_review":
                    try:
                        editor = episode_script_editor.get("widget")
                        if editor is not None:
                            edited_script = json.loads(
                                editor.get("1.0", "end")
                            )
                            if edited_script != current_episode.script:
                                episode_service.update_episode_script(
                                    episode_store,
                                    episode_number,
                                    edited_script,
                                )
                        episode_service.approve_script(
                            episode_store, episode_number
                        )
                    except Exception as exc:
                        messagebox.showerror(
                            "상세 대본 승인 실패", str(exc), parent=window
                        )
                        return
                    self._toast(
                        f"Episode {episode_number} 대본 승인 · Reference 확인 대기"
                    )
                    if on_episode_complete:
                        on_episode_complete()
                    show_step(4)
                    return
                if current_episode.state in {
                    "waiting_for_asset_mapping_review",
                    "asset_mapping_approved",
                    "images_partial",
                }:
                    if not self.config_data.openai_api_key:
                        messagebox.showinfo(
                            "OpenAI API 키 필요",
                            "이미지 생성에는 OpenAI API 키가 필요합니다.",
                            parent=window,
                        )
                        return
                    try:
                        if current_episode.state == (
                            "waiting_for_asset_mapping_review"
                        ):
                            summary = episode_service.automatic_reference_summary(
                                episode_store, episode_number
                            )
                            if not messagebox.askyesno(
                                "Candidate Asset 전달 확인",
                                f"후보 Asset {len(summary['candidate_asset_ids'])}개\n"
                                "이미지 API 호출 최대 6회\n\n진행할까요?",
                                parent=window,
                            ):
                                return
                            episode_service.confirm_automatic_references(
                                episode_store, episode_number
                            )
                    except Exception as exc:
                        messagebox.showerror(
                            "Reference 확인 실패", str(exc), parent=window
                        )
                        return
                    window.destroy()

                    def run_episode_images() -> None:
                        try:
                            episode_service.generate_episode_images(
                                episode_store, episode_number
                            )
                            self.after(
                                0,
                                lambda: self._open_result_viewer(
                                    episode_store=episode_store,
                                    episode_service=episode_service,
                                    episode_number=episode_number,
                                    on_close=on_episode_complete,
                                ),
                            )
                        except Exception as exc:
                            self.after(
                                0,
                                lambda error=exc: messagebox.showerror(
                                    "Episode 이미지 생성 실패",
                                    str(error), parent=parent or self,
                                ),
                            )

                    threading.Thread(
                        target=run_episode_images, daemon=True
                    ).start()
                    return
                if current_episode.state == "images_review":
                    window.destroy()
                    self._open_result_viewer(
                        episode_store=episode_store,
                        episode_service=episode_service,
                        episode_number=episode_number,
                        on_close=on_episode_complete,
                    )
                    return
                if current_episode.state == "waiting_for_video_confirmation":
                    messagebox.showinfo(
                        "영상 생성 확인 대기",
                        "이미지 승인이 완료되어 Runway 영상 생성을 기다립니다.",
                        parent=window,
                    )
                    return
            if episode_mode and not self.config_data.openai_api_key:
                messagebox.showinfo(
                    "OpenAI API 키 필요",
                    "프로젝트 저장은 가능하지만 대본 생성에는 API 키가 필요합니다.",
                    parent=window,
                )
                return
            if episode_mode:
                if (
                    episode_store is None or episode_number is None
                    or episode_service is None
                ):
                    return
                save_episode_configuration()
                episode = episode_store.load_episode(episode_number)
                regenerate = bool(episode.script)
                if regenerate and not messagebox.askyesno(
                    "Episode 상세 대본 재생성",
                    "기존 대본은 이력에 보존됩니다. Story API 최대 1회로 "
                    "선택 Episode의 상세 대본만 다시 생성할까요?",
                    parent=window,
                ):
                    return
                instruction = episode_instruction()
                window.destroy()
                self._toast(
                    f"Episode {episode_number} 상세 대본 생성 중",
                    kind="progress",
                )

                def run_episode_story() -> None:
                    try:
                        episode_service.generate_episode_script(
                            episode_store,
                            episode_number,
                            instruction=instruction,
                            regenerate=regenerate,
                        )
                        self.after(
                            0,
                            lambda: self._toast(
                                f"Episode {episode_number} 상세 대본 검토 준비 완료"
                            ),
                        )
                        if on_episode_complete:
                            self.after(0, on_episode_complete)
                    except Exception as exc:
                        self.after(
                            0,
                            lambda error=exc: messagebox.showerror(
                                "Episode 상세 대본 생성 실패",
                                str(error),
                                parent=parent or self,
                            ),
                        )

                threading.Thread(target=run_episode_story, daemon=True).start()
                return
            duration = int(
                "".join(filter(str.isdigit, values["duration"].get()))
            )
            if existing_project is not None:
                context = draft_context()
                MemoryManager(
                    self.config_data.project_root
                    / "learning_data" / "projects"
                ).save(context)
                mapping_store = ProjectAssetMappingStore(
                    self.config_data.project_root
                    / "learning_data" / "projects",
                    context.project_id,
                )
                mapping_store.save_all([
                    item for item in mapping_store.load_all()
                    if not item.candidate_only
                ])
                library = AssetLibrary(
                    self.config_data.project_root / "learning_data"
                )
                for asset_id in sorted(all_delivery_asset_ids()):
                    mapping_store.add_candidate(
                        library.get(asset_id),
                        usage_role="candidate",
                        selected_child_asset_ids=folder_selections.get(asset_id),
                    )
            self._handle_generation_request(
                values["topic"].get().strip(),
                project_name=values["name"].get().strip(),
                genre=values["genre"].get().strip(),
                mood=values["mood"].get().strip(),
                duration_seconds=duration,
                scene_count=6,
                additional_notes=notes_value.get().strip(),
                character=values["character"].get().strip(),
                lore=values["lore"].get().strip(),
                full_story=values["logline"].get().strip(),
                style_notes=style_notes(),
                candidate_asset_ids=sorted(selected_ids),
                folder_child_selections=dict(folder_selections),
                character_cast=current_character_cast(),
                atmosphere_asset_ids=sorted(atmosphere_asset_ids),
                scene_reference_assets=dict(scene_reference_assets),
                previous_scene_link=dict(previous_scene_link),
                wizard_window=window,
                existing_project_id=(
                    existing_project.project_id
                    if existing_project is not None else None
                ),
            )

        def save_episode_configuration() -> None:
            if (
                episode_store is None or episode_number is None
                or long_project is None
            ):
                return
            episode = episode_store.load_episode(episode_number)
            episode.title = values["name"].get().strip()
            episode.summary = values["logline"].get().strip()
            episode.core_event = values["topic"].get().strip()
            episode.duration_seconds = int(
                "".join(filter(str.isdigit, values["duration"].get()))
            )
            outline = dict(episode.outline)
            outline.update({
                "episode_number": episode.number,
                "title": episode.title,
                "summary": episode.summary,
                "main_event": episode.core_event,
                "previous_scene_link": dict(previous_scene_link),
            })
            episode.outline = outline
            episode_store.save_episode(episode)
            mapping_store = ProjectAssetMappingStore(
                self.config_data.project_root / "learning_data" / "projects",
                long_project.project_id,
                review_scope=f"episode_{episode_number}",
            )
            library = AssetLibrary(
                self.config_data.project_root / "learning_data"
            )
            existing = mapping_store.load_all()
            retained = [
                item for item in existing
                if not (
                    item.candidate_only
                    and item.episode_scope.mode == "episode"
                    and item.episode_scope.episode == episode_number
                    and item.asset_id not in selected_ids
                )
            ]
            mapping_store.save_all(retained)
            for asset_id in sorted(selected_ids):
                mapping_store.add_candidate(
                    library.get(asset_id),
                    usage_role="candidate",
                    episode_scope=EpisodeScope(
                        mode="episode", episode=episode_number
                    ),
                    selected_child_asset_ids=folder_selections.get(asset_id),
                )

        def episode_instruction() -> str:
            return (
                "[Episode Wizard 수정값]\n"
                f"Episode 제목: {values['name'].get().strip()}\n"
                f"핵심 사건/주제: {values['topic'].get().strip()}\n"
                f"전체 줄거리: {values['logline'].get().strip()}\n"
                f"대표 캐릭터: {values['character'].get().strip()}\n"
                f"세계관: {values['lore'].get().strip()}\n"
                f"장르: {values['genre'].get().strip()}\n"
                f"분위기: {values['mood'].get().strip()}\n"
                f"영상 길이: {values['duration'].get().strip()}\n"
                f"장면 수: {values['scenes'].get().strip()}\n"
                f"스타일 설정: {json.dumps(style_notes(), ensure_ascii=False)}\n\n"
                "[이전 이야기 연결]\n"
                f"{previous_scene_link.get('story_context') or '연결된 이전 이야기 없음'}\n\n"
                "[사용자 추가 지시사항]\n"
                f"{notes_value.get().strip() or '별도 지시 없음'}"
            )

        side_summary = tk.StringVar()
        tk.Label(
            summary_panel, text="실시간 요약", bg="#0B1422", fg=self.TEXT,
            font=(self.FONT, 11, "bold"),
        ).pack(anchor="w", padx=18, pady=(20, 10))
        tk.Label(
            summary_panel, textvariable=side_summary, bg="#0B1422",
            fg=self.TEXT_SOFT, justify="left", wraplength=210,
            font=(self.FONT, 8),
        ).pack(anchor="w", padx=18)

        def update_side_summary(*_args: object) -> None:
            supporting_count = sum(
                item.get("cast_role") == "supporting"
                for item in character_cast.values()
            )
            def preview(value: str, fallback: str = "미입력") -> str:
                normalized = " ".join(value.split())
                if not normalized:
                    return fallback
                return (
                    normalized
                    if len(normalized) <= 54
                    else normalized[:51] + "..."
                )

            side_summary.set(
                f"{values['name'].get() or '이름 미입력'}\n\n"
                f"영상 주제  {preview(values['topic'].get())}\n"
                f"전체 줄거리  {preview(values['logline'].get(), '별도 설정 없음')}\n"
                f"장르  {values['genre'].get()}\n"
                f"분위기  {values['mood'].get()}\n"
                f"대사 스타일  "
                f"{preview(values['dialogue'].get(), '자율')}\n"
                f"길이  {values['duration'].get()}\n"
                f"장면  {values['scenes'].get()}\n"
                f"화면 비율  {values['aspect'].get()}\n"
                f"대표 캐릭터  {values['character'].get() or '기본값'}\n"
                f"서브 캐릭터  {supporting_count}명\n"
                f"세계관  {values['lore'].get() or '기본값'}\n"
                f"추가 지시  "
                f"{preview(notes_value.get(), '별도 지시 없음')}\n"
                f"등장 캐릭터  {len(selected_ids)}명\n"
                f"전체 분위기 Reference  {len(atmosphere_asset_ids)}개\n"
                f"장면 참고 Asset  {len(scene_reference_assets)}개\n"
                f"이전 장면 연결  "
                f"{previous_scene_link.get('label') or '없음'}\n"
                f"실제 전달 Asset  {len(all_delivery_asset_ids())}개\n\n"
                "대본 생성 → 캐릭터·분위기 Reference 전달\n"
                "→ 이미지 생성 → 검토 → 영상 생성 확인"
            )

        for index, label in enumerate(step_names):
            button = HoverButton(
                steps, f"{index + 1}   {label}",
                lambda position=index: show_step(position),
                background="#0B1422", hover="#192744",
                foreground=self.TEXT_SOFT, font=(self.FONT, 8),
                padx=12, pady=9,
            )
            button.pack(fill="x", padx=8, pady=2)
            step_buttons.append(button)
        for variable in values.values():
            variable.trace_add("write", update_side_summary)
        notes_value.trace_add("write", update_side_summary)
        show_step(initial_step)
        self._fade_in(window)

    def _brief_entry(
        self,
        parent: tk.Misc,
        eyebrow: str,
        label: str,
        row: int,
        *,
        columnspan: int = 1,
        multiline: bool = False,
    ) -> tk.Text | tk.Entry:
        area = tk.Frame(parent, bg=self.SURFACE)
        area.grid(
            row=row,
            column=0,
            columnspan=columnspan,
            sticky="ew",
            padx=20,
            pady=(20, 4),
        )
        tk.Label(
            area,
            text=eyebrow,
            bg=self.SURFACE,
            fg=self.GOLD,
            font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w")
        tk.Label(
            area,
            text=label,
            bg=self.SURFACE,
            fg=self.TEXT,
            font=(self.FONT, 9, "bold"),
        ).pack(anchor="w", pady=(3, 7))
        if multiline:
            widget: tk.Text | tk.Entry = tk.Text(
                area,
                height=4,
                wrap="word",
                bg=self.SURFACE_3,
                fg=self.TEXT,
                insertbackground=self.GOLD,
                relief="flat",
                font=(self.FONT, 10),
                padx=12,
                pady=10,
                highlightbackground=self.BORDER,
                highlightcolor=self.PURPLE,
                highlightthickness=1,
            )
        else:
            widget = tk.Entry(
                area,
                bg=self.SURFACE_3,
                fg=self.TEXT,
                insertbackground=self.GOLD,
                relief="flat",
                font=(self.FONT, 10),
            )
        widget.pack(fill="x")
        return widget

    def _brief_combo(
        self,
        parent: tk.Misc,
        eyebrow: str,
        label: str,
        values: tuple[str, ...],
        row: int,
        column: int,
    ) -> ttk.Combobox:
        area = tk.Frame(parent, bg=self.SURFACE)
        area.grid(
            row=row,
            column=column,
            sticky="ew",
            padx=(20, 9) if column == 0 else (9, 20),
            pady=(16, 4),
        )
        tk.Label(
            area,
            text=eyebrow,
            bg=self.SURFACE,
            fg=self.GOLD,
            font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w")
        tk.Label(
            area,
            text=label,
            bg=self.SURFACE,
            fg=self.TEXT,
            font=(self.FONT, 9, "bold"),
        ).pack(anchor="w", pady=(3, 7))
        combo = ttk.Combobox(
            area,
            values=values,
            state="normal",
            style="Studio.TCombobox",
            font=(self.FONT, 9),
        )
        combo.current(0)
        combo.pack(fill="x")
        return combo

    def _submit_brief(self, window: tk.Toplevel) -> None:
        topic = self.brief_topic.get("1.0", "end").strip()
        if not topic:
            self._toast("영상 주제를 입력해 주세요.", kind="warning")
            return
        genre = self.brief_genre.get().strip()
        mood = self.brief_mood.get().strip()
        duration_text = self.brief_duration.get().strip()
        scene_text = self.brief_scenes.get().strip()
        notes = self.brief_notes.get("1.0", "end").strip()
        if not genre or not mood:
            self._toast("장르와 전체 분위기를 입력해 주세요.", kind="warning")
            return
        try:
            duration_seconds = int(
                "".join(character for character in duration_text if character.isdigit())
            )
            scene_count = int(
                "".join(character for character in scene_text if character.isdigit())
            )
        except ValueError:
            self._toast("영상 길이와 장면 수를 숫자로 입력해 주세요.", kind="warning")
            return
        if duration_seconds <= 0:
            self._toast("영상 길이는 1초 이상이어야 합니다.", kind="warning")
            return
        if scene_count != 6:
            self._toast(
                "현재 단기 제작 워크플로는 정확히 6개 장면만 지원합니다.",
                kind="warning",
            )
            return
        self._handle_generation_request(
            topic,
            genre=genre,
            mood=mood,
            duration_seconds=duration_seconds,
            scene_count=scene_count,
            additional_notes=notes,
            wizard_window=window,
        )

    def _select_character(self, from_brief: bool = False) -> None:
        selected = filedialog.askopenfilename(
            parent=self,
            title="대표 캐릭터 기준 이미지 선택",
            initialdir=self.config_data.project_root / "character",
            filetypes=[
                ("이미지", "*.png *.jpg *.jpeg *.webp"),
                ("모든 파일", "*.*"),
            ],
        )
        if selected:
            self.character_path = Path(selected)
            if from_brief and hasattr(self, "brief_character_text"):
                self.brief_character_text.set(self.character_path.name)
            self._toast(f"캐릭터 이미지 선택 · {self.character_path.name}")

    def _select_references(self) -> None:
        selected = filedialog.askopenfilenames(
            parent=self,
            title="참고 이미지 선택",
            initialdir=self.config_data.project_root / "reference_library",
            filetypes=[
                ("이미지", "*.png *.jpg *.jpeg *.webp"),
                ("모든 파일", "*.*"),
            ],
        )
        if selected:
            self.reference_paths = [Path(path) for path in selected]
            self._toast(f"참고 이미지 {len(self.reference_paths)}개 선택")

    def _generate_story_and_images(self) -> None:
        self._open_project_brief()

    def _handle_generation_request(
        self,
        topic: str,
        *,
        genre: str = "미스터리",
        mood: str = "시네마틱",
        duration_seconds: int = 30,
        scene_count: int = 6,
        additional_notes: str = "",
        project_name: str = "",
        character: str = "",
        lore: str = "",
        full_story: str = "",
        style_notes: dict[str, str] | None = None,
        candidate_asset_ids: list[str] | None = None,
        folder_child_selections: dict[str, list[str]] | None = None,
        character_cast: list[dict[str, str]] | None = None,
        atmosphere_asset_ids: list[str] | None = None,
        scene_reference_assets: dict[str, str] | None = None,
        previous_scene_link: dict[str, object] | None = None,
        wizard_window: tk.Toplevel | None = None,
        existing_project_id: str | None = None,
    ) -> None:
        if self._generation_running:
            self._toast("동일한 생성 작업이 이미 실행 중입니다.", kind="warning")
            return
        if (
            self._story_preview_window is not None
            and self._story_preview_window.winfo_exists()
        ):
            self._story_preview_window.lift()
            self._story_preview_window.focus_force()
            return
        resolved_character = (
            character.strip()
            or (self.character_path.stem if self.character_path else "")
            or "대표 캐릭터"
        )
        resolved_lore = lore.strip() or "자율"
        effective_candidate_ids = set(candidate_asset_ids or [])
        effective_atmosphere_ids = set(atmosphere_asset_ids or [])
        effective_scene_references = {
            str(asset_id): str(purpose).strip()
            for asset_id, purpose in (scene_reference_assets or {}).items()
        }
        effective_candidate_ids.update(effective_atmosphere_ids)
        effective_candidate_ids.update(effective_scene_references)
        effective_folder_selections = {
            key: list(dict.fromkeys(value))
            for key, value in (folder_child_selections or {}).items()
        }
        try:
            character_asset_id, character_asset_metadata = (
                resolve_named_character_asset(
                    AssetLibrary(
                        self.config_data.project_root / "learning_data"
                    ),
                    resolved_character,
                )
            )
        except ReferenceAssetError as exc:
            messagebox.showerror(
                "대표 캐릭터 Asset 확인",
                str(exc),
                parent=wizard_window or self,
            )
            return
        if character_asset_id is not None:
            effective_candidate_ids.add(character_asset_id)
            character_asset = AssetLibrary(
                self.config_data.project_root / "learning_data"
            ).get(character_asset_id)
            if (
                character_asset.is_folder
                and character_asset_id not in effective_folder_selections
            ):
                children = AssetLibrary(
                    self.config_data.project_root / "learning_data"
                ).folder_children(character_asset)
                defaults = [
                    child.asset_id for child in children
                    if child.asset_id == character_asset.thumbnail_asset_id
                    or child.role == "front"
                ]
                effective_folder_selections[character_asset_id] = (
                    defaults[:2] or [child.asset_id for child in children[:1]]
                )
            self._toast(
                f"대표 캐릭터 '{resolved_character}' Asset을 자동 포함했습니다."
            )
        project_cast = build_project_character_cast(
            AssetLibrary(
                self.config_data.project_root / "learning_data"
            ),
            resolved_character,
            effective_candidate_ids,
            character_cast,
        )
        prompt_manager = PromptManager(
            self.config_data.project_root / "prompts"
        )
        prompt_manager.initialize()
        original_prompt = render_short_story_prompt(
            prompt_manager,
            topic=topic,
            genre=genre,
            mood=mood,
            duration_seconds=duration_seconds,
            scene_count=scene_count,
            additional_notes=additional_notes,
            character=resolved_character,
            lore=resolved_lore,
            project_name=project_name,
            full_story=full_story,
            style_notes=style_notes,
            character_asset_metadata=character_asset_metadata,
            character_cast_metadata=describe_character_cast(project_cast),
            atmosphere_asset_metadata=describe_story_assets(
                AssetLibrary(
                    self.config_data.project_root / "learning_data"
                ),
                effective_atmosphere_ids,
            ),
            scene_reference_asset_metadata=describe_scene_reference_assets(
                AssetLibrary(
                    self.config_data.project_root / "learning_data"
                ),
                effective_scene_references,
            ),
            project_asset_metadata=describe_story_assets(
                AssetLibrary(
                    self.config_data.project_root / "learning_data"
                ),
                effective_candidate_ids,
                exclude_asset_ids={
                    item["asset_id"] for item in project_cast
                } | effective_atmosphere_ids | set(effective_scene_references),
            ),
            previous_scene_context=str(
                (previous_scene_link or {}).get("story_context", "")
            ),
        )

        def start_generation(
            approved_prompt: str, approved_at: str
        ) -> None:
            if self._generation_running:
                return
            if wizard_window is not None and wizard_window.winfo_exists():
                wizard_window.destroy()
            self._generation_running = True
            self._open_generation_progress(
                "대본 생성",
                "Story API 요청을 처리하고 있습니다.",
            )
            self._update_generation_progress("API 요청 전송 준비")
            self._toast("대본 생성 준비 중", kind="progress")

            def progress(message: str) -> None:
                self.after(
                    0,
                    lambda value=message: (
                        self._toast(value, kind="progress"),
                        self._update_generation_progress(value),
                    ),
                )

            def run() -> None:
                try:
                    if self.generation_service is None:
                        self.generation_service = GenerationService(
                            self.config_data
                        )
                    context = self.generation_service.generate_project(
                        topic,
                        genre=genre,
                        mood=mood,
                        duration_seconds=duration_seconds,
                        scene_count=scene_count,
                        additional_notes=additional_notes,
                        project_name=project_name,
                        full_story=full_story,
                        style_notes=style_notes,
                        candidate_asset_ids=sorted(effective_candidate_ids),
                        folder_child_selections=effective_folder_selections,
                        character_cast=project_cast,
                        atmosphere_asset_ids=sorted(
                            effective_atmosphere_ids
                        ),
                        scene_reference_assets=effective_scene_references,
                        previous_scene_link=dict(
                            previous_scene_link or {}
                        ),
                        approved_story_prompt=approved_prompt,
                        original_story_prompt=original_prompt,
                        story_prompt_approved_at=approved_at,
                        reference_source_project_id=(
                            self.reference_source_project_id
                        ),
                        character=resolved_character,
                        lore=resolved_lore,
                        initial_reference_paths=(
                            ([self.character_path] if self.character_path else [])
                            + self.reference_paths
                        ),
                        progress=progress,
                        existing_project_id=existing_project_id,
                    )
                    self.after(
                        0, lambda: self._generation_succeeded(context)
                    )
                except Exception as exc:
                    self.after(
                        0,
                        lambda error=exc: self._generation_failed(error),
                    )

            threading.Thread(target=run, daemon=True).start()

        self._open_story_prompt_preview(
            original_prompt,
            on_confirm=start_generation,
            parent=wizard_window or self,
        )

    def _open_story_prompt_preview(
        self,
        original_prompt: str,
        *,
        on_confirm: Callable[[str, str], None],
        parent: tk.Misc,
        window_title: str = "OpenAI 대본 요청 확인",
        eyebrow: str = "STORY API  /  REQUEST PREVIEW",
        heading: str = "OpenAI 대본 요청 확인",
        subtitle: str = (
            "아래 내용이 확인 후 Story Adapter에 그대로 전달됩니다."
        ),
        request_summary: str | None = None,
        confirm_text: str = "프롬프트 확인 완료 →",
    ) -> None:
        """Show the exact one-shot Story request before any API job begins."""
        if (
            self._story_preview_window is not None
            and self._story_preview_window.winfo_exists()
        ):
            self._story_preview_window.lift()
            return
        preview = tk.Toplevel(parent)
        self._story_preview_window = preview
        preview.title(window_title)
        self._fit_window(preview, 980, 720, 780, 560)
        preview.configure(bg=self.BG)
        preview.transient(parent)
        preview.grab_set()
        state = {"approved": False, "editing": False}

        self._window_header(
            preview,
            eyebrow,
            heading,
            subtitle,
        )
        summary = self._card(preview, background=self.SURFACE_2)
        summary.pack(fill="x", padx=22, pady=(14, 8))
        api_ready = bool(self.config_data.openai_api_key)
        summary_text = request_summary or (
            f"Story 모델  {self.config_data.openai_story_model}\n"
            "예상 Story API 호출  최대 1회\n"
            "이후 예상 Image API 호출  장면당 최대 1회 · 총 최대 6회\n"
            f"API 키  {'설정됨' if api_ready else '미설정'}\n"
            "JSON Schema  animation_story · 요구 장면 수 6개\n"
            "캐시 적중 시 이후 Image API 호출 수는 줄어들 수 있습니다.\n"
            "프롬프트 확인 후 별도의 API 요청 전송창이 한 번 더 표시됩니다."
        )
        budget_manager = BudgetManager(
            self.config_data.project_root
            / "learning_data"
            / "api_budget_usage.json",
            self.config_data.monthly_budget_usd,
            self.config_data.budget_warning_threshold,
        )
        estimated_story_cost = budget_manager.estimate("story")
        budget_summary = budget_manager.summary(estimated_story_cost)
        summary_text += (
            f"\n예상 비용  ${estimated_story_cost:.2f}"
            f" · 이번 달 기록  ${budget_summary['spent_usd']:.2f}"
            f" · 남은 예산  ${budget_summary['remaining_usd']:.2f}"
        )
        if not budget_summary["can_spend"]:
            summary_text += "\n예산 초과: API 요청은 로컬에서 차단됩니다."
        tk.Label(
            summary, text=summary_text, justify="left",
            bg=self.SURFACE_2, fg=self.TEXT_SOFT,
            font=(self.FONT, 8), padx=15, pady=11,
        ).pack(anchor="w")
        prompt_count = tk.StringVar(
            value=f"Prompt 문자 수  {len(original_prompt)}"
        )
        tk.Label(
            preview, textvariable=prompt_count, bg=self.BG,
            fg=self.MUTED, font=("Consolas", 8, "bold"),
        ).pack(anchor="w", padx=24, pady=(2, 5))
        editor_shell = tk.Frame(preview, bg=self.SURFACE_3)
        editor_shell.pack(fill="both", expand=True, padx=22, pady=(0, 10))
        prompt_text = tk.Text(
            editor_shell, wrap="word", bg=self.SURFACE_3, fg=self.TEXT,
            insertbackground=self.GOLD, relief="flat",
            font=("Consolas", 9), padx=12, pady=12,
        )
        scrollbar = ttk.Scrollbar(
            editor_shell, orient="vertical", command=prompt_text.yview
        )
        prompt_text.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        prompt_text.pack(side="left", fill="both", expand=True)
        prompt_text.insert("1.0", original_prompt)
        prompt_text.configure(state="disabled")

        def current_prompt() -> str:
            return prompt_text.get("1.0", "end-1c")

        def update_count(_event: object | None = None) -> None:
            prompt_count.set(f"Prompt 문자 수  {len(current_prompt())}")

        def copy_prompt() -> None:
            copy_story_prompt(self, current_prompt())
            self._toast("Story Prompt를 클립보드에 복사했습니다.")

        def edit_prompt() -> None:
            state["editing"] = True
            prompt_text.configure(state="normal")
            prompt_text.focus_set()

        def restore_prompt() -> None:
            set_story_prompt_text(
                prompt_text, original_prompt, editable=state["editing"]
            )
            update_count()

        def close_preview() -> None:
            if preview.winfo_exists():
                preview.grab_release()
                preview.destroy()
            self._story_preview_window = None
            if (
                not state["approved"]
                and isinstance(parent, tk.Toplevel)
                and parent.winfo_exists()
            ):
                parent.grab_set()
                parent.focus_force()

        def confirm() -> None:
            if state["approved"]:
                return
            prompt = current_prompt()
            blocking_message = story_prompt_submission_error(
                prompt, self.config_data.openai_api_key
            )
            if blocking_message:
                messagebox.showerror(
                    "Story Prompt 확인",
                    blocking_message,
                    parent=preview,
                )
                return
            state["approved"] = True
            confirm_button.configure(state="disabled", fg=self.DIM)
            close_preview()
            self._open_story_api_submission_confirmation(
                prompt,
                on_confirm=on_confirm,
                parent=parent,
                request_summary=summary_text,
                request_name=heading,
            )

        prompt_text.bind("<KeyRelease>", update_count)
        actions = tk.Frame(preview, bg="#070D17")
        actions.pack(fill="x", side="bottom")
        for label, command, color in (
            ("복사", copy_prompt, self.SURFACE_3),
            ("수정", edit_prompt, self.PURPLE),
            ("원래 프롬프트 복원", restore_prompt, self.SURFACE_3),
            ("취소", close_preview, self.SURFACE_3),
        ):
            HoverButton(
                actions, label, command, background=color,
                hover=self.BORDER, font=(self.FONT, 8, "bold"),
                padx=12, pady=8,
            ).pack(side="left", padx=(18 if label == "복사" else 0, 7), pady=12)
        confirm_button = HoverButton(
            actions, confirm_text, confirm,
            background=self.GREEN if api_ready else self.SURFACE_3,
            hover=self.GOLD, foreground=self.TEXT if api_ready else self.MUTED,
            font=(self.FONT, 8, "bold"), padx=16, pady=8,
        )
        confirm_button.pack(side="right", padx=18, pady=12)
        preview.protocol("WM_DELETE_WINDOW", close_preview)
        self._fade_in(preview)

    def _open_story_api_submission_confirmation(
        self,
        prompt: str,
        *,
        on_confirm: Callable[[str, str], None],
        parent: tk.Misc,
        request_summary: str,
        request_name: str,
    ) -> None:
        """Require a second explicit click immediately before the paid request."""
        window = tk.Toplevel(parent)
        window.title("PRISM FORGE — API 요청 전송 확인")
        self._fit_window(window, 620, 430, 520, 390)
        window.configure(bg=self.BG)
        window.transient(parent)
        window.grab_set()
        sent = {"value": False}

        self._window_header(
            window,
            "FINAL API SUBMISSION",
            "API 요청을 보낼까요?",
            "아직 OpenAI 서버로 요청되지 않았습니다.",
        )
        card = self._card(window, background=self.SURFACE_2)
        card.pack(fill="both", expand=True, padx=22, pady=16)
        tk.Label(
            card,
            text=request_name,
            bg=self.SURFACE_2,
            fg=self.TEXT,
            font=(self.FONT, 11, "bold"),
            wraplength=540,
            justify="left",
        ).pack(anchor="w", padx=18, pady=(18, 8))
        tk.Label(
            card,
            text=(
                f"Story 모델  {self.config_data.openai_story_model}\n"
                "이번 요청  Story API 최대 1회\n"
                f"전송 Prompt  {len(prompt):,}자\n"
                "이미지 API 요청  지금은 0회\n\n"
                "아래 버튼을 눌러야 실제 유료 API 요청이 전송됩니다."
            ),
            bg=self.SURFACE_2,
            fg=self.TEXT_SOFT,
            font=(self.FONT, 9),
            justify="left",
        ).pack(anchor="w", padx=18)
        tk.Label(
            card,
            text="요청 전송 후에는 취소하거나 사용 비용을 되돌릴 수 없습니다.",
            bg=self.SURFACE_2,
            fg=self.ORANGE,
            font=(self.FONT, 8, "bold"),
            wraplength=540,
            justify="left",
        ).pack(anchor="w", padx=18, pady=(14, 18))

        actions = tk.Frame(window, bg="#070D17")
        actions.pack(fill="x", side="bottom")

        def close() -> None:
            if window.winfo_exists():
                window.grab_release()
                window.destroy()
            if (
                not sent["value"]
                and isinstance(parent, tk.Toplevel)
                and parent.winfo_exists()
            ):
                parent.grab_set()
                parent.focus_force()

        def send() -> None:
            if sent["value"]:
                return
            blocking_message = story_prompt_submission_error(
                prompt, self.config_data.openai_api_key
            )
            if blocking_message:
                messagebox.showerror(
                    "API 요청 전송 확인", blocking_message, parent=window
                )
                return
            sent["value"] = True
            approved_at = datetime.now(timezone.utc).isoformat()
            send_button.configure(state="disabled", fg=self.DIM)
            close()
            on_confirm(prompt, approved_at)

        HoverButton(
            actions,
            "돌아가기",
            close,
            background=self.SURFACE_3,
            hover=self.BORDER,
            font=(self.FONT, 9, "bold"),
            padx=16,
            pady=9,
        ).pack(side="left", padx=18, pady=12)
        send_button = HoverButton(
            actions,
            "API 요청 보내기",
            send,
            background=self.GREEN,
            hover=self.GOLD,
            font=(self.FONT, 9, "bold"),
            padx=18,
            pady=9,
        )
        send_button.pack(side="right", padx=18, pady=12)
        window.protocol("WM_DELETE_WINDOW", close)
        self._fade_in(window)

    def _open_generation_progress(
        self,
        title: str,
        detail: str,
        *,
        step_labels: tuple[str, ...] | None = None,
    ) -> None:
        """Show a modeless status view while the background API job runs."""
        if (
            self._generation_progress_window is not None
            and self._generation_progress_window.winfo_exists()
        ):
            self._generation_progress_window.lift()
            return
        window = tk.Toplevel(self)
        self._generation_progress_window = window
        window.title(f"PRISM FORGE — {title} 진행 상황")
        self._fit_window(window, 680, 480, 560, 430)
        window.configure(bg=self.BG)
        window.transient(self)
        # Keep this window modeless. Generation runs on a worker thread, so
        # users must remain able to inspect projects and other local screens.
        # Duplicate paid requests are blocked separately by
        # ``_generation_running`` and the service-level job guards.
        self._generation_progress_value = tk.DoubleVar(value=8)
        self._generation_progress_status = tk.StringVar(value="요청 준비 중")
        self._generation_progress_detail = tk.StringVar(value=detail)
        self._generation_progress_steps = []

        self._window_header(
            window,
            "LIVE GENERATION STATUS",
            f"{title} 진행 중",
            "창을 닫거나 버튼을 다시 누르지 않아도 자동으로 다음 단계로 이동합니다.",
        )
        panel = self._card(window, background=self.SURFACE_2)
        panel.pack(fill="both", expand=True, padx=24, pady=18)
        tk.Label(
            panel,
            textvariable=self._generation_progress_status,
            bg=self.SURFACE_2,
            fg=self.TEXT,
            font=(self.FONT, 14, "bold"),
        ).pack(anchor="w", padx=20, pady=(20, 5))
        tk.Label(
            panel,
            textvariable=self._generation_progress_detail,
            bg=self.SURFACE_2,
            fg=self.TEXT_SOFT,
            font=(self.FONT, 9),
            wraplength=590,
            justify="left",
        ).pack(anchor="w", padx=20)
        ttk.Progressbar(
            panel,
            variable=self._generation_progress_value,
            maximum=100,
            mode="determinate",
            style="Studio.Horizontal.TProgressbar",
        ).pack(fill="x", padx=20, pady=(18, 20))

        steps = tk.Frame(panel, bg=self.SURFACE_2)
        steps.pack(fill="x", padx=16, pady=(0, 20))
        if step_labels is None:
            step_labels = (
                ("요청 준비", "Scene 1–2", "Scene 3–4", "Scene 5–6")
                if "이미지" in title
                else ("API 요청", "대본 생성", "6개 장면 검증", "프로젝트 저장")
            )
        for index, label in enumerate(step_labels):
            item = tk.Frame(steps, bg=self.SURFACE_2)
            item.pack(side="left", fill="x", expand=True, padx=4)
            badge = tk.Label(
                item,
                text=str(index + 1),
                bg=self.SURFACE_3,
                fg=self.MUTED,
                font=(self.FONT, 8, "bold"),
                padx=9,
                pady=5,
            )
            badge.pack()
            tk.Label(
                item,
                text=label,
                bg=self.SURFACE_2,
                fg=self.MUTED,
                font=(self.FONT, 8, "bold"),
            ).pack(pady=(6, 0))
            self._generation_progress_steps.append(badge)

        tk.Label(
            panel,
            text="OpenAI 응답 시간에 따라 잠시 멈춘 것처럼 보일 수 있습니다.",
            bg=self.SURFACE_2,
            fg=self.MUTED,
            font=(self.FONT, 8),
        ).pack(anchor="w", padx=20, pady=(0, 16))

        def attempt_close() -> None:
            if self._generation_running:
                self._close_generation_progress()
                self._toast(
                    "생성 작업은 백그라운드에서 계속됩니다.",
                    kind="progress",
                )
                return
            self._close_generation_progress()

        window.protocol("WM_DELETE_WINDOW", attempt_close)
        self._update_generation_progress("API 요청 전송 준비")
        self._fade_in(window)

    def _set_generation_progress_state(
        self,
        message: str,
        *,
        detail: str,
        percent: float,
        stage: int,
    ) -> None:
        """Update a modeless generation window with an explicit workflow stage."""
        window = self._generation_progress_window
        if window is None or not window.winfo_exists():
            return
        if self._generation_progress_status is not None:
            self._generation_progress_status.set(message)
        if self._generation_progress_detail is not None:
            self._generation_progress_detail.set(detail)
        if self._generation_progress_value is not None:
            self._generation_progress_value.set(max(0, min(100, percent)))
        final = percent >= 100
        for index, badge in enumerate(self._generation_progress_steps):
            completed = index < stage or final
            active = index == stage and not final
            badge.configure(
                text="✓" if completed else str(index + 1),
                bg=(
                    self.GREEN
                    if completed
                    else self.PURPLE if active else self.SURFACE_3
                ),
                fg=self.TEXT if completed or active else self.MUTED,
            )

    def _open_image_regeneration_progress(self, scene_number: int) -> None:
        """Open the shared modeless progress UI for one-scene regeneration."""
        self._open_generation_progress(
            f"Scene {scene_number} 이미지 재생성",
            "수정한 대본과 이미지 프롬프트를 현재 장면에 저장하고 있습니다.",
            step_labels=(
                "수정값 저장",
                "Image API 요청",
                "이미지 저장",
                "검토 화면 갱신",
            ),
        )
        self._set_generation_progress_state(
            "수정값 저장 중",
            detail=f"Scene {scene_number}의 수정 내용을 재생성 요청에 반영합니다.",
            percent=12,
            stage=0,
        )

    def _update_generation_progress(self, message: str) -> None:
        """Translate existing service progress messages into clear visual stages."""
        window = self._generation_progress_window
        if window is None or not window.winfo_exists():
            return
        lowered = message.lower()
        if "실패" in message or "오류" in message:
            stage, percent, color = 0, 100, self.RED
        elif "이미지" in message and "/6" in message:
            match = re.search(r"이미지\s+(\d+)/6", message)
            number = int(match.group(1)) if match else 1
            stage = min(3, 1 + (number - 1) // 2)
            percent = min(100, 10 + number * 15)
            color = self.GREEN if number == 6 else self.PURPLE
        elif "저장 완료" in message or "검토 대기" in message:
            stage, percent, color = 3, 100, self.GREEN
        elif "응답 수신" in message or "검증 완료" in message:
            stage, percent, color = 2, 78, self.PURPLE
        elif "대본 생성" in message:
            stage, percent, color = 1, 42, self.PURPLE
        else:
            stage, percent, color = 0, 15, self.GOLD
        if self._generation_progress_status is not None:
            self._generation_progress_status.set(message)
        if self._generation_progress_detail is not None:
            self._generation_progress_detail.set(
                "현재 작업은 백그라운드에서 안전하게 실행 중입니다."
            )
        if self._generation_progress_value is not None:
            self._generation_progress_value.set(percent)
        for index, badge in enumerate(self._generation_progress_steps):
            completed = index < stage or percent == 100
            active = index == stage and percent < 100
            badge.configure(
                text="✓" if completed else str(index + 1),
                bg=self.GREEN if completed else color if active else self.SURFACE_3,
                fg=self.TEXT if completed or active else self.MUTED,
            )

        # ImagePipeline saves its checkpoint before emitting the N/6 message.
        # Reload the dashboard then, so cards advance during the active job.
        if re.search(r"\b[1-6]/6\b", message):
            self.refresh()

    def _close_generation_progress(self) -> None:
        window = self._generation_progress_window
        if window is not None and window.winfo_exists():
            try:
                window.grab_release()
            except tk.TclError:
                pass
            window.destroy()
        self._generation_progress_window = None
        self._generation_progress_steps = []

    def _generation_succeeded(self, context: ProjectContext) -> None:
        self._generation_running = False
        self._update_generation_progress("프로젝트 저장 완료")
        self._close_generation_progress()
        if context.workflow_state == WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW:
            self._toast("대본 완료 · Candidate Asset 전달 확인")
            self.refresh()
            self._confirm_short_automatic_references(context)
            return
        self._toast("생성 완료 · 사용자 승인 대기")
        self.refresh()
        self._open_result_viewer(context)

    def _confirm_short_automatic_references(
        self, context: ProjectContext
    ) -> None:
        """Show the v1.3 simple Resolver summary without another API call."""
        if self._api_session_disconnected:
            messagebox.showwarning(
                "OpenAI 연결 필요",
                "현재 API 연결이 해제되어 있습니다.\n"
                "상단의 키 저장·연결을 먼저 눌러주세요.",
                parent=self,
            )
            return
        try:
            if self.generation_service is None:
                self.generation_service = GenerationService(self.config_data)
            summary = self.generation_service.automatic_reference_summary(
                context
            )
        except Exception as exc:
            messagebox.showerror(
                "Candidate Asset 확인 실패", str(exc), parent=self
            )
            return
        selected = summary["selected_asset_ids_by_scene"]
        candidate_ids = {
            str(asset_id) for asset_id in summary["candidate_asset_ids"]
        }
        atmosphere_ids = {
            str(asset_id)
            for asset_id in context.lore_context.get(
                "atmosphere_asset_ids", []
            )
        }
        library = AssetLibrary(
            self.config_data.project_root / "learning_data"
        )
        character_ids: set[str] = set()
        for asset_id in candidate_ids - atmosphere_ids:
            try:
                if library.get(asset_id).asset_type == "character":
                    character_ids.add(asset_id)
            except ReferenceAssetError:
                continue
        lines = [
            "이미지 6장을 생성합니다.",
            "",
            f"등장 캐릭터: {len(character_ids)}명",
            f"전체 분위기 Reference: {len(atmosphere_ids)}개",
            f"실제 전달 Asset 합계: {len(candidate_ids)}개",
            "각 장면에는 위 Reference Asset 전체가 전달됩니다.",
        ]
        for scene in range(1, 7):
            lines.append(
                f"Scene{scene}: 전달 Asset "
                f"{len(selected.get(scene, []))}개"
            )
        budget_manager = self.generation_service.budget
        estimated_image_cost = budget_manager.estimate("image", 6)
        budget_summary = budget_manager.summary(estimated_image_cost)
        lines.extend((
            "",
            "예상 이미지 API 호출: 최대 6회",
            f"최대 예상 비용: ${estimated_image_cost:.2f}",
            f"이번 달 기록: ${budget_summary['spent_usd']:.2f}",
            f"남은 예산: ${budget_summary['remaining_usd']:.2f}",
        ))
        if not budget_summary["can_spend"]:
            lines.append(
                "주의: 캐시되지 않은 호출이 남은 예산을 넘으면 "
                "해당 요청 전에 차단됩니다."
            )
        choice = messagebox.askyesnocancel(
            "이미지 생성 전 확인",
            "\n".join(lines)
            + "\n\n예: 생성  /  아니요: 후보 Asset 다시 선택  /  취소",
            parent=self,
        )
        if choice is None:
            return
        if choice is False:
            self._open_project_brief(
                existing_project=context,
                initial_step=3,
                on_project_saved=self._confirm_short_automatic_references,
            )
            return
        try:
            self.generation_service.confirm_automatic_references(context)
        except Exception as exc:
            messagebox.showerror("Reference 확인 실패", str(exc), parent=self)
            return
        if self.config_data.app_confirm_before_paid_run and not messagebox.askyesno(
            "유료 이미지 API 요청 확인",
            "이미지 최대 6회가 요청될 수 있습니다. 생성할까요?",
            parent=self,
        ):
            return
        self._generation_running = True
        self._open_generation_progress(
            "이미지 생성",
            "장면별 이미지 6장을 순서대로 생성하고 있습니다.",
        )
        self._update_generation_progress("이미지 API 요청 준비")

        def run() -> None:
            try:
                result = self.generation_service.generate_approved_images(
                    context,
                    progress=lambda message: self.after(
                        0,
                        lambda value=message: self._update_generation_progress(
                            value
                        ),
                    ),
                )
                self.after(0, lambda: self._generation_succeeded(result))
            except Exception as exc:
                self.after(0, lambda error=exc: self._generation_failed(error))

        threading.Thread(target=run, daemon=True).start()

    def _generation_failed(self, error: Exception) -> None:
        self._generation_running = False
        self._update_generation_progress("생성 실패 · 오류 내용을 확인하세요")
        self._close_generation_progress()
        get_logger("ui").error(
            "OpenAI generation failed: %s", type(error).__name__
        )
        self._toast("생성 실패 · 원인을 확인하세요.", kind="error")
        messagebox.showerror("OpenAI 생성 실패", str(error), parent=self)

    def _get_video_service(self) -> VideoGenerationService:
        """Return the shared Runway service without making a provider request."""
        if self.video_generation_service is None:
            self.video_generation_service = VideoGenerationService(
                self.config_data
            )
        return self.video_generation_service

    def _open_runway_confirmation(
        self,
        project: ProjectContext,
        *,
        retry_scene: int | None = None,
        force_all: bool = False,
    ) -> None:
        """Show editable prompts and cost before the explicit paid action."""
        try:
            service = self._get_video_service()
            previews = service.previews(project)
        except Exception as exc:
            if not self.config_data.runway_api_secret:
                self._open_runway_key_dialog(
                    lambda: self._open_runway_confirmation(
                        project, retry_scene=retry_scene, force_all=force_all
                    )
                )
                return
            messagebox.showerror("Runway 준비 실패", str(exc), parent=self)
            return
        window = tk.Toplevel(self)
        window.title("PRISM FORGE — Runway 영상 생성 요청 확인")
        self._fit_window(window, 1120, 760, 820, 580)
        window.configure(bg=self.BG)
        window.transient(self)
        self._window_header(
            window,
            "RUNWAY / PAID REQUEST PREVIEW",
            "영상 생성 요청 확인",
            "프롬프트를 확인·수정한 뒤 아래 전송 버튼을 눌러야 유료 요청이 시작됩니다.",
        )
        content = tk.Frame(window, bg=self.BG)
        content.pack(fill="both", expand=True, padx=24, pady=(16, 8))
        content.columnconfigure(1, weight=1)
        content.rowconfigure(0, weight=1)
        listing = tk.Listbox(
            content,
            bg=self.SURFACE_2,
            fg=self.TEXT,
            selectbackground=self.PURPLE,
            relief="flat",
            activestyle="none",
            exportselection=False,
            font=(self.FONT, 9, "bold"),
        )
        listing.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
        scene_numbers = [retry_scene] if retry_scene else list(range(1, 7))
        project_ratio = runway_ratio_for_project(
            project, self.config_data.runway_ratio
        )
        ratio_label = project_ratio.replace(":", "×")
        for number in scene_numbers:
            listing.insert(
                "end",
                f"Scene {number}  ·  5초  ·  {ratio_label}",
            )
        editor_card = self._card(content)
        editor_card.grid(row=0, column=1, sticky="nsew")
        editor_card.rowconfigure(2, weight=1)
        editor_card.columnconfigure(0, weight=1)
        scene_title = tk.StringVar()
        tk.Label(
            editor_card, textvariable=scene_title,
            bg=self.SURFACE, fg=self.TEXT,
            font=(self.FONT, 13, "bold"),
        ).grid(row=0, column=0, sticky="w", padx=18, pady=(16, 4))
        tk.Label(
            editor_card,
            text="현재 이미지의 정체성·구도는 유지하고 움직임만 지시합니다.",
            bg=self.SURFACE, fg=self.MUTED, font=(self.FONT, 8),
        ).grid(row=1, column=0, sticky="w", padx=18)
        prompt_count_var = tk.StringVar(value="0 / 1000 UTF-16")
        prompt_count_label = tk.Label(
            editor_card,
            textvariable=prompt_count_var,
            bg=self.SURFACE, fg=self.MUTED,
            font=("Consolas", 8, "bold"),
        )
        prompt_count_label.grid(row=1, column=0, sticky="e", padx=18)
        editor = tk.Text(
            editor_card,
            bg=self.SURFACE_3, fg=self.TEXT, insertbackground=self.GOLD,
            relief="flat", wrap="word", font=(self.FONT, 9),
            padx=12, pady=12,
        )
        editor.grid(row=2, column=0, sticky="nsew", padx=18, pady=14)
        prompts = [preview.prompt for preview in previews]
        selected = {"scene": scene_numbers[0]}
        editor_loaded = {"value": False}

        def update_prompt_count(_event: object | None = None) -> None:
            value = editor.get("1.0", "end-1c")
            count = runway_prompt_code_units(value)
            prompt_count_var.set(f"{count} / 1000 UTF-16")
            prompt_count_label.configure(
                fg=self.RED if count > 1000 else self.GREEN
            )
            editor.edit_modified(False)

        def editor_modified(_event: object | None = None) -> None:
            if editor.edit_modified():
                update_prompt_count()

        editor.bind("<<Modified>>", editor_modified, add="+")

        def store_current() -> None:
            if not editor_loaded["value"]:
                return
            prompts[selected["scene"] - 1] = editor.get("1.0", "end").strip()

        def select_scene(_event: object | None = None) -> None:
            if not listing.curselection():
                return
            store_current()
            number = scene_numbers[int(listing.curselection()[0])]
            selected["scene"] = number
            scene_title.set(f"Scene {number} 영상 프롬프트")
            editor.delete("1.0", "end")
            editor.insert("1.0", prompts[number - 1])
            editor_loaded["value"] = True
            update_prompt_count()

        listing.bind("<<ListboxSelect>>", select_scene)
        listing.selection_set(0)
        select_scene()
        total_calls = service.expected_new_paid_requests(
            project, retry_scene=retry_scene, force_all=force_all
        )
        total_cost = service.scene_estimated_cost_usd * total_calls
        runway_budget = service.budget.summary(total_cost)
        # Reserve the paid-action bar ahead of the expanding editor.  Tk may
        # otherwise give a late-packed footer zero height on small displays.
        footer = tk.Frame(
            window, name="runway_confirmation_action_bar", bg=self.BG
        )
        footer.pack(
            side="bottom", fill="x", padx=24, pady=(4, 18), before=content
        )
        tk.Label(
            footer,
            text=(
                f"모델 {self.config_data.runway_model}  ·  "
                f"{project_ratio}  ·  장면당 "
                f"{self.config_data.runway_duration_seconds}초\n"
                f"순차 생성  ·  오디오 없음  ·  장면 연결 강도 보통  ·  "
                f"예상 최대 호출 {total_calls}회\n"
                f"이번 요청 예상 비용 ${total_cost:.2f}  ·  "
                f"이번 달 Runway 로컬 기록 ${runway_budget['spent_usd']:.2f}  ·  "
                f"남은 로컬 예산 ${runway_budget['remaining_usd']:.2f}"
            ),
            bg=self.BG, fg=self.TEXT_SOFT, font=(self.FONT, 9),
            justify="left",
        ).pack(side="left")

        def submit() -> None:
            store_current()
            if any(not prompts[number - 1] for number in scene_numbers):
                messagebox.showwarning(
                    "프롬프트 확인",
                    "전송할 장면 프롬프트가 비어 있습니다.",
                    parent=window,
                )
                return
            oversized = [
                number for number in scene_numbers
                if runway_prompt_code_units(prompts[number - 1]) > 1000
            ]
            if oversized:
                messagebox.showwarning(
                    "프롬프트 길이 초과",
                    (
                        "Runway의 1,000 UTF-16 글자 제한을 초과한 장면이 "
                        f"있습니다: {', '.join(map(str, oversized))}\n\n"
                        "표시된 글자 수가 1,000 이하가 되도록 줄여주세요."
                    ),
                    parent=window,
                )
                return
            if not messagebox.askyesno(
                "Runway API 요청 전송",
                (
                    f"지금 Runway에 유료 요청 {total_calls}회를 순차 전송합니다.\n"
                    f"로컬 예상 비용: ${total_cost:.2f}\n\n"
                    + (
                        "기존 6개 영상은 history 폴더에 보존하고 "
                        "모든 장면을 새로 생성합니다.\n\n"
                        if force_all else ""
                    )
                    + "전송 후에는 해당 장면 작업이 완료될 때까지 취소할 수 없습니다.\n"
                    + "요청을 시작할까요?"
                ),
                parent=window,
            ):
                return
            window.destroy()
            self._start_runway_generation(
                project, prompts, retry_scene=retry_scene,
                force_all=force_all,
            )

        HoverButton(
            footer, "Runway 요청 보내기",
            submit,
            background=self.PURPLE, hover="#765DE4",
            font=(self.FONT, 9, "bold"), padx=18, pady=10,
        ).pack(side="right")
        HoverButton(
            footer, "취소", window.destroy,
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 9), padx=14, pady=10,
        ).pack(side="right", padx=8)

    def _open_runway_key_dialog(
        self, on_saved: Callable[[], None] | None = None
    ) -> None:
        """Fallback key dialog used when a video action needs a missing key."""
        if self._generation_running:
            self._toast(
                "생성 작업이 끝난 뒤 Runway 연결 설정을 변경하세요.",
                kind="warning",
            )
            return
        value = simpledialog.askstring(
            "Runway API 연결",
            "Runway API secret을 입력하세요.\n\n"
            "키는 로컬 .env의 RUNWAYML_API_SECRET에만 저장됩니다.\n"
            "연결 확인만 수행하며 유료 영상 요청은 보내지 않습니다.",
            show="•",
            parent=self,
        )
        if value is None:
            return
        self._save_and_activate_runway_key(value, on_saved=on_saved)

    def _save_and_activate_runway_key(
        self,
        value: str,
        *,
        on_saved: Callable[[], None] | None = None,
    ) -> None:
        """Persist and activate one explicit key without provider traffic."""
        if self._generation_running:
            self._toast(
                "생성 작업이 끝난 뒤 Runway 연결 설정을 변경하세요.",
                kind="warning",
            )
            return
        try:
            save_runway_api_secret(self.config_data.project_root, value)
            self.config_data = AppConfig.load(
                self.config_data.project_root, env={}
            )
            self.video_generation_service = VideoGenerationService(
                self.config_data
            )
        except (APIKeySettingsError, ConfigurationError, ValueError) as exc:
            messagebox.showerror("Runway 키 저장 실패", str(exc), parent=self)
            return
        self._runway_session_disconnected = False
        if hasattr(self, "runway_key_entry"):
            self.runway_key_entry.delete(0, "end")
            self.runway_key_entry.configure(show="*")
        if hasattr(self, "runway_key_status"):
            self.runway_key_status.set(
                masked_api_key(self.config_data.runway_api_secret)
            )
            self.runway_key_status_label.configure(fg=self.GREEN)
            self.runway_disconnect_button.configure(
                state="normal", fg=self.TEXT, text="연결 해제",
                command=self._disconnect_runway,
            )
        self._toast("Runway 키 저장 완료 · 영상 Adapter 준비됨")
        self.refresh()
        messagebox.showinfo(
            "Runway 연결 준비 완료",
            "Runway 키를 로컬 .env에 저장하고 영상 Adapter를 준비했습니다.\n\n"
            "이 확인 과정에서는 Runway API 요청이나 비용이 발생하지 않았습니다.",
            parent=self,
        )
        if on_saved is not None:
            on_saved()

    def _disconnect_runway(self) -> None:
        """Disable Runway for this session while retaining its saved secret."""
        if self._generation_running:
            self._toast(
                "생성 작업이 끝난 뒤 Runway 연결을 해제하세요.",
                kind="warning",
            )
            return
        saved = AppConfig.load(self.config_data.project_root, env={})
        if not saved.runway_api_secret:
            self._toast("저장된 Runway 키가 없습니다.", kind="warning")
            return
        if not messagebox.askyesno(
            "Runway 연결 해제",
            "저장된 키는 삭제하지 않고 현재 프로그램의 연결만 끊습니다.\n"
            "다시 연결할 때 키를 재입력할 필요가 없습니다.\n\n"
            "연결을 해제할까요?",
            parent=self,
        ):
            return
        self.config_data = replace(
            self.config_data, runway_api_secret=None
        )
        self._runway_session_disconnected = True
        self.video_generation_service = None
        self.runway_key_status.set("연결 해제됨 · 키 저장됨")
        self.runway_key_status_label.configure(fg=self.ORANGE)
        self.runway_disconnect_button.configure(
            state="normal", fg=self.TEXT, text="다시 연결",
            command=self._reconnect_runway,
        )
        self.refresh()
        self._toast("Runway 저장 키를 유지하고 연결만 해제했습니다.")

    def _reconnect_runway(self) -> None:
        """Reconnect the saved Runway secret without making an API call."""
        if self._generation_running:
            self._toast(
                "생성 작업이 끝난 뒤 Runway에 다시 연결하세요.",
                kind="warning",
            )
            return
        try:
            refreshed = AppConfig.load(self.config_data.project_root, env={})
            if not refreshed.runway_api_secret:
                self._open_runway_key_dialog()
                return
            service = VideoGenerationService(refreshed)
        except (ConfigurationError, ValueError) as exc:
            messagebox.showerror("Runway 연결 실패", str(exc), parent=self)
            return
        self.config_data = refreshed
        self.video_generation_service = service
        self._runway_session_disconnected = False
        self.runway_key_status.set(masked_api_key(refreshed.runway_api_secret))
        self.runway_key_status_label.configure(fg=self.GREEN)
        self.runway_disconnect_button.configure(
            state="normal", fg=self.TEXT, text="연결 해제",
            command=self._disconnect_runway,
        )
        self.refresh()
        self._toast("저장된 키로 Runway 영상 Adapter를 다시 준비했습니다.")

    def _start_runway_generation(
        self,
        project: ProjectContext,
        prompts: list[str],
        *,
        retry_scene: int | None = None,
        force_all: bool = False,
    ) -> None:
        """Run sequential polling in a worker while the app remains usable."""
        if self._generation_running:
            self._toast("다른 생성 작업이 진행 중입니다.", kind="warning")
            return
        service = self._get_video_service()
        self._generation_running = True
        progress_window = tk.Toplevel(self)
        progress_window.title("PRISM FORGE — Runway 영상 생성 진행")
        self._fit_window(progress_window, 820, 700, 680, 560)
        progress_window.configure(bg=self.BG)
        progress_window.transient(self)
        self._window_header(
            progress_window,
            "LIVE RUNWAY STATUS",
            "영상 생성 진행 중",
            "창을 닫아도 백그라운드 작업은 계속됩니다.",
        )
        card = self._card(progress_window)
        card.pack(fill="both", expand=True, padx=24, pady=20)
        status_var = tk.StringVar(value="Runway 요청을 준비하고 있습니다.")
        detail_var = tk.StringVar(
            value="순차 생성 · 장면별 다운로드 · 마지막 프레임 저장"
        )
        eta_var = tk.StringVar(
            value="초기 예상: 장면당 약 1~5분 · 전체 약 6~30분"
        )
        tk.Label(
            card, textvariable=status_var, bg=self.SURFACE, fg=self.TEXT,
            font=(self.FONT, 14, "bold"), anchor="w",
        ).pack(fill="x", padx=22, pady=(24, 5))
        tk.Label(
            card, textvariable=detail_var, bg=self.SURFACE, fg=self.MUTED,
            font=(self.FONT, 9), anchor="w",
        ).pack(fill="x", padx=22)
        tk.Label(
            card, textvariable=eta_var, bg=self.SURFACE, fg=self.GOLD,
            font=(self.FONT, 8, "bold"), anchor="w",
        ).pack(fill="x", padx=22, pady=(5, 0))
        progress_var = tk.DoubleVar(value=0)
        self._runway_progress_window = progress_window
        self._runway_status_var = status_var
        self._runway_detail_var = detail_var
        self._runway_progress_var = progress_var
        self._runway_eta_var = eta_var
        ttk.Progressbar(
            card, maximum=100, variable=progress_var
        ).pack(fill="x", padx=22, pady=(16, 12))

        scene_board = tk.Frame(card, bg=self.SURFACE_2)
        scene_board.pack(fill="x", padx=22, pady=(0, 14))
        scene_status_vars: list[tk.StringVar] = []
        scene_progress_vars: list[tk.DoubleVar] = []
        target_scenes = {retry_scene} if retry_scene else set(range(1, 7))
        succeeded_scenes = {
            int(record.get("scene_number", 0))
            for record in project.video_generation_records
            if record.get("status") == "succeeded"
        }
        completed_scenes = (
            set(succeeded_scenes)
            if retry_scene is None and not force_all else set()
        )
        for number in range(1, 7):
            existing = (
                number in succeeded_scenes
                and retry_scene is None
                and not force_all
            )
            inactive = retry_scene is not None and number != retry_scene
            initial_status = (
                "✓ 완료 파일 재사용" if existing
                else "재생성 대상 아님" if inactive
                else "대기"
            )
            initial_progress = 100 if existing else 0
            row = tk.Frame(scene_board, bg=self.SURFACE_2)
            row.pack(fill="x", padx=12, pady=5)
            tk.Label(
                row, text=f"Scene {number}", width=9, anchor="w",
                bg=self.SURFACE_2, fg=self.TEXT,
                font=(self.FONT, 8, "bold"),
            ).pack(side="left")
            scene_var = tk.StringVar(value=initial_status)
            tk.Label(
                row, textvariable=scene_var, width=22, anchor="w",
                bg=self.SURFACE_2,
                fg=self.GREEN if existing else self.MUTED,
                font=(self.FONT, 8),
            ).pack(side="left", padx=(2, 10))
            scene_progress = tk.DoubleVar(value=initial_progress)
            ttk.Progressbar(
                row, maximum=100, variable=scene_progress,
            ).pack(side="left", fill="x", expand=True)
            scene_status_vars.append(scene_var)
            scene_progress_vars.append(scene_progress)
        self._runway_scene_status_vars = scene_status_vars
        self._runway_scene_progress_vars = scene_progress_vars
        actions = tk.Frame(card, bg=self.SURFACE)
        actions.pack(fill="x", padx=22, pady=(0, 22))
        HoverButton(
            actions, "다음 요청부터 중지",
            service.request_stop,
            background="#733B1A", hover=self.ORANGE,
            font=(self.FONT, 9, "bold"), padx=16, pady=9,
        ).pack(side="left")
        HoverButton(
            actions, "창 닫기", progress_window.destroy,
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 9), padx=16, pady=9,
        ).pack(side="right")

        labels = {
            "submitting": "Runway에 Scene {scene} 요청 전송 중",
            "polling": "Scene {scene} 생성 상태 확인 중 · {status}",
            "downloading": "Scene {scene} 영상 다운로드 중",
            "scene_completed": "Scene {scene} 완료 · 다음 장면 준비",
            "skipped": "Scene {scene} 기존 완료 파일 재사용",
            "completed": "6개 장면 영상 생성 완료",
        }
        batch_started_at = time.monotonic()
        scene_started_at: dict[int, float] = {}
        scene_durations: list[float] = []

        scene_status_labels = {
            "submitting": "요청 제출 중",
            "polling": "Runway 생성 중",
            "downloading": "완료 영상 다운로드 중",
            "scene_completed": "✓ 생성·저장 완료",
            "skipped": "✓ 기존 완료 파일 재사용",
        }

        def format_seconds(seconds: float) -> str:
            rounded = max(0, int(round(seconds)))
            minutes, remain = divmod(rounded, 60)
            return f"{minutes}분 {remain}초" if minutes else f"{remain}초"

        def update(event: dict[str, object]) -> None:
            kind = str(event.get("kind", ""))
            scene = int(event.get("scene_number", 0) or 0)
            text = labels.get(kind, kind).format(
                scene=scene, status=event.get("status", "")
            )
            task_progress = event.get("task_progress")
            fraction = (
                float(task_progress)
                if task_progress is not None else 0.5
            )
            if fraction > 1:
                fraction /= 100
            fraction = min(1.0, max(0.0, fraction))
            if kind == "completed":
                value = 100
            elif retry_scene is not None:
                value = min(96, max(3, fraction * 100))
            else:
                finished_before_event = len(completed_scenes)
                value = min(
                    96,
                    max(3, (finished_before_event + fraction) * 100 / 6),
                )
            now = time.monotonic()
            if kind == "submitting" and scene:
                scene_started_at.setdefault(scene, now)
            if kind in {"scene_completed", "skipped"} and scene:
                started = scene_started_at.pop(scene, None)
                if started is not None and kind == "scene_completed":
                    scene_durations.append(max(0.0, now - started))
                completed_scenes.add(scene)
            remaining = max(0, len(target_scenes - completed_scenes))
            elapsed = now - batch_started_at
            if scene_durations and remaining:
                average = sum(scene_durations) / len(scene_durations)
                eta_text = (
                    f"경과 {format_seconds(elapsed)} · 예상 남은 시간 "
                    f"약 {format_seconds(average * remaining)} "
                    "(완료 장면 속도 기준)"
                )
            elif remaining:
                eta_text = (
                    f"경과 {format_seconds(elapsed)} · 초기 예상 "
                    f"남은 시간 {remaining}~{remaining * 5}분"
                )
            else:
                eta_text = f"전체 소요 시간 {format_seconds(elapsed)}"

            scene_value = 0.0
            scene_text = scene_status_labels.get(kind, "대기")
            if kind == "submitting":
                scene_value = 5
            elif kind == "polling":
                scene_value = max(10, fraction * 90)
                provider_status = str(event.get("status", ""))
                if provider_status:
                    scene_text += f" · {provider_status}"
            elif kind == "downloading":
                scene_value = 95
            elif kind in {"scene_completed", "skipped"}:
                scene_value = 100

            def apply_update() -> None:
                status_var.set(text)
                progress_var.set(value)
                eta_var.set(eta_text)
                if 1 <= scene <= 6 and kind != "completed":
                    scene_status_vars[scene - 1].set(scene_text)
                    scene_progress_vars[scene - 1].set(scene_value)

            self.after(0, apply_update)

        def run() -> None:
            try:
                updated = service.generate(
                    project, prompts, progress=update,
                    retry_scene=retry_scene,
                    force_all=force_all,
                )
                self.after(
                    0, lambda: self._runway_generation_finished(
                        updated, progress_window
                    )
                )
            except VideoGenerationStopped:
                self.after(
                    0, lambda: self._runway_generation_stopped(progress_window)
                )
            except Exception as exc:
                self.after(
                    0, lambda error=exc: self._runway_generation_failed(
                        error, progress_window, project
                    )
                )

        threading.Thread(target=run, daemon=True).start()

    def _reopen_runway_progress(self, project: ProjectContext) -> None:
        """Reopen a monitor for the current background Runway operation."""
        existing = getattr(self, "_runway_progress_window", None)
        if existing is not None:
            try:
                if existing.winfo_exists():
                    existing.deiconify()
                    existing.lift()
                    existing.focus_force()
                    return
            except tk.TclError:
                pass
        if not self._generation_running:
            self._toast(
                "실행 중인 영상 Worker가 없습니다. 프로젝트를 다시 불러옵니다.",
                kind="warning",
            )
            try:
                project = MemoryManager(
                    self.config_data.project_root
                    / "learning_data"
                    / "projects"
                ).load(project.project_id)
            except Exception:
                pass
            if project.workflow_state == WorkflowState.INTERRUPTED:
                self._open_runway_confirmation(project)
                return
        window = tk.Toplevel(self)
        window.title("PRISM FORGE — Runway 영상 생성 진행")
        self._fit_window(window, 820, 700, 680, 560)
        window.configure(bg=self.BG)
        window.transient(self)
        self._window_header(
            window,
            "LIVE RUNWAY STATUS",
            "영상 생성 진행 상황",
            "창을 닫아도 이미 제출된 작업의 추적과 저장은 계속됩니다.",
        )
        card = self._card(window)
        card.pack(fill="both", expand=True, padx=24, pady=20)
        status_var = getattr(
            self, "_runway_status_var",
            tk.StringVar(value="Runway 작업 상태를 확인하고 있습니다."),
        )
        detail_var = getattr(
            self, "_runway_detail_var",
            tk.StringVar(value=f"프로젝트: {project.topic}"),
        )
        progress_var = getattr(
            self, "_runway_progress_var", tk.DoubleVar(value=0)
        )
        eta_var = getattr(
            self,
            "_runway_eta_var",
            tk.StringVar(value="초기 예상: 장면당 약 1~5분"),
        )
        tk.Label(
            card, textvariable=status_var, bg=self.SURFACE, fg=self.TEXT,
            font=(self.FONT, 14, "bold"), anchor="w",
        ).pack(fill="x", padx=22, pady=(24, 5))
        tk.Label(
            card, textvariable=detail_var, bg=self.SURFACE, fg=self.MUTED,
            font=(self.FONT, 9), anchor="w",
        ).pack(fill="x", padx=22)
        tk.Label(
            card, textvariable=eta_var, bg=self.SURFACE, fg=self.GOLD,
            font=(self.FONT, 8, "bold"), anchor="w",
        ).pack(fill="x", padx=22, pady=(5, 0))
        ttk.Progressbar(
            card, maximum=100, variable=progress_var
        ).pack(fill="x", padx=22, pady=(16, 12))

        scene_status_vars = getattr(self, "_runway_scene_status_vars", None)
        scene_progress_vars = getattr(
            self, "_runway_scene_progress_vars", None
        )
        if not scene_status_vars or not scene_progress_vars:
            succeeded = {
                int(record.get("scene_number", 0))
                for record in project.video_generation_records
                if record.get("status") == "succeeded"
            }
            scene_status_vars = [
                tk.StringVar(
                    value="✓ 생성·저장 완료" if number in succeeded else "대기"
                )
                for number in range(1, 7)
            ]
            scene_progress_vars = [
                tk.DoubleVar(value=100 if number in succeeded else 0)
                for number in range(1, 7)
            ]
            self._runway_scene_status_vars = scene_status_vars
            self._runway_scene_progress_vars = scene_progress_vars
        scene_board = tk.Frame(card, bg=self.SURFACE_2)
        scene_board.pack(fill="x", padx=22, pady=(0, 14))
        for number, (scene_status, scene_progress) in enumerate(
            zip(scene_status_vars, scene_progress_vars), start=1
        ):
            row = tk.Frame(scene_board, bg=self.SURFACE_2)
            row.pack(fill="x", padx=12, pady=5)
            tk.Label(
                row, text=f"Scene {number}", width=9, anchor="w",
                bg=self.SURFACE_2, fg=self.TEXT,
                font=(self.FONT, 8, "bold"),
            ).pack(side="left")
            tk.Label(
                row, textvariable=scene_status, width=22, anchor="w",
                bg=self.SURFACE_2, fg=self.MUTED,
                font=(self.FONT, 8),
            ).pack(side="left", padx=(2, 10))
            ttk.Progressbar(
                row, maximum=100, variable=scene_progress,
            ).pack(side="left", fill="x", expand=True)
        actions = tk.Frame(card, bg=self.SURFACE)
        actions.pack(fill="x", padx=22, pady=(0, 22))
        HoverButton(
            actions, "다음 미제출 장면부터 중지",
            self._get_video_service().request_stop,
            background="#733B1A", hover=self.ORANGE,
            font=(self.FONT, 9, "bold"), padx=16, pady=9,
        ).pack(side="left")
        HoverButton(
            actions, "창 닫기", window.destroy,
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 9), padx=16, pady=9,
        ).pack(side="right")
        self._runway_progress_window = window
        self._runway_eta_var = eta_var
        self._fade_in(window)

    def _runway_generation_finished(
        self, project: ProjectContext, window: tk.Toplevel
    ) -> None:
        self._generation_running = False
        if window.winfo_exists():
            window.destroy()
        monitor = getattr(self, "_runway_progress_window", None)
        if monitor is not None and monitor is not window:
            try:
                if monitor.winfo_exists():
                    monitor.destroy()
            except tk.TclError:
                pass
        self.refresh()
        self._open_video_review(project)

    def _runway_generation_stopped(self, window: tk.Toplevel) -> None:
        self._generation_running = False
        if window.winfo_exists():
            window.destroy()
        monitor = getattr(self, "_runway_progress_window", None)
        if monitor is not None and monitor is not window:
            try:
                if monitor.winfo_exists():
                    monitor.destroy()
            except tk.TclError:
                pass
        self.refresh()
        self._toast("현재 작업 뒤의 새 요청을 중지했습니다.", kind="warning")

    def _runway_generation_failed(
        self,
        error: Exception,
        window: tk.Toplevel,
        project: ProjectContext,
    ) -> None:
        """Report one provider failure and offer an explicit scene-only retry.

        Opening the retry preview is free.  The provider is not called until
        the user reviews the freshly rebuilt prompt and confirms transmission.
        """
        self._generation_running = False
        if window.winfo_exists():
            window.destroy()
        monitor = getattr(self, "_runway_progress_window", None)
        if monitor is not None and monitor is not window:
            try:
                if monitor.winfo_exists():
                    monitor.destroy()
            except tk.TclError:
                pass
        try:
            latest = MemoryManager(
                self.config_data.project_root / "learning_data" / "projects"
            ).load(project.project_id)
        except Exception:
            latest = project
        failed_scenes = sorted({
            int(record.get("scene_number", 0))
            for record in latest.video_generation_records
            if str(record.get("status", "")).upper()
            in {"FAILED", "CANCELLED"}
            and 1 <= int(record.get("scene_number", 0)) <= 6
        })
        self.refresh()
        messagebox.showerror(
            "Runway 영상 생성 실패", str(error), parent=self
        )
        if len(failed_scenes) != 1:
            return
        scene_number = failed_scenes[0]
        retry = messagebox.askyesno(
            f"Scene {scene_number} 재시도 준비",
            (
                f"Scene {scene_number}만 생성에 실패했습니다.\n"
                "성공한 다른 Scene은 보존합니다.\n\n"
                "최신 압축·카메라 규칙으로 이 Scene의 프롬프트를 "
                "다시 만들어 확인할까요?\n\n"
                "확인창을 여는 것만으로는 비용이 발생하지 않으며, "
                "Runway 요청 보내기를 다시 눌러야 전송됩니다."
            ),
            parent=self,
        )
        if retry:
            self._open_runway_confirmation(
                latest, retry_scene=scene_number
            )

    def _open_video_review(self, project: ProjectContext) -> None:
        """Review downloaded scene videos before the single FFmpeg merge."""
        try:
            project = MemoryManager(
                self.config_data.project_root
                / "learning_data"
                / "projects"
            ).load(project.project_id)
        except Exception:
            pass
        window = tk.Toplevel(self)
        window.title("PRISM FORGE — Video Review")
        self._fit_window(window, 1040, 700, 780, 540)
        window.configure(bg=self.BG)
        window.transient(self)
        self._window_header(
            window,
            "VIDEO REVIEW / RUNWAY SCENES",
            "장면 영상 검토",
            "각 영상을 재생하고 승인한 뒤 최종 Reels MP4로 병합하세요.",
        )
        # Keep every review command visible while only the detail area shrinks.
        actions = tk.Frame(
            window, name="video_review_action_bar", bg=self.BG
        )
        actions.pack(side="bottom", fill="x", padx=24, pady=(0, 18))
        body = tk.Frame(window, bg=self.BG)
        body.pack(fill="both", expand=True, padx=24, pady=18)
        body.columnconfigure(1, weight=1)
        body.rowconfigure(0, weight=1)
        listing = tk.Listbox(
            body, bg=self.SURFACE_2, fg=self.TEXT,
            selectbackground=self.PURPLE, relief="flat",
            activestyle="none", exportselection=False,
            font=(self.FONT, 9, "bold"),
        )
        listing.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
        review_by_scene = {
            int(item.get("scene_number", 0)): bool(item.get("approved"))
            for item in project.video_reviews
        }
        records_by_scene = {
            int(item.get("scene_number", 0)): dict(item)
            for item in project.video_generation_records
        }
        for number in range(1, 7):
            saved_path = (
                Path(project.generated_video_paths[number - 1])
                if len(project.generated_video_paths) >= number
                and project.generated_video_paths[number - 1]
                else None
            )
            has_video = bool(
                saved_path is not None
                and saved_path.is_file()
                and saved_path.stat().st_size > 0
            )
            record_status = str(
                records_by_scene.get(number, {}).get("status", "")
            ).upper()
            if review_by_scene.get(number):
                mark = "✓ 승인"
            elif has_video:
                mark = "미승인"
            elif record_status == "FAILED":
                mark = "생성 실패"
            else:
                mark = "영상 없음"
            listing.insert("end", f"Scene {number}  ·  {mark}")
        detail = self._card(body)
        detail.grid(row=0, column=1, sticky="nsew")
        detail.columnconfigure(0, weight=1)
        detail.rowconfigure(2, weight=1)
        title_var = tk.StringVar()
        path_var = tk.StringVar()
        tk.Label(
            detail, textvariable=title_var, bg=self.SURFACE, fg=self.TEXT,
            font=(self.FONT, 14, "bold"),
        ).grid(row=0, column=0, sticky="w", padx=22, pady=(22, 6))
        tk.Label(
            detail, textvariable=path_var, bg=self.SURFACE, fg=self.MUTED,
            font=("Consolas", 8), wraplength=560, justify="left",
            anchor="w",
        ).grid(row=1, column=0, sticky="ew", padx=22)
        info_frame = tk.Frame(detail, bg=self.SURFACE_2)
        info_frame.grid(row=2, column=0, sticky="nsew", padx=22, pady=18)
        info_frame.columnconfigure(0, weight=1)
        info_frame.rowconfigure(0, weight=1)
        info = tk.Text(
            info_frame,
            bg=self.SURFACE_2, fg=self.TEXT_SOFT,
            insertbackground=self.TEXT,
            selectbackground=self.PURPLE,
            relief="flat", bd=0, highlightthickness=0,
            font=(self.FONT, 10), wrap="word",
            padx=12, pady=12,
        )
        info.grid(row=0, column=0, sticky="nsew")
        info_scroll = ttk.Scrollbar(
            info_frame, orient="vertical", command=info.yview
        )
        info_scroll.grid(row=0, column=1, sticky="ns")
        info.configure(yscrollcommand=info_scroll.set, state="disabled")
        selected = {"scene": 1}
        action_buttons: dict[str, tk.Button] = {}

        def select(_event: object | None = None) -> None:
            if listing.curselection():
                selected["scene"] = int(listing.curselection()[0]) + 1
            number = selected["scene"]
            path = (
                Path(project.generated_video_paths[number - 1])
                if len(project.generated_video_paths) >= number
                and project.generated_video_paths[number - 1]
                else Path()
            )
            title_var.set(f"Scene {number}")
            path_var.set(
                f"영상 파일: {path.name}\n저장 위치: {path.parent}"
                if str(path) != "." else "영상 없음"
            )
            has_video = (
                str(path) != "."
                and path.is_file()
                and path.stat().st_size > 0
            )
            image_path = (
                project.generated_images[number - 1]
                if len(project.generated_images) >= number else "없음"
            )
            record = next((
                item for item in project.video_generation_records
                if int(item.get("scene_number", 0)) == number
            ), {})
            prompt = str(record.get("prompt", "저장된 Prompt 없음"))
            status = str(record.get("status", "상태 없음"))
            cost = float(record.get("estimated_cost_usd", 0.0) or 0.0)
            content = (
                "원본 OpenAI 이미지\n"
                f"{image_path}\n\n"
                f"Runway 상태  {status}\n"
                f"로컬 예상 비용  ${cost:.2f}\n\n"
                "Runway에 전달한 최종 Prompt\n"
                f"{prompt}\n\n"
                "승인은 프로젝트 검토 상태만 저장하며 "
                "Asset Library로 복사하지 않습니다."
            )
            info.configure(state="normal")
            info.delete("1.0", "end")
            info.insert("1.0", content)
            info.configure(state="disabled")
            info.yview_moveto(0)
            if action_buttons:
                enabled = "normal" if has_video else "disabled"
                action_buttons["play"].configure(state=enabled)
                action_buttons["approve"].configure(state=enabled)

        def resize_text(_event: tk.Event[tk.Misc]) -> None:
            width = max(260, detail.winfo_width() - 44)
            for child in detail.grid_slaves(row=1, column=0):
                if isinstance(child, tk.Label):
                    child.configure(wraplength=width)

        detail.bind("<Configure>", resize_text, add="+")

        listing.bind("<<ListboxSelect>>", select)
        listing.selection_set(0)

        def video_path() -> Path:
            number = selected["scene"]
            value = (
                project.generated_video_paths[number - 1]
                if len(project.generated_video_paths) >= number
                else ""
            )
            if not value:
                raise FileNotFoundError(
                    f"Scene {number} 영상이 아직 생성되지 않았습니다. "
                    "'이 장면 재생성'으로 해당 장면만 다시 요청하세요."
                )
            path = Path(value)
            if not path.is_file() or path.stat().st_size == 0:
                raise FileNotFoundError(
                    f"Scene {number} 영상 파일을 찾을 수 없습니다. "
                    "'이 장면 재생성'으로 복구하세요."
                )
            return path

        def play() -> None:
            try:
                open_local_path(video_path())
            except Exception as exc:
                messagebox.showerror("영상 열기 실패", str(exc), parent=window)

        def approve() -> None:
            nonlocal project
            project = self._get_video_service().approve_scene(
                project, selected["scene"], True
            )
            window.destroy()
            self._open_video_review(project)

        def regenerate() -> None:
            number = selected["scene"]
            window.destroy()
            self._open_runway_confirmation(project, retry_scene=number)

        def regenerate_all() -> None:
            window.destroy()
            self._open_runway_confirmation(project, force_all=True)

        def merge() -> None:
            if project.workflow_state != WorkflowState.VIDEOS_APPROVED:
                messagebox.showwarning(
                    "병합 전 확인",
                    "6개 장면 영상을 모두 승인해야 병합할 수 있습니다.",
                    parent=window,
                )
                return
            window.destroy()
            self._start_video_merge(project)

        action_buttons["play"] = HoverButton(
            actions, "영상 재생", play,
            background=self.PURPLE, hover="#765DE4",
            font=(self.FONT, 9, "bold"), padx=16, pady=10,
        )
        action_buttons["play"].pack(side="left")
        action_buttons["approve"] = HoverButton(
            actions, "장면 승인", approve,
            background="#176344", hover="#20845B",
            font=(self.FONT, 9, "bold"), padx=16, pady=10,
        )
        action_buttons["approve"].pack(side="left", padx=8)
        HoverButton(
            actions, "이 장면 재생성", regenerate,
            background="#733B1A", hover=self.ORANGE,
            font=(self.FONT, 9, "bold"), padx=16, pady=10,
        ).pack(side="left")
        HoverButton(
            actions, "전체 영상 재생성", regenerate_all,
            background="#6B2432", hover="#96384B",
            font=(self.FONT, 9, "bold"), padx=16, pady=10,
        ).pack(side="left", padx=8)
        HoverButton(
            actions, "승인 영상 최종 병합", merge,
            background=self.PURPLE, hover="#765DE4",
            font=(self.FONT, 9, "bold"), padx=18, pady=10,
        ).pack(side="right")
        select()

    def _start_video_merge(self, project: ProjectContext) -> None:
        """Merge six approved scene videos once, without a provider call."""
        if self._generation_running:
            self._toast("다른 작업이 진행 중입니다.", kind="warning")
            return
        self._generation_running = True
        project_root = (
            self.config_data.project_root
            / "learning_data"
            / "projects"
            / project.project_directory_name
        )
        project_ratio = runway_ratio_for_project(
            project, self.config_data.runway_ratio
        )
        output_size = (
            (1920, 1080) if project_ratio == "1280:720" else (1080, 1920)
        )
        pipeline = VideoPipeline(
            project_root / "videos" / "runway",
            project_root / "videos" / "final" / "instagram_reel.mp4",
            self.ffmpeg_engine.probe,
            lambda clips, output: self.ffmpeg_engine.execute(
                clips, output, output_size=output_size
            ),
            MemoryManager(
                self.config_data.project_root
                / "learning_data"
                / "projects"
            ).save,
            APIJobManager(
                self.config_data.project_root
                / "learning_data"
                / "api_jobs.json",
                self.config_data.app_max_concurrent_api_jobs,
            ),
        )

        def run() -> None:
            try:
                pipeline.initialize()
                updated = pipeline.execute(project)
                self.after(0, lambda: self._video_merge_finished(updated))
            except Exception as exc:
                self.after(
                    0, lambda error=exc: self._video_merge_failed(error)
                )

        threading.Thread(target=run, daemon=True).start()

    def _video_merge_finished(self, project: ProjectContext) -> None:
        self._generation_running = False
        self.refresh()
        self._toast("Instagram Reels 최종 MP4 병합이 완료되었습니다.")
        if project.final_video_path:
            open_local_path(Path(project.final_video_path))

    def _video_merge_failed(self, error: Exception) -> None:
        self._generation_running = False
        messagebox.showerror("최종 영상 병합 실패", str(error), parent=self)

    def _open_project(self, project: ProjectContext) -> None:
        """Show one concise project overview with a state-aware next action."""
        window = tk.Toplevel(self)
        window.title("PRISM FORGE — 단기 프로젝트")
        self._fit_window(window, 920, 640, 760, 540)
        window.configure(bg=self.BG)
        window.transient(self)
        progress, stage = project_progress(project)
        project_name = str(
            project.lore_context.get("project_name")
            or project.story.get("title")
            or "단기 프로젝트"
        )
        header = self._window_header(
            window,
            f"SHORT PROJECT  /  {stage}",
            project_name,
            "현재 상태와 다음 제작 작업을 확인하고 저장된 설정을 다시 열 수 있습니다.",
        )
        self._status_badge(
            header, f"{project.workflow_state.value} · {progress}%",
            color=self.GREEN
            if project.workflow_state == WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION
            else self.GOLD,
        ).pack(side="right", padx=(0, 8))

        # Project actions are navigation-critical, so reserve their height
        # before the overview body consumes the remaining vertical space.
        actions = tk.Frame(
            window, name="short_project_action_bar", bg=self.BG
        )
        actions.pack(side="bottom", fill="x", padx=26, pady=(4, 18))
        body = tk.Frame(window, bg=self.BG)
        body.pack(fill="both", expand=True, padx=26, pady=(22, 8))
        overview = self._card(body)
        overview.pack(fill="x")
        tk.Label(
            overview, text="PROJECT OVERVIEW", bg=self.SURFACE,
            fg=self.GOLD, font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w", padx=18, pady=(15, 3))
        tk.Label(
            overview,
            text=project.topic,
            bg=self.SURFACE, fg=self.TEXT,
            font=(self.FONT, 14, "bold"), wraplength=760, justify="left",
        ).pack(anchor="w", padx=18)
        genre = str(project.style_profile.get("genre", "—"))
        mood = str(project.style_profile.get("mood", "—"))
        duration = project.lore_context.get("duration_seconds", 30)
        tk.Label(
            overview,
            text=(
                f"{genre}  ·  {mood}  ·  {duration}초  ·  "
                f"대본 장면 {len(project.scenes)}/6  ·  "
                f"이미지 {len(project.generated_images)}/6"
            ),
            bg=self.SURFACE, fg=self.MUTED, font=(self.FONT, 8),
        ).pack(anchor="w", padx=18, pady=(8, 15))

        flow = self._card(body, background=self.SURFACE_2)
        flow.pack(fill="x", pady=14)
        stages = (
            ("1", "프로젝트", bool(project.topic)),
            ("2", "대본", len(project.scenes) == 6),
            (
                "3", "Reference",
                project.workflow_state not in {
                    WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW,
                    WorkflowState.GENERATING_STORY,
                    WorkflowState.READY,
                    WorkflowState.INIT,
                },
            ),
            ("4", "이미지", len(project.generated_images) == 6),
            (
                "5", "이미지 확정",
                project.workflow_state in {
                    WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
                    WorkflowState.GENERATING_VIDEOS,
                    WorkflowState.VIDEOS_READY,
                    WorkflowState.REVIEWING_VIDEOS,
                    WorkflowState.VIDEOS_APPROVED,
                    WorkflowState.RENDERING,
                    WorkflowState.COMPLETED,
                },
            ),
            (
                "6", "영상",
                project.workflow_state in {
                    WorkflowState.VIDEOS_READY,
                    WorkflowState.REVIEWING_VIDEOS,
                    WorkflowState.VIDEOS_APPROVED,
                    WorkflowState.RENDERING,
                    WorkflowState.COMPLETED,
                },
            ),
        )
        for number, label, done in stages:
            item = tk.Frame(flow, bg=self.SURFACE_2)
            item.pack(side="left", expand=True, fill="x", padx=6, pady=16)
            self._status_badge(
                item, "✓" if done else number,
                color=self.GREEN if done else self.MUTED,
            ).pack()
            tk.Label(
                item, text=label, bg=self.SURFACE_2,
                fg=self.TEXT if done else self.MUTED,
                font=(self.FONT, 8, "bold"),
            ).pack(pady=(5, 0))

        def run_and_close(action: Callable[[], None]) -> None:
            window.destroy()
            action()

        state = project.workflow_state
        if state == WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION:
            primary_text = "Runway 영상 생성 확인"
            primary_action = lambda: self._open_runway_confirmation(project)
        elif state in {
            WorkflowState.VIDEOS_READY,
            WorkflowState.REVIEWING_VIDEOS,
            WorkflowState.VIDEOS_APPROVED,
        }:
            primary_text = "장면 영상 검토"
            primary_action = lambda: self._open_video_review(project)
        elif state == WorkflowState.INTERRUPTED:
            primary_text = "Runway 작업 재개"
            primary_action = lambda: self._open_runway_confirmation(project)
        elif state == WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW:
            primary_text = "Candidate Asset 전달 확인"
            primary_action = lambda: self._confirm_short_automatic_references(project)
        elif state == WorkflowState.ASSET_MAPPING_APPROVED:
            primary_text = "이미지 생성"
            primary_action = lambda: self._start_short_image_generation(project)
        elif state in {WorkflowState.IMAGES_READY, WorkflowState.IMAGES_REVIEW}:
            primary_text = "이미지 검토"
            primary_action = lambda: self._open_result_viewer(project)
        elif state == WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION:
            primary_text = "이미지 검토 결과"
            primary_action = lambda: self._open_result_viewer(project)
        elif state in {
            WorkflowState.GENERATING_VIDEOS,
            WorkflowState.VIDEOS_READY,
            WorkflowState.REVIEWING_VIDEOS,
            WorkflowState.VIDEOS_APPROVED,
            WorkflowState.RENDERING,
            WorkflowState.COMPLETED,
        }:
            primary_text = "프로젝트 결과 보기"
            primary_action = lambda: self._open_result_viewer(project)
        else:
            primary_text = "프로젝트 결과 보기"
            primary_action = lambda: self._open_result_viewer(project)
        HoverButton(
            actions, primary_text,
            lambda: run_and_close(primary_action),
            background=self.PURPLE, hover="#765DE4",
            font=(self.FONT, 10, "bold"), padx=20, pady=10,
        ).pack(side="left")
        if project.generated_images:
            HoverButton(
                actions, "이미지 열기",
                lambda: run_and_close(
                    lambda: self._open_result_viewer(project)
                ),
                background=self.SURFACE_3, hover=self.PURPLE,
                font=(self.FONT, 9, "bold"), padx=16, pady=10,
            ).pack(side="left", padx=8)
        HoverButton(
            actions, "프로젝트 폴더",
            lambda: open_local_path(
                self.config_data.project_root / "learning_data" / "projects"
                / project.project_id
            ),
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 9, "bold"), padx=16, pady=10,
        ).pack(side="right")
        settings_enabled = state in {
            WorkflowState.INIT,
            WorkflowState.READY,
            WorkflowState.FAILED,
            WorkflowState.CANCELLED,
        }
        settings_button = HoverButton(
            actions, "프로젝트 설정",
            lambda: run_and_close(
                lambda: self._open_project_brief(existing_project=project)
            ),
            background=self.SURFACE_3, hover=self.PURPLE,
            font=(self.FONT, 9, "bold"), padx=16, pady=10,
        )
        settings_button.pack(side="right", padx=8)
        if not settings_enabled:
            settings_button.configure(state="disabled", fg=self.MUTED)
        self._fade_in(window)

    def _start_short_image_generation(self, project: ProjectContext) -> None:
        """Run the existing approved image stage from the project overview."""
        if not self.config_data.openai_api_key:
            self._toast("OpenAI API 키가 필요합니다.", kind="warning")
            return
        if self._generation_running:
            self._toast("다른 생성 작업이 진행 중입니다.", kind="warning")
            return
        if self.config_data.app_confirm_before_paid_run and not messagebox.askyesno(
            "이미지 생성 확인",
            "장면 이미지 최대 6회를 요청할 수 있습니다. 진행할까요?",
            parent=self,
        ):
            return
        self._generation_running = True

        def run() -> None:
            try:
                if self.generation_service is None:
                    self.generation_service = GenerationService(self.config_data)
                result = self.generation_service.generate_approved_images(project)
                self.after(0, lambda: self._generation_succeeded(result))
            except Exception as exc:
                self.after(0, lambda error=exc: self._generation_failed(error))

        threading.Thread(target=run, daemon=True).start()

    def _delete_short_project(self, project: ProjectContext) -> None:
        title = str(project.story.get("title") or project.topic)
        if not messagebox.askyesno(
            "단기 프로젝트 삭제",
            "프로젝트 폴더 전체를 보관함으로 이동합니다.\n"
            "대본, 이미지, Reference, 검토 기록이 함께 이동됩니다.\n\n"
            "계속할까요?",
            parent=self,
        ):
            return
        typed = simpledialog.askstring(
            "삭제 확인",
            (
                "확인을 위해 아래 프로젝트 이름을 입력하세요.\n"
                "앞뒤 공백과 콜론 같은 문장부호 차이는 허용됩니다.\n\n"
                f"{title}"
            ),
            parent=self,
        )
        if not project_delete_confirmation_matches(
            typed,
            title,
            project.topic,
            project.project_id,
        ):
            if typed is not None:
                messagebox.showwarning(
                    "프로젝트 이름 불일치",
                    (
                        "입력한 이름이 프로젝트와 일치하지 않습니다.\n\n"
                        "다음 이름을 그대로 입력하세요.\n"
                        f"{title}"
                    ),
                    parent=self,
                )
            return
        try:
            destination = self.project_lifecycle.archive_project(project.project_id)
        except ProjectLifecycleError as exc:
            messagebox.showerror("삭제 실패", str(exc), parent=self)
            return
        self._toast("단기 프로젝트를 복구 가능한 보관함으로 이동했습니다.")
        self.refresh()
        messagebox.showinfo(
            "프로젝트 보관 완료",
            f"프로젝트를 다음 보관함으로 이동했습니다.\n\n{destination}",
            parent=self,
        )

    def _current_project(self) -> ProjectContext | None:
        if self.dashboard_data and self.dashboard_data.projects:
            return self.dashboard_data.projects[0]
        return None

    def _pick_reference_project(
        self, parent: tk.Misc
    ) -> ReferenceProjectOption | None:
        options = list_reference_projects(
            self.config_data.project_root / "learning_data" / "projects"
        )
        if not options:
            messagebox.showinfo(
                "프로젝트 필요", "먼저 단편 또는 장기 프로젝트를 만드세요.",
                parent=parent,
            )
            return None
        labels = "\n".join(
            f"{index + 1}. {item.title} · {item.project_id}"
            for index, item in enumerate(options)
        )
        number = simpledialog.askinteger(
            "프로젝트 선택", labels, parent=parent,
            minvalue=1, maxvalue=len(options),
        )
        return options[number - 1] if number else None

    def _choose_library_asset(
        self, parent: tk.Misc, *, asset_type: str | None = None,
        title: str = "Library Asset 선택",
        asset_filter: Callable[[LibraryAsset], bool] | None = None,
    ) -> LibraryAsset | None:
        """Choose a typed Library Asset with an image preview."""
        library = AssetLibrary(self.config_data.project_root / "learning_data")
        assets = library.search(asset_type=asset_type)
        if asset_filter is not None:
            assets = [asset for asset in assets if asset_filter(asset)]
        if not assets:
            self._toast(f"선택 가능한 {title} 항목이 없습니다.", kind="warning")
            return None
        picker = tk.Toplevel(parent)
        picker.title(title)
        self._fit_window(picker, 720, 500, 640, 440)
        picker.configure(bg=self.BG)
        picker.transient(parent)
        picker.grab_set()
        listing = tk.Listbox(
            picker, bg=self.SURFACE, fg=self.TEXT,
            selectbackground=self.PURPLE, relief="flat", font=(self.FONT, 9),
        )
        listing.pack(side="left", fill="both", expand=True, padx=18, pady=18)
        preview = tk.Canvas(
            picker, width=300, bg="#080D1A", highlightthickness=0
        )
        preview.pack(side="left", fill="both", padx=(0, 18), pady=18)
        for asset in assets:
            listing.insert(
                "end",
                f"{asset.display_name} · {asset.asset_type} · v{asset.version}",
            )
        result: dict[str, LibraryAsset | None] = {"asset": None}
        photo_state: dict[str, object] = {"photo": None}

        def show(_event: tk.Event[tk.Misc] | None = None) -> None:
            selected = listing.curselection()
            if not selected:
                return
            asset = assets[selected[0]]
            preview.delete("all")
            try:
                photo = tk.PhotoImage(file=str(library.resolve_path(asset)))
                scale = max(
                    1, max(photo.width() // 270, photo.height() // 360)
                )
                photo = photo.subsample(scale, scale)
                preview.create_image(150, 190, image=photo)
                photo_state["photo"] = photo
            except (tk.TclError, ReferenceAssetError):
                preview.create_text(
                    150, 190, text="썸네일을 표시할 수 없습니다.",
                    fill=self.MUTED, font=(self.FONT, 8),
                )
            preview.create_text(
                150, 420,
                text=f"{asset.display_name}\n{asset.description or '설명 없음'}",
                width=270, fill=self.TEXT_SOFT, font=(self.FONT, 8),
            )

        def choose(_event: tk.Event[tk.Misc] | None = None) -> None:
            selected = listing.curselection()
            if selected:
                result["asset"] = assets[selected[0]]
                picker.destroy()

        listing.bind("<<ListboxSelect>>", show)
        listing.bind("<Double-Button-1>", choose)
        HoverButton(
            picker, "선택", choose, background=self.PURPLE, hover="#765DE4",
            font=(self.FONT, 8, "bold"), padx=12, pady=7,
        ).place(relx=0.96, rely=0.96, anchor="se")
        self.wait_window(picker)
        return result["asset"]

    def _open_asset_registration_wizard(
        self,
        parent: tk.Misc,
        source_path: Path,
        library: AssetLibrary,
        on_saved: Callable[[LibraryAsset], None],
    ) -> None:
        """Collect searchable Asset metadata in a five-step guided flow."""
        wizard = tk.Toplevel(parent)
        wizard.title("PRISM FORGE — Asset Registration Wizard")
        self._fit_window(wizard, 1040, 700, 900, 580)
        wizard.configure(bg=self.BG)
        wizard.transient(parent)
        wizard.grab_set()

        values = {
            "name": tk.StringVar(value=source_path.stem),
            "type": tk.StringVar(value="general_reference"),
            "description": tk.StringVar(),
            "tags": tk.StringVar(),
        }
        visual_values = {
            key: tk.StringVar()
            for fields in ASSET_VISUAL_INPUT_FIELDS.values()
            for key, _label, _guidance in fields
        }
        step_names = (
            "대표 이름",
            "Asset 유형",
            "설명",
            "검색 태그",
            "최종 확인",
        )
        type_options = (
            ("character", "Character", "반복 등장하는 캐릭터"),
            ("background", "Background", "장면의 장소와 배경"),
            ("object", "Object", "반복 사용하는 소품과 물건"),
            ("style", "Style", "그림체와 시각적 표현 방식"),
            (
                "general_reference",
                "General Reference",
                "전체 분위기와 구도를 위한 참고 이미지",
            ),
        )
        current = {"step": 0}

        self._window_header(
            wizard,
            "ASSET LIBRARY  /  REGISTRATION",
            "새 Asset 등록",
            "검색과 자동 Reference 선택에 사용할 정보를 단계별로 입력하세요.",
        )
        body = tk.Frame(wizard, bg=self.BG)
        body.pack(fill="both", expand=True, padx=20, pady=16)
        body.columnconfigure(0, minsize=180)
        body.columnconfigure(1, weight=1)
        body.columnconfigure(2, minsize=230)
        body.rowconfigure(0, weight=1)
        steps = self._card(body, background="#0B1422")
        steps.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        center = self._card(body)
        center.grid(row=0, column=1, sticky="nsew", padx=(0, 12))
        preview_panel = self._card(body, background=self.SURFACE_2)
        preview_panel.grid(row=0, column=2, sticky="nsew")

        tk.Label(
            steps, text="REGISTRATION STEPS", bg="#0B1422",
            fg=self.MUTED, font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w", padx=14, pady=(18, 10))
        step_buttons: list[HoverButton] = []
        error_value = tk.StringVar()

        tk.Label(
            preview_panel, text="IMAGE PREVIEW", bg=self.SURFACE_2,
            fg=self.GOLD, font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w", padx=14, pady=(16, 6))
        preview = tk.Canvas(
            preview_panel, height=210, bg="#080D14", highlightthickness=0,
        )
        preview.pack(fill="x", padx=14)
        try:
            photo = tk.PhotoImage(file=str(source_path))
            scale = max(
                1, (photo.width() + 199) // 200,
                (photo.height() + 179) // 180,
            )
            photo = photo.subsample(scale, scale)
            preview.create_image(105, 105, image=photo)
            preview._asset_photo = photo  # type: ignore[attr-defined]
        except (OSError, tk.TclError):
            preview.create_text(
                105, 105, text="Preview 불가",
                fill=self.MUTED, font=(self.FONT, 8),
            )
        live_summary = tk.StringVar()
        tk.Label(
            preview_panel, textvariable=live_summary, justify="left",
            wraplength=200, bg=self.SURFACE_2, fg=self.TEXT_SOFT,
            font=(self.FONT, 8),
        ).pack(anchor="w", padx=14, pady=14)

        footer = tk.Frame(
            wizard, bg="#0A1019",
            highlightbackground=self.BORDER_SOFT, highlightthickness=1,
        )
        footer.pack(fill="x", side="bottom")
        back_button = HoverButton(
            footer, "이전 단계", lambda: show_step(current["step"] - 1),
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 8, "bold"), padx=16, pady=9,
        )
        back_button.pack(side="left", padx=20, pady=12)
        next_button = HoverButton(
            footer, "다음 단계", lambda: show_step(current["step"] + 1),
            background=self.PURPLE, hover="#765DE4",
            font=(self.FONT, 8, "bold"), padx=18, pady=9,
        )
        next_button.pack(side="right", padx=20, pady=12)
        tk.Label(
            footer, textvariable=error_value, bg="#0A1019", fg=self.RED,
            font=(self.FONT, 8, "bold"),
        ).place(relx=.5, rely=.5, anchor="center")

        def clear_center(title: str, description: str) -> tk.Frame:
            for child in center.winfo_children():
                child.destroy()
            page = tk.Frame(center, bg=self.SURFACE)
            page.pack(fill="both", expand=True, padx=24, pady=20)
            tk.Label(
                page, text=title, bg=self.SURFACE, fg=self.TEXT,
                font=(self.FONT, 15, "bold"),
            ).pack(anchor="w")
            tk.Label(
                page, text=description, justify="left", wraplength=520,
                bg=self.SURFACE, fg=self.MUTED, font=(self.FONT, 8),
            ).pack(anchor="w", pady=(6, 18))
            return page

        def entry(
            page: tk.Misc,
            variable: tk.StringVar,
            guidance: str,
            example: str,
        ) -> tk.Entry:
            widget = tk.Entry(
                page, textvariable=variable, bg=self.SURFACE_3,
                fg=self.TEXT, insertbackground=self.GOLD, relief="flat",
                font=(self.FONT, 10),
                highlightbackground=self.BORDER,
                highlightcolor=self.PURPLE, highlightthickness=1,
            )
            widget.pack(fill="x", ipady=8)
            tk.Label(
                page, text=guidance, justify="left", wraplength=520,
                bg=self.SURFACE, fg=self.MUTED, font=(self.FONT, 8),
            ).pack(anchor="w", pady=(9, 0))
            tk.Label(
                page, text=f"예)\n{example}", justify="left",
                bg=self.SURFACE, fg=self.DIM, font=(self.FONT, 8),
            ).pack(anchor="w", pady=(6, 0))
            return widget

        def render_name() -> None:
            page = clear_center(
                "1. 대표 이름",
                "Asset Library에서 이 이미지를 구분하는 이름입니다.",
            )
            entry(
                page, values["name"],
                "이 Asset을 대표하는 고유한 이름입니다.",
                "프로젝트에서 구분할 대표 이름",
            ).focus_set()

        def render_type() -> None:
            page = clear_center(
                "2. Asset 유형",
                "AI가 장면에서 이 이미지를 어떤 역할로 사용할지 결정합니다.",
            )
            for key, title, description in type_options:
                row = tk.Radiobutton(
                    page,
                    text=f"{title}\n{description}",
                    variable=values["type"],
                    value=key,
                    indicatoron=False,
                    anchor="w",
                    justify="left",
                    bg=self.SURFACE_3,
                    fg=self.TEXT_SOFT,
                    selectcolor="#1A2942",
                    activebackground="#20304A",
                    activeforeground=self.TEXT,
                    font=(self.FONT, 8, "bold"),
                    padx=14,
                    pady=9,
                    relief="flat",
                    highlightbackground=self.BORDER_SOFT,
                    highlightthickness=1,
                )
                row.pack(fill="x", pady=(0, 7))

        def render_description() -> None:
            selected_type = values["type"].get()
            page = clear_center(
                (
                    "3. 캐릭터 시각 정보"
                    if selected_type == "character"
                    else "3. 배경·분위기 정보"
                    if selected_type == "background"
                    else "3. 이미지 시각 정보"
                ),
                (
                    "사진을 직접 보지 않는 Story AI와, 사진을 참고하는 Image AI가 "
                    "같은 대상을 정확히 이해하도록 필요한 정보만 입력합니다."
                ),
            )
            for key, label, guidance in ASSET_VISUAL_INPUT_FIELDS.get(
                selected_type,
                ASSET_VISUAL_INPUT_FIELDS["general_reference"],
            ):
                area = tk.Frame(page, bg=self.SURFACE)
                area.pack(fill="x", pady=(0, 12))
                tk.Label(
                    area, text=label, bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 8, "bold"),
                ).pack(anchor="w")
                widget = tk.Entry(
                    area, textvariable=visual_values[key],
                    bg=self.SURFACE_3, fg=self.TEXT,
                    insertbackground=self.GOLD, relief="flat",
                    font=(self.FONT, 9),
                    highlightbackground=self.BORDER,
                    highlightcolor=self.PURPLE, highlightthickness=1,
                )
                widget.pack(fill="x", pady=(5, 3), ipady=6)
                tk.Label(
                    area, text=guidance, bg=self.SURFACE, fg=self.MUTED,
                    justify="left", wraplength=520, font=(self.FONT, 7),
                ).pack(anchor="w")
            values["description"].set(
                compose_asset_visual_description(
                    selected_type,
                    {key: value.get() for key, value in visual_values.items()},
                )
            )

        def render_tags() -> None:
            page = clear_center(
                "4. 검색 태그",
                "대표 이름이나 설명 외에 검색에 사용할 키워드입니다.",
            )
            entry(
                page, values["tags"],
                "검색을 쉽게 하기 위한 키워드입니다.\n"
                "쉼표(,)로 여러 개 입력 가능합니다.",
                "역할, 성격, 소품, 장소, 계절",
            )

        def render_final() -> None:
            values["description"].set(
                compose_asset_visual_description(
                    values["type"].get(),
                    {key: value.get() for key, value in visual_values.items()},
                )
            )
            page = clear_center(
                "5. 최종 확인",
                "미리보기와 검색 메타데이터를 확인한 뒤 저장하세요.",
            )
            selected_type = next(
                title for key, title, _description in type_options
                if key == values["type"].get()
            )
            summary = (
                f"대표 이름\n{values['name'].get() or '—'}\n\n"
                f"유형\n{selected_type}\n\n"
                f"설명\n{values['description'].get() or '—'}\n\n"
                f"검색 태그\n{values['tags'].get() or '—'}"
            )
            tk.Label(
                page, text=summary, justify="left", anchor="nw",
                wraplength=520, bg=self.SURFACE_3, fg=self.TEXT_SOFT,
                font=(self.FONT, 9), padx=16, pady=14,
            ).pack(fill="both", expand=True)

        renderers = (
            render_name, render_type, render_description,
            render_tags, render_final,
        )

        def validate_step(index: int) -> bool:
            error_value.set("")
            if index == 0 and not values["name"].get().strip():
                error_value.set("대표 이름을 입력하세요.")
                return False
            if index == 1 and values["type"].get() not in {
                item[0] for item in type_options
            }:
                error_value.set("Asset 유형을 선택하세요.")
                return False
            if index == 2:
                fields = ASSET_VISUAL_INPUT_FIELDS.get(
                    values["type"].get(),
                    ASSET_VISUAL_INPUT_FIELDS["general_reference"],
                )
                required = [
                    key for key, label, _guidance in fields if "*" in label
                ]
                if any(not visual_values[key].get().strip() for key in required):
                    error_value.set("* 표시된 시각 정보를 입력하세요.")
                    return False
                values["description"].set(
                    compose_asset_visual_description(
                        values["type"].get(),
                        {
                            key: value.get()
                            for key, value in visual_values.items()
                        },
                    )
                )
            return True

        def save_asset() -> None:
            if not validate_step(0) or not validate_step(1):
                return
            try:
                created = library.import_file(
                    source_path,
                    asset_type=values["type"].get(),
                    display_name=values["name"].get().strip(),
                    description=values["description"].get().strip(),
                    tags=values["tags"].get().split(","),
                )
            except (OSError, ReferenceAssetError) as exc:
                messagebox.showerror("Asset 등록 실패", str(exc), parent=wizard)
                return
            wizard.destroy()
            on_saved(created)

        def show_step(index: int) -> None:
            if index > current["step"] and not validate_step(current["step"]):
                return
            index = max(0, min(index, len(step_names) - 1))
            current["step"] = index
            renderers[index]()
            for position, button in enumerate(step_buttons):
                completed = position < index
                active = position == index
                color = (
                    "#15382F" if completed
                    else "#1A2942" if active
                    else "#0B1422"
                )
                button.configure(
                    text=(
                        f"✓  {step_names[position]}"
                        if completed
                        else f"{position + 1}   {step_names[position]}"
                    ),
                    bg=color,
                    fg=(
                        self.GREEN if completed
                        else self.TEXT if active
                        else self.TEXT_SOFT
                    ),
                    highlightbackground=(
                        self.GREEN if completed
                        else self.PURPLE if active
                        else self.BORDER_SOFT
                    ),
                )
                button._base = color
            back_button.configure(
                state="normal" if index else "disabled",
                fg=self.TEXT if index else self.DIM,
            )
            next_button.configure(
                text="확인 후 저장" if index == 4 else "다음 단계",
            )
            next_button._command = (
                save_asset if index == 4
                else lambda: show_step(current["step"] + 1)
            )
            live_summary.set(
                f"{values['name'].get() or '이름 미입력'}\n\n"
                f"유형  {values['type'].get()}\n"
                f"검색 태그  {values['tags'].get() or '—'}"
            )

        for index, name in enumerate(step_names):
            button = HoverButton(
                steps, f"{index + 1}   {name}",
                lambda value=index: show_step(value),
                background="#0B1422", hover="#1A2942",
                foreground=self.TEXT_SOFT,
                font=(self.FONT, 8, "bold"), padx=12, pady=8,
            )
            button.pack(fill="x", padx=8, pady=2)
            step_buttons.append(button)
        show_step(0)
        self._fade_in(wizard)

    def _open_asset_library(self, edit_asset_id: str | None = None) -> None:
        """Open the global Asset Library even when no project exists."""
        window = tk.Toplevel(self)
        window.title("PRISM FORGE — Asset Library")
        self._fit_window(window, 1320, 760, 980, 620)
        window.configure(bg=self.BG)
        window.transient(self)
        library = AssetLibrary(self.config_data.project_root / "learning_data")
        projects_root = (
            self.config_data.project_root / "learning_data" / "projects"
        )
        try:
            LegacyReferenceMigrator(
                self.config_data.project_root / "learning_data"
            ).migrate_all()
            repaired_generated_folders = (
                library.repair_legacy_generated_scene_folders()
            )
            upgraded_assets = (
                library.upgrade_legacy_root_assets_to_folders()
            )
            synchronized_children = library.synchronize_folder_child_types()
        except (OSError, ReferenceAssetError, TypeError, ValueError) as exc:
            messagebox.showwarning(
                "Asset 형식 확인",
                "기존 Asset 형식을 확인하는 중 문제가 발생했습니다.\n\n"
                + str(exc),
                parent=window,
            )
            upgraded_assets = 0
            repaired_generated_folders = 0
            synchronized_children = 0
        if repaired_generated_folders:
            self.after(
                100,
                lambda count=repaired_generated_folders: self._toast(
                    f"자동 생성 프로젝트 {count}개의 장면 이미지를 "
                    "6장짜리 Folder로 정리했습니다."
                ),
            )
        if upgraded_assets:
            self.after(
                100,
                lambda count=upgraded_assets: self._toast(
                    f"기존 Asset {count}개를 Folder 형식으로 최신화했습니다."
                ),
            )
        if synchronized_children:
            self.after(
                100,
                lambda count=synchronized_children: self._toast(
                    f"기존 하위 Reference {count}개의 유형을 Folder와 동기화했습니다."
                ),
            )

        self._window_header(
            window,
            "ASSET LIBRARY  /  SEARCH INDEX",
            "Asset Library",
            "Project Images와 수동 등록 이미지를 검색하고 관리합니다.",
        )
        query = tk.StringVar()
        asset_type = tk.StringVar(value="all")
        sort_mode = tk.StringVar(value="type/name")
        tag_filter = tk.StringVar()
        source_filter = tk.StringVar(value="all")
        filters = self._card(window, background=self.SURFACE_2)
        filters.pack(fill="x", padx=24, pady=(16, 0))
        tk.Label(
            filters, text="검색", bg=self.SURFACE_2, fg=self.MUTED,
            font=(self.FONT, 8, "bold"),
        ).pack(side="left", padx=(12, 6))
        search = tk.Entry(
            filters, textvariable=query, bg=self.SURFACE_3, fg=self.TEXT,
            insertbackground=self.GOLD, relief="flat", font=(self.FONT, 9),
        )
        search.pack(side="left", fill="x", expand=True, padx=12, pady=10, ipady=6)
        tag_entry = tk.Entry(
            filters, textvariable=tag_filter, bg=self.SURFACE_3,
            fg=self.TEXT, insertbackground=self.GOLD, relief="flat",
            width=14, font=(self.FONT, 8),
        )
        tk.Label(
            filters, text="태그", bg=self.SURFACE_2, fg=self.MUTED,
            font=(self.FONT, 8, "bold"),
        ).pack(side="left", padx=(0, 6))
        tag_entry.pack(side="left", padx=(0, 8), pady=10, ipady=6)
        tk.Label(
            filters, text="유형", bg=self.SURFACE_2, fg=self.MUTED,
            font=(self.FONT, 8, "bold"),
        ).pack(side="left", padx=(0, 6))
        filter_box = ttk.Combobox(
            filters, textvariable=asset_type, state="readonly",
            values=(
                "all", "character", "background", "object", "style",
                "general_reference",
            ),
            width=18, style="Studio.TCombobox",
        )
        filter_box.pack(side="left", padx=(0, 8), pady=10)
        tk.Label(
            filters, text="정렬", bg=self.SURFACE_2, fg=self.MUTED,
            font=(self.FONT, 8, "bold"),
        ).pack(side="left", padx=(0, 6))
        sort_box = ttk.Combobox(
            filters, textvariable=sort_mode, state="readonly",
            values=("type/name", "name", "newest", "version"),
            width=12, style="Studio.TCombobox",
        )
        sort_box.pack(side="left", padx=(0, 12), pady=10)
        source_box = ttk.Combobox(
            filters, textvariable=source_filter, state="readonly",
            values=("all", "manual", "project"),
            width=9, style="Studio.TCombobox",
        )
        source_box.pack(side="left", padx=(0, 12), pady=10)
        tk.Label(
            window, text=ASSET_SEARCH_GUIDANCE, justify="left",
            bg=self.BG, fg=self.MUTED, font=(self.FONT, 7),
        ).pack(anchor="w", padx=36, pady=(6, 0))

        # Reserve the action bar before the expanding content so it remains
        # visible when the user reduces the window height.
        actions = tk.Frame(
            window, name="asset_action_bar", bg="#0A1019",
            highlightbackground=self.BORDER_SOFT, highlightthickness=1,
        )
        actions.pack(side="bottom", fill="x", padx=24, pady=(0, 12))

        body = tk.Frame(window, bg=self.BG)
        body.pack(fill="both", expand=True, padx=24, pady=(18, 8))
        body.columnconfigure(0, weight=3, minsize=250)
        body.columnconfigure(1, weight=7, minsize=410)
        body.columnconfigure(2, weight=4, minsize=310)
        body.rowconfigure(0, weight=1)
        list_panel = self._card(body, background=self.SURFACE_2)
        list_panel.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        tk.Label(
            list_panel, text="ASSET RESULTS", bg=self.SURFACE_2,
            fg=self.GOLD, font=("Segoe UI", 8, "bold"),
        ).pack(anchor="w", padx=14, pady=(14, 2))
        tk.Label(
            list_panel, text="Asset 목록", bg=self.SURFACE_2,
            fg=self.TEXT, font=(self.FONT, 11, "bold"),
        ).pack(anchor="w", padx=14, pady=(0, 10))
        listing = tk.Listbox(
            list_panel, selectmode="extended", bg=self.SURFACE, fg=self.TEXT,
            selectbackground=self.PURPLE,
            relief="flat", font=(self.FONT, 9),
        )
        listing.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        preview_panel = self._card(body, background=self.SURFACE)
        preview_panel.grid(row=0, column=1, sticky="nsew", padx=(0, 12))
        inspector = self._card(body, background=self.SURFACE_2)
        inspector.grid(row=0, column=2, sticky="nsew")
        tk.Label(
            preview_panel, text="LARGE PREVIEW", bg=self.SURFACE,
            fg=self.GOLD, font=("Segoe UI", 8, "bold"),
        ).pack(anchor="w", padx=16, pady=(14, 0))
        preview = tk.Canvas(
            preview_panel, bg="#080D14", highlightthickness=0
        )
        preview.pack(fill="both", expand=True, padx=16, pady=(10, 16))
        tk.Label(
            inspector, text="METADATA / USAGE", bg=self.SURFACE_2,
            fg=self.GOLD, font=("Segoe UI", 8, "bold"),
        ).pack(anchor="w", padx=18, pady=(14, 0))
        details = tk.StringVar(value="자산을 선택하면 Preview와 메타데이터가 표시됩니다.")
        tk.Label(
            inspector, textvariable=details, justify="left", anchor="nw",
            wraplength=430, bg=self.SURFACE_2, fg=self.TEXT_SOFT,
            font=(self.FONT, 9), padx=18, pady=12,
        ).pack(fill="both", expand=True)
        preview_state: dict[str, object] = {"photo": None}
        state: dict[str, object] = {"assets": []}

        def open_editor(asset: LibraryAsset) -> None:
            editor = tk.Toplevel(window)
            editor.title(f"Asset Library — {asset.display_name}")
            self._fit_window(editor, 620, 690, 560, 560)
            editor.configure(bg=self.BG)
            editor.transient(window)
            editor.grab_set()
            variables: dict[str, tk.Variable] = {
                "display_name": tk.StringVar(value=asset.display_name),
                "asset_type": tk.StringVar(value=asset.asset_type),
                "description": tk.StringVar(value=asset.description),
                "tags": tk.StringVar(value=", ".join(asset.tags)),
            }
            initial = {
                key: variable.get() for key, variable in variables.items()
            }
            reference_state = {
                "items": [
                    CharacterReferenceImage(
                        item.role, item.path, item.content_sha256,
                        item.original_filename,
                    )
                    for item in asset.reference_images
                ],
                "roles": list(dict.fromkeys(
                    asset.reference_roles
                    or sorted(CHARACTER_REFERENCE_ROLES)
                    or [item.role for item in asset.reference_images]
                )),
            }
            initial["reference_images"] = tuple(
                (item.role, item.path) for item in reference_state["items"]
            )
            initial["reference_roles"] = tuple(reference_state["roles"])
            dirty_label = tk.StringVar()

            def snapshot() -> dict[str, object]:
                state = {
                    key: variable.get() for key, variable in variables.items()
                }
                state["reference_images"] = tuple(
                    (item.role, item.path)
                    for item in reference_state["items"]
                )
                state["reference_roles"] = tuple(reference_state["roles"])
                return state

            def is_dirty() -> bool:
                return snapshot() != initial

            def refresh_dirty(*_args: object) -> None:
                dirty = is_dirty()
                dirty_label.set("저장되지 않은 변경사항" if dirty else "")
                editor.title(
                    f"Asset Library{' *' if dirty else ''} — "
                    f"{variables['display_name'].get()}"
                )

            tk.Label(
                editor, text="Asset 정보 편집", bg=self.BG, fg=self.TEXT,
                font=(self.FONT, 15, "bold"),
            ).pack(anchor="w", padx=24, pady=(22, 4))
            tk.Label(
                editor, textvariable=dirty_label, bg=self.BG, fg=self.ORANGE,
                font=(self.FONT, 8, "bold"),
            ).pack(anchor="w", padx=24)
            form = self._card(editor, background=self.SURFACE)
            form.pack(fill="both", expand=True, padx=24, pady=14)

            help_text = {
                "display_name": "이 Asset을 대표하는 고유한 이름입니다.",
                "asset_type": "character / background / object / style / general_reference",
                "description": "AI가 기억해야 하는 중요한 특징을 적어주세요.",
                "tags": "검색 키워드를 쉼표(,)로 여러 개 입력할 수 있습니다.",
            }
            labels = {
                key: ASSET_UX_LABELS[key]
                for key in (
                    "display_name", "asset_type", "description",
                    "tags",
                )
            }
            for key in (
                "display_name", "asset_type", "description", "tags"
            ):
                area = tk.Frame(form, bg=self.SURFACE)
                area.pack(fill="x", padx=18, pady=(12, 0))
                tk.Label(
                    area, text=labels[key], bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 8, "bold"),
                ).pack(anchor="w")
                if key == "asset_type":
                    field_widget: tk.Widget = ttk.Combobox(
                        area, textvariable=variables[key], state="readonly",
                        values=(
                            "character", "background", "object", "style",
                            "general_reference",
                        ),
                    )
                else:
                    field_widget = tk.Entry(
                        area, textvariable=variables[key], bg=self.SURFACE_3,
                        fg=self.TEXT, insertbackground=self.GOLD, relief="flat",
                        font=(self.FONT, 9),
                    )
                field_widget.pack(fill="x", pady=(5, 2), ipady=5)
                tk.Label(
                    area, text=help_text[key], bg=self.SURFACE, fg=self.MUTED,
                    font=(self.FONT, 7),
                ).pack(anchor="w")
            for variable in variables.values():
                variable.trace_add("write", refresh_dirty)

            def manage_character_references() -> None:
                dialog = tk.Toplevel(editor)
                dialog.title("Character Reference Images")
                self._fit_window(dialog, 760, 560, 680, 500)
                dialog.configure(bg=self.BG)
                dialog.transient(editor)
                dialog.grab_set()
                tk.Label(
                    dialog, text="Reference Images", bg=self.BG,
                    fg=self.TEXT, font=(self.FONT, 15, "bold"),
                ).pack(anchor="w", padx=22, pady=(20, 4))
                tk.Label(
                    dialog,
                    text=(
                        "역할을 고른 뒤 이미지 파일을 추가하세요. 목록을 드래그하면 "
                        "순서를 바꿀 수 있고, 대표 이미지는 한 장만 지정됩니다."
                    ),
                    bg=self.BG, fg=self.MUTED, font=(self.FONT, 8),
                ).pack(anchor="w", padx=22, pady=(0, 12))
                quick = tk.Frame(dialog, bg=self.BG)
                quick.pack(fill="x", padx=22, pady=(0, 10))
                role_value = tk.StringVar(value="front")
                role_box = ttk.Combobox(
                    quick, textvariable=role_value, state="readonly",
                    values=tuple(reference_state["roles"]),
                    style="Studio.TCombobox", width=18,
                )
                role_box.pack(side="left", padx=(0, 8))
                listing = tk.Listbox(
                    dialog, bg=self.SURFACE, fg=self.TEXT,
                    selectbackground=self.PURPLE, relief="flat",
                    font=(self.FONT, 9),
                )
                listing.pack(fill="both", expand=True, padx=22)
                drag = {"index": None}

                def redraw(selected: int | None = None) -> None:
                    listing.delete(0, "end")
                    for number, reference in enumerate(
                        reference_state["items"], start=1
                    ):
                        listing.insert(
                            "end",
                            f"{number:02d}  {reference.role}  ·  "
                            f"{reference.original_filename or Path(reference.path).name}",
                        )
                    if selected is not None and reference_state["items"]:
                        selected = max(
                            0, min(selected, len(reference_state["items"]) - 1)
                        )
                        listing.selection_set(selected)
                        listing.activate(selected)

                def selected_index() -> int | None:
                    selected = listing.curselection()
                    return selected[0] if selected else None

                def add_reference() -> None:
                    selected = filedialog.askopenfilenames(
                        parent=dialog,
                        title="Character Reference 이미지 추가",
                        filetypes=[
                            ("이미지", "*.png *.jpg *.jpeg *.webp")
                        ],
                    )
                    if not selected:
                        return
                    role = role_value.get()
                    added = 0
                    for value in selected:
                        path = Path(value)
                        try:
                            _width, _height, digest = validate_image_file(path)
                        except ReferenceAssetError as exc:
                            messagebox.showerror(
                                "Reference 추가 실패",
                                f"{path.name}\n{exc}",
                                parent=dialog,
                            )
                            continue
                        if any(
                            item.role == role
                            and item.content_sha256 == digest
                            for item in reference_state["items"]
                        ):
                            continue
                        reference_state["items"].append(
                            CharacterReferenceImage(
                                role, str(path.resolve()), digest, path.name
                            )
                        )
                        added += 1
                    if not added:
                        self._toast(
                            "추가할 새 Reference 이미지가 없습니다.",
                            kind="warning",
                        )
                        return
                    redraw(len(reference_state["items"]) - 1)
                    refresh_dirty()

                def refresh_roles(selected: str | None = None) -> None:
                    roles = reference_state["roles"]
                    role_box.configure(values=tuple(roles))
                    if selected in roles:
                        role_value.set(selected)
                    elif roles:
                        role_value.set(roles[0])
                    else:
                        role_value.set("")

                def add_role() -> None:
                    value = simpledialog.askstring(
                        "역할 추가",
                        "새 Reference 역할 이름을 입력하세요.",
                        parent=dialog,
                    )
                    if value is None:
                        return
                    role = value.strip()
                    if (
                        not role or len(role) > 40
                        or any(character in role for character in "\r\n\t")
                    ):
                        messagebox.showerror(
                            "역할 추가 실패",
                            "역할은 1~40자의 한 줄 이름이어야 합니다.",
                            parent=dialog,
                        )
                        return
                    if role.casefold() in {
                        item.casefold() for item in reference_state["roles"]
                    }:
                        self._toast("이미 존재하는 역할입니다.", kind="warning")
                        return
                    reference_state["roles"].append(role)
                    refresh_roles(role)
                    refresh_dirty()

                def delete_role() -> None:
                    role = role_value.get()
                    if not role:
                        return
                    if any(
                        item.role == role for item in reference_state["items"]
                    ):
                        messagebox.showinfo(
                            "역할 삭제 불가",
                            "이 역할을 사용하는 이미지가 있습니다.\n"
                            "이미지 역할을 변경하거나 이미지를 삭제한 뒤 다시 시도하세요.",
                            parent=dialog,
                        )
                        return
                    reference_state["roles"].remove(role)
                    refresh_roles()
                    refresh_dirty()

                def remove_reference() -> None:
                    index = selected_index()
                    if index is None or len(reference_state["items"]) <= 1:
                        return
                    reference_state["items"].pop(index)
                    redraw(index)
                    refresh_dirty()

                def apply_role() -> None:
                    index = selected_index()
                    if index is None or not role_value.get():
                        return
                    if role_value.get() == "thumbnail":
                        make_representative()
                        return
                    reference_state["items"][index].role = role_value.get()
                    redraw(index)
                    refresh_dirty()

                def make_representative() -> None:
                    index = selected_index()
                    if index is None:
                        return
                    items = reference_state["items"]
                    for item in items:
                        if item.role == "thumbnail":
                            item.role = "other"
                    items[index].role = "thumbnail"
                    items.insert(0, items.pop(index))
                    redraw(0)
                    refresh_dirty()

                def drag_start(event: tk.Event[tk.Misc]) -> None:
                    drag["index"] = listing.nearest(event.y)

                def drag_move(event: tk.Event[tk.Misc]) -> str:
                    origin = drag["index"]
                    target = listing.nearest(event.y)
                    if (
                        origin is not None and target != origin
                        and target in range(len(reference_state["items"]))
                    ):
                        item = reference_state["items"].pop(origin)
                        reference_state["items"].insert(target, item)
                        drag["index"] = target
                        redraw(target)
                        refresh_dirty()
                    return "break"

                listing.bind("<ButtonPress-1>", drag_start)
                listing.bind("<B1-Motion>", drag_move)
                listing.bind(
                    "<<ListboxSelect>>",
                    lambda _event: (
                        role_value.set(
                            reference_state["items"][selected_index()].role
                        )
                        if selected_index() is not None else None
                    ),
                )
                HoverButton(
                    quick, "+ 이미지 추가", add_reference,
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=12, pady=7,
                ).pack(side="left", padx=(0, 7))
                HoverButton(
                    quick, "선택 항목 역할 적용", apply_role,
                    background=self.SURFACE_3, hover=self.BORDER,
                    font=(self.FONT, 8, "bold"), padx=12, pady=7,
                ).pack(side="left")
                HoverButton(
                    quick, "+ 역할", add_role,
                    background=self.GREEN, hover=self.BORDER,
                    font=(self.FONT, 8, "bold"), padx=10, pady=7,
                ).pack(side="left", padx=(7, 4))
                HoverButton(
                    quick, "역할 삭제", delete_role,
                    background=self.RED, hover=self.BORDER,
                    font=(self.FONT, 8, "bold"), padx=10, pady=7,
                ).pack(side="left")
                buttons = tk.Frame(dialog, bg=self.BG)
                buttons.pack(fill="x", padx=22, pady=16)
                for label, command, color in (
                    ("삭제", remove_reference, self.RED),
                    ("대표 이미지 지정", make_representative, self.GREEN),
                ):
                    HoverButton(
                        buttons, label, command, background=color,
                        hover=self.BORDER, font=(self.FONT, 8, "bold"),
                        padx=11, pady=7,
                    ).pack(side="left", padx=(0, 7))
                HoverButton(
                    buttons, "완료", dialog.destroy,
                    background=self.SURFACE_3, hover=self.BORDER,
                    font=(self.FONT, 8, "bold"), padx=12, pady=7,
                ).pack(side="right")
                redraw()

            def save() -> bool:
                nonlocal initial
                asset_type_value = str(variables["asset_type"].get())
                try:
                    library.update_metadata(
                        asset.asset_id,
                        display_name=str(variables["display_name"].get()),
                        asset_type=asset_type_value,
                        description=str(variables["description"].get()),
                        tags=str(variables["tags"].get()).split(","),
                    )
                    if asset_type_value == "character":
                        library.update_character_references(
                            asset.asset_id,
                            reference_state["items"],
                            reference_roles=reference_state["roles"],
                        )
                except (OSError, ReferenceAssetError) as exc:
                    messagebox.showerror("Asset 저장 실패", str(exc), parent=editor)
                    return False
                initial = snapshot()
                refresh_dirty()
                reload_assets()
                return True

            def request_close() -> None:
                if not is_dirty():
                    editor.destroy()
                    return
                choice = messagebox.askyesnocancel(
                    "저장되지 않은 변경사항",
                    "저장되지 않은 Asset 변경사항이 있습니다.\n\n"
                    "예: 저장 후 계속\n아니요: 변경사항 버리기\n취소: 편집 계속",
                    parent=editor,
                )
                if choice is None:
                    return
                if choice and not save():
                    return
                editor.destroy()

            actions = tk.Frame(editor, bg=self.BG)
            actions.pack(fill="x", padx=24, pady=(0, 20))
            HoverButton(
                actions, "저장", save, background=self.PURPLE,
                hover="#7048D9", font=(self.FONT, 8, "bold"),
                padx=15, pady=8,
            ).pack(side="right")
            HoverButton(
                actions, "닫기", request_close, background=self.SURFACE_3,
                hover=self.BORDER, font=(self.FONT, 8, "bold"),
                padx=15, pady=8,
            ).pack(side="right", padx=8)
            editor.protocol("WM_DELETE_WINDOW", request_close)
            refresh_dirty()

        def reload_assets(_event: tk.Event[tk.Misc] | None = None) -> None:
            try:
                selected_type = None if asset_type.get() == "all" else asset_type.get()
                assets = library.search(
                    query.get(), asset_type=selected_type,
                    tags=[
                        value.strip() for value in tag_filter.get().split(",")
                        if value.strip()
                    ],
                    include_disabled=True,
                )
                assets = [
                    item for item in assets if not item.parent_folder_id
                ]
                if source_filter.get() == "manual":
                    assets = [
                        item for item in assets
                        if item.source_project_id == "_asset_library_manual"
                    ]
                elif source_filter.get() == "project":
                    assets = [
                        item for item in assets
                        if item.source_project_id != "_asset_library_manual"
                    ]
                if sort_mode.get() == "name":
                    assets.sort(key=lambda item: item.display_name.casefold())
                elif sort_mode.get() == "newest":
                    assets.sort(key=lambda item: item.updated_at, reverse=True)
                elif sort_mode.get() == "version":
                    assets.sort(key=lambda item: item.version, reverse=True)
            except ReferenceAssetError as exc:
                messagebox.showerror("Asset Library", str(exc), parent=window)
                return
            state["assets"] = assets
            listing.delete(0, "end")
            for asset in assets:
                marker = "●"
                match_summary = asset_search_match_summary(
                    asset, query.get()
                )
                listing.insert(
                    "end",
                    f"{marker} "
                    f"{highlight_search_matches(asset.display_name, query.get())}"
                    f" · {highlight_search_matches(asset.asset_type, query.get())}"
                    + (
                        f" · Folder · {len(asset.child_asset_ids)}장"
                        if asset.is_folder else f" · v{asset.version}"
                    )
                    + (f"\n    일치  {match_summary}" if match_summary else ""),
                )
            details.set(f"전역 자산 {len(assets)}개")

        def selected_asset():
            selection = listing.curselection()
            assets = state["assets"]
            return assets[selection[0]] if selection and isinstance(assets, list) else None

        def show_details(_event: tk.Event[tk.Misc] | None = None) -> None:
            asset = selected_asset()
            if asset is None:
                return
            used = library.usage_projects(projects_root, asset.asset_id)
            usage = library.usage_details(projects_root, asset.asset_id)
            preview.delete("all")
            preview.update_idletasks()
            preview_width = max(320, preview.winfo_width())
            preview_height = max(300, preview.winfo_height())
            try:
                if asset.is_folder:
                    photos = []
                    children = library.folder_children(asset)
                    columns = 3
                    cell_width = max(100, preview_width // columns)
                    cell_height = 150
                    for index, child in enumerate(children[:9]):
                        photo = tk.PhotoImage(
                            file=str(library.resolve_path(child))
                        )
                        scale = max(
                            1,
                            (photo.width() + cell_width - 25)
                            // max(1, cell_width - 24),
                            (photo.height() + 96) // 96,
                        )
                        photo = photo.subsample(scale, scale)
                        x = index % columns * cell_width + cell_width // 2
                        y = index // columns * cell_height + 58
                        preview.create_image(x, y, image=photo)
                        preview.create_text(
                            x, y + 66,
                            text=f"{child.role or 'other'} · {child.display_name}",
                            fill=self.TEXT_SOFT, font=(self.FONT, 7),
                        )
                        photos.append(photo)
                    preview_state["photo"] = photos
                else:
                    photo = tk.PhotoImage(file=str(library.resolve_path(asset)))
                    scale = max(
                        1,
                        (photo.width() + preview_width - 1)
                        // max(1, preview_width - 28),
                        (photo.height() + preview_height - 1)
                        // max(1, preview_height - 28),
                    )
                    photo = photo.subsample(scale, scale)
                    preview.create_image(
                        preview_width // 2, preview_height // 2, image=photo
                    )
                    preview_state["photo"] = photo
            except (tk.TclError, OSError, ReferenceAssetError):
                preview.create_text(
                    preview_width // 2, preview_height // 2,
                    text="Preview를 표시할 수 없습니다.",
                    fill=self.MUTED, font=(self.FONT, 9),
                )
            versions = "\n".join(
                f"v{item.version} · {item.notes or '메모 없음'}"
                for item in asset.versions
            )
            policies = "\n".join(
                f"{item['project_id']} · {item['version_policy']}"
                for item in usage
            )
            reference_summary = "\n".join(
                f"{index}. {item.role} · "
                f"{item.original_filename or Path(item.path).name}"
                for index, item in enumerate(
                    asset.reference_images, start=1
                )
            )
            folder_summary = "\n".join(
                f"{index}. {child.role or 'other'} · "
                f"{child.display_name} · {child.original_filename}"
                for index, child in enumerate(
                    library.folder_children(asset), start=1
                )
            ) if asset.is_folder else ""
            details.set(
                f"대표 이름\n{asset.display_name}\n\n"
                f"유형\n{asset.asset_type}\n\n"
                f"설명\n{asset.description or '—'}\n\n"
                f"검색 태그\n{', '.join(asset.tags) or '—'}\n\n"
                + (
                    f"하위 이미지\n{folder_summary or '—'}\n\n"
                    if asset.is_folder else ""
                )
                + (
                    f"Reference Images\n{reference_summary or '—'}\n\n"
                    if asset.asset_type == "character" else ""
                )
                + f"사용 프로젝트\n{', '.join(used) or '없음'}\n"
                f"{policies or '—'}\n\n"
                f"생성일\n{asset.created_at}\n\n"
                f"최근 수정일\n{asset.updated_at}\n\n"
                f"ID  {asset.asset_id}"
                + ("" if asset.is_folder else f"  ·  Version {asset.version}")
                + "\n"
                f"Version 기록\n{versions}\n\n"
            )

        def create_asset_folder(
            existing_children: list[LibraryAsset] | None = None,
        ) -> None:
            creator = tk.Toplevel(window)
            creator.title("PRISM FORGE — New Asset Folder")
            self._fit_window(creator, 760, 680, 660, 580)
            creator.configure(bg=self.BG)
            creator.transient(window)
            creator.grab_set()
            self._window_header(
                creator,
                "ASSET LIBRARY  /  NEW FOLDER",
                "새 Asset Folder",
                "대본 생성 Prompt에 전달할 Folder 정보만 입력합니다.",
            )
            values = {
                "name": tk.StringVar(),
                "type": tk.StringVar(value="character"),
                "description": tk.StringVar(),
                "tags": tk.StringVar(),
            }
            folder_visual_values = {
                key: tk.StringVar()
                for visual_fields in ASSET_VISUAL_INPUT_FIELDS.values()
                for key, _label, _guidance in visual_fields
            }
            card = self._card(creator, background=self.SURFACE)
            card.pack(fill="both", expand=True, padx=24, pady=18)
            fields = (
                (
                    "폴더 대표 이름 *", "name",
                    "프로젝트와 대본에서 이 자료를 식별할 이름입니다.",
                ),
                (
                    "Asset 유형 *", "type",
                    "대본에서 인물·배경·소품·스타일 중 어떤 자료인지 구분합니다.",
                ),
                (
                    "검색 태그", "tags",
                    "Asset Library에서 찾기 위한 핵심 단어입니다. "
                    "쉼표(,)로 구분합니다.",
                ),
            )
            type_widget: ttk.Combobox | None = None
            for label, key, guidance in fields:
                area = tk.Frame(card, bg=self.SURFACE)
                area.pack(fill="x", padx=20, pady=(13, 0))
                tk.Label(
                    area, text=label, bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 8, "bold"),
                ).pack(anchor="w")
                if key == "type":
                    type_widget = ttk.Combobox(
                        area, textvariable=values[key], state="readonly",
                        values=(
                            "character", "background", "object", "style",
                            "general_reference",
                        ),
                        style="Studio.TCombobox",
                    )
                    widget: tk.Widget = type_widget
                else:
                    widget = tk.Entry(
                        area, textvariable=values[key], bg=self.SURFACE_3,
                        fg=self.TEXT, insertbackground=self.GOLD,
                        relief="flat", font=(self.FONT, 9),
                    )
                widget.pack(fill="x", pady=(5, 2), ipady=5)
                tk.Label(
                    area, text=guidance, bg=self.SURFACE, fg=self.MUTED,
                    justify="left", wraplength=650, font=(self.FONT, 7),
                ).pack(anchor="w")
            visual_area = tk.Frame(card, bg=self.SURFACE)
            visual_area.pack(fill="both", expand=True, padx=20, pady=(13, 0))

            def render_folder_visual_fields(_event: object = None) -> None:
                for child in visual_area.winfo_children():
                    child.destroy()
                asset_type = values["type"].get()
                heading = (
                    "캐릭터 시각 정보"
                    if asset_type == "character"
                    else "배경·분위기 정보"
                    if asset_type == "background"
                    else "이미지 시각 정보"
                )
                tk.Label(
                    visual_area, text=heading, bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 9, "bold"),
                ).pack(anchor="w", pady=(0, 3))
                for key, label, guidance in ASSET_VISUAL_INPUT_FIELDS.get(
                    asset_type,
                    ASSET_VISUAL_INPUT_FIELDS["general_reference"],
                ):
                    row = tk.Frame(visual_area, bg=self.SURFACE)
                    row.pack(fill="x", pady=(4, 0))
                    tk.Label(
                        row, text=label, bg=self.SURFACE,
                        fg=self.TEXT_SOFT, font=(self.FONT, 7, "bold"),
                    ).pack(anchor="w")
                    tk.Entry(
                        row, textvariable=folder_visual_values[key],
                        bg=self.SURFACE_3, fg=self.TEXT,
                        insertbackground=self.GOLD, relief="flat",
                        font=(self.FONT, 8),
                    ).pack(fill="x", pady=(2, 1), ipady=4)
                    tk.Label(
                        row, text=guidance, bg=self.SURFACE, fg=self.MUTED,
                        justify="left", wraplength=650,
                        font=(self.FONT, 7),
                    ).pack(anchor="w")

            if type_widget is not None:
                type_widget.bind(
                    "<<ComboboxSelected>>",
                    render_folder_visual_fields,
                )
            render_folder_visual_fields()
            error = tk.StringVar()
            tk.Label(
                creator, textvariable=error, bg=self.BG, fg=self.RED,
                font=(self.FONT, 8, "bold"),
            ).pack(anchor="w", padx=28)

            def save_folder() -> None:
                name = values["name"].get().strip()
                if not name:
                    error.set("폴더 대표 이름을 입력하세요.")
                    return
                visual_fields = ASSET_VISUAL_INPUT_FIELDS.get(
                    values["type"].get(),
                    ASSET_VISUAL_INPUT_FIELDS["general_reference"],
                )
                required = [
                    key
                    for key, label, _guidance in visual_fields
                    if "*" in label
                ]
                if any(
                    not folder_visual_values[key].get().strip()
                    for key in required
                ):
                    error.set("* 표시된 시각 정보를 입력하세요.")
                    return
                values["description"].set(
                    compose_asset_visual_description(
                        values["type"].get(),
                        {
                            key: value.get()
                            for key, value in folder_visual_values.items()
                        },
                    )
                )
                children = list(existing_children or [])
                try:
                    folder = library.create_folder(
                        display_name=name,
                        asset_type=values["type"].get(),
                        description=values["description"].get(),
                        tags=values["tags"].get().split(","),
                        child_asset_ids=[
                            child.asset_id for child in children
                        ],
                        thumbnail_asset_id=(
                            children[0].asset_id if children else ""
                        ),
                    )
                except ReferenceAssetError as exc:
                    error.set(str(exc))
                    return
                creator.destroy()
                reload_assets()
                self._toast(
                    f"Asset Folder 생성 완료 · {folder.display_name} · "
                    "이미지는 메타데이터 편집에서 추가할 수 있습니다."
                )

            actions = tk.Frame(creator, bg=self.BG)
            actions.pack(fill="x", padx=24, pady=(0, 20))
            HoverButton(
                actions, "취소", creator.destroy,
                background=self.SURFACE_3, hover=self.BORDER,
                font=(self.FONT, 8, "bold"), padx=14, pady=8,
            ).pack(side="right", padx=(8, 0))
            HoverButton(
                actions, "Folder 생성", save_folder,
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 8, "bold"), padx=15, pady=8,
            ).pack(side="right")
            self._fade_in(creator)

        def group_selected_assets() -> None:
            assets = state.get("assets", [])
            if not isinstance(assets, list):
                return
            selected = [
                assets[index] for index in listing.curselection()
                if not assets[index].is_folder
                and not assets[index].parent_folder_id
            ]
            if len(selected) < 2:
                self._toast(
                    "Folder로 묶을 단일 Asset을 2개 이상 선택하세요.",
                    kind="warning",
                )
                return
            create_asset_folder(selected)

        def open_folder_editor(folder: LibraryAsset) -> None:
            dialog = tk.Toplevel(window)
            dialog.title(f"Asset Folder — {folder.display_name}")
            self._fit_window(dialog, 900, 760, 720, 620)
            dialog.configure(bg=self.BG)
            dialog.transient(window)
            dialog.grab_set()
            values = {
                "name": tk.StringVar(value=folder.display_name),
                "type": tk.StringVar(value=folder.asset_type),
                "description": tk.StringVar(value=folder.description),
                "tags": tk.StringVar(value=", ".join(folder.tags)),
            }
            folder_visual_values = {
                key: tk.StringVar()
                for visual_fields in ASSET_VISUAL_INPUT_FIELDS.values()
                for key, _label, _guidance in visual_fields
            }
            for key, value in parse_asset_visual_description(
                folder.asset_type, folder.description
            ).items():
                folder_visual_values[key].set(value)
            children = list(library.folder_children(folder))
            thumbnail = {"id": folder.thumbnail_asset_id}
            self._window_header(
                dialog, "ASSET FOLDER  /  EDIT",
                "Asset Folder 편집",
                (
                    "생성할 때 입력한 Asset 정보와 이미지 AI에 전달할 "
                    "Reference를 수정합니다."
                ),
            )
            footer = tk.Frame(
                dialog, bg=self.BG,
                highlightbackground=self.BORDER,
                highlightthickness=1,
            )
            footer.pack(side="bottom", fill="x")
            content_shell = tk.Frame(dialog, bg=self.BG)
            content_shell.pack(fill="both", expand=True)
            content_canvas = tk.Canvas(
                content_shell, bg=self.BG, highlightthickness=0, bd=0,
            )
            content_scrollbar = ttk.Scrollbar(
                content_shell, orient="vertical",
                command=content_canvas.yview,
            )
            content_canvas.configure(
                yscrollcommand=content_scrollbar.set
            )
            content_scrollbar.pack(side="right", fill="y")
            content_canvas.pack(side="left", fill="both", expand=True)
            scroll_content = tk.Frame(content_canvas, bg=self.BG)
            scroll_window = content_canvas.create_window(
                (0, 0), window=scroll_content, anchor="nw"
            )
            scroll_content.bind(
                "<Configure>",
                lambda _event: content_canvas.configure(
                    scrollregion=content_canvas.bbox("all")
                ),
            )
            content_canvas.bind(
                "<Configure>",
                lambda event: content_canvas.itemconfigure(
                    scroll_window, width=event.width
                ),
            )
            self._bind_scroll_canvas(content_canvas)

            form = tk.Frame(scroll_content, bg=self.BG)
            form.pack(fill="x", padx=22, pady=(10, 4))
            type_widget: ttk.Combobox | None = None
            for index, (label, key) in enumerate((
                ("폴더 대표 이름", "name"), ("Asset 유형", "type"),
                ("검색 태그", "tags"),
            )):
                area = tk.Frame(form, bg=self.BG)
                area.grid(
                    row=index // 2, column=index % 2,
                    sticky="ew", padx=6, pady=5,
                )
                form.columnconfigure(index % 2, weight=1)
                tk.Label(
                    area, text=label, bg=self.BG, fg=self.TEXT_SOFT,
                    font=(self.FONT, 8, "bold"),
                ).pack(anchor="w")
                if key == "type":
                    type_widget = ttk.Combobox(
                        area, textvariable=values[key], state="readonly",
                        values=(
                            "character", "background", "object", "style",
                            "general_reference",
                        ),
                    )
                    widget: tk.Widget = type_widget
                else:
                    widget = tk.Entry(
                        area, textvariable=values[key], bg=self.SURFACE_3,
                        fg=self.TEXT, insertbackground=self.GOLD,
                        relief="flat", font=(self.FONT, 9),
                    )
                widget.pack(fill="x", ipady=5)
            visual_editor = tk.Frame(
                scroll_content, bg=self.SURFACE_2,
                highlightbackground=self.BORDER, highlightthickness=1,
            )
            visual_editor.pack(fill="x", padx=28, pady=(4, 6))
            selected_folder_type = {"value": folder.asset_type}

            def render_visual_editor(_event: object = None) -> None:
                for child in visual_editor.winfo_children():
                    child.destroy()
                asset_type = values["type"].get()
                heading = {
                    "character": "캐릭터 시각 정보",
                    "background": "배경·분위기 정보",
                    "object": "소품 시각 정보",
                    "style": "스타일 시각 정보",
                    "general_reference": "일반 Reference 정보",
                }.get(asset_type, "Asset 시각 정보")
                tk.Label(
                    visual_editor,
                    text=f"{heading}  ·  생성할 때 입력한 정보",
                    bg=self.SURFACE_2, fg=self.GOLD,
                    font=(self.FONT, 9, "bold"),
                ).grid(
                    row=0, column=0, columnspan=2,
                    sticky="w", padx=14, pady=(11, 5),
                )
                fields = ASSET_VISUAL_INPUT_FIELDS.get(
                    asset_type,
                    ASSET_VISUAL_INPUT_FIELDS["general_reference"],
                )
                for index, (key, label, guidance) in enumerate(fields):
                    area = tk.Frame(visual_editor, bg=self.SURFACE_2)
                    area.grid(
                        row=1 + index // 2, column=index % 2,
                        sticky="nsew", padx=14, pady=(3, 9),
                    )
                    visual_editor.columnconfigure(index % 2, weight=1)
                    tk.Label(
                        area, text=label, bg=self.SURFACE_2,
                        fg=self.TEXT_SOFT, font=(self.FONT, 8, "bold"),
                    ).pack(anchor="w")
                    tk.Entry(
                        area, textvariable=folder_visual_values[key],
                        bg=self.SURFACE_3, fg=self.TEXT,
                        insertbackground=self.GOLD, relief="flat",
                        font=(self.FONT, 8),
                    ).pack(fill="x", pady=(3, 1), ipady=4)
                    tk.Label(
                        area, text=guidance, bg=self.SURFACE_2,
                        fg=self.MUTED, font=(self.FONT, 7),
                        wraplength=380, justify="left",
                    ).pack(anchor="w")

            def change_folder_type(_event: object = None) -> None:
                previous_type = selected_folder_type["value"]
                next_type = values["type"].get()
                if previous_type == next_type:
                    render_visual_editor()
                    return
                confirmed = messagebox.askyesno(
                    "Asset 유형 변경",
                    (
                        f"Asset 유형을 {previous_type}에서 {next_type}(으)로 "
                        "변경할까요?\n\n"
                        "• 폴더 대표 이름, 검색 태그, Reference 이미지는 유지됩니다.\n"
                        "• 두 유형에서 의미가 같은 시각 정보만 유지됩니다.\n"
                        "• 이전 유형 전용 세부 정보는 삭제됩니다."
                    ),
                    parent=dialog,
                )
                if not confirmed:
                    values["type"].set(previous_type)
                    return
                migrated = migrate_asset_visual_values(
                    previous_type,
                    next_type,
                    {
                        key: variable.get()
                        for key, variable in folder_visual_values.items()
                    },
                )
                for key, variable in folder_visual_values.items():
                    variable.set(migrated.get(key, ""))
                selected_folder_type["value"] = next_type
                render_visual_editor()

            if type_widget is not None:
                type_widget.bind(
                    "<<ComboboxSelected>>", change_folder_type
                )
            render_visual_editor()

            def open_folder_info_editor() -> None:
                """Edit the same metadata collected when the Folder was made."""
                info = tk.Toplevel(dialog)
                info.title("PRISM FORGE — Asset Folder 생성 정보 수정")
                self._fit_window(info, 780, 700, 680, 580)
                info.configure(bg=self.BG)
                info.transient(dialog)
                info.grab_set()
                self._window_header(
                    info,
                    "ASSET FOLDER  /  CREATION INFO",
                    "Asset Folder 생성 정보 수정",
                    (
                        "Folder 생성 시 입력했던 정보를 수정합니다. "
                        "저장된 내용은 Story·Image Prompt에 반영됩니다."
                    ),
                )
                local = {
                    "name": tk.StringVar(value=values["name"].get()),
                    "type": tk.StringVar(value=values["type"].get()),
                    "tags": tk.StringVar(value=values["tags"].get()),
                }
                local_visual = {
                    key: tk.StringVar(value=variable.get())
                    for key, variable in folder_visual_values.items()
                }
                selected_local_type = {"value": local["type"].get()}
                info_card = self._card(info, background=self.SURFACE)
                info_card.pack(
                    fill="both", expand=True, padx=24, pady=(14, 10)
                )
                for label, key, guidance in (
                    (
                        "폴더 대표 이름 *", "name",
                        "프로젝트와 대본에서 이 Asset을 식별하는 이름입니다.",
                    ),
                    (
                        "Asset 유형 *", "type",
                        "캐릭터·배경·소품·스타일·일반 참고자료를 구분합니다.",
                    ),
                    (
                        "검색 태그", "tags",
                        "Library 검색용 단어입니다. 쉼표(,)로 구분합니다.",
                    ),
                ):
                    field = tk.Frame(info_card, bg=self.SURFACE)
                    field.pack(fill="x", padx=20, pady=(11, 0))
                    tk.Label(
                        field, text=label, bg=self.SURFACE,
                        fg=self.TEXT_SOFT, font=(self.FONT, 8, "bold"),
                    ).pack(anchor="w")
                    if key == "type":
                        widget: tk.Widget = ttk.Combobox(
                            field, textvariable=local[key], state="readonly",
                            values=(
                                "character", "background", "object", "style",
                                "general_reference",
                            ),
                        )
                        local_type_widget = widget
                    else:
                        widget = tk.Entry(
                            field, textvariable=local[key],
                            bg=self.SURFACE_3, fg=self.TEXT,
                            insertbackground=self.GOLD, relief="flat",
                            font=(self.FONT, 9),
                        )
                    widget.pack(fill="x", pady=(4, 1), ipady=5)
                    tk.Label(
                        field, text=guidance, bg=self.SURFACE,
                        fg=self.MUTED, font=(self.FONT, 7),
                        wraplength=680, justify="left",
                    ).pack(anchor="w")
                local_visual_area = tk.Frame(info_card, bg=self.SURFACE)
                local_visual_area.pack(
                    fill="both", expand=True, padx=20, pady=(12, 8)
                )

                def render_local_fields(_event: object = None) -> None:
                    for child in local_visual_area.winfo_children():
                        child.destroy()
                    selected_type = local["type"].get()
                    tk.Label(
                        local_visual_area,
                        text="유형별 시각 정보",
                        bg=self.SURFACE, fg=self.GOLD,
                        font=(self.FONT, 9, "bold"),
                    ).pack(anchor="w", pady=(0, 3))
                    for key, label, guidance in (
                        ASSET_VISUAL_INPUT_FIELDS.get(
                            selected_type,
                            ASSET_VISUAL_INPUT_FIELDS[
                                "general_reference"
                            ],
                        )
                    ):
                        row = tk.Frame(local_visual_area, bg=self.SURFACE)
                        row.pack(fill="x", pady=(5, 0))
                        tk.Label(
                            row, text=label, bg=self.SURFACE,
                            fg=self.TEXT_SOFT,
                            font=(self.FONT, 8, "bold"),
                        ).pack(anchor="w")
                        tk.Entry(
                            row, textvariable=local_visual[key],
                            bg=self.SURFACE_3, fg=self.TEXT,
                            insertbackground=self.GOLD, relief="flat",
                            font=(self.FONT, 8),
                        ).pack(fill="x", pady=(2, 1), ipady=4)
                        tk.Label(
                            row, text=guidance, bg=self.SURFACE,
                            fg=self.MUTED, font=(self.FONT, 7),
                        ).pack(anchor="w")

                def change_local_type(_event: object = None) -> None:
                    previous_type = selected_local_type["value"]
                    next_type = local["type"].get()
                    if previous_type == next_type:
                        render_local_fields()
                        return
                    confirmed = messagebox.askyesno(
                        "Asset 유형 변경",
                        (
                            f"Asset 유형을 {previous_type}에서 {next_type}(으)로 "
                            "변경할까요?\n\n"
                            "• 폴더 대표 이름, 검색 태그, Reference 이미지는 유지됩니다.\n"
                            "• 두 유형에서 의미가 같은 시각 정보만 유지됩니다.\n"
                            "• 이전 유형 전용 세부 정보는 삭제됩니다."
                        ),
                        parent=info,
                    )
                    if not confirmed:
                        local["type"].set(previous_type)
                        return
                    migrated = migrate_asset_visual_values(
                        previous_type,
                        next_type,
                        {
                            key: variable.get()
                            for key, variable in local_visual.items()
                        },
                    )
                    for key, variable in local_visual.items():
                        variable.set(migrated.get(key, ""))
                    selected_local_type["value"] = next_type
                    render_local_fields()

                local_type_widget.bind(
                    "<<ComboboxSelected>>", change_local_type
                )
                render_local_fields()

                def save_creation_info() -> None:
                    name = local["name"].get().strip()
                    selected_type = local["type"].get()
                    fields = ASSET_VISUAL_INPUT_FIELDS.get(
                        selected_type,
                        ASSET_VISUAL_INPUT_FIELDS["general_reference"],
                    )
                    missing = [
                        label.replace(" *", "")
                        for key, label, _guidance in fields
                        if "*" in label
                        and not local_visual[key].get().strip()
                    ]
                    if not name or missing:
                        detail = (
                            "폴더 대표 이름을 입력하세요."
                            if not name else
                            "다음 정보를 입력하세요.\n\n"
                            + "\n".join(f"• {label}" for label in missing)
                        )
                        messagebox.showwarning(
                            "필수 정보 확인", detail, parent=info
                        )
                        return
                    description = compose_asset_visual_description(
                        selected_type,
                        {
                            key: variable.get()
                            for key, variable in local_visual.items()
                        },
                    )
                    try:
                        library.update_folder(
                            folder.asset_id,
                            display_name=name,
                            asset_type=selected_type,
                            description=description,
                            tags=local["tags"].get().split(","),
                        )
                    except ReferenceAssetError as exc:
                        messagebox.showerror(
                            "Asset 정보 저장 실패", str(exc), parent=info
                        )
                        return
                    values["name"].set(name)
                    values["type"].set(selected_type)
                    selected_folder_type["value"] = selected_type
                    values["tags"].set(local["tags"].get())
                    values["description"].set(description)
                    for key, variable in local_visual.items():
                        folder_visual_values[key].set(variable.get())
                    render_visual_editor()
                    info.destroy()
                    reload_assets()
                    self._toast(f"Asset 생성 정보 저장 완료 · {name}")

                info_actions = tk.Frame(info, bg=self.BG)
                info_actions.pack(fill="x", padx=24, pady=(0, 18))
                HoverButton(
                    info_actions, "취소", info.destroy,
                    background=self.SURFACE_3, hover=self.BORDER,
                    font=(self.FONT, 8, "bold"), padx=14, pady=8,
                ).pack(side="right", padx=(8, 0))
                HoverButton(
                    info_actions, "정보 저장", save_creation_info,
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=15, pady=8,
                ).pack(side="right")

            edit_info_bar = tk.Frame(scroll_content, bg=self.BG)
            edit_info_bar.pack(fill="x", padx=28, pady=(0, 5))
            HoverButton(
                edit_info_bar,
                "Asset Folder 생성 정보 수정",
                open_folder_info_editor,
                background=self.ORANGE, hover=self.GOLD,
                font=(self.FONT, 8, "bold"), padx=15, pady=8,
            ).pack(side="left")
            tk.Label(
                edit_info_bar,
                text="이름·유형·검색 태그·유형별 시각 정보를 한 번에 수정",
                bg=self.BG, fg=self.MUTED, font=(self.FONT, 7),
            ).pack(side="left", padx=10)
            listing = tk.Listbox(
                scroll_content, bg=self.SURFACE, fg=self.TEXT,
                selectbackground=self.PURPLE, relief="flat",
                font=(self.FONT, 9),
                height=5,
            )
            listing.pack(fill="both", expand=True, padx=22, pady=8)

            def redraw(selected: int | None = None) -> None:
                listing.delete(0, "end")
                for child in children:
                    marker = "★" if child.asset_id == thumbnail["id"] else " "
                    listing.insert(
                        "end",
                        f"{marker} {child.role or 'other'} · "
                        f"{child.display_name} · {child.original_filename}",
                    )
                if selected is not None and children:
                    listing.selection_set(max(0, min(selected, len(children) - 1)))

            def selected_index() -> int | None:
                selected = listing.curselection()
                return selected[0] if selected else None

            def add_reference() -> None:
                """Add one image using only reference-specific metadata."""
                selected = filedialog.askopenfilename(
                    parent=dialog,
                    title="추가할 Reference 이미지 선택",
                    filetypes=[("이미지", "*.png *.jpg *.jpeg *.webp")],
                )
                if not selected:
                    return
                selected_path = Path(selected)
                reference_dialog = tk.Toplevel(dialog)
                reference_dialog.title("PRISM FORGE — Reference 추가")
                self._fit_window(reference_dialog, 580, 470, 520, 440)
                reference_dialog.configure(bg=self.BG)
                reference_dialog.transient(dialog)
                reference_dialog.grab_set()
                self._window_header(
                    reference_dialog,
                    "ASSET FOLDER  /  REFERENCE",
                    "새 Reference 추가",
                    (
                        "Folder의 이름·유형·설명은 그대로 사용합니다. "
                        "이 이미지 자체를 구분할 정보만 입력하세요."
                    ),
                )
                reference_name = tk.StringVar(value=selected_path.stem)
                current_asset_type = values["type"].get()
                default_role = (
                    "front"
                    if current_asset_type == "character" and not children
                    else "other"
                    if current_asset_type == "character"
                    else "미지정"
                )
                reference_role = tk.StringVar(value=default_role)
                body = tk.Frame(reference_dialog, bg=self.SURFACE_2)
                body.pack(fill="both", expand=True, padx=22, pady=14)
                tk.Label(
                    body, text=f"선택한 이미지  ·  {selected_path.name}",
                    bg=self.SURFACE_2, fg=self.GOLD,
                    font=(self.FONT, 8, "bold"),
                    wraplength=470, justify="left",
                ).pack(anchor="w", padx=18, pady=(18, 14))

                role_help = tk.StringVar()
                def update_role_help(*_args: object) -> None:
                    raw_role = reference_role.get().strip()
                    role = (
                        raw_role.lower()
                        if current_asset_type == "character" else raw_role
                    )
                    role_help.set(
                        REFERENCE_ROLE_DESCRIPTIONS.get(
                            role,
                            "직접 입력한 역할 이름으로 이미지 AI에 전달됩니다.",
                        )
                    )

                for label, variable, guidance in (
                    (
                        "Reference 이름 *",
                        reference_name,
                        (
                            "직접 입력하는 표시 이름입니다. 예: Folder 이름이 "
                            "'악어'라면 악어.1, 악어.2처럼 순서대로 작성할 수 "
                            "있습니다."
                        ),
                    ),
                    (
                        "Reference 역할 *",
                        reference_role,
                        (
                            "이미지가 보여주는 방향이나 용도입니다. "
                            "예: front, side, back, expression, detail"
                        ),
                    ),
                ):
                    field = tk.Frame(body, bg=self.SURFACE_2)
                    field.pack(fill="x", padx=18, pady=(0, 12))
                    tk.Label(
                        field, text=label, bg=self.SURFACE_2,
                        fg=self.TEXT_SOFT, font=(self.FONT, 8, "bold"),
                    ).pack(anchor="w")
                    if variable is reference_role:
                        widget: tk.Widget = ttk.Combobox(
                            field, textvariable=variable, state="normal",
                            values=reference_role_options(
                                current_asset_type
                            ),
                        )
                    else:
                        widget = tk.Entry(
                            field, textvariable=variable,
                            bg=self.SURFACE_3, fg=self.TEXT,
                            insertbackground=self.GOLD, relief="flat",
                            font=(self.FONT, 9),
                        )
                    widget.pack(fill="x", ipady=5)
                    if variable is reference_role:
                        widget.bind(
                            "<<ComboboxSelected>>", update_role_help
                        )
                        widget.bind("<KeyRelease>", update_role_help)
                    tk.Label(
                        field, text=guidance, bg=self.SURFACE_2,
                        fg=self.MUTED, font=(self.FONT, 7),
                        wraplength=470, justify="left",
                    ).pack(anchor="w", pady=(4, 0))
                    if variable is reference_role:
                        tk.Label(
                            field, textvariable=role_help,
                            bg=self.SURFACE_2, fg=self.GOLD,
                            font=(self.FONT, 7), wraplength=470,
                            justify="left",
                        ).pack(anchor="w", pady=(3, 0))
                update_role_help()

                def confirm_reference() -> None:
                    name = reference_name.get().strip()
                    role = reference_role.get().strip()
                    if not name or not role:
                        messagebox.showwarning(
                            "입력 확인",
                            "Reference 이름과 역할을 모두 입력하세요.",
                            parent=reference_dialog,
                        )
                        return
                    try:
                        matched = library.find_matching_file(selected_path)
                        if matched is not None and matched.asset_id in {
                            item.asset_id for item in children
                        }:
                            messagebox.showinfo(
                                "이미 추가된 Reference",
                                "선택한 이미지는 현재 Folder에 이미 있습니다.",
                                parent=reference_dialog,
                            )
                            return
                        if matched is None:
                            child = library.import_file(
                                selected_path,
                                asset_type=values["type"].get(),
                                display_name=name,
                            )
                            child = library.update_metadata(
                                child.asset_id,
                                display_name=name,
                                role=role,
                            )
                        elif matched.parent_folder_id:
                            child = library.create_reference_link(
                                matched.asset_id,
                                display_name=name,
                                role=role,
                            )
                        else:
                            child = library.update_metadata(
                                matched.asset_id,
                                display_name=name,
                                role=role,
                            )
                    except (OSError, ReferenceAssetError) as exc:
                        messagebox.showwarning(
                            "Reference 추가 실패", str(exc),
                            parent=reference_dialog,
                        )
                        return
                    children.append(child)
                    reference_dialog.destroy()
                    redraw(len(children) - 1)
                    self._toast(f"Reference 추가됨 · {name}")

                buttons = tk.Frame(reference_dialog, bg=self.BG)
                buttons.pack(fill="x", padx=22, pady=(0, 14))
                HoverButton(
                    buttons, "취소", reference_dialog.destroy,
                    background=self.SURFACE_3, hover=self.BORDER,
                    font=(self.FONT, 8, "bold"), padx=14, pady=7,
                ).pack(side="right", padx=(6, 0))
                HoverButton(
                    buttons, "Reference 추가", confirm_reference,
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=14, pady=7,
                ).pack(side="right")

            def add_existing() -> None:
                current_ids = {item.asset_id for item in children}
                child = self._choose_library_asset(
                    dialog,
                    title="기존 Reference 선택",
                    asset_filter=lambda item: (
                        not item.is_folder
                        and item.asset_id not in current_ids
                    ),
                )
                if child is not None:
                    try:
                        if child.parent_folder_id:
                            child = library.create_reference_link(
                                child.asset_id
                            )
                    except ReferenceAssetError as exc:
                        messagebox.showwarning(
                            "Reference 연결 실패", str(exc), parent=dialog
                        )
                        return
                    children.append(child)
                    redraw(len(children) - 1)
                    self._toast(
                        f"기존 Reference 연결됨 · {child.display_name}"
                    )

            def remove_child() -> None:
                index = selected_index()
                if index is None:
                    return
                removed = children.pop(index)
                if thumbnail["id"] == removed.asset_id:
                    thumbnail["id"] = children[0].asset_id if children else ""
                redraw(index)

            def set_role() -> None:
                index = selected_index()
                if index is None:
                    self._toast(
                        "역할을 바꿀 Reference를 먼저 선택하세요.",
                        kind="warning",
                    )
                    return
                child = children[index]
                role_dialog = tk.Toplevel(dialog)
                role_dialog.title("PRISM FORGE — Reference 역할 변경")
                self._fit_window(role_dialog, 540, 390, 500, 360)
                role_dialog.configure(bg=self.BG)
                role_dialog.transient(dialog)
                role_dialog.grab_set()
                self._window_header(
                    role_dialog,
                    "REFERENCE  /  ROLE",
                    "Reference 역할 변경",
                    f"{child.display_name} 이미지의 용도를 지정합니다.",
                )
                selected_role = tk.StringVar(value=child.role or "other")
                current_asset_type = values["type"].get()
                role_body = tk.Frame(role_dialog, bg=self.SURFACE_2)
                role_body.pack(fill="both", expand=True, padx=22, pady=16)
                tk.Label(
                    role_body, text="역할 선택 또는 직접 입력",
                    bg=self.SURFACE_2, fg=self.TEXT_SOFT,
                    font=(self.FONT, 9, "bold"),
                ).pack(anchor="w", padx=18, pady=(18, 6))
                role_box = ttk.Combobox(
                    role_body, textvariable=selected_role, state="normal",
                    values=reference_role_options(current_asset_type),
                )
                role_box.pack(fill="x", padx=18, ipady=5)
                role_summary = tk.StringVar()

                def refresh_role_summary(*_args: object) -> None:
                    raw_role = selected_role.get().strip()
                    role = (
                        raw_role.lower()
                        if current_asset_type == "character" else raw_role
                    )
                    description = REFERENCE_ROLE_DESCRIPTIONS.get(
                        role, "사용자 정의 역할로"
                    )
                    role_summary.set(
                        f"{description} 참고하도록 이미지 AI에 전달됩니다."
                    )

                role_box.bind("<<ComboboxSelected>>", refresh_role_summary)
                role_box.bind("<KeyRelease>", refresh_role_summary)
                tk.Label(
                    role_body, textvariable=role_summary,
                    bg=self.SURFACE_2, fg=self.GOLD,
                    font=(self.FONT, 8), wraplength=450, justify="left",
                ).pack(anchor="w", padx=18, pady=(8, 0))
                tk.Label(
                    role_body,
                    text=(
                        "역할은 이미지 AI가 여러 Reference의 방향과 용도를 "
                        "구분할 때 사용합니다."
                    ),
                    bg=self.SURFACE_2, fg=self.MUTED,
                    font=(self.FONT, 8), wraplength=450, justify="left",
                ).pack(anchor="w", padx=18, pady=(12, 0))
                refresh_role_summary()

                def save_role() -> None:
                    role = selected_role.get().strip()
                    if not role:
                        messagebox.showwarning(
                            "역할 확인", "역할을 입력하세요.",
                            parent=role_dialog,
                        )
                        return
                    child.role = role
                    role_dialog.destroy()
                    redraw(index)

                role_buttons = tk.Frame(role_dialog, bg=self.BG)
                role_buttons.pack(fill="x", padx=22, pady=(0, 16))
                HoverButton(
                    role_buttons, "취소", role_dialog.destroy,
                    background=self.SURFACE_3, hover=self.BORDER,
                    font=(self.FONT, 8, "bold"), padx=14, pady=7,
                ).pack(side="right", padx=(6, 0))
                HoverButton(
                    role_buttons, "역할 저장", save_role,
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=14, pady=7,
                ).pack(side="right")

            def rename_child() -> None:
                index = selected_index()
                if index is None:
                    return
                name = simpledialog.askstring(
                    "Reference 이름 변경",
                    "선택한 Reference의 표시 이름",
                    initialvalue=children[index].display_name,
                    parent=dialog,
                )
                if name is None:
                    return
                normalized = name.strip()
                if not normalized:
                    messagebox.showwarning(
                        "이름 확인",
                        "Reference 이름은 비워둘 수 없습니다.",
                        parent=dialog,
                    )
                    return
                children[index].display_name = normalized
                redraw(index)

            def move(offset: int) -> None:
                index = selected_index()
                if index is None or index + offset not in range(len(children)):
                    return
                child = children.pop(index)
                children.insert(index + offset, child)
                redraw(index + offset)

            def set_thumbnail() -> None:
                index = selected_index()
                if index is not None:
                    thumbnail["id"] = children[index].asset_id
                    redraw(index)

            def relink_child() -> None:
                index = selected_index()
                if index is None:
                    return
                path = filedialog.askopenfilename(
                    parent=dialog, title="누락 경로 복구",
                    filetypes=[("이미지", "*.png *.jpg *.jpeg *.webp")],
                )
                if path:
                    try:
                        children[index] = library.relink_file(
                            children[index].asset_id, Path(path)
                        )
                        redraw(index)
                    except ReferenceAssetError as exc:
                        messagebox.showerror(
                            "경로 복구 실패", str(exc), parent=dialog
                        )

            controls = tk.Frame(footer, bg=self.BG)
            controls.pack(
                side="left", fill="x", expand=True, padx=16, pady=7
            )
            control_actions = (
                ("+ Reference", add_reference, self.PURPLE),
                ("+ 기존 Reference", add_existing, self.SURFACE_3),
                ("제거", remove_child, self.RED),
                ("이름 변경", rename_child, self.SURFACE_3),
                ("역할 변경", set_role, self.SURFACE_3),
                ("위", lambda: move(-1), self.SURFACE_3),
                ("아래", lambda: move(1), self.SURFACE_3),
                ("대표 썸네일", set_thumbnail, self.GREEN),
                ("경로 복구", relink_child, self.ORANGE),
            )
            for index, (text, command, color) in enumerate(control_actions):
                HoverButton(
                    controls, text, command, background=color,
                    hover=self.BORDER, font=(self.FONT, 8, "bold"),
                    padx=9, pady=6,
                ).grid(
                    row=index // 5,
                    column=index % 5,
                    sticky="w", padx=(0, 5), pady=3,
                )

            def save_folder() -> None:
                name = values["name"].get().strip()
                if not name:
                    messagebox.showwarning(
                        "입력 확인", "폴더 대표 이름을 입력하세요.",
                        parent=dialog,
                    )
                    return
                visual_fields = ASSET_VISUAL_INPUT_FIELDS.get(
                    values["type"].get(),
                    ASSET_VISUAL_INPUT_FIELDS["general_reference"],
                )
                missing = [
                    label.replace(" *", "")
                    for key, label, _guidance in visual_fields
                    if "*" in label
                    and not folder_visual_values[key].get().strip()
                ]
                if missing:
                    messagebox.showwarning(
                        "필수 정보 확인",
                        "다음 정보를 입력하세요.\n\n"
                        + "\n".join(f"• {label}" for label in missing),
                        parent=dialog,
                    )
                    return
                description = compose_asset_visual_description(
                    values["type"].get(),
                    {
                        key: variable.get()
                        for key, variable in folder_visual_values.items()
                    },
                )
                try:
                    for child in children:
                        library.update_metadata(
                            child.asset_id,
                            display_name=child.display_name,
                            role=child.role or "other",
                        )
                    library.update_folder(
                        folder.asset_id,
                        display_name=name,
                        asset_type=values["type"].get(),
                        description=description,
                        tags=values["tags"].get().split(","),
                        child_asset_ids=[
                            child.asset_id for child in children
                        ],
                        thumbnail_asset_id=thumbnail["id"],
                    )
                except ReferenceAssetError as exc:
                    messagebox.showerror(
                        "Folder 저장 실패", str(exc), parent=dialog
                    )
                    return
                dialog.destroy()
                reload_assets()
                self._toast(f"Asset 정보 저장 완료 · {name}")

            HoverButton(
                footer, "저장", save_folder, background=self.PURPLE,
                hover="#7048D9", font=(self.FONT, 8, "bold"),
                padx=15, pady=8,
            ).pack(side="right", padx=16, pady=10)
            redraw()

        def edit_asset() -> None:
            asset = selected_asset()
            if asset is None:
                return
            if asset.is_folder:
                open_folder_editor(asset)
            else:
                open_editor(asset)

        def add_version() -> None:
            asset = selected_asset()
            if asset is None:
                return
            if asset.is_folder:
                self._toast(
                    "Asset Folder는 하위 이미지별 Version을 관리합니다.",
                    kind="warning",
                )
                return
            usage = library.usage_details(projects_root, asset.asset_id)
            impact = "\n".join(
                f"- {item['project_id']} · {item['version_policy']}"
                for item in usage
            ) or "사용 프로젝트 없음"
            if not messagebox.askyesno(
                "새 Asset Version",
                "기존 Version 파일은 유지됩니다.\n\n영향 프로젝트\n"
                + impact + "\n\n새 Version을 등록할까요?",
                parent=window,
            ):
                return
            path = filedialog.askopenfilename(
                parent=window, title="새 Version 이미지",
                filetypes=[("이미지", "*.png *.jpg *.jpeg *.webp")],
            )
            if not path:
                return
            note = simpledialog.askstring(
                "변경 메모", "새 Version 변경 내용", parent=window
            ) or ""
            try:
                library.add_version(
                    asset.asset_id, Path(path), notes=note
                )
                reload_assets()
            except (OSError, ReferenceAssetError) as exc:
                messagebox.showerror("Version 등록 실패", str(exc), parent=window)

        def add_candidate_to_project() -> None:
            asset = selected_asset()
            if asset is None:
                return
            option = self._pick_reference_project(window)
            if option is None:
                return
            try:
                ProjectAssetMappingStore(
                    projects_root, option.project_id
                ).add_candidate(asset, usage_role="candidate")
                self._toast(
                    f"{asset.display_name}을 {option.title} 후보 Asset으로 추가했습니다."
                )
            except (OSError, ReferenceAssetError, ValueError) as exc:
                messagebox.showerror("후보 Asset 추가 실패", str(exc), parent=window)

        def clean_missing_files() -> None:
            audit = library.audit_files()
            problems = [
                item for item in audit
                if item.classification in {"missing", "damaged"}
            ]
            healthy = sum(item.classification == "healthy" for item in audit)
            if not problems:
                messagebox.showinfo(
                    "누락 파일 검사",
                    f"전체 {len(audit)}개 · 정상 {healthy}개\n"
                    "누락되거나 손상된 파일이 없습니다.",
                    parent=window,
                )
                return
            dialog = tk.Toplevel(window)
            dialog.title("Asset 누락 파일 검사 결과")
            self._fit_window(dialog, 820, 560, 720, 480)
            dialog.configure(bg=self.BG)
            dialog.transient(window)
            dialog.grab_set()
            tk.Label(
                dialog,
                text=(
                    f"전체 {len(audit)} · 정상 {healthy} · "
                    f"누락 {sum(item.classification == 'missing' for item in audit)} · "
                    f"손상 {sum(item.classification == 'damaged' for item in audit)}"
                ),
                bg=self.BG, fg=self.TEXT, font=(self.FONT, 11, "bold"),
            ).pack(anchor="w", padx=20, pady=(18, 8))
            tk.Label(
                dialog,
                text="검사만 완료된 상태이며 아직 인덱스는 변경되지 않았습니다.",
                bg=self.BG, fg=self.MUTED, font=(self.FONT, 8),
            ).pack(anchor="w", padx=20, pady=(0, 10))
            problem_list = tk.Listbox(
                dialog, selectmode="extended", bg=self.SURFACE,
                fg=self.TEXT, selectbackground=self.PURPLE,
                relief="flat", font=(self.FONT, 8),
            )
            problem_list.pack(fill="both", expand=True, padx=20, pady=8)
            for item in problems:
                problem_list.insert(
                    "end",
                    f"{item.classification.upper()} · {item.display_name} · "
                    f"{item.source_kind}\n{item.path}",
                )

            def chosen() -> list:
                return [problems[index] for index in problem_list.curselection()]

            def disable_selected() -> None:
                targets = chosen()
                if not targets:
                    return
                if not messagebox.askyesno(
                    "Asset 비활성화",
                    f"선택한 {len(targets)}개를 자동 Reference에서 제외할까요?",
                    parent=dialog,
                ):
                    return
                for item in targets:
                    library.update_metadata(item.asset_id, enabled=False)
                dialog.destroy()
                reload_assets()

            def remove_selected() -> None:
                targets = chosen()
                if not targets:
                    return
                blocked = [
                    (item, library.usage_projects(projects_root, item.asset_id))
                    for item in targets
                ]
                used = [(item, projects) for item, projects in blocked if projects]
                if used:
                    messagebox.showwarning(
                        "사용 중 Asset",
                        "\n".join(
                            f"{item.display_name}: {', '.join(projects)}"
                            for item, projects in used
                        ),
                        parent=dialog,
                    )
                    return
                if not messagebox.askyesno(
                    "인덱스에서 제거",
                    f"선택한 {len(targets)}개를 인덱스에서 제거할까요?\n"
                    "실제 파일은 삭제하지 않습니다.",
                    parent=dialog,
                ):
                    return
                for item in targets:
                    library.delete(item.asset_id, projects_root)
                dialog.destroy()
                reload_assets()

            def relink_selected() -> None:
                targets = chosen()
                if len(targets) != 1:
                    self._toast("경로 재지정은 Asset 하나만 선택하세요.", kind="warning")
                    return
                path = filedialog.askopenfilename(
                    parent=dialog, title="대체 이미지 선택",
                    filetypes=[("이미지", "*.png *.jpg *.jpeg *.webp")],
                )
                if not path:
                    return
                try:
                    library.relink_file(targets[0].asset_id, Path(path))
                except (OSError, ReferenceAssetError) as exc:
                    messagebox.showerror("경로 재지정 실패", str(exc), parent=dialog)
                    return
                dialog.destroy()
                reload_assets()

            buttons = tk.Frame(dialog, bg=self.BG)
            buttons.pack(fill="x", padx=18, pady=16)
            for text, command, color in (
                ("비활성화", disable_selected, self.PURPLE),
                ("인덱스에서 제거", remove_selected, self.RED),
                ("경로 다시 지정", relink_selected, self.GREEN),
                ("건너뛰기", dialog.destroy, self.SURFACE_3),
            ):
                HoverButton(
                    buttons, text, command, background=color, hover=self.GOLD,
                    font=(self.FONT, 8, "bold"), padx=12, pady=7,
                ).pack(side="left", padx=4)

        def delete() -> None:
            asset = selected_asset()
            if asset is None:
                self._toast("삭제할 Asset을 먼저 선택하세요.", kind="warning")
                return
            used = library.usage_projects(projects_root, asset.asset_id)
            if used:
                messagebox.showwarning(
                    "사용 중인 Asset",
                    "다음 프로젝트에서 사용 중이므로 삭제할 수 없습니다.\n"
                    + "\n".join(used)
                    + "\n\n먼저 비활성화하는 것을 권장합니다.",
                    parent=window,
                )
                return
            manual = asset.source_project_id == "_asset_library_manual"
            folder_children = (
                library.folder_children(asset) if asset.is_folder else []
            )
            child_count = len(folder_children)
            choice = {"value": "cancel"}
            confirm = tk.Toplevel(window)
            confirm.title("PRISM FORGE — Asset 삭제")
            self._fit_window(confirm, 650, 500, 570, 450)
            confirm.configure(bg=self.BG)
            confirm.transient(window)
            confirm.grab_set()
            confirm.protocol("WM_DELETE_WINDOW", confirm.destroy)
            self._window_header(
                confirm,
                "ASSET LIBRARY  /  DELETE",
                "선택한 Asset을 삭제할까요?",
                "삭제 범위와 원본 이미지에 미치는 영향을 확인하세요.",
            )
            card = tk.Frame(
                confirm, bg=self.SURFACE_2,
                highlightbackground=self.BORDER, highlightthickness=1,
            )
            card.pack(fill="x", padx=24, pady=(16, 10))
            tk.Label(
                card, text=asset.display_name, bg=self.SURFACE_2,
                fg=self.TEXT, font=(self.FONT, 13, "bold"),
                wraplength=560, justify="left",
            ).pack(anchor="w", padx=18, pady=(16, 6))
            kind_text = (
                f"Asset Folder · {child_count}개 Reference"
                if asset.is_folder else f"단일 이미지 · {asset.asset_type}"
            )
            tk.Label(
                card,
                text=(
                    f"{kind_text}\n"
                    f"출처: {asset.source_project_id or '출처 정보 없음'}\n"
                    "프로젝트 사용: 없음"
                ),
                bg=self.SURFACE_2, fg=self.MUTED,
                font=(self.FONT, 9), justify="left",
            ).pack(anchor="w", padx=18, pady=(0, 16))

            explanation = tk.Frame(confirm, bg=self.BG)
            explanation.pack(fill="x", padx=28, pady=4)
            full_delete_allowed = False
            if asset.is_folder:
                safe_title = "Library에서만 제거"
                safe_detail = (
                    "Folder와 하위 Reference를 Asset Library 목록에서 함께 "
                    "제거합니다. 원본 이미지 파일은 삭제하지 않습니다."
                )
                folder_owns_files = bool(folder_children) and all(
                    child.source_project_id == "_asset_library_manual"
                    for child in folder_children
                )
                full_delete_allowed = folder_owns_files
                destructive_title = "Library + 원본 파일 삭제"
                destructive_detail = (
                    "Folder와 하위 Reference 목록 및 수동으로 업로드한 원본 "
                    "이미지 파일을 함께 삭제합니다. 공유 파일은 보존됩니다."
                    if folder_owns_files else ""
                )
                if not folder_owns_files:
                    destructive_detail = (
                        "이 Folder는 프로젝트가 생성한 장면 이미지를 사용합니다. "
                        "프로젝트 검토·영상 작업이 깨질 수 있어 원본 삭제는 차단됩니다."
                    )
            elif manual:
                safe_title = "Library에서만 제거"
                safe_detail = (
                    "Asset Library 목록에서만 제거합니다. "
                    "업로드한 원본 이미지 파일은 유지됩니다."
                )
                full_delete_allowed = True
                destructive_title = "Library + 원본 파일 삭제"
                destructive_detail = (
                    "Asset Library 항목과 수동 업로드 원본 파일을 함께 "
                    "삭제합니다. 이 작업은 되돌릴 수 없습니다."
                )
            else:
                safe_title = "Library에서만 제거"
                safe_detail = (
                    "Asset Library 인덱스에서만 제거합니다. 프로젝트가 만든 "
                    "이미지 원본은 프로젝트 폴더에 그대로 유지됩니다."
                )
                destructive_title = "Library + 원본 파일 삭제"
                destructive_detail = (
                    "이 이미지는 프로젝트가 생성한 원본입니다. 프로젝트 검토·영상 "
                    "작업이 깨질 수 있어 Asset Library에서는 원본을 삭제할 수 없습니다."
                )

            def option_text(title: str, detail: str, color: str) -> None:
                row = tk.Frame(explanation, bg=self.BG)
                row.pack(fill="x", pady=5)
                tk.Label(
                    row, text=title, bg=self.BG, fg=color,
                    font=(self.FONT, 9, "bold"),
                ).pack(anchor="w")
                tk.Label(
                    row, text=detail, bg=self.BG, fg=self.MUTED,
                    font=(self.FONT, 8), wraplength=580, justify="left",
                ).pack(anchor="w", pady=(2, 0))

            option_text(safe_title, safe_detail, self.GREEN)
            if destructive_title:
                option_text(
                    destructive_title, destructive_detail, self.ORANGE
                )

            def select_delete(action: str) -> None:
                choice["value"] = action
                confirm.destroy()

            def select_full_delete() -> None:
                if not full_delete_allowed:
                    messagebox.showwarning(
                        "원본 파일 삭제 차단",
                        "이 항목의 원본은 프로젝트가 소유하고 있습니다.\n\n"
                        "Asset Library에서는 Library 연결만 제거할 수 있습니다. "
                        "프로젝트 원본 삭제는 해당 프로젝트를 삭제할 때 처리하세요.",
                        parent=confirm,
                    )
                    return
                select_delete("full")

            buttons = tk.Frame(confirm, bg=self.BG)
            buttons.pack(side="bottom", fill="x", padx=24, pady=18)
            HoverButton(
                buttons, "취소", confirm.destroy,
                background=self.SURFACE_3, hover=self.BORDER,
                font=(self.FONT, 8, "bold"), padx=14, pady=8,
            ).pack(side="right", padx=(8, 0))
            HoverButton(
                buttons, destructive_title,
                select_full_delete,
                background=self.RED if full_delete_allowed else self.SURFACE_3,
                hover=self.ORANGE if full_delete_allowed else self.BORDER,
                foreground=self.TEXT if full_delete_allowed else self.MUTED,
                font=(self.FONT, 8, "bold"), padx=14, pady=8,
            ).pack(side="right", padx=(8, 0))
            HoverButton(
                buttons, safe_title, lambda: select_delete("safe"),
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 8, "bold"), padx=14, pady=8,
            ).pack(side="right")
            window.wait_window(confirm)
            if choice["value"] == "cancel":
                return
            try:
                if asset.is_folder:
                    library.delete_folder(
                        asset.asset_id,
                        projects_root,
                        remove_child_indexes=True,
                        delete_manual_files=choice["value"] == "full",
                    )
                elif choice["value"] == "safe" or not manual:
                    library.delete(asset.asset_id, projects_root)
                else:
                    library.delete_manual_file(asset.asset_id, projects_root)
                reload_assets()
                self._toast(f"삭제 완료 · {asset.display_name}")
            except ReferenceAssetError as exc:
                messagebox.showwarning("삭제 차단", str(exc), parent=window)

        asset_actions = [
            ("+ Asset Folder", create_asset_folder, self.PURPLE),
            ("메타데이터 편집", edit_asset, self.PURPLE),
            ("삭제", delete, self.RED),
        ]
        for text, command, color in asset_actions:
            HoverButton(
                actions, text, command, background=color, hover=self.GOLD,
                font=(self.FONT, 8, "bold"), padx=12, pady=7,
            ).pack(side="left", padx=6, pady=12)
        listing.bind("<<ListboxSelect>>", show_details)
        search.bind("<KeyRelease>", reload_assets)
        tag_entry.bind("<KeyRelease>", reload_assets)
        filter_box.bind("<<ComboboxSelected>>", reload_assets)
        sort_box.bind("<<ComboboxSelected>>", reload_assets)
        source_box.bind("<<ComboboxSelected>>", reload_assets)
        reload_assets()
        if edit_asset_id:
            try:
                target = library.get(edit_asset_id)
                visible = state.get("assets", [])
                if isinstance(visible, list):
                    index = next(
                        (
                            position for position, item in enumerate(visible)
                            if item.asset_id == edit_asset_id
                        ),
                        None,
                    )
                    if index is not None:
                        listing.selection_set(index)
                        listing.see(index)
                        show_details()
                open_editor(target)
            except ReferenceAssetError:
                self._toast(
                    "등록된 Asset 상세 정보를 열 수 없습니다.", kind="warning"
                )
        self._fade_in(window)

    def _open_project_assets(self) -> None:
        window = tk.Toplevel(self)
        window.withdraw()
        option = self._pick_reference_project(self)
        if option is None:
            window.destroy()
            return
        window.deiconify()
        window.title(f"Project Assets — {option.title}")
        self._fit_window(window, 780, 560, 700, 500)
        window.configure(bg=self.BG)
        library = AssetLibrary(self.config_data.project_root / "learning_data")
        store = ProjectAssetMappingStore(
            self.config_data.project_root / "learning_data" / "projects",
            option.project_id,
        )
        listing = tk.Listbox(
            window, selectmode="multiple", bg=self.SURFACE, fg=self.TEXT,
            selectbackground=self.PURPLE, relief="flat", font=(self.FONT, 9),
        )
        listing.pack(fill="both", expand=True, padx=24, pady=20)
        assets = library.search()
        existing = {item.asset_id for item in store.load_all()}
        for asset in assets:
            marker = "✓" if asset.asset_id in existing else " "
            listing.insert(
                "end", f"[{marker}] {asset.display_name} · {asset.asset_type}"
            )

        def add_selected() -> None:
            mode = simpledialog.askstring(
                "Project Asset 사용 방식",
                "candidate = 자동 배정 후보\nalways = 전체 프로젝트 적용\n"
                "default_style = 기본 스타일 고정\nexclude = 프로젝트에서 제외",
                initialvalue="candidate", parent=window,
            )
            if not mode:
                return
            for index in listing.curselection():
                asset = assets[index]
                if mode == "exclude":
                    store.exclude_project_asset(asset)
                    continue
                if mode == "default_style" and asset.asset_type != "style":
                    messagebox.showwarning(
                        "유형 불일치",
                        "기본 스타일에는 style Asset만 사용할 수 있습니다.",
                        parent=window,
                    )
                    continue
                store.add_candidate(
                    asset,
                    usage_role=(
                        "style" if mode == "default_style" else asset.asset_type
                    ),
                    always_apply=mode in {"always", "default_style"},
                )
            self.reference_source_project_id = option.project_id
            self._toast("프로젝트 후보 Asset을 저장했습니다.")
            window.destroy()

        def snapshot_selected() -> None:
            selected = listing.curselection()
            if not selected:
                return
            asset = assets[selected[0]]
            mapping = next(
                (
                    item for item in store.load_all()
                    if item.asset_id == asset.asset_id
                    and not item.candidate_only
                ),
                None,
            )
            if mapping is None:
                self._toast(
                    "Snapshot은 장면 또는 전체 적용 Mapping에 만들 수 있습니다.",
                    kind="warning",
                )
                return
            try:
                store.create_snapshot(mapping.mapping_id, library)
                self._toast("프로젝트 내부 Snapshot을 생성했습니다.")
            except (OSError, ReferenceAssetError) as exc:
                messagebox.showerror("Snapshot 실패", str(exc), parent=window)

        def change_policy() -> None:
            selected = listing.curselection()
            if not selected:
                return
            asset = assets[selected[0]]
            mapping = next(
                (
                    item for item in store.load_all()
                    if item.asset_id == asset.asset_id
                ),
                None,
            )
            if mapping is None:
                self._toast("먼저 Project Asset으로 저장하세요.", kind="warning")
                return
            policy = simpledialog.askstring(
                "Version 정책",
                "pinned_version / follow_latest / snapshot",
                initialvalue=mapping.version_policy, parent=window,
            )
            if not policy:
                return
            try:
                store.set_version_policy(
                    mapping.mapping_id, policy.strip(), library
                )
                self._toast("Asset Version 정책을 변경했습니다.")
            except (OSError, ReferenceAssetError) as exc:
                messagebox.showerror("정책 변경 실패", str(exc), parent=window)

        project_asset_actions = tk.Frame(
            window, name="project_asset_action_bar", bg=self.BG
        )
        project_asset_actions.pack(
            side="bottom", fill="x", padx=24, pady=(0, 16), before=listing
        )
        HoverButton(
            project_asset_actions, "선택 항목을 후보 Asset으로 저장", add_selected,
            background=self.PURPLE, hover="#765DE4",
            font=(self.FONT, 9, "bold"), padx=15, pady=9,
        ).pack(side="left", padx=(0, 8))
        HoverButton(
            project_asset_actions, "선택 Mapping Snapshot 생성", snapshot_selected,
            background=self.PURPLE, hover=self.GOLD,
            font=(self.FONT, 9, "bold"), padx=15, pady=9,
        ).pack(side="left", padx=(0, 8))
        HoverButton(
            project_asset_actions, "선택 Mapping Version 정책", change_policy,
            background=self.SURFACE_3, hover=self.GOLD,
            font=(self.FONT, 9, "bold"), padx=15, pady=9,
        ).pack(side="left")
        self._fade_in(window)

    def _open_scene_mapping(
        self, project_id: str | None = None, episode_number: int | None = None
    ) -> None:
        window = tk.Toplevel(self)
        window.withdraw()
        option = (
            resolve_reference_project(
                self.config_data.project_root / "learning_data" / "projects",
                project_id,
            )
            if project_id else self._pick_reference_project(self)
        )
        if option is None:
            window.destroy()
            return
        store = ProjectAssetMappingStore(
            self.config_data.project_root / "learning_data" / "projects",
            option.project_id,
            review_scope=(
                f"episode_{episode_number}" if episode_number else "project"
            ),
        )
        mappings = [
            item for item in store.load_all()
            if not item.candidate_only
            and (
                episode_number is None
                or item.episode_scope.includes(episode_number)
            )
        ]
        window.deiconify()
        window.title(f"Scene Mapping — {option.title}")
        self._fit_window(window, 1040, 700, 900, 580)
        window.configure(bg=self.BG)
        filters = tk.Frame(window, bg="#080D1A")
        filters.pack(fill="x", padx=24, pady=(16, 0))
        status_filter = tk.StringVar(value="all")
        type_filter = tk.StringVar(value="all")
        scene_filter = tk.StringVar(value="all")
        for variable, values in (
            (status_filter, ("all", "unconfirmed", "suggested", "ambiguous",
                             "unmatched", "confirmed", "excluded", "invalid")),
            (type_filter, ("all", "character", "background", "object", "style")),
            (scene_filter, ("all", "1", "2", "3", "4", "5", "6")),
        ):
            ttk.Combobox(
                filters, textvariable=variable, state="readonly",
                values=values, width=15,
            ).pack(side="left", padx=(0, 8))
        body = tk.Frame(window, bg=self.BG)
        body.pack(fill="both", expand=True, padx=24, pady=14)
        listing = tk.Listbox(
            body, bg=self.SURFACE, fg=self.TEXT,
            selectbackground=self.PURPLE, relief="flat", font=(self.FONT, 9),
        )
        listing.pack(side="left", fill="both", expand=True)
        right_panel = tk.Frame(body, bg=self.SURFACE_2)
        right_panel.pack(
            side="left", fill="both", expand=True, padx=(12, 0)
        )
        asset_preview = tk.Canvas(
            right_panel, height=190, bg="#080D1A", highlightthickness=0
        )
        asset_preview.pack(fill="x", padx=18, pady=(18, 8))
        details = tk.StringVar(value="장면 Mapping을 선택하세요.")
        tk.Label(
            right_panel, textvariable=details, justify="left", anchor="nw",
            wraplength=410, bg=self.SURFACE_2, fg=self.TEXT_SOFT,
            font=(self.FONT, 9), padx=18, pady=18,
        ).pack(fill="both", expand=True)
        library = AssetLibrary(self.config_data.project_root / "learning_data")
        preview_state: dict[str, object] = {"photo": None}
        visible_mappings: list = []
        long_store: LongStoryStore | None = None
        short_context: ProjectContext | None = None
        scenes: list[dict] = []
        if episode_number is not None:
            try:
                long_store = LongStoryStore(
                    self.config_data.project_root / "learning_data" / "projects",
                    option.project_id,
                )
                long_episode = long_store.load_episode(episode_number)
                scenes = long_episode.script.get("scenes", [])
            except (OSError, TypeError, ValueError):
                long_store = None
        else:
            try:
                short_context = MemoryManager(
                    self.config_data.project_root / "learning_data" / "projects"
                ).load(option.project_id)
                scenes = short_context.scenes
            except (OSError, ValueError):
                short_context = None

        def reload() -> None:
            nonlocal mappings, visible_mappings
            mappings = [
                item for item in store.load_all()
                if not item.candidate_only
                and (
                    episode_number is None
                    or item.episode_scope.includes(episode_number)
                )
            ]
            visible_mappings = [
                item for item in mappings
                if (
                    status_filter.get() == "all"
                    or item.status == status_filter.get()
                    or (
                        status_filter.get() == "unconfirmed"
                        and not item.user_confirmed
                    )
                )
                and (type_filter.get() == "all"
                     or item.usage_role == type_filter.get())
                and (scene_filter.get() == "all"
                     or item.scene_scope.includes(int(scene_filter.get())))
            ]
            listing.delete(0, "end")
            for item in visible_mappings:
                try:
                    name = library.get(item.asset_id).display_name
                except ReferenceAssetError:
                    name = "미배정" if item.asset_id == "UNMATCHED" else "누락된 Asset"
                listing.insert(
                    "end",
                    f"Scene {item.scene_scope.scene or 'ALL'} · {name} · "
                    f"{item.status} · {item.match_reason or item.assignment_source}",
                )

        def selected_mapping():
            selected = listing.curselection()
            return visible_mappings[selected[0]] if selected else None

        def show_mapping(_event: tk.Event[tk.Misc] | None = None) -> None:
            item = selected_mapping()
            if item is None:
                return
            scene_number = item.scene_scope.scene
            scene = next(
                (
                    value for value in scenes
                    if int(value.get("number", 0)) == scene_number
                ),
                {},
            )
            entities = scene.get("entities", {})
            try:
                asset = library.get(item.asset_id)
                asset_text = (
                    f"{asset.display_name} · {asset.asset_type} · v{asset.version}"
                )
                path = library.resolve_path(
                    asset,
                    asset.version if item.version_policy == "follow_latest"
                    else item.pinned_version,
                )
                asset_preview.delete("all")
                try:
                    photo = tk.PhotoImage(file=str(path))
                    scale = max(
                        1, max(photo.width() // 360, photo.height() // 170)
                    )
                    photo = photo.subsample(scale, scale)
                    asset_preview.create_image(200, 95, image=photo)
                    preview_state["photo"] = photo
                except tk.TclError:
                    asset_preview.create_text(
                        200, 95, text="이 형식의 썸네일을 표시할 수 없습니다.",
                        fill=self.MUTED, font=(self.FONT, 8),
                    )
            except ReferenceAssetError:
                asset_text = "미배정 또는 누락 Asset"
                asset_preview.delete("all")
                asset_preview.create_text(
                    200, 95, text=asset_text,
                    fill=self.MUTED, font=(self.FONT, 8),
                )
            details.set(
                f"Scene {scene_number or 'ALL'}\n\n"
                f"대본/설명\n{scene.get('description', '—')}\n\n"
                f"Entities\n{json.dumps(entities, ensure_ascii=False, indent=2)}\n\n"
                f"Asset\n{asset_text}\n\n"
                f"상태  {item.status}\n확인  {item.user_confirmed}\n"
                f"근거  {item.match_reason or item.assignment_source}\n"
                f"정책  {item.version_policy}"
            )

        def set_decision(confirmed: bool) -> None:
            selected = listing.curselection()
            if selected:
                store.confirm(
                    visible_mappings[selected[0]].mapping_id, confirmed
                )
                reload()

        def approve_all_visible() -> None:
            for item in mappings:
                if item.status == "suggested":
                    store.confirm(item.mapping_id, True)
            reload()

        def choose_asset(asset_type_value: str | None = None):
            return self._choose_library_asset(
                window, asset_type=asset_type_value,
                title="Scene Mapping Asset 선택",
            )

        def add_asset() -> None:
            scene = simpledialog.askinteger(
                "장면 선택", "적용할 장면 번호", parent=window,
                minvalue=1, maxvalue=6,
            )
            asset = choose_asset()
            if scene and asset:
                store.assign_asset(
                    asset, scene_scope=SceneScope(mode="scene", scene=scene)
                )
                reload()

        def replace_asset() -> None:
            item = selected_mapping()
            if item is None:
                return
            asset = choose_asset(item.usage_role)
            if asset:
                store.replace_asset(item.mapping_id, asset)
                reload()

        def mark_unmatched() -> None:
            scene = simpledialog.askinteger(
                "미배정 확인", "Reference 없이 유지할 장면 번호",
                parent=window, minvalue=1, maxvalue=6,
            )
            if scene:
                store.mark_scene_unmatched(scene, user_confirmed=True)
                reload()

        def apply_asset_scope() -> None:
            asset = choose_asset()
            if asset is None:
                return
            scope_text = simpledialog.askstring(
                "적용 범위", "all / 2-5 / 1,3,6",
                parent=window, initialvalue="all",
            )
            if scope_text:
                scope = parse_scope(scope_text, episode=False)
                store.assign_asset(asset, scene_scope=scope)
                reload()

        def rerun_matching() -> None:
            try:
                if episode_number is not None and long_store is not None:
                    LongStoryService(
                        self.config_data
                    ).rerun_episode_asset_matching(
                        long_store, episode_number
                    )
                elif short_context is not None:
                    if self.generation_service is None:
                        self.generation_service = GenerationService(self.config_data)
                    self.generation_service.rerun_asset_matching(short_context)
                else:
                    raise ValueError("Mapping 대상 프로젝트를 불러올 수 없습니다.")
                reload()
            except (ValueError, ReferenceAssetError) as exc:
                messagebox.showerror("자동 재매칭 실패", str(exc), parent=window)

        def finalize_and_generate() -> None:
            try:
                if episode_number is not None and long_store is not None:
                    has_assignments = bool(mappings)
                    legacy_manager = ProjectReferenceManager(
                        self.config_data.project_root
                        / "learning_data" / "projects",
                        option.project_id,
                    )
                    has_legacy = bool(legacy_manager.load_all())
                    text_only = False
                    legacy = False
                    if not has_assignments and has_legacy:
                        legacy = messagebox.askyesno(
                            "Legacy Reference 확인",
                            "기존 Reference 사용을 확인했습니까?", parent=window,
                        )
                        if not legacy:
                            return
                    elif not has_assignments:
                        text_only = messagebox.askyesno(
                            "Reference 없이 생성",
                            "이 Episode를 텍스트 프롬프트만으로 생성합니까?",
                            parent=window,
                        )
                        if not text_only:
                            return
                    LongStoryService(
                        self.config_data
                    ).approve_episode_asset_mapping(
                        long_store, episode_number,
                        text_only_confirmed=text_only,
                        legacy_confirmed=legacy,
                    )
                    self._toast(
                        f"Episode {episode_number} Mapping 최종 승인 완료"
                    )
                    window.destroy()
                    return
                context = MemoryManager(
                    self.config_data.project_root / "learning_data" / "projects"
                ).load(option.project_id)
                has_assignments = bool(mappings)
                legacy_manager = ProjectReferenceManager(
                    self.config_data.project_root / "learning_data" / "projects",
                    option.project_id,
                )
                has_legacy = bool(legacy_manager.load_all())
                text_only = False
                legacy = False
                if not has_assignments and has_legacy:
                    legacy = messagebox.askyesno(
                        "Legacy Reference 확인",
                        "기존 프로젝트 Reference를 확인했으며 이미지 생성에 사용할까요?",
                        parent=window,
                    )
                    if not legacy:
                        return
                elif not has_assignments:
                    text_only = messagebox.askyesno(
                        "Reference 없이 생성",
                        "이 프로젝트는 Reference Asset 없이 텍스트 프롬프트만으로 "
                        "생성합니다. 계속할까요?",
                        parent=window,
                    )
                    if not text_only:
                        return
                if not messagebox.askyesno(
                    "이미지 API 요청 확인",
                    "Mapping 최종 승인 후 이미지 API를 최대 6회 호출합니다. 실행할까요?",
                    parent=window,
                ):
                    return
                if self.generation_service is None:
                    self.generation_service = GenerationService(self.config_data)
                self.generation_service.approve_asset_mapping(
                    context, text_only_confirmed=text_only,
                    legacy_confirmed=legacy,
                )
                window.destroy()
                self._generation_running = True

                def run_images() -> None:
                    try:
                        result = self.generation_service.generate_approved_images(
                            context,
                            progress=lambda message: self.after(
                                0, lambda: self._toast(message, kind="progress")
                            ),
                        )
                        self.after(0, lambda: self._generation_succeeded(result))
                    except Exception as exc:
                        self.after(0, lambda: self._generation_failed(exc))

                threading.Thread(target=run_images, daemon=True).start()
            except (OSError, ValueError, ReferenceAssetError) as exc:
                messagebox.showerror("Mapping 승인 실패", str(exc), parent=window)

        actions = tk.Frame(
            window, name="scene_mapping_action_bar", bg=self.BG
        )
        actions.pack(
            side="bottom", fill="x", padx=24, pady=(0, 20), before=body
        )
        HoverButton(
            actions, "선택 배정 확인", lambda: set_decision(True),
            background=self.GREEN, hover=self.GOLD,
            font=(self.FONT, 8, "bold"), padx=12, pady=7,
        ).pack(side="left", padx=5)
        HoverButton(
            actions, "Asset 추가", add_asset,
            background=self.GREEN, hover=self.GOLD,
            font=(self.FONT, 8, "bold"), padx=12, pady=7,
        ).pack(side="left", padx=5)
        HoverButton(
            actions, "Asset 교체", replace_asset,
            background=self.PURPLE, hover=self.GOLD,
            font=(self.FONT, 8, "bold"), padx=12, pady=7,
        ).pack(side="left", padx=5)
        HoverButton(
            actions, "미배정 확인", mark_unmatched,
            background=self.SURFACE_3, hover=self.GOLD,
            font=(self.FONT, 8, "bold"), padx=12, pady=7,
        ).pack(side="left", padx=5)
        HoverButton(
            actions, "전체/범위 적용", apply_asset_scope,
            background=self.SURFACE_3, hover=self.GOLD,
            font=(self.FONT, 8, "bold"), padx=12, pady=7,
        ).pack(side="left", padx=5)
        HoverButton(
            actions, "고급: 점수 기반 Mapping 다시 분석", rerun_matching,
            background=self.GOLD, hover=self.GOLD_LIGHT,
            font=(self.FONT, 8, "bold"), padx=12, pady=7,
        ).pack(side="left", padx=5)
        HoverButton(
            actions, "선택 배정 제외", lambda: set_decision(False),
            background=self.RED, hover=self.GOLD,
            font=(self.FONT, 8, "bold"), padx=12, pady=7,
        ).pack(side="left", padx=5)
        HoverButton(
            actions, "제안 전체 확인", approve_all_visible,
            background=self.PURPLE, hover=self.GOLD,
            font=(self.FONT, 8, "bold"), padx=12, pady=7,
        ).pack(side="left", padx=5)
        HoverButton(
            actions,
            (
                "Mapping 최종 승인"
                if episode_number is not None
                else "최종 승인 후 이미지 생성"
            ),
            finalize_and_generate,
            background=self.PURPLE, hover="#765DE4",
            font=(self.FONT, 8, "bold"), padx=12, pady=7,
        ).pack(side="left", padx=5)
        listing.bind("<<ListboxSelect>>", show_mapping)
        for variable in (status_filter, type_filter, scene_filter):
            variable.trace_add("write", lambda *_: reload())
        reload()
        self._fade_in(window)

    def _open_reference_assets(
        self, project_id: str | None = None, project_title: str | None = None
    ) -> None:
        """Open project-scoped Reference Asset management."""
        project = self._current_project() if project_id is None else None
        resolved_id = project_id or (project.project_id if project else None)
        projects_root = (
            self.config_data.project_root / "learning_data" / "projects"
        )
        initial_project = (
            resolve_reference_project(projects_root, resolved_id)
            if resolved_id else None
        )
        screen_state = ReferenceScreenState(initial_project)
        window = tk.Toplevel(self)
        window.title("PRISM FORGE — Reference Assets")
        self._fit_window(window, 940, 650, 780, 560)
        window.configure(bg=self.BG)
        window.transient(self)

        header = tk.Frame(window, bg="#080D1A", height=82)
        header.pack(fill="x")
        header.pack_propagate(False)
        tk.Label(
            header, text="REFERENCE ASSETS", bg="#080D1A", fg=self.GOLD,
            font=("Segoe UI", 8, "bold"),
        ).pack(anchor="w", padx=28, pady=(17, 2))
        project_heading = tk.StringVar(
            value=(
                f"{initial_project.title} · 생성 입력 자료 관리"
                if initial_project else "프로젝트를 선택하지 않음"
            )
        )
        tk.Label(
            header, textvariable=project_heading,
            bg="#080D1A", fg=self.TEXT, font=(self.FONT, 14, "bold"),
        ).pack(anchor="w", padx=28)

        body = tk.Frame(window, bg=self.BG)
        body.pack(fill="both", expand=True, padx=24, pady=20)
        body.columnconfigure(0, weight=2)
        body.columnconfigure(1, weight=3)
        body.rowconfigure(0, weight=1)
        left = tk.Frame(body, bg=self.SURFACE, highlightbackground=self.BORDER, highlightthickness=1)
        left.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
        right = tk.Frame(body, bg=self.SURFACE_2, highlightbackground=self.BORDER, highlightthickness=1)
        right.grid(row=0, column=1, sticky="nsew")

        filters = tk.Frame(left, bg=self.SURFACE)
        filters.pack(fill="x", padx=12, pady=(12, 0))
        type_filter = tk.StringVar(value="all")
        type_filter_combo = ttk.Combobox(
            filters, textvariable=type_filter, state="readonly", width=15,
            values=("all", "character", "background", "style", "object"),
        )
        type_filter_combo.pack(side="left")
        asset_list = tk.Listbox(
            left, bg=self.SURFACE, fg=self.TEXT, selectbackground=self.PURPLE,
            relief="flat", font=(self.FONT, 9), highlightthickness=0,
        )
        asset_list.pack(fill="both", expand=True, padx=12, pady=(8, 12))
        preview = tk.Canvas(right, height=300, bg="#080D1A", highlightthickness=0)
        preview.pack(fill="x", padx=18, pady=18)
        details = tk.StringVar(value="Reference Asset을 선택하세요.")
        tk.Label(
            right, textvariable=details, justify="left", anchor="nw",
            bg=self.SURFACE_2, fg=self.TEXT_SOFT, font=(self.FONT, 9),
        ).pack(fill="x", padx=18)
        state: dict[str, object] = {
            "assets": [], "photo": None,
            "manager": (
                ProjectReferenceManager(projects_root, initial_project.project_id)
                if initial_project else None
            ),
        }

        def active_manager() -> ProjectReferenceManager | None:
            value = state.get("manager")
            return value if isinstance(value, ProjectReferenceManager) else None

        def reload_assets() -> None:
            manager = active_manager()
            if manager is None:
                state["assets"] = []
                asset_list.delete(0, "end")
                return
            if not manager.project_root.is_dir():
                messagebox.showwarning(
                    "프로젝트를 찾을 수 없음",
                    "활성 프로젝트 폴더가 삭제되었습니다. 다른 프로젝트를 선택하십시오.",
                    parent=window,
                )
                activate_project(None)
                return
            try:
                assets = filter_references(manager.load_all(), type_filter.get())
            except (OSError, ReferenceAssetError) as exc:
                messagebox.showerror("Reference Assets", str(exc), parent=window)
                assets = []
                activate_project(None)
                return
            state["assets"] = assets
            asset_list.delete(0, "end")
            for asset in assets:
                marker = "●" if asset.enabled else "○"
                source = "직접 업로드" if asset.source == "manual_upload" else "AI 승인 이미지"
                asset_list.insert(
                    "end",
                    f"{marker} {asset.display_name} · {asset.reference_type}\n"
                    f"    {reference_scope_label(asset)} · {source}",
                )
        type_filter.trace_add("write", lambda *_: reload_assets())

        def selected_asset():
            indices = asset_list.curselection()
            assets = state["assets"]
            return assets[indices[0]] if indices and isinstance(assets, list) else None

        def show_selected(event: tk.Event[tk.Misc] | None = None) -> None:
            manager = active_manager()
            if manager is None:
                return
            asset = selected_asset()
            if asset is None:
                return
            path = manager.resolve_path(asset)
            preview.delete("all")
            try:
                photo = tk.PhotoImage(file=str(path))
                scale = max(1, max(photo.width() // 430, photo.height() // 270))
                photo = photo.subsample(scale, scale)
                preview.create_image(230, 150, image=photo)
                state["photo"] = photo
            except tk.TclError:
                preview.create_text(
                    230, 150, text="미리보기를 표시할 수 없습니다.",
                    fill=self.MUTED, font=(self.FONT, 9),
                )
            details.set(
                f"표시 이름  {asset.display_name}\n유형  {asset.reference_type}\n"
                f"출처  {'직접 업로드' if asset.source == 'manual_upload' else 'AI 생성 후 등록'}\n"
                f"적용 범위  {reference_scope_label(asset)}\n활성화  {asset.enabled}\n"
                f"얼굴 기준 이미지  {asset.face_baseline}\n메모  {asset.notes or '없음'}"
            )

        asset_list.bind("<<ListboxSelect>>", show_selected)

        def add_manual() -> None:
            manager = active_manager()
            if manager is None:
                return
            path_value = filedialog.askopenfilename(
                parent=window, title="Reference 이미지 선택",
                filetypes=[("Images", "*.png *.jpg *.jpeg *.webp")],
            )
            if not path_value:
                return
            ref_type = simpledialog.askstring(
                "Reference 유형",
                "character / style / background / object / general_reference",
                parent=window, initialvalue="general_reference",
            )
            if not ref_type:
                return
            name = simpledialog.askstring(
                "표시 이름", "Reference 표시 이름", parent=window,
                initialvalue=Path(path_value).stem,
            )
            scope_value = simpledialog.askstring(
                "적용 장면", "all, 단일 번호, 범위(2-5), 목록(1,3,6)", parent=window,
                initialvalue="all",
            )
            episode_value = simpledialog.askstring(
                "적용 에피소드",
                "all, 단일 번호, 범위(1-10), 목록(1,3,8)",
                parent=window, initialvalue="all",
            )
            notes = simpledialog.askstring(
                "메모", "Reference 메모", parent=window, initialvalue=""
            ) or ""
            face = ref_type == "character" and messagebox.askyesno(
                "얼굴 기준", "캐릭터 얼굴 유사도 검사의 기준 이미지로 지정할까요?",
                parent=window,
            )
            try:
                scope = parse_scope(scope_value or "all", episode=False)
                episode_scope = parse_scope(episode_value or "all", episode=True)
                manager.import_file(
                    Path(path_value), reference_type=ref_type,
                    display_name=name, scene_scope=scope,
                    episode_scope=episode_scope, notes=notes,
                    face_baseline=face,
                )
                reload_assets()
                self._toast("Reference Asset 등록 완료")
            except (ReferenceAssetError, ValueError) as exc:
                messagebox.showerror("등록 실패", str(exc), parent=window)

        def toggle_asset() -> None:
            manager = active_manager()
            if manager is None:
                return
            asset = selected_asset()
            if asset:
                manager.update(asset.asset_id, enabled=not asset.enabled)
                reload_assets()

        def edit_asset() -> None:
            manager = active_manager()
            if manager is None:
                return
            asset = selected_asset()
            if not asset:
                return
            name = simpledialog.askstring(
                "표시 이름", "새 표시 이름", initialvalue=asset.display_name,
                parent=window,
            )
            notes = simpledialog.askstring(
                "메모", "사용자 메모", initialvalue=asset.notes, parent=window,
            )
            ref_type = simpledialog.askstring(
                "Reference 유형",
                "character / style / background / object / general_reference",
                initialvalue=asset.reference_type, parent=window,
            )
            scope_value = simpledialog.askstring(
                "적용 장면",
                "all, 단일 번호, 범위(예: 2-5), 목록(예: 1,3,6)",
                initialvalue=(
                    "all" if asset.scene_scope.mode == "all"
                    else str(asset.scene_scope.scene or "")
                ), parent=window,
            )
            episode_value = simpledialog.askstring(
                "적용 에피소드",
                "all, 단일 번호, 범위(1-10), 목록(1,3,8)",
                initialvalue=(
                    "all" if asset.episode_scope.mode == "all"
                    else str(asset.episode_scope.episode or "")
                ), parent=window,
            )
            if name:
                try:
                    scope = parse_scope(scope_value or "all", episode=False)
                    episode_scope = parse_scope(
                        episode_value or "all", episode=True
                    )
                    face = (
                        ref_type == "character"
                        and messagebox.askyesno(
                            "얼굴 기준",
                            "얼굴 유사도 검사의 기준 이미지로 지정할까요?",
                            parent=window,
                        )
                    )
                    manager.update(
                        asset.asset_id,
                        display_name=name,
                        notes=notes or "",
                        reference_type=ref_type,
                        scene_scope=scope,
                        episode_scope=episode_scope,
                        face_baseline=face,
                    )
                    reload_assets()
                except (ReferenceAssetError, ValueError) as exc:
                    messagebox.showerror("수정 실패", str(exc), parent=window)

        def remove_asset() -> None:
            manager = active_manager()
            if manager is None:
                return
            asset = selected_asset()
            if not asset:
                return
            delete_file = messagebox.askyesnocancel(
                "Reference 삭제",
                "예: 등록과 저장 파일 삭제\n아니요: 등록만 해제\n취소: 유지",
                parent=window,
            )
            if delete_file is None:
                return
            manager.remove(asset.asset_id, delete_file=delete_file)
            reload_assets()
            preview.delete("all")
            details.set("Reference Asset을 선택하세요.")

        actions = tk.Frame(
            left, name="reference_asset_action_bar", bg=self.SURFACE
        )
        actions.pack(
            side="bottom", fill="x", padx=12, pady=(0, 12),
            before=asset_list,
        )
        dependent_controls: list[tk.Widget] = []
        for text, command, color in (
            ("＋ 수동 이미지 추가", add_manual, self.ORANGE),
            ("활성 전환", toggle_asset, self.PURPLE),
            ("이름·메모", edit_asset, self.SURFACE_3),
            ("삭제", remove_asset, self.RED),
        ):
            button = HoverButton(
                actions, text, command, background=color, hover=self.GOLD,
                font=(self.FONT, 8, "bold"), padx=9, pady=7,
            )
            button.pack(side="left", padx=(0, 5))
            dependent_controls.append(button)
        active_bar = tk.Frame(right, bg=self.SURFACE_2)
        active_bar.pack(fill="x", padx=18, pady=(10, 14))
        tk.Label(
            active_bar, text="장면에 적용된 참고 이미지", bg=self.SURFACE_2,
            fg=self.GOLD, font=(self.FONT, 11, "bold"),
        ).pack(anchor="w")
        tk.Label(
            active_bar,
            text=(
                "선택한 Episode와 Scene의 이미지 생성에 사용되는 "
                "Reference Asset을 확인합니다. · 조회 전용"
            ),
            bg=self.SURFACE_2, fg=self.MUTED, justify="left",
            font=(self.FONT, 8), wraplength=430,
        ).pack(anchor="w", pady=(4, 9))
        input_row = tk.Frame(active_bar, bg=self.SURFACE_2)
        input_row.pack(fill="x")
        episode_field = tk.Frame(input_row, bg=self.SURFACE_2)
        episode_field.pack(side="left")
        episode_label = tk.Label(
            episode_field, text="Episode 번호", bg=self.SURFACE_2,
            fg=self.TEXT_SOFT, font=(self.FONT, 8, "bold"),
        )
        episode_label.pack(anchor="w")
        episode_entry = tk.Entry(
            episode_field, width=10, bg=self.SURFACE_3, fg=self.TEXT,
            insertbackground=self.GOLD, relief="flat", bd=0,
            highlightbackground=self.BORDER, highlightcolor=self.PURPLE,
            highlightthickness=1,
        )
        episode_entry.pack(anchor="w", pady=(4, 0), ipady=4)
        scene_field = tk.Frame(input_row, bg=self.SURFACE_2)
        scene_field.pack(side="left", padx=(10, 0))
        tk.Label(
            scene_field, text="Scene 번호", bg=self.SURFACE_2,
            fg=self.TEXT_SOFT, font=(self.FONT, 8, "bold"),
        ).pack(anchor="w")
        scene_entry = tk.Entry(
            scene_field, width=10, bg=self.SURFACE_3, fg=self.TEXT,
            insertbackground=self.GOLD, relief="flat", bd=0,
            highlightbackground=self.BORDER, highlightcolor=self.PURPLE,
            highlightthickness=1,
        )
        episode_entry.insert(0, "1")
        scene_entry.insert(0, "1")
        scene_entry.pack(anchor="w", pady=(4, 0), ipady=4)

        def show_effective_results(
            common: list, scene_specific: list, warnings: list[str],
            episode_number: int, scene_number: int,
            selected_manager: ProjectReferenceManager,
        ) -> None:
            result = tk.Toplevel(window)
            result.title("장면에 적용된 참고 이미지")
            self._fit_window(result, 820, 650, 700, 520)
            result.configure(bg=self.BG)
            result.transient(window)
            result.photos = []  # type: ignore[attr-defined]
            tk.Label(
                result,
                text=f"Episode {episode_number} · Scene {scene_number}",
                bg=self.BG, fg=self.TEXT, font=(self.FONT, 16, "bold"),
            ).pack(anchor="w", padx=24, pady=(20, 3))
            tk.Label(
                result,
                text="아래 이미지는 해당 장면의 실제 이미지 API 입력 선택과 동일합니다.",
                bg=self.BG, fg=self.MUTED, font=(self.FONT, 8),
            ).pack(anchor="w", padx=24, pady=(0, 12))
            canvas = tk.Canvas(result, bg=self.BG, highlightthickness=0)
            scroll = ttk.Scrollbar(
                result, orient="vertical", command=canvas.yview
            )
            listing = tk.Frame(canvas, bg=self.BG)
            listing.bind(
                "<Configure>",
                lambda _event: canvas.configure(scrollregion=canvas.bbox("all")),
            )
            canvas.create_window((0, 0), window=listing, anchor="nw")
            canvas.configure(yscrollcommand=scroll.set)
            scroll.pack(side="right", fill="y")
            canvas.pack(fill="both", expand=True, padx=(24, 8), pady=(0, 18))
            self._bind_scroll_canvas(canvas)

            def add_group(title: str, assets: list) -> None:
                if not assets:
                    return
                tk.Label(
                    listing, text=title, bg=self.BG, fg=self.GOLD,
                    font=(self.FONT, 10, "bold"),
                ).pack(anchor="w", pady=(8, 6))
                for asset in assets:
                    row = tk.Frame(
                        listing, bg=self.SURFACE,
                        highlightbackground=self.BORDER, highlightthickness=1,
                    )
                    row.pack(fill="x", pady=(0, 8))
                    thumb = tk.Canvas(
                        row, width=112, height=82, bg="#080D1A",
                        highlightthickness=0,
                    )
                    thumb.pack(side="left", padx=10, pady=10)
                    try:
                        photo = tk.PhotoImage(
                            file=str(selected_manager.resolve_path(asset))
                        )
                        scale = max(
                            1, max(photo.width() // 106, photo.height() // 76)
                        )
                        photo = photo.subsample(scale, scale)
                        thumb.create_image(56, 41, image=photo)
                        result.photos.append(photo)  # type: ignore[attr-defined]
                    except (OSError, ReferenceAssetError, tk.TclError):
                        thumb.create_text(
                            56, 41, text="미리보기\n불가", fill=self.MUTED,
                            font=(self.FONT, 7), justify="center",
                        )
                    scope_text = (
                        "전체 프로젝트"
                        if asset in common
                        else reference_scope_label(asset)
                    )
                    tk.Label(
                        row,
                        text=(
                            f"{asset.display_name}\n"
                            f"분류  ·  {reference_type_label(asset)}\n"
                            f"적용 범위  ·  {scope_text}\n"
                            "실제 이미지 API 요청 포함  ·  예"
                        ),
                        justify="left", bg=self.SURFACE, fg=self.TEXT_SOFT,
                        font=(self.FONT, 8),
                    ).pack(side="left", anchor="w", padx=8, pady=10)

            add_group("프로젝트 공통 Reference", common)
            add_group("이 장면에만 적용된 Reference", scene_specific)
            if not common and not scene_specific:
                empty = tk.Frame(
                    listing, bg=self.SURFACE,
                    highlightbackground=self.BORDER, highlightthickness=1,
                )
                empty.pack(fill="x", pady=12)
                tk.Label(
                    empty,
                    text="이 장면에 적용된 참고 이미지가 없습니다.",
                    bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 11, "bold"),
                ).pack(pady=(24, 8))

                def manage_reference() -> None:
                    result.destroy()
                    add_manual()

                HoverButton(
                    empty, "Reference Asset 관리 · 이미지 추가",
                    manage_reference, background=self.PURPLE, hover="#765DE4",
                    font=(self.FONT, 8, "bold"), padx=13, pady=7,
                ).pack(pady=(0, 24))
            if warnings:
                tk.Label(
                    listing, text="경고\n" + "\n".join(warnings),
                    justify="left", bg="#301A22", fg=self.RED,
                    font=(self.FONT, 8),
                ).pack(fill="x", pady=8)

        def preview_active() -> None:
            manager = active_manager()
            if manager is None:
                return
            try:
                option = screen_state.active_project
                if option is None:
                    return
                episode_number = (
                    int(episode_entry.get())
                    if option.project_type == "long_story_project" else 1
                )
                scene_number = int(scene_entry.get())
                common, scene_specific, warnings = effective_reference_groups(
                    manager, option.project_type, episode_number, scene_number
                )
                details.set(
                    f"Episode {episode_number} · Scene {scene_number}\n\n"
                    + f"프로젝트 공통 Reference  {len(common)}개\n"
                    + f"이 장면에만 적용된 Reference  {len(scene_specific)}개\n"
                    + "실제 이미지 API 입력 기준으로 조회했습니다."
                    + (
                        "\n\n경고\n" + "\n".join(warnings) if warnings else ""
                    )
                )
                show_effective_results(
                    common, scene_specific, warnings,
                    episode_number, scene_number, manager,
                )
            except (ValueError, ReferenceAssetError) as exc:
                messagebox.showerror("Reference Preview", str(exc), parent=window)

        preview_button = HoverButton(
            active_bar, "적용된 참고 이미지 확인", preview_active,
            background=self.PURPLE, hover=self.GOLD,
            font=(self.FONT, 8, "bold"), padx=9, pady=5,
        )
        preview_button.pack(anchor="w", pady=(10, 0))
        dependent_controls.extend(
            [type_filter_combo, episode_entry, scene_entry, preview_button]
        )

        empty_panel = tk.Frame(
            body, bg=self.SURFACE, highlightbackground=self.BORDER,
            highlightthickness=1,
        )
        tk.Label(
            empty_panel,
            text="REFERENCE ASSETS  /  PROJECT REQUIRED",
            bg=self.SURFACE, fg=self.GOLD, font=("Segoe UI", 8, "bold"),
        ).pack(pady=(32, 8))
        tk.Label(
            empty_panel,
            text=(
                "Reference Assets는 프로젝트별로 관리됩니다.\n"
                "먼저 새 프로젝트를 만들거나 기존 프로젝트를 선택하십시오."
            ),
            justify="center", bg=self.SURFACE, fg=self.TEXT,
            font=(self.FONT, 11, "bold"),
        ).pack(padx=35, pady=(0, 20))
        empty_actions = tk.Frame(empty_panel, bg=self.SURFACE)
        empty_actions.pack(pady=(0, 30))

        def activate_project(option: ReferenceProjectOption | None) -> None:
            if option is not None:
                verified = resolve_reference_project(
                    projects_root, option.project_id
                )
                if verified is None:
                    messagebox.showwarning(
                        "프로젝트를 열 수 없음",
                        "프로젝트가 삭제되었거나 데이터가 손상되었습니다. "
                        "다른 프로젝트를 선택하십시오.",
                        parent=window,
                    )
                    option = None
                else:
                    option = verified
            screen_state.active_project = option
            self.reference_source_project_id = (
                option.project_id if option is not None else None
            )
            state["manager"] = (
                ProjectReferenceManager(projects_root, option.project_id)
                if option else None
            )
            state["assets"] = []
            state["photo"] = None
            asset_list.delete(0, "end")
            preview.delete("all")
            if option is None:
                project_heading.set("프로젝트를 선택하지 않음")
                details.set("프로젝트를 선택하면 Reference 목록이 표시됩니다.")
                episode_label.configure(text="Episode 번호")
                for control in dependent_controls:
                    control.configure(state="disabled")
                empty_panel.place(
                    relx=0.5, rely=0.5, anchor="center",
                    relwidth=0.72, relheight=0.56,
                )
                return
            project_heading.set(f"{option.title} · 생성 입력 자료 관리")
            details.set("Reference Asset을 선택하세요.")
            for control in dependent_controls:
                control.configure(
                    state="readonly" if control is type_filter_combo else "normal"
                )
            if option.project_type == "short_project":
                episode_entry.delete(0, "end")
                episode_entry.insert(0, "1")
                episode_entry.configure(state="disabled")
                episode_label.configure(text="Episode 번호 · 단기는 1로 고정")
            else:
                episode_entry.configure(state="normal")
                episode_label.configure(text="Episode 번호")
            empty_panel.place_forget()
            reload_assets()
            self.refresh()

        def select_existing_project() -> None:
            options = list_reference_projects(projects_root)
            if not options:
                messagebox.showinfo(
                    "기존 프로젝트 선택",
                    "선택할 수 있는 정상 프로젝트가 없습니다.",
                    parent=window,
                )
                return
            picker = tk.Toplevel(window)
            picker.title("기존 프로젝트 선택")
            self._fit_window(picker, 560, 430, 520, 400)
            picker.configure(bg=self.BG)
            picker.transient(window)
            picker.grab_set()
            tk.Label(
                picker, text="REFERENCE PROJECTS", bg=self.BG, fg=self.GOLD,
                font=("Segoe UI", 8, "bold"),
            ).pack(anchor="w", padx=22, pady=(20, 7))
            listing = tk.Listbox(
                picker, bg=self.SURFACE, fg=self.TEXT,
                selectbackground=self.PURPLE, relief="flat",
                font=(self.FONT, 9),
            )
            listing.pack(fill="both", expand=True, padx=22, pady=(0, 10))
            for item in options:
                kind = "장기" if item.project_type == "long_story_project" else "단편"
                listing.insert("end", f"{kind} · {item.title} · {item.project_id}")

            def choose(_event: tk.Event[tk.Misc] | None = None) -> None:
                selected = listing.curselection()
                if selected:
                    option = options[selected[0]]
                    picker.destroy()
                    activate_project(option)

            listing.bind("<Double-Button-1>", choose)
            HoverButton(
                picker, "선택한 프로젝트 열기", choose,
                background=self.PURPLE, hover="#765DE4",
                font=(self.FONT, 8, "bold"), padx=13, pady=7,
            ).pack(anchor="e", padx=22, pady=(0, 18))

        def create_short_from_reference() -> None:
            title = simpledialog.askstring(
                "새 단편 프로젝트", "프로젝트 제목 또는 영상 주제",
                parent=window,
            )
            if not title or not title.strip():
                return
            try:
                activate_project(create_empty_short_project(projects_root, title))
                self._toast("새 단편 프로젝트가 활성화되었습니다.")
            except (OSError, ValueError) as exc:
                messagebox.showerror("프로젝트 생성 실패", str(exc), parent=window)

        def create_long_from_reference() -> None:
            title = simpledialog.askstring(
                "새 장기 프로젝트", "프로젝트 제목", parent=window,
            )
            if not title or not title.strip():
                return
            count = simpledialog.askinteger(
                "목표 회차", "에피소드 수", parent=window,
                initialvalue=30, minvalue=1, maxvalue=365,
            )
            if not count:
                return
            try:
                option = create_empty_long_project(
                    LongStoryService(self.config_data), title, count
                )
                activate_project(option)
                self._toast("새 장기 프로젝트가 활성화되었습니다.")
            except (OSError, ValueError) as exc:
                messagebox.showerror("프로젝트 생성 실패", str(exc), parent=window)

        for text, command, color in (
            ("새 단편 프로젝트", create_short_from_reference, self.ORANGE),
            ("새 장기 프로젝트", create_long_from_reference, self.PURPLE),
            ("기존 프로젝트 선택", select_existing_project, self.SURFACE_3),
        ):
            HoverButton(
                empty_actions, text, command, background=color, hover=self.GOLD,
                font=(self.FONT, 8, "bold"), padx=12, pady=7,
            ).pack(side="left", padx=4)

        # Project selection remains available after a project is active.
        HoverButton(
            header, "프로젝트 전환", select_existing_project,
            background=self.SURFACE_3, hover=self.GOLD,
            font=(self.FONT, 8, "bold"), padx=11, pady=6,
        ).pack(side="right", padx=22)

        activate_project(initial_project)
        self._fade_in(window)

    def _open_long_story_studio(self) -> None:
        """Open offline-capable long-project dashboard and editors."""
        service = LongStoryService(self.config_data)
        window = tk.Toplevel(self)
        window.title("PRISM FORGE — Long Story Studio v1.3.1")
        self._fit_window(window, 1500, 900, 1040, 640)
        window.configure(bg=self.BG)
        window.transient(self)

        toolbar = tk.Frame(
            window, bg="#0A1019", height=42,
            highlightbackground=self.BORDER_SOFT, highlightthickness=1,
        )
        toolbar.pack(fill="x")
        toolbar.pack_propagate(False)
        tk.Label(
            toolbar, text="◈  PRISM FORGE  —  Long Story Studio v1.3.1",
            bg="#0A1019", fg=self.TEXT, font=("Segoe UI", 8, "bold"),
        ).pack(side="left", padx=16)
        api_text = (
            "AI 생성 준비됨" if self.config_data.openai_api_key
            else "AI 생성 비활성화 · OPENAI_API_KEY를 설정하면 사용할 수 있습니다."
        )
        tk.Label(
            toolbar, text=api_text, bg="#0A1019",
            fg=self.GREEN if self.config_data.openai_api_key else self.ORANGE,
            font=(self.FONT, 8, "bold"),
        ).pack(side="right", padx=24)

        shell = tk.Frame(window, bg=self.BG)
        shell.pack(fill="both", expand=True)
        sidebar = tk.Frame(
            shell, bg="#0B121C", width=220,
            highlightbackground=self.BORDER_SOFT, highlightthickness=1,
        )
        sidebar.pack(side="left", fill="y")
        sidebar.pack_propagate(False)
        content_host = tk.Frame(shell, bg=self.BG)
        content_host.pack(side="left", fill="both", expand=True)
        content_canvas = tk.Canvas(
            content_host, bg=self.BG, highlightthickness=0, bd=0,
        )
        content_scroll = ttk.Scrollbar(
            content_host, orient="vertical", command=content_canvas.yview,
        )
        content_canvas.configure(yscrollcommand=content_scroll.set)
        content_scroll.pack(side="right", fill="y")
        content_canvas.pack(side="left", fill="both", expand=True)
        content = tk.Frame(content_canvas, bg=self.BG)
        content_window = content_canvas.create_window(
            (0, 0), window=content, anchor="nw",
        )
        content.bind(
            "<Configure>",
            lambda _event: content_canvas.configure(
                scrollregion=content_canvas.bbox("all")
            ),
        )
        content_canvas.bind(
            "<Configure>",
            lambda event: content_canvas.itemconfigure(
                content_window, width=event.width
            ),
        )
        self._bind_scroll_canvas(content_canvas)
        inspector = tk.Frame(
            shell, bg="#0E1622", width=310,
            highlightbackground=self.BORDER_SOFT, highlightthickness=1,
        )
        inspector.pack(side="right", fill="y")
        inspector.pack_propagate(False)
        inspector_text = tk.StringVar(value="장기 프로젝트를 선택하세요.")
        tk.Label(
            inspector, text="프로젝트 요약", bg="#0E1622", fg=self.TEXT,
            font=(self.FONT, 12, "bold"),
        ).pack(anchor="w", padx=20, pady=(22, 10))
        tk.Label(
            inspector, textvariable=inspector_text, justify="left", wraplength=210,
            bg="#0E1622", fg=self.TEXT_SOFT, font=(self.FONT, 9),
        ).pack(anchor="w", padx=20)

        tk.Label(
            sidebar,
            text="◇  PRISM FORGE",
            bg="#0B121C",
            fg=self.TEXT,
            font=("Segoe UI", 11, "bold"),
        ).pack(anchor="w", padx=18, pady=(24, 18))

        state: dict[str, object] = {
            "store": None, "view": "dashboard", "active_jobs": set()
        }

        def start_long_job(key: str, target: Callable[[], None]) -> bool:
            active = state["active_jobs"]
            if not isinstance(active, set):
                return False
            if key in active:
                self._toast("동일한 생성 작업이 이미 실행 중입니다.", kind="warning")
                return False
            active.add(key)

            def guarded() -> None:
                try:
                    target()
                finally:
                    active.discard(key)

            threading.Thread(target=guarded, daemon=True).start()
            return True

        def close_long_studio() -> None:
            active = state.get("active_jobs")
            if isinstance(active, set) and active and not messagebox.askyesno(
                "API 작업 진행 중",
                "이미 전송된 요청은 취소되거나 환불되지 않습니다. 창을 닫아도 "
                "현재 요청 결과는 안전하게 저장될 수 있습니다. 닫을까요?",
                parent=window,
            ):
                return
            window.destroy()

        window.protocol("WM_DELETE_WINDOW", close_long_studio)

        def clear_content() -> None:
            for child in content.winfo_children():
                child.destroy()
            content_canvas.yview_moveto(0)

        def long_projects() -> list[LongStoryStore]:
            stores = []
            root = self.config_data.project_root / "learning_data" / "projects"
            if root.is_dir():
                for directory in root.iterdir():
                    if (directory / "long_story" / "project.json").is_file():
                        stores.append(LongStoryStore(root, directory.name))
            return stores

        def select_store(store: LongStoryStore) -> None:
            active = state.get("active_jobs")
            if isinstance(active, set) and active and state.get("store") is not store:
                if not messagebox.askyesno(
                    "생성 작업 진행 중",
                    "API 작업이 진행 중입니다. 프로젝트를 전환해도 요청은 "
                    "취소되거나 환불되지 않습니다. 전환할까요?",
                    parent=window,
                ):
                    return
            state["store"] = store
            try:
                migrated = store.migrate_legacy_outlines()
                if migrated:
                    self._toast(
                        f"기존 Episode {migrated}개의 개요를 백업 후 추출했습니다."
                    )
            except (OSError, TypeError, ValueError) as exc:
                messagebox.showwarning(
                    "기존 개요 변환 보류",
                    (
                        "기존 상세 대본은 그대로 유지했습니다.\n"
                        f"개요 변환 중 문제: {exc}"
                    ),
                    parent=window,
                )
            project = store.load_project()
            episodes = store.list_episodes()
            bible = store.load_bible()
            try:
                records_path = (
                    self.config_data.project_root / "learning_data" / "api_calls.json"
                )
                records = (
                    json.loads(records_path.read_text(encoding="utf-8"))
                    if records_path.is_file() else []
                )
                api_calls = sum(
                    item.get("project_id") == project.project_id for item in records
                )
            except (OSError, json.JSONDecodeError):
                api_calls = 0
            reference_manager = ProjectReferenceManager(
                service.projects_root, project.project_id
            )
            reference_warnings = 0
            try:
                for episode in episodes:
                    for scene in range(1, 7):
                        _assets, warnings = reference_manager.select_for_episode_scene(
                            episode.number, scene
                        )
                        reference_warnings += len(warnings)
            except ReferenceAssetError:
                reference_warnings += 1
            metrics = dashboard_metrics(
                episodes, bible, api_calls, reference_warnings
            )
            completed = sum(item.state == "completed" for item in episodes)
            outlines_done = sum(bool(item.outline) for item in episodes)
            scripts_done = sum(bool(item.script) for item in episodes)
            images_done = sum(len(item.generated_images) == 6 for item in episodes)
            video_waiting = sum(
                item.state == "waiting_for_video_confirmation" for item in episodes
            )
            inspector_text.set(
                f"▣  전체 에피소드                 {len(episodes)}\n\n"
                f"◇  개요 완료                     {outlines_done}\n\n"
                f"▤  대본 완료                     {scripts_done}\n\n"
                f"▧  이미지 완료                   {images_done}\n\n"
                f"▶  영상 생성 확인 대기                   {video_waiting}\n\n"
                f"✓  프로젝트 완료                 {completed}\n\n"
                f"장르  {project.genre or '—'}\n"
                f"화면비  {project.aspect_ratio}\n"
                f"API  {'활성' if self.config_data.openai_api_key else '비활성'}"
            )
            show_dashboard()

        def create_long_project(project: LongProject) -> None:
            count = project.episode_count
            created_store = service.create_project(project)
            select_store(created_store)
            original_prompt = service.render_project_outline_prompt(
                created_store
            )

            def generate_outline(
                approved_prompt: str, _approved_at: str
            ) -> None:
                def run() -> None:
                    try:
                        service.generate_project_outline(
                            created_store,
                            approved_prompt=approved_prompt,
                        )
                        self.after(0, lambda: (
                            select_store(created_store),
                            self._toast("전체 개요·Episode 계획 생성 완료"),
                        ))
                    except Exception as exc:
                        self.after(0, lambda error=exc: messagebox.showerror(
                            "전체 개요 생성 실패", str(error), parent=window
                        ))

                start_long_job(
                    f"outline:{project.project_id}",
                    run,
                )

            summary = (
                f"Story 모델  {self.config_data.openai_story_model}\n"
                "예상 Story API 호출  최대 1회\n"
                "예상 Image API 호출  0회\n"
                f"API 키  {'설정됨' if self.config_data.openai_api_key else '미설정'}\n"
                f"생성 범위  전체 작품 개요 + Episode Outline {count}개\n"
                "상세 Episode 대본과 이미지는 생성하지 않습니다.\n"
                "프롬프트 확인 후 별도의 API 요청 전송창이 한 번 더 표시됩니다."
            )
            if count > 30:
                summary += "\nEpisode가 많아 응답 길이가 길어질 수 있습니다."
            self._open_story_prompt_preview(
                original_prompt,
                on_confirm=generate_outline,
                parent=window,
                window_title="OpenAI 장기 작품 개요 요청 확인",
                eyebrow="LONG STORY API  /  REQUEST PREVIEW",
                heading="OpenAI 장기 작품 개요 요청 확인",
                subtitle=(
                    "전체 작품 개요와 Episode Outline 생성에 사용할 "
                    "최종 Prompt입니다."
                ),
                request_summary=summary,
                confirm_text="프롬프트 확인 완료 →",
            )

        def new_project() -> None:
            wizard = tk.Toplevel(window)
            wizard.title("PRISM FORGE — New Long Project Wizard")
            self._fit_window(wizard, 1120, 700, 920, 580)
            wizard.configure(bg=self.BG)
            wizard.transient(window)
            wizard.grab_set()

            values: dict[str, tk.StringVar] = {
                "title": tk.StringVar(),
                "logline": tk.StringVar(),
                "genre": tk.StringVar(value="애니메이션"),
                "tone": tk.StringVar(value="시네마틱"),
                "overview": tk.StringVar(),
                "theme": tk.StringVar(),
                "ending": tk.StringVar(),
                "notes": tk.StringVar(),
                "episodes": tk.StringVar(value="12"),
                "duration": tk.StringVar(value="30초"),
                "aspect": tk.StringVar(value="9:16"),
                "platform": tk.StringVar(value="YouTube Shorts"),
                "audience": tk.StringVar(),
            }
            step_names = (
                "작품 개요",
                "세계관 & 이야기",
                "Episode 설정",
                "최종 확인",
            )
            current = {"step": 0}

            top = tk.Frame(wizard, bg="#070D17", height=76)
            top.pack(fill="x")
            top.pack_propagate(False)
            tk.Label(
                top, text="새 장기 프로젝트 설계", bg="#070D17",
                fg=self.TEXT, font=(self.FONT, 17, "bold"),
            ).pack(side="left", padx=24, pady=20)
            tk.Label(
                top,
                text=(
                    "Story API 최대 1회 · 이미지 API 0회"
                    if self.config_data.openai_api_key
                    else "API 키 미설정 · 프로젝트 저장만 가능"
                ),
                bg="#070D17",
                fg=self.GREEN if self.config_data.openai_api_key else self.ORANGE,
                font=(self.FONT, 8, "bold"),
            ).pack(side="right", padx=24)

            body = tk.Frame(wizard, bg=self.BG)
            body.pack(fill="both", expand=True, padx=20, pady=16)
            body.columnconfigure(0, minsize=190)
            body.columnconfigure(1, weight=1)
            body.columnconfigure(2, minsize=250)
            body.rowconfigure(0, weight=1)
            steps = self._card(body, background="#0B1422")
            steps.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
            center = self._card(body, background=self.SURFACE)
            center.grid(row=0, column=1, sticky="nsew", padx=(0, 12))
            summary = self._card(body, background="#0B1422")
            summary.grid(row=0, column=2, sticky="nsew")
            tk.Label(
                steps, text="LONG PROJECT SETUP", bg="#0B1422",
                fg=self.MUTED, font=("Segoe UI", 7, "bold"),
            ).pack(anchor="w", padx=14, pady=(18, 10))
            step_buttons: list[HoverButton] = []

            footer = tk.Frame(wizard, bg="#070D17", height=68)
            footer.pack(fill="x", side="bottom")
            footer.pack_propagate(False)
            back_button = HoverButton(
                footer, "이전 단계", lambda: show_step(current["step"] - 1),
                background=self.SURFACE_3, hover=self.BORDER,
                font=(self.FONT, 8, "bold"), padx=16, pady=9,
            )
            back_button.pack(side="left", padx=22, pady=13)
            next_button = HoverButton(
                footer, "다음 단계", lambda: show_step(current["step"] + 1),
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 8, "bold"), padx=18, pady=9,
            )
            next_button.pack(side="right", padx=22, pady=13)
            error_value = tk.StringVar()

            def clear_center() -> tk.Frame:
                for child in center.winfo_children():
                    child.destroy()
                page = tk.Frame(center, bg=self.SURFACE)
                page.pack(fill="both", expand=True, padx=10, pady=8)
                page.columnconfigure(0, weight=1)
                page.columnconfigure(1, weight=1)
                return page

            def field(
                parent: tk.Misc, label: str, key: str, row: int,
                column: int = 0, *,
                choices: tuple[str, ...] | None = None,
                columnspan: int = 1,
            ) -> tk.Widget:
                area = tk.Frame(parent, bg=self.SURFACE)
                area.grid(
                    row=row, column=column, columnspan=columnspan,
                    sticky="ew", padx=16, pady=(9, 2),
                )
                tk.Label(
                    area, text=label, bg=self.SURFACE, fg=self.TEXT_SOFT,
                    font=(self.FONT, 8, "bold"),
                ).pack(anchor="w", pady=(0, 5))
                if choices:
                    widget: tk.Widget = ttk.Combobox(
                        area, textvariable=values[key], values=choices,
                        state="normal", style="Studio.TCombobox",
                    )
                else:
                    widget = tk.Entry(
                        area, textvariable=values[key], bg=self.SURFACE_3,
                        fg=self.TEXT, insertbackground=self.GOLD,
                        relief="flat", font=(self.FONT, 9),
                    )
                widget.pack(fill="x", ipady=5)
                return widget

            def heading(page: tk.Misc, text: str) -> None:
                tk.Label(
                    page, text=text, bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 14, "bold"),
                ).grid(
                    row=0, column=0, columnspan=2, sticky="w",
                    padx=16, pady=10,
                )

            def render_overview() -> None:
                page = clear_center()
                heading(page, "1. 작품 개요")
                field(page, "작품 제목 *", "title", 1)
                field(page, "전체 이야기 주제 *", "logline", 1, 1)
                field(
                    page, "장르", "genre", 2, choices=(
                        "미스터리", "모험", "판타지", "코미디",
                        "드라마", "액션", "애니메이션",
                    ),
                )
                field(
                    page, "전체 분위기", "tone", 2, 1, choices=(
                        "시네마틱", "따뜻하고 유쾌함", "긴장감",
                        "몽환적", "에너지 넘침", "감성적",
                    ),
                )

            def render_story() -> None:
                page = clear_center()
                heading(page, "2. 세계관 & 이야기")
                field(page, "세계관·작품 전체 줄거리", "overview", 1, columnspan=2)
                field(page, "핵심 주제", "theme", 2)
                field(page, "결말 방향", "ending", 2, 1)
                field(page, "추가 지시사항", "notes", 3, columnspan=2)
                tk.Label(
                    page,
                    text=(
                        "이 설정은 이후 Episode 프롬프트에서 Episode별 수정값보다 "
                        "우선 적용됩니다."
                    ),
                    bg=self.SURFACE, fg=self.GREEN, justify="left",
                    font=(self.FONT, 8, "bold"),
                ).grid(
                    row=4, column=0, columnspan=2, sticky="w",
                    padx=16, pady=18,
                )

            def render_episode() -> None:
                page = clear_center()
                heading(page, "3. Episode 설정")
                field(page, "총 Episode 수", "episodes", 1)
                field(
                    page, "Episode 길이", "duration", 1, 1,
                    choices=("15초", "30초", "45초", "60초"),
                )
                field(
                    page, "화면 비율", "aspect", 2,
                    choices=("16:9", "9:16", "1:1"),
                )
                field(
                    page, "플랫폼", "platform", 2, 1,
                    choices=("YouTube Shorts", "YouTube", "Instagram Reels"),
                )
                field(page, "대상 시청자", "audience", 3, columnspan=2)

            def render_final() -> None:
                page = clear_center()
                heading(page, "4. 최종 확인")
                details = (
                    f"작품 제목  {values['title'].get() or '—'}\n"
                    f"전체 이야기 주제  {values['logline'].get() or '—'}\n"
                    f"장르 / 분위기  {values['genre'].get()} / "
                    f"{values['tone'].get()}\n"
                    f"세계관·전체 줄거리  {values['overview'].get() or '—'}\n"
                    f"핵심 주제  {values['theme'].get() or '—'}\n"
                    f"Episode  {values['episodes'].get()}개 · "
                    f"{values['duration'].get()}\n"
                    f"화면 비율 / 플랫폼  {values['aspect'].get()} / "
                    f"{values['platform'].get()}\n\n"
                    "생성 범위  전체 작품 개요 + Episode Outline\n"
                    "Story API  최대 1회\n"
                    "Image API  0회"
                )
                tk.Label(
                    page, text=details, justify="left", wraplength=560,
                    bg=self.SURFACE, fg=self.TEXT_SOFT,
                    font=(self.FONT, 9),
                ).grid(
                    row=1, column=0, columnspan=2, sticky="nw",
                    padx=16, pady=10,
                )

            renderers = (
                render_overview, render_story, render_episode, render_final
            )

            def validate_step(index: int) -> bool:
                error_value.set("")
                if index == 0 and (
                    not values["title"].get().strip()
                    or not values["logline"].get().strip()
                ):
                    error_value.set("작품 제목과 전체 이야기 주제를 입력하세요.")
                    return False
                if index == 2:
                    try:
                        count = int(values["episodes"].get())
                    except ValueError:
                        error_value.set("총 Episode 수는 숫자로 입력하세요.")
                        return False
                    if not 1 <= count <= self.config_data.app_max_long_project_episodes:
                        error_value.set(
                            "총 Episode 수는 1에서 "
                            f"{self.config_data.app_max_long_project_episodes} "
                            "사이여야 합니다."
                        )
                        return False
                return True

            def submit() -> None:
                if not all(validate_step(index) for index in range(3)):
                    return
                duration = int(
                    "".join(filter(str.isdigit, values["duration"].get()))
                )
                project = LongProject(
                    project_id=f"long_{uuid4().hex[:12]}",
                    title=values["title"].get().strip(),
                    logline=values["logline"].get().strip(),
                    genre=values["genre"].get().strip(),
                    tone=values["tone"].get().strip(),
                    overview=values["overview"].get().strip(),
                    theme=values["theme"].get().strip(),
                    ending_direction=values["ending"].get().strip(),
                    notes=values["notes"].get().strip(),
                    episode_count=int(values["episodes"].get()),
                    episode_duration_seconds=duration,
                    aspect_ratio=values["aspect"].get().strip(),
                    platform=values["platform"].get().strip(),
                    audience=values["audience"].get().strip(),
                )
                wizard.destroy()
                create_long_project(project)

            def show_step(index: int) -> None:
                if index > current["step"] and not validate_step(current["step"]):
                    return
                index = max(0, min(index, len(step_names) - 1))
                current["step"] = index
                renderers[index]()
                for number, button in enumerate(step_buttons):
                    completed = number < index
                    active = number == index
                    color = (
                        "#15382F" if completed
                        else "#1A2740" if active
                        else "#0B1422"
                    )
                    button.configure(
                        text=(
                            f"✓  {step_names[number]}"
                            if completed
                            else f"{number + 1}   {step_names[number]}"
                        ),
                        background=color,
                        foreground=(
                            self.GREEN if completed
                            else self.TEXT if active
                            else self.TEXT_SOFT
                        ),
                        highlightbackground=(
                            self.GREEN if completed
                            else self.PURPLE if active
                            else "#0B1422"
                        ),
                    )
                    button._base = color
                back_button.configure(
                    state="normal" if index else "disabled"
                )
                next_button.configure(
                    text="장기 프로젝트 생성" if index == 3 else "다음 단계",
                    bg=self.PURPLE,
                )
                next_button._command = (
                    submit if index == 3
                    else lambda: show_step(current["step"] + 1)
                )
                next_button._base = (
                    self.PURPLE
                )
                summary_value.set(
                    f"{values['title'].get() or '제목 미입력'}\n\n"
                    f"{values['genre'].get()} · {values['tone'].get()}\n"
                    f"Episode {values['episodes'].get()}개 · "
                    f"{values['duration'].get()}\n"
                    f"{values['aspect'].get()} · {values['platform'].get()}"
                )

            for index, name in enumerate(step_names):
                button = HoverButton(
                    steps, f"{index + 1}   {name}",
                    lambda value=index: show_step(value),
                    background="#0B1422", hover="#192744",
                    foreground=self.TEXT_SOFT,
                    font=(self.FONT, 8, "bold"), padx=12, pady=10,
                )
                button.pack(fill="x", padx=8, pady=2)
                step_buttons.append(button)

            tk.Label(
                summary, text="실시간 요약", bg="#0B1422", fg=self.TEXT,
                font=(self.FONT, 11, "bold"),
            ).pack(anchor="w", padx=18, pady=(20, 10))
            summary_value = tk.StringVar()
            tk.Label(
                summary, textvariable=summary_value, justify="left",
                wraplength=210, bg="#0B1422", fg=self.TEXT_SOFT,
                font=(self.FONT, 8),
            ).pack(anchor="w", padx=18)
            tk.Label(
                summary,
                text=(
                    "PROMPT PRIORITY\n\n"
                    "1  Story Bible\n"
                    "2  장기 프로젝트 전체 설정\n"
                    "3  Episode Outline\n"
                    "4  Continuity\n"
                    "5  Episode Wizard 수정값\n"
                    "6  사용자 추가 지시사항"
                ),
                justify="left", bg="#0B1422", fg=self.GREEN,
                font=(self.FONT, 8, "bold"),
            ).pack(anchor="w", padx=18, pady=(28, 0))
            tk.Label(
                footer, textvariable=error_value, bg="#070D17",
                fg=self.RED, font=(self.FONT, 8, "bold"),
            ).place(relx=0.5, rely=0.5, anchor="center")
            show_step(0)
            self._fade_in(wizard)

        def require_store() -> LongStoryStore | None:
            value = state.get("store")
            if not isinstance(value, LongStoryStore):
                self._toast("장기 프로젝트를 먼저 선택하세요.", kind="warning")
                return None
            return value

        def show_dashboard() -> None:
            clear_content()
            store = require_store()
            if not store:
                return
            project = store.load_project()
            episodes = store.list_episodes()
            heading = tk.Frame(content, bg=self.BG)
            heading.pack(fill="x", padx=24, pady=(22, 12))
            tk.Label(
                heading, text="장기 프로젝트", bg=self.BG, fg=self.TEXT,
                font=(self.FONT, 20, "bold"),
            ).pack(anchor="w")
            tk.Label(
                heading, text="장기 프로젝트를 생성하고 에피소드를 관리하세요.",
                bg=self.BG, fg=self.MUTED, font=(self.FONT, 8),
            ).pack(anchor="w", pady=(4, 0))

            project_card = self._card(content, background="#0D1725")
            project_card.pack(fill="x", padx=24, pady=(0, 12))
            poster = tk.Canvas(
                project_card, width=150, height=112, bg="#111B2B",
                highlightthickness=0,
            )
            poster.pack(side="left", padx=14, pady=14)
            poster.create_rectangle(
                0, 0, 150, 112, fill="#231B25", outline=""
            )
            poster.create_polygon(
                8, 104, 34, 59, 55, 79, 78, 31, 101, 69,
                126, 42, 148, 104, fill="#8D5330", outline=""
            )
            poster.create_oval(
                104, 10, 143, 49, fill="#F39A4B", outline=""
            )
            copy = tk.Frame(project_card, bg="#0D1725")
            copy.pack(side="left", fill="both", expand=True, pady=14)
            tk.Label(
                copy,
                text=f"{project.episode_count}화 · {project.genre or '애니메이션'}",
                bg="#0D1725", fg=self.TEXT,
                font=(self.FONT, 16, "bold"),
            ).pack(anchor="w")
            meta = (
                f"장르  {project.genre or '—'}       "
                f"분위기  {project.tone or '—'}       "
                f"진행  {sum(item.state == 'completed' for item in episodes)}"
                f" / {len(episodes)} 완료"
            )
            tk.Label(
                copy, text=meta, bg="#0D1725", fg=self.MUTED,
                font=(self.FONT, 8),
            ).pack(anchor="w", pady=(9, 5))
            progress_value = int(
                100 * sum(STATE_PROGRESS.get(item.state, 0) for item in episodes)
                / max(1, len(episodes) * 100)
            )
            meter = tk.Canvas(
                copy, height=8, bg="#0D1725", highlightthickness=0
            )
            meter.pack(fill="x", pady=(4, 0), padx=(0, 18))
            meter.bind(
                "<Configure>",
                lambda event, value=progress_value, widget=meter:
                self._draw_meter(widget, event.width, value),
            )
            tk.Label(
                copy,
                text=project.logline
                or project.overview
                or "전체 개요가 아직 생성되지 않았습니다.",
                bg="#0D1725", fg=self.TEXT_SOFT,
                font=(self.FONT, 8), wraplength=650, justify="left",
            ).pack(anchor="w", pady=(8, 0))
            HoverButton(
                project_card, "•••", show_projects,
                background=self.SURFACE_3, hover=self.BORDER,
                font=("Segoe UI", 10, "bold"), padx=12, pady=6,
            ).pack(side="right", anchor="n", padx=14, pady=14)
            show_timeline(embed=True)

        def show_timeline(embed: bool = False) -> None:
            if not embed:
                clear_content()
            store = require_store()
            if not store:
                return
            holder = tk.Frame(content, bg=self.BG)
            holder.pack(fill="both", expand=True, padx=26, pady=(0, 20))
            tk.Label(
                holder, text="에피소드 목록", bg=self.BG, fg=self.TEXT,
                font=(self.FONT, 15, "bold"),
            ).pack(anchor="w", pady=(8, 10))
            filter_bar = tk.Frame(holder, bg=self.BG)
            filter_bar.pack(fill="x", pady=(0, 8))
            query_value = tk.StringVar()
            state_value = tk.StringVar(value="all")
            sort_value = tk.StringVar(value="오름차순")
            search_entry = tk.Entry(
                filter_bar, textvariable=query_value, bg=self.SURFACE_2,
                fg=self.TEXT, insertbackground=self.GOLD, relief="flat",
                font=(self.FONT, 9),
            )
            search_entry.pack(
                side="left", fill="x", expand=True, ipady=7, padx=(0, 8)
            )
            ttk.Combobox(
                filter_bar, textvariable=state_value, state="readonly", width=18,
                values=("all", *sorted({
                    item.state for item in store.list_episodes()
                })),
            ).pack(side="left", padx=6)
            ttk.Combobox(
                filter_bar, textvariable=sort_value, state="readonly", width=9,
                values=("오름차순", "내림차순"),
            ).pack(side="left")
            card_holder = tk.Frame(holder, bg=self.BG)
            card_holder.pack(fill="both", expand=True)
            episodes: list = []
            selected_episode: dict[str, int | None] = {"number": None}
            episode_opener: dict[str, Callable[[int], None]] = {
                "command": lambda number: inspect_episode_number(number)
            }

            def inspect_episode_number(number: int) -> None:
                selected_episode["number"] = number
                episode = store.load_episode(number)
                try:
                    context = service.build_context(store, number)
                    length = context_length(context)
                except Exception:
                    length = 0
                inspector_text.set(
                    f"EP {number:03d} · {episode.title}\n\n"
                    f"상태  {episode.state}\n"
                    f"진행률  {STATE_PROGRESS.get(episode.state, 0)}%\n\n"
                    f"대본  {'완료' if episode.script else '대기'}\n"
                    f"이미지  {len(episode.generated_images)}/6\n"
                    f"승인  {len(episode.approved_scene_numbers)}/6\n"
                    f"Runway  "
                    f"{'대기 중' if episode.state == 'waiting_for_video_confirmation' else '미도달'}\n\n"
                    f"Context  {length:,} chars\n"
                    "예상 API  대본 1 / 이미지 최대 6"
                )

            def reload_timeline(*_args: object) -> None:
                nonlocal episodes
                episodes = filter_episodes(
                    store.list_episodes(), query_value.get(), state_value.get(),
                    sort_value.get() == "내림차순",
                )
                for child in card_holder.winfo_children():
                    child.destroy()
                columns = min(5, max(1, len(episodes)))
                for column in range(5):
                    card_holder.columnconfigure(
                        column, weight=1, uniform="episode"
                    )
                for index, item in enumerate(episodes):
                    progress = STATE_PROGRESS.get(item.state, 0)
                    selected = selected_episode["number"] == item.number
                    card = HoverCard(
                        card_holder,
                        background=self.SURFACE,
                        border=self.PURPLE if selected else self.BORDER_SOFT,
                        hover_border=self.PURPLE,
                        height=220,
                    )
                    card.grid(
                        row=index // 5, column=index % 5, sticky="nsew",
                        padx=(0, 9) if index % 5 < 4 else 0,
                        pady=(0, 9),
                    )
                    card.pack_propagate(False)
                    top = tk.Frame(card, bg=self.SURFACE)
                    top.pack(fill="x", padx=14, pady=(14, 4))
                    tk.Label(
                        top, text=f"{item.number:02d}화",
                        bg=self.SURFACE,
                        fg=self.PURPLE if selected else self.TEXT_SOFT,
                        font=(self.FONT, 9, "bold"),
                    ).pack(anchor="w")
                    tk.Label(
                        card, text=item.title or f"Episode {item.number}",
                        bg=self.SURFACE, fg=self.TEXT,
                        font=(self.FONT, 11, "bold"),
                        wraplength=150, justify="left",
                    ).pack(anchor="w", padx=14)
                    state_color = (
                        self.GREEN if item.state in {
                            "waiting_for_video_confirmation", "completed"
                        }
                        else self.GOLD if item.script
                        else self.MUTED
                    )
                    self._status_badge(
                        card, item.state, color=state_color,
                        background=self.SURFACE_3,
                    ).pack(anchor="w", padx=14, pady=(10, 7))
                    tk.Label(
                        card,
                        text=(
                            f"▤  대본 {'완료' if item.script else '대기'}\n"
                            f"▧  이미지 {len(item.generated_images)}/6\n"
                            f"▶  Runway "
                            f"{'대기' if item.state == 'waiting_for_video_confirmation' else '미도달'}\n"
                            f"수정  {item.updated_at[:10]}"
                        ),
                        bg=self.SURFACE, fg=self.MUTED,
                        justify="left", font=(self.FONT, 8),
                    ).pack(anchor="w", padx=14)
                    meter = tk.Canvas(
                        card, height=6, bg=self.SURFACE,
                        highlightthickness=0,
                    )
                    meter.pack(fill="x", padx=14, pady=(12, 2))
                    meter.bind(
                        "<Configure>",
                        lambda event, value=progress, widget=meter:
                        self._draw_meter(widget, event.width, value),
                    )
                    tk.Label(
                        card, text=f"{progress}%", bg=self.SURFACE,
                        fg=self.TEXT_SOFT, font=("Segoe UI", 7),
                    ).pack(anchor="e", padx=14)

                    def choose(
                        _event: tk.Event[tk.Misc] | None = None,
                        number: int = item.number,
                    ) -> None:
                        inspect_episode_number(number)
                        episode_opener["command"](number)

                    def bind_card(widget: tk.Misc) -> None:
                        widget.bind("<Button-1>", choose)
                        for child in widget.winfo_children():
                            bind_card(child)

                    bind_card(card)

            for variable in (query_value, state_value, sort_value):
                variable.trace_add("write", reload_timeline)
            reload_timeline()
            buttons = tk.Frame(holder, bg=self.BG)
            buttons.pack(fill="x", pady=10)

            def selected_number() -> int | None:
                value = selected_episode["number"]
                return int(value) if value is not None else None

            def add_episode() -> None:
                service.add_episode(store, "새 에피소드")
                show_timeline()

            def duplicate() -> None:
                number = selected_number()
                if number:
                    service.duplicate_episode(store, number)
                    show_timeline()

            def delete() -> None:
                number = selected_number()
                if number and messagebox.askyesno(
                    "회차 삭제",
                    "대본·이미지·Continuity 데이터도 함께 삭제됩니다. 계속할까요?",
                    parent=window,
                ):
                    store.delete_episode(number)
                    show_timeline()

            def generate_script() -> None:
                number = selected_number()
                if not number:
                    return
                if not self.config_data.openai_api_key:
                    messagebox.showinfo(
                        "OpenAI API 키 필요",
                        "OpenAI API 키가 설정되지 않았습니다.\n"
                        ".env 파일에 OPENAI_API_KEY를 입력한 뒤 앱을 다시 실행하십시오.",
                        parent=window,
                    )
                    return
                episode = store.load_episode(number)
                if episode.state == "planned" and not episode.outline:
                    messagebox.showinfo(
                        "Episode 개요 필요",
                        "먼저 장기 프로젝트 전체 개요를 생성하십시오.",
                        parent=window,
                    )
                    return
                regenerate = bool(episode.script)
                if regenerate and not messagebox.askyesno(
                    "상세 대본 재생성",
                    (
                        "기존 상세 대본은 이력에 보존됩니다.\n"
                        "Story API 최대 1회를 사용해 새 Revision을 생성할까요?"
                    ),
                    parent=window,
                ):
                    return
                if not regenerate and not messagebox.askyesno(
                    "Episode 상세 대본 생성",
                    (
                        f"Episode {number} 개요를 바탕으로 장면 6개 상세 대본을 "
                        "생성합니다.\nStory API 요청: 최대 1회\n"
                        "이미지 API 요청: 0회\n\n진행할까요?"
                    ),
                    parent=window,
                ):
                    return
                self._toast(f"Episode {number} 대본 생성은 백그라운드에서 시작됩니다.")
                start_long_job(
                    f"script:{store.load_project().project_id}:{number}",
                    lambda: self._long_script_job(
                        service, store, number, window, show_timeline,
                        regenerate=regenerate,
                    ),
                )

            def view_outline() -> None:
                number = selected_number()
                if not number:
                    return
                episode = store.load_episode(number)
                messagebox.showinfo(
                    f"Episode {number} 개요",
                    json.dumps(
                        episode.outline or {
                            "title": episode.title,
                            "summary": episode.summary,
                            "main_event": episode.core_event,
                            "conflict": episode.conflict,
                        },
                        ensure_ascii=False,
                        indent=2,
                    ),
                    parent=window,
                )

            def open_script_editor() -> None:
                number = selected_number()
                if not number:
                    return
                episode = store.load_episode(number)
                if not episode.script:
                    self._toast("먼저 상세 대본을 생성하세요.", kind="warning")
                    return
                editor_window = tk.Toplevel(window)
                editor_window.title(f"Episode {number} 상세 대본")
                self._fit_window(editor_window, 760, 620, 680, 540)
                editor_window.configure(bg=self.BG)
                editor = tk.Text(
                    editor_window, bg=self.SURFACE, fg=self.TEXT,
                    insertbackground=self.GOLD, wrap="none",
                    font=("Consolas", 9),
                )
                editor.pack(fill="both", expand=True, padx=18, pady=18)
                editor.insert(
                    "1.0",
                    json.dumps(episode.script, ensure_ascii=False, indent=2),
                )

                def save_script() -> None:
                    try:
                        service.update_episode_script(
                            store,
                            number,
                            json.loads(editor.get("1.0", "end")),
                        )
                        editor_window.destroy()
                        self._toast(
                            f"Episode {number} 상세 대본 수정 · 재승인 필요"
                        )
                        show_timeline()
                    except Exception as exc:
                        messagebox.showerror(
                            "대본 저장 실패", str(exc), parent=editor_window
                        )

                HoverButton(
                    editor_window, "수정 저장", save_script,
                    background=self.GREEN, hover=self.GOLD,
                    font=(self.FONT, 9, "bold"), padx=16, pady=8,
                ).pack(pady=(0, 16))

            def approve_script() -> None:
                number = selected_number()
                if not number:
                    return
                try:
                    service.approve_script(store, number)
                    self._toast(
                        f"Episode {number} 대본 승인 · Scene Mapping 검토 대기"
                    )
                    show_timeline()
                except Exception as exc:
                    messagebox.showerror("승인 실패", str(exc), parent=window)

            def generate_images() -> None:
                number = selected_number()
                if not number:
                    return
                if not self.config_data.openai_api_key:
                    messagebox.showinfo(
                        "OpenAI API 키 필요",
                        ".env 파일에 OPENAI_API_KEY를 입력한 뒤 앱을 다시 실행하십시오.",
                        parent=window,
                    )
                    return
                try:
                    episode = store.load_episode(number)
                    if episode.state == "waiting_for_asset_mapping_review":
                        summary = service.automatic_reference_summary(store, number)
                        selected = summary["selected_asset_ids_by_scene"]
                        details = "\n".join(
                            f"Scene{scene}: {len(selected.get(scene, []))}개"
                            for scene in range(1, 7)
                        )
                        if not messagebox.askyesno(
                            "Candidate Asset 전달 확인",
                            (
                                "후보 Asset: "
                                f"{len(summary['candidate_asset_ids'])}개\n\n"
                                f"{details}\n\n"
                                "예상 이미지 API 호출: 최대 6회\n\n"
                                "이 Candidate 전체를 각 장면에 전달할까요?"
                            ),
                            parent=window,
                        ):
                            return
                        service.confirm_automatic_references(store, number)
                except Exception as exc:
                    messagebox.showerror(
                        "Reference 확인 실패", str(exc), parent=window
                    )
                    return
                if not messagebox.askyesno(
                    "회차 이미지 생성",
                    f"Episode {number} 장면 이미지 최대 6회를 생성할까요?",
                    parent=window,
                ):
                    return
                start_long_job(
                    f"images:{store.load_project().project_id}:{number}",
                    lambda: self._long_image_job(
                        service, store, number, window, show_timeline
                    ),
                )

            def review_scene_mapping() -> None:
                number = selected_number()
                if number:
                    self._open_scene_mapping(
                        store.load_project().project_id, number
                    )

            def regenerate_scene() -> None:
                number = selected_number()
                if not number:
                    return
                scene = simpledialog.askinteger(
                    "Scene 재생성", "재생성할 Scene 번호 (1~6)",
                    parent=window, minvalue=1, maxvalue=6,
                )
                if not scene:
                    return
                try:
                    preview = service.preview_scene_generation(store, number, scene)
                except Exception as exc:
                    messagebox.showerror("재생성 준비 실패", str(exc), parent=window)
                    return
                references = preview["references"]
                reference_text = "\n".join(
                    f"{index}. {item['display_name']} · {item['reference_type']}"
                    for index, item in enumerate(references, 1)
                ) or "없음"
                prompt_window = (
                    f"Episode {number} · Scene {scene}\n\n"
                    f"현재 Prompt\n{preview['prompt']}\n\n"
                    f"사용 Reference\n{reference_text}\n\n"
                    "예상 API 호출  1회\n"
                    "정책  새 결과를 요청하는 강제 재생성(기존 캐시 우회)\n"
                    f"동일 입력 캐시  {'존재' if preview['cache_hit'] else '없음'}\n\n"
                    "이 장면 하나만 교체할까요?"
                )
                if not messagebox.askyesno(
                    "Generate Again · 실행 전 확인", prompt_window,
                    parent=window,
                ):
                    return
                start_long_job(
                    f"regen:{store.load_project().project_id}:{number}:{scene}",
                    lambda: self._long_regenerate_job(
                        service, store, number, scene, window, show_timeline
                    ),
                )

            def approve_images() -> None:
                number = selected_number()
                if not number:
                    return
                try:
                    for scene in range(1, 7):
                        service.approve_image(store, number, scene)
                    self._toast(
                        f"Episode {number} 이미지 승인 · 영상 생성 확인 대기"
                    )
                    show_timeline()
                except Exception as exc:
                    messagebox.showerror("승인 실패", str(exc), parent=window)

            def prepare_next() -> None:
                number = selected_number()
                if not number:
                    return
                summary = simpledialog.askstring(
                    "Continuity Memory",
                    "현재 회차에서 실제로 일어난 내용을 확인·수정해 입력하세요.",
                    parent=window,
                )
                if summary is None:
                    return
                try:
                    next_episode = service.prepare_next_episode(
                        store, number,
                        ContinuityMemory(number, episode_summary=summary),
                    )
                    self._toast(
                        "Continuity 저장 완료 · "
                        + (
                            f"Episode {next_episode.number} 준비됨"
                            if next_episode else "마지막 회차입니다."
                        )
                    )
                except Exception as exc:
                    messagebox.showerror("다음 회차 준비 실패", str(exc), parent=window)

            def generate_plan() -> None:
                if not self.config_data.openai_api_key:
                    messagebox.showinfo(
                        "OpenAI API 키 필요",
                        ".env 파일에 OPENAI_API_KEY를 입력한 뒤 앱을 다시 실행하십시오.",
                        parent=window,
                    )
                    return
                count = min(store.load_project().episode_count, 30)
                if not messagebox.askyesno(
                    "AI 계획 미리보기",
                    f"에피소드 계획 생성: 대본 API 최대 1회\n대상: {count}개 회차",
                    parent=window,
                ):
                    return
                start_long_job(
                    f"plan:{store.load_project().project_id}",
                    lambda: self._long_plan_job(
                        service, store, count, window, show_timeline
                    ),
                )

            def open_episode_workspace(number: int) -> None:
                self._open_project_brief(
                    episode_store=store,
                    episode_number=number,
                    episode_service=service,
                    parent=window,
                    on_episode_complete=show_timeline,
                )
                return
                selected_episode["number"] = number
                episode = store.load_episode(number)
                project = store.load_project()
                workspace = tk.Toplevel(window)
                workspace.title(
                    f"{project.title} — Episode {number:02d} 제작"
                )
                self._fit_window(workspace, 1180, 760, 920, 600)
                workspace.configure(bg=self.BG)
                workspace.transient(window)
                self._window_header(
                    workspace,
                    f"LONG PROJECT  /  EPISODE {number:02d}",
                    episode.title or f"Episode {number}",
                    episode.summary or "Episode 개요를 확인하고 제작을 진행하세요.",
                )
                body = tk.Frame(workspace, bg=self.BG)
                body.pack(fill="both", expand=True, padx=24, pady=18)
                body.columnconfigure(0, weight=2, minsize=260)
                body.columnconfigure(1, weight=5, minsize=520)
                body.rowconfigure(0, weight=1)
                overview = self._card(body, background=self.SURFACE_2)
                overview.grid(row=0, column=0, sticky="nsew", padx=(0, 14))
                mapping_store = ProjectAssetMappingStore(
                    service.projects_root, project.project_id
                )
                candidates = {
                    item.asset_id for item in mapping_store.load_all()
                    if item.candidate_only and item.enabled
                    and item.episode_scope.includes(number)
                }
                tk.Label(
                    overview, text="Episode 제작 상태",
                    bg=self.SURFACE_2, fg=self.TEXT,
                    font=(self.FONT, 11, "bold"),
                ).pack(anchor="w", padx=18, pady=(20, 12))
                tk.Label(
                    overview,
                    text=(
                        f"상위 프로젝트  {project.title}\n"
                        f"Episode  {number:02d}\n"
                        f"현재 상태  {episode.state}\n\n"
                        f"상세 대본  {'생성됨' if episode.script else '미생성'}\n"
                        f"대본 승인  {'완료' if episode.approved else '대기'}\n"
                        f"후보 Asset  {len(candidates)}개\n"
                        f"생성 이미지  {len(episode.generated_images)}/6\n"
                        f"Runway  "
                        f"{'대기' if episode.state == 'waiting_for_video_confirmation' else '미도달'}"
                    ),
                    justify="left", bg=self.SURFACE_2, fg=self.TEXT_SOFT,
                    font=(self.FONT, 9),
                ).pack(anchor="w", padx=18)
                flow = self._card(body, background=self.SURFACE)
                flow.grid(row=0, column=1, sticky="nsew")
                tk.Label(
                    flow, text="Episode 제작 순서", bg=self.SURFACE,
                    fg=self.TEXT, font=(self.FONT, 13, "bold"),
                ).pack(anchor="w", padx=20, pady=(20, 5))
                tk.Label(
                    flow,
                    text=(
                        "개요 확인 → 상세 대본 생성·검토 → 대본 승인 → "
                        "후보 Asset·Mapping → 이미지 생성 → 이미지 승인 → Runway"
                    ),
                    bg=self.SURFACE, fg=self.MUTED, wraplength=650,
                    justify="left", font=(self.FONT, 8),
                ).pack(anchor="w", padx=20, pady=(0, 18))
                action_grid = tk.Frame(flow, bg=self.SURFACE)
                action_grid.pack(fill="x", padx=16)

                def run_and_refresh(command: Callable[[], None]) -> None:
                    selected_episode["number"] = number
                    command()
                    if workspace.winfo_exists():
                        workspace.destroy()

                workspace_actions = (
                    ("Episode 개요 확인", view_outline, self.SURFACE_3),
                    ("상세 대본 생성", generate_script, self.GOLD),
                    ("상세 대본 검토·수정", open_script_editor, self.SURFACE_3),
                    ("상세 대본 승인", approve_script, self.GREEN),
                    ("후보 Asset·Mapping", review_scene_mapping, self.PURPLE),
                    ("이미지 생성", generate_images, self.PURPLE),
                    ("선택 장면 재생성", regenerate_scene, self.ORANGE),
                    ("이미지 6장 승인", approve_images, self.GREEN),
                )
                for index, (text, command, color) in enumerate(workspace_actions):
                    action_grid.columnconfigure(index % 2, weight=1)
                    HoverButton(
                        action_grid, text,
                        lambda command=command: run_and_refresh(command),
                        background=color, hover=self.GOLD,
                        font=(self.FONT, 9, "bold"), padx=12, pady=10,
                    ).grid(
                        row=index // 2, column=index % 2, sticky="ew",
                        padx=5, pady=5,
                    )

                navigation = tk.Frame(workspace, bg="#070D17")
                navigation.pack(fill="x", side="bottom")

                def move(target: int) -> None:
                    active = state.get("active_jobs")
                    if isinstance(active, set) and active and not messagebox.askyesno(
                        "API 작업 진행 중",
                        "실행 중 작업은 취소되지 않습니다. 이동할까요?",
                        parent=workspace,
                    ):
                        return
                    workspace.destroy()
                    open_episode_workspace(target)

                HoverButton(
                    navigation, "장기 프로젝트로 돌아가기", workspace.destroy,
                    background=self.SURFACE_3, hover=self.BORDER,
                    font=(self.FONT, 8, "bold"), padx=14, pady=8,
                ).pack(side="left", padx=18, pady=12)
                if number > 1:
                    HoverButton(
                        navigation, "이전 Episode",
                        lambda: move(number - 1),
                        background=self.SURFACE_3, hover=self.BORDER,
                        font=(self.FONT, 8, "bold"), padx=14, pady=8,
                    ).pack(side="right", padx=5, pady=12)
                if number < project.episode_count:
                    HoverButton(
                        navigation, "다음 Episode",
                        lambda: move(number + 1),
                        background=self.PURPLE, hover="#7048D9",
                        font=(self.FONT, 8, "bold"), padx=14, pady=8,
                    ).pack(side="right", padx=5, pady=12)
                self._fade_in(workspace)

            episode_opener["command"] = open_episode_workspace

            episode_actions = [
                ("＋ 회차 추가", add_episode, self.ORANGE),
                ("복제", duplicate, self.PURPLE),
                ("삭제", delete, self.RED),
                ("AI 시즌 계획 미리보기", generate_plan, self.GOLD),
            ]
            for index, (text, command, color) in enumerate(episode_actions):
                buttons.columnconfigure(index % 4, weight=1)
                HoverButton(
                    buttons, text, command, background=color,
                    hover=self.GOLD_LIGHT, font=(self.FONT, 8, "bold"),
                    padx=10, pady=7,
                ).grid(
                    row=index // 4, column=index % 4,
                    sticky="ew", padx=(0, 6), pady=(0, 6),
                )

        def show_bible() -> None:
            clear_content()
            store = require_store()
            if not store:
                return
            bible = store.load_bible()
            tk.Label(
                content, text="Story Bible", bg=self.BG, fg=self.TEXT,
                font=(self.FONT, 19, "bold"),
            ).pack(anchor="w", padx=26, pady=(22, 10))
            editor = tk.Text(
                content, bg=self.SURFACE, fg=self.TEXT,
                insertbackground=self.GOLD, wrap="none", relief="flat",
                font=("Consolas", 9),
            )
            editor.pack(fill="both", expand=True, padx=26, pady=(0, 10))
            editor.insert("1.0", json.dumps(asdict(bible), ensure_ascii=False, indent=2))

            def save() -> None:
                try:
                    service.save_bible(
                        store, StoryBible(**json.loads(editor.get("1.0", "end")))
                    )
                    self._toast("Story Bible 저장 완료")
                except Exception as exc:
                    messagebox.showerror("저장 실패", str(exc), parent=window)
            def link_style() -> None:
                asset = self._choose_library_asset(
                    window, asset_type="style", title="전체 시각 스타일 선택"
                )
                if asset is None:
                    return
                policy = simpledialog.askstring(
                    "Version 정책",
                    "pinned_version / follow_latest / snapshot",
                    initialvalue="pinned_version", parent=window,
                )
                if policy:
                    service.link_bible_style(
                        store, asset.asset_id,
                        version_policy=policy.strip(),
                    )
                    show_bible()
            HoverButton(
                content, "Story Bible 저장", save, background=self.PURPLE,
                hover="#765DE4", font=(self.FONT, 9, "bold"),
                padx=14, pady=8,
            ).pack(anchor="e", padx=26, pady=(0, 18))
            HoverButton(
                content, "Library 전체 스타일 연결", link_style,
                background=self.PURPLE, hover=self.GOLD,
                font=(self.FONT, 9, "bold"), padx=14, pady=8,
            ).pack(anchor="e", padx=26, pady=(0, 18))

        collection_fields = {
            "characters": (
                ("name", "이름"), ("status", "상태"), ("alive", "생존"),
                ("injured", "부상"), ("reference_id", "Reference"),
                ("last_appearance", "최근 등장"),
            ),
            "locations": (
                ("name", "장소"), ("status", "상태"),
                ("character_ids", "관련 캐릭터"),
                ("episode_ids", "관련 에피소드"),
                ("reference_id", "Reference"),
            ),
            "props": (
                ("name", "소품"), ("status", "상태"),
                ("owner_id", "현재 소유자"), ("location_id", "현재 위치"),
                ("episode_ids", "관련 에피소드"),
                ("reference_id", "Reference"),
            ),
            "secrets": (
                ("name", "비밀/복선"), ("status", "상태"),
                ("planned_reveal_episode", "공개 예정"),
                ("actual_reveal_episode", "실제 공개"),
                ("character_ids", "관련 캐릭터"),
                ("location_ids", "관련 장소"),
                ("event_ids", "관련 사건"),
            ),
            "foreshadowing": (
                ("name", "복선"), ("status", "상태"),
                ("planned_reveal_episode", "회수 예정"),
                ("actual_reveal_episode", "실제 회수"),
                ("character_ids", "관련 캐릭터"),
                ("location_ids", "관련 장소"),
                ("event_ids", "관련 사건"),
            ),
        }

        def show_collection(collection: str) -> None:
            clear_content()
            store = require_store()
            if not store:
                return
            bible = store.load_bible()
            manager = BibleCollectionManager(bible, collection)
            fields = collection_fields[collection]
            id_key = manager.id_key
            title = {
                "characters": "CHARACTER MANAGER",
                "locations": "LOCATION MANAGER",
                "props": "PROP MANAGER",
                "secrets": "SECRET MANAGER",
                "foreshadowing": "FORESHADOW MANAGER",
            }[collection]
            header = tk.Frame(content, bg=self.BG)
            header.pack(fill="x", padx=26, pady=(22, 10))
            tk.Label(
                header, text=title, bg=self.BG, fg=self.TEXT,
                font=(self.FONT, 17, "bold"),
            ).pack(side="left")
            query = tk.StringVar()
            status = tk.StringVar(value="all")
            tk.Entry(
                header, textvariable=query, bg=self.SURFACE_2, fg=self.TEXT,
                insertbackground=self.GOLD, relief="flat", width=22,
            ).pack(side="right", ipady=5)
            ttk.Combobox(
                header, textvariable=status, state="readonly", width=11,
                values=("all", "open", "resolved", "hidden", "planned", "active"),
            ).pack(side="right", padx=6)
            columns = (id_key, *(key for key, _label in fields))
            tree = ttk.Treeview(content, columns=columns, show="headings", height=18)
            tree.heading(id_key, text="ID")
            tree.column(id_key, width=105, stretch=False)
            for key, label in fields:
                tree.heading(key, text=label)
                tree.column(key, width=95)
            tree.pack(fill="both", expand=True, padx=26)
            visible_items: list[dict] = []

            def format_value(value: object) -> str:
                if isinstance(value, list):
                    return ", ".join(str(item) for item in value)
                if isinstance(value, bool):
                    return "Yes" if value else "No"
                return str(value or "")

            def reload_collection(*_args: object) -> None:
                nonlocal visible_items
                candidates = manager.search(query.get()) if query.get() else list(manager.items)
                visible_items = [
                    item for item in candidates
                    if status.get() == "all"
                    or str(item.get("status", "")).lower() == status.get()
                ]
                visible_items.sort(key=lambda item: str(item.get("name", "")).lower())
                tree.delete(*tree.get_children())
                for item in visible_items:
                    tree.insert(
                        "", "end",
                        values=(item.get(id_key, ""), *(
                            format_value(item.get(key)) for key, _label in fields
                        )),
                    )

            def selected_item() -> dict | None:
                selected = tree.selection()
                if not selected:
                    return None
                index = tree.index(selected[0])
                return visible_items[index]

            def edit_item(create: bool = False) -> None:
                item = {} if create else selected_item()
                if item is None:
                    return
                changes: dict[str, object] = {}
                for key, label in fields:
                    initial = format_value(item.get(key))
                    value = simpledialog.askstring(
                        title, label, initialvalue=initial, parent=window,
                    )
                    if value is None:
                        return
                    if key in {"alive", "injured"}:
                        changes[key] = value.strip().lower() in {
                            "yes", "true", "1", "생존", "부상",
                        }
                    elif key.endswith("_ids"):
                        changes[key] = [
                            part.strip() for part in value.split(",") if part.strip()
                        ]
                    elif key.endswith("_episode") and value.strip():
                        changes[key] = int(value)
                    else:
                        changes[key] = value.strip()
                if create:
                    manager.add(changes)
                else:
                    manager.update(str(item[id_key]), changes)
                service.save_bible(store, bible)
                reload_collection()
                self._toast(f"{title} 저장 완료")

            def delete_item() -> None:
                item = selected_item()
                if item and messagebox.askyesno(
                    "항목 삭제", f"{item.get('name', item[id_key])}을 삭제할까요?",
                    parent=window,
                ):
                    manager.delete(str(item[id_key]))
                    service.save_bible(store, bible)
                    reload_collection()

            def preview_reference() -> None:
                item = selected_item()
                if item and item.get("asset_link"):
                    self._open_asset_library()
                else:
                    self._toast("연결된 Library Asset이 없습니다.", kind="warning")

            def link_library_asset() -> None:
                item = selected_item()
                expected = {
                    "characters": "character",
                    "locations": "background",
                    "props": "object",
                }.get(collection)
                if item is None or expected is None:
                    return
                asset = self._choose_library_asset(
                    window, asset_type=expected,
                    title=f"{collection} Library Asset 선택",
                )
                if asset is None:
                    return
                policy = simpledialog.askstring(
                    "Version 정책",
                    "pinned_version / follow_latest / snapshot",
                    initialvalue="pinned_version", parent=window,
                )
                if not policy:
                    return
                episode_text = simpledialog.askstring(
                    "Episode 적용 범위",
                    "all / 단일 번호 / 범위(1-10) / 목록(1,3,8)",
                    initialvalue="all", parent=window,
                )
                if episode_text is None:
                    return
                try:
                    service.link_bible_asset(
                        store, collection, str(item[id_key]),
                        asset.asset_id,
                        version_policy=policy.strip(),
                        episode_scope=parse_scope(
                            episode_text or "all", episode=True
                        ),
                    )
                    reload_collection()
                    self._toast("Story Bible에 Library Asset을 연결했습니다.")
                except (ValueError, ReferenceAssetError) as exc:
                    messagebox.showerror("Asset 연결 실패", str(exc), parent=window)

            def unlink_library_asset() -> None:
                item = selected_item()
                if item is not None:
                    service.unlink_bible_asset(
                        store, collection, str(item[id_key])
                    )
                    reload_collection()

            actions = tk.Frame(content, bg=self.BG)
            actions.pack(fill="x", padx=26, pady=10)
            for text, command, color in (
                ("＋ 추가", lambda: edit_item(True), self.ORANGE),
                ("편집", edit_item, self.PURPLE),
                ("삭제", delete_item, self.RED),
                ("Asset Preview", preview_reference, self.SURFACE_3),
                ("Library Asset 연결", link_library_asset, self.GREEN),
                ("Asset 연결 해제", unlink_library_asset, self.RED),
            ):
                HoverButton(
                    actions, text, command, background=color, hover=self.GOLD,
                    font=(self.FONT, 8, "bold"), padx=12, pady=7,
                ).pack(side="left", padx=(0, 6))
            query.trace_add("write", reload_collection)
            status.trace_add("write", reload_collection)
            reload_collection()

        def show_secret_manager() -> None:
            show_collection("secrets")

        def show_projects() -> None:
            clear_content()
            stores = long_projects()
            tk.Label(
                content, text="장기 프로젝트 전체 보기", bg=self.BG, fg=self.TEXT,
                font=(self.FONT, 19, "bold"),
            ).pack(anchor="w", padx=26, pady=(22, 12))
            tk.Label(
                content,
                text=(
                    f"생성된 장기 프로젝트 {len(stores)}개를 한 화면에서 "
                    "확인하고 선택할 수 있습니다."
                ),
                bg=self.BG, fg=self.MUTED, font=(self.FONT, 8),
            ).pack(anchor="w", padx=26, pady=(0, 14))
            for store in stores:
                try:
                    project = store.load_project()
                    episodes = store.list_episodes()
                except (OSError, TypeError, ValueError):
                    continue
                row = tk.Frame(
                    content, bg=self.SURFACE,
                    highlightbackground=self.BORDER, highlightthickness=1,
                )
                row.pack(fill="x", padx=26, pady=(0, 8))
                completed = sum(
                    item.state == "completed" for item in episodes
                )
                outlines = sum(bool(item.outline) for item in episodes)
                scripts = sum(bool(item.script) for item in episodes)
                images = sum(
                    len(item.generated_images) == 6 for item in episodes
                )
                HoverButton(
                    row,
                    (
                        f"{project.title}\n"
                        f"{project.episode_count}화 · "
                        f"{project.genre or '장르 미정'} · "
                        f"{project.tone or '분위기 미정'}\n"
                        f"개요 {outlines}/{len(episodes)} · "
                        f"대본 {scripts}/{len(episodes)} · "
                        f"이미지 {images}/{len(episodes)} · "
                        f"완료 {completed}/{len(episodes)}"
                    ),
                    lambda value=store: select_store(value),
                    background=self.SURFACE, hover=self.SURFACE_3,
                    foreground=self.TEXT, font=(self.FONT, 9, "bold"),
                    padx=16, pady=11,
                ).pack(side="left", fill="x", expand=True)

                def delete_long(
                    value: LongStoryStore = store,
                    title: str = project.title,
                    project_id: str = project.project_id,
                ) -> None:
                    if not messagebox.askyesno(
                        "장기 프로젝트 삭제",
                        "Story Bible, 모든 Episode, 이미지, Reference와 "
                        "Continuity를 보관함으로 이동합니다.\n\n계속할까요?",
                        parent=window,
                    ):
                        return
                    typed = simpledialog.askstring(
                        "삭제 확인",
                        (
                            "확인을 위해 아래 프로젝트 이름을 입력하세요.\n"
                            "앞뒤 공백과 문장부호 차이는 허용됩니다.\n\n"
                            f"{title}"
                        ),
                        parent=window,
                    )
                    if not project_delete_confirmation_matches(
                        typed, title, project_id
                    ):
                        if typed is not None:
                            messagebox.showwarning(
                                "프로젝트 이름 불일치",
                                "다음 이름을 그대로 입력하세요.\n\n"
                                + title,
                                parent=window,
                            )
                        return
                    try:
                        self.project_lifecycle.archive_project(project_id)
                    except ProjectLifecycleError as exc:
                        messagebox.showerror("삭제 실패", str(exc), parent=window)
                        return
                    if state.get("store") is value:
                        state["store"] = None
                        inspector_text.set("장기 프로젝트를 선택하세요.")
                    self._toast("장기 프로젝트를 복구 가능한 보관함으로 이동했습니다.")
                    show_projects()

                HoverButton(
                    row, "삭제", delete_long,
                    background="#3A1822", hover=self.RED,
                    font=(self.FONT, 8, "bold"), padx=12, pady=11,
                ).pack(side="right")
            if not stores:
                empty = self._card(content, background=self.SURFACE)
                empty.pack(fill="x", padx=26, pady=(0, 10))
                tk.Label(
                    empty,
                    text="아직 생성된 장기 프로젝트가 없습니다.",
                    bg=self.SURFACE, fg=self.MUTED,
                    font=(self.FONT, 9), pady=24,
                ).pack()
            HoverButton(
                content, "＋ 새 장기 프로젝트", new_project,
                background=self.PURPLE, hover="#765DE4",
                font=(self.FONT, 9, "bold"), padx=16, pady=9,
            ).pack(anchor="w", padx=26, pady=10)

        def choose_episode_image_review() -> None:
            store = require_store()
            if store is None:
                return
            episodes = store.list_episodes()
            picker = tk.Toplevel(window)
            picker.title("Episode 이미지 검토 선택")
            self._fit_window(picker, 620, 560, 540, 480)
            picker.configure(bg=self.BG)
            picker.transient(window)
            picker.grab_set()
            self._window_header(
                picker,
                "IMAGE REVIEW  /  EPISODE SELECT",
                "검토할 Episode 선택",
                "현재 장기 프로젝트에서 이미지가 생성된 Episode를 선택하세요.",
            )
            listing = tk.Listbox(
                picker, bg=self.SURFACE, fg=self.TEXT,
                selectbackground=self.PURPLE, relief="flat",
                font=(self.FONT, 9), activestyle="none",
            )
            listing.pack(fill="both", expand=True, padx=22, pady=16)
            visible_episodes = []
            for episode in episodes:
                image_count = sum(
                    Path(path).is_file() for path in episode.generated_images
                )
                approved_count = len(episode.approved_scene_numbers)
                visible_episodes.append(episode)
                listing.insert(
                    "end",
                    f"Episode {episode.number:02d} · "
                    f"{episode.title or '제목 없음'}\n"
                    f"    이미지 {image_count}/6 · 승인 {approved_count}/6 · "
                    f"{episode.state}",
                )
            if not visible_episodes:
                listing.insert("end", "현재 프로젝트에 Episode가 없습니다.")
                listing.configure(state="disabled")
            status_value = tk.StringVar(
                value="이미지 1장 이상 생성된 Episode만 검토할 수 있습니다."
            )
            tk.Label(
                picker, textvariable=status_value, bg=self.BG, fg=self.MUTED,
                font=(self.FONT, 8),
            ).pack(anchor="w", padx=22, pady=(0, 8))

            def open_selected(
                _event: tk.Event[tk.Misc] | None = None,
            ) -> None:
                selection = listing.curselection()
                if not selection or not visible_episodes:
                    return
                episode = visible_episodes[selection[0]]
                valid_images = sum(
                    Path(path).is_file() for path in episode.generated_images
                )
                if valid_images == 0:
                    status_value.set(
                        f"Episode {episode.number:02d}에는 검토할 이미지가 없습니다."
                    )
                    self._toast(
                        "먼저 Episode Wizard에서 이미지를 생성하세요.",
                        kind="warning",
                    )
                    return
                if episode.state not in {
                    "images_review", "waiting_for_video_confirmation"
                }:
                    status_value.set(
                        f"현재 상태({episode.state})에서는 이미지 검토를 열 수 없습니다."
                    )
                    return
                picker.destroy()
                self._open_result_viewer(
                    episode_store=store,
                    episode_service=service,
                    episode_number=episode.number,
                    on_close=show_timeline,
                )

            listing.bind("<Double-Button-1>", open_selected)
            actions = tk.Frame(picker, bg=self.BG)
            actions.pack(fill="x", padx=18, pady=(0, 18))
            HoverButton(
                actions, "취소", picker.destroy,
                background=self.SURFACE_3, hover=self.BORDER,
                font=(self.FONT, 8, "bold"), padx=14, pady=8,
            ).pack(side="right", padx=4)
            HoverButton(
                actions, "선택 Episode 검토", open_selected,
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 8, "bold"), padx=14, pady=8,
            ).pack(side="right", padx=4)
            self._fade_in(picker)

        workspace_navigation = [
            ("▤   장기 프로젝트 전체 보기", show_projects),
            ("⌂   대시보드", show_dashboard),
            ("▦   Episode 목록", show_timeline),
            ("▧   Episode 이미지 검토", choose_episode_image_review),
        ]
        if self.advanced_mode:
            workspace_navigation.extend([
                ("▤   Story Bible · 고급", show_bible),
                ("Characters · 고급", lambda: show_collection("characters")),
                ("Locations · 고급", lambda: show_collection("locations")),
                ("Props · 고급", lambda: show_collection("props")),
                ("Secrets · 고급", show_secret_manager),
                (
                    "Foreshadowing · 고급",
                    lambda: show_collection("foreshadowing"),
                ),
            ])
        tk.Label(
            sidebar, text="WORKSPACE", bg="#09111D", fg=self.MUTED,
            font=("Segoe UI", 7),
        ).pack(anchor="w", padx=18, pady=(0, 5))
        for text, command in workspace_navigation:
            HoverButton(
                sidebar, text, command, background="#09111D",
                hover=self.SURFACE_3, foreground=self.TEXT_SOFT,
                font=(self.FONT, 8), padx=12, pady=8,
            ).pack(fill="x", padx=10, pady=1)
        tk.Frame(sidebar, bg=self.BORDER_SOFT, height=1).pack(
            fill="x", padx=16, pady=12
        )
        tk.Label(
            sidebar, text="SYSTEM", bg="#09111D", fg=self.MUTED,
            font=("Segoe UI", 7),
        ).pack(anchor="w", padx=18, pady=(0, 5))
        HoverButton(
            sidebar, "⚙   설정", self._show_settings,
            background="#09111D", hover=self.SURFACE_3,
            foreground=self.TEXT_SOFT, font=(self.FONT, 8),
            padx=12, pady=8,
        ).pack(fill="x", padx=10, pady=1)
        tk.Label(
            sidebar,
            text="●  프로덕션 시스템 정상",
            bg="#09111D",
            fg=self.GREEN,
            font=(self.FONT, 7, "bold"),
        ).pack(side="bottom", anchor="w", padx=18, pady=18)
        HoverButton(
            inspector, "＋ 새 장기 프로젝트", new_project,
            background=self.PURPLE, hover="#7048D9",
            foreground=self.TEXT, font=(self.FONT, 9, "bold"),
            padx=16, pady=10,
        ).pack(side="bottom", fill="x", padx=18, pady=20)

        show_projects()
        self._fade_in(window)

    def _long_script_job(
        self,
        service: LongStoryService,
        store: LongStoryStore,
        number: int,
        window: tk.Toplevel,
        refresh: Callable[[], None],
        *,
        regenerate: bool = False,
    ) -> None:
        try:
            service.generate_episode_script(
                store, number, regenerate=regenerate
            )
            self.after(0, lambda: self._toast(f"Episode {number} 대본 검토 준비 완료"))
            self.after(0, refresh)
        except Exception as exc:
            self.after(
                0, lambda error=exc: messagebox.showerror(
                    "회차 대본 생성 실패", str(error), parent=window
                )
            )

    def _long_image_job(
        self,
        service: LongStoryService,
        store: LongStoryStore,
        number: int,
        window: tk.Toplevel,
        refresh: Callable[[], None],
    ) -> None:
        try:
            service.generate_episode_images(store, number)
            self.after(
                0, lambda: self._toast(
                    f"Episode {number} 이미지 생성 완료 · 사용자 승인 대기"
                )
            )
            self.after(0, refresh)
        except Exception as exc:
            self.after(
                0, lambda error=exc: messagebox.showerror(
                    "회차 이미지 생성 실패", str(error), parent=window
                )
            )

    def _long_regenerate_job(
        self,
        service: LongStoryService,
        store: LongStoryStore,
        number: int,
        scene: int,
        window: tk.Toplevel,
        refresh: Callable[[], None],
    ) -> None:
        try:
            service.regenerate_episode_scene(store, number, scene)
            self.after(
                0,
                lambda: self._toast(
                    f"Episode {number} · Scene {scene} 교체 완료 · 승인 초기화"
                ),
            )
            self.after(0, refresh)
        except Exception as exc:
            self.after(
                0,
                lambda error=exc: messagebox.showerror(
                    "장면 재생성 실패", str(error), parent=window
                ),
            )

    def _long_plan_job(
        self,
        service: LongStoryService,
        store: LongStoryStore,
        count: int,
        window: tk.Toplevel,
        refresh: Callable[[], None],
    ) -> None:
        try:
            preview = service.generate_plan_preview(store, count=count)

            def review() -> None:
                summary = "\n".join(
                    f"{item.number}화 · {item.title} · {item.summary}"
                    for item in preview[:10]
                )
                if len(preview) > 10:
                    summary += f"\n… 외 {len(preview) - 10}개 회차"
                if messagebox.askyesno(
                    "AI 계획 미리보기",
                    summary + "\n\n이 계획을 승인하고 저장할까요?",
                    parent=window,
                ):
                    service.approve_plan(store, preview)
                    self._toast("AI 에피소드 계획 승인·저장 완료")
                    refresh()

            self.after(0, review)
        except Exception as exc:
            self.after(
                0, lambda error=exc: messagebox.showerror(
                    "계획 생성 실패", str(error), parent=window
                )
            )

    def _open_project_image_gallery(self) -> None:
        """Show generated short-project images grouped by their project."""
        data = self.data_loader(self.config_data)
        projects = [
            project for project in data.projects
            if any(Path(path).is_file() for path in project.generated_images)
        ]
        gallery_window = tk.Toplevel(self)
        gallery_window.title("PRISM FORGE — 생성 이미지 모음")
        self._fit_window(gallery_window, 1120, 760, 760, 520)
        gallery_window.configure(bg=self.BG)
        gallery_window.transient(self)
        gallery_window.grab_set()
        self._window_header(
            gallery_window,
            "PROJECT IMAGE GALLERY",
            "생성 이미지 모음",
            "생성된 이미지를 단기 프로젝트별로 모아 보여줍니다.",
        )

        footer = tk.Frame(gallery_window, bg=self.BG)
        footer.pack(side="bottom", fill="x", padx=20, pady=(4, 14))
        count_text = (
            f"프로젝트 {len(projects)}개  ·  "
            f"이미지 {sum(sum(Path(path).is_file() for path in item.generated_images) for item in projects)}장"
        )
        tk.Label(
            footer, text=count_text, bg=self.BG, fg=self.MUTED,
            font=(self.FONT, 8),
        ).pack(side="left")
        HoverButton(
            footer, "닫기", gallery_window.destroy,
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 8, "bold"), padx=14, pady=8,
        ).pack(side="right")

        shell = tk.Frame(gallery_window, bg=self.BG)
        shell.pack(fill="both", expand=True, padx=20, pady=(14, 4))
        canvas = tk.Canvas(shell, bg=self.BG, highlightthickness=0)
        scrollbar = ttk.Scrollbar(
            shell, orient="vertical", command=canvas.yview
        )
        content = tk.Frame(canvas, bg=self.BG)
        content_window = canvas.create_window(
            (0, 0), window=content, anchor="nw"
        )
        content.bind(
            "<Configure>",
            lambda _event: canvas.configure(
                scrollregion=canvas.bbox("all")
            ),
        )
        canvas.bind(
            "<Configure>",
            lambda event: canvas.itemconfigure(
                content_window, width=event.width
            ),
        )
        canvas.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)
        self._bind_scroll_canvas(canvas)
        gallery_photos: list[tk.PhotoImage] = []

        def clear_content() -> None:
            """Reset the current gallery page and its image references."""
            for child in content.winfo_children():
                child.destroy()
            gallery_photos.clear()
            canvas.yview_moveto(0)

        def show_project_detail(project: ProjectContext) -> None:
            """Load thumbnails only after the user selects a project."""
            clear_content()
            title = str(project.story.get("title") or project.topic)
            existing = [
                Path(path) for path in project.generated_images
                if Path(path).is_file()
            ]

            toolbar = tk.Frame(content, bg=self.BG)
            toolbar.pack(fill="x", pady=(0, 12))
            HoverButton(
                toolbar, "← 프로젝트 목록",
                show_project_list,
                background=self.SURFACE_3, hover=self.BORDER,
                font=(self.FONT, 8, "bold"), padx=12, pady=7,
            ).pack(side="left")
            tk.Label(
                toolbar,
                text=f"선택한 프로젝트  /  이미지 {len(existing)}장",
                bg=self.BG, fg=self.GOLD,
                font=(self.FONT, 8, "bold"),
            ).pack(side="right", pady=8)

            project_card = self._card(content)
            project_card.pack(fill="both", expand=True, pady=(0, 14))
            project_card.columnconfigure(1, weight=1)
            project_card.rowconfigure(0, weight=1)

            info = tk.Frame(project_card, bg=self.SURFACE, width=230)
            info.grid(row=0, column=0, sticky="nsw", padx=18, pady=18)
            tk.Label(
                info, text=title, bg=self.SURFACE, fg=self.TEXT,
                font=(self.FONT, 11, "bold"), justify="left",
                anchor="w", wraplength=205,
            ).pack(fill="x", anchor="w")
            tk.Label(
                info,
                text=(
                    f"이미지 {len(existing)}/6\n"
                    f"상태  {project.workflow_state.value}\n"
                    f"최근 수정  {project.updated_at[:10]}"
                ),
                bg=self.SURFACE, fg=self.TEXT_SOFT,
                font=(self.FONT, 8), justify="left",
            ).pack(fill="x", anchor="w", pady=(10, 14))
            HoverButton(
                info, "이미지 검토",
                lambda value=project: (
                    gallery_window.destroy(),
                    self._open_result_viewer(value),
                ),
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 8, "bold"), padx=12, pady=7,
            ).pack(fill="x", pady=(0, 6))
            HoverButton(
                info, "이미지 폴더 열기",
                lambda value=project: open_local_path(
                    self.config_data.project_root
                    / "learning_data" / "projects"
                    / value.project_directory_name / "images"
                ),
                background=self.SURFACE_3, hover=self.BORDER,
                font=(self.FONT, 8, "bold"), padx=12, pady=7,
            ).pack(fill="x")

            thumbnails = tk.Frame(project_card, bg=self.SURFACE_2)
            thumbnails.grid(
                row=0, column=1, sticky="nsew", padx=(0, 18), pady=18
            )
            for column in range(3):
                thumbnails.columnconfigure(column, weight=1, uniform="thumb")
            for row in range(2):
                thumbnails.rowconfigure(row, weight=1, uniform="thumb")
            for index in range(6):
                tile = tk.Frame(
                    thumbnails, bg="#090E16",
                    highlightbackground=self.BORDER_SOFT,
                    highlightthickness=1,
                )
                tile.grid(
                    row=index // 3, column=index % 3, sticky="nsew",
                    padx=4, pady=4,
                )
                path = (
                    Path(project.generated_images[index])
                    if index < len(project.generated_images) else None
                )
                preview = tk.Canvas(
                    tile, bg="#090E16", highlightthickness=0,
                    width=180, height=145,
                )
                preview.pack(fill="both", expand=True, padx=5, pady=(5, 0))
                preview.create_text(
                    90, 72, text=f"SCENE {index + 1:02d}",
                    fill=self.MUTED, font=("Consolas", 8, "bold"),
                    tags=("empty",),
                )
                if path is not None and path.is_file():
                    try:
                        photo = tk.PhotoImage(file=str(path))
                        scale = max(
                            1,
                            (photo.width() + 179) // 180,
                            (photo.height() + 139) // 140,
                        )
                        photo = photo.subsample(scale, scale)
                        preview.delete("empty")
                        preview.create_image(
                            90, 72, image=photo, tags=("thumbnail",)
                        )
                        preview.bind(
                            "<Configure>",
                            lambda event, widget=preview: widget.coords(
                                "thumbnail", event.width // 2, event.height // 2
                            ),
                        )
                        gallery_photos.append(photo)
                    except (tk.TclError, OSError):
                        pass
                tk.Label(
                    tile, text=f"Scene {index + 1}",
                    bg="#090E16", fg=self.TEXT_SOFT,
                    font=(self.FONT, 7),
                ).pack(pady=(3, 5))

        def show_project_list() -> None:
            """Show project folders without eagerly loading scene images."""
            clear_content()
            tk.Label(
                content,
                text="프로젝트를 선택하면 해당 프로젝트의 이미지만 표시됩니다.",
                bg=self.BG, fg=self.TEXT_SOFT,
                font=(self.FONT, 9), anchor="w",
            ).pack(fill="x", pady=(0, 12))

            if not projects:
                empty = self._card(content)
                empty.pack(fill="x", pady=8)
                tk.Label(
                    empty,
                    text="아직 생성된 프로젝트 이미지가 없습니다.",
                    bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 12, "bold"),
                ).pack(pady=(40, 8))
                tk.Label(
                    empty,
                    text="이미지 생성이 완료되면 이곳에 프로젝트별로 표시됩니다.",
                    bg=self.SURFACE, fg=self.MUTED,
                    font=(self.FONT, 9),
                ).pack(pady=(0, 40))
                return

            for project in projects:
                existing = [
                    Path(path) for path in project.generated_images
                    if Path(path).is_file()
                ]
                title = str(project.story.get("title") or project.topic)
                project_card = self._card(content)
                project_card.pack(fill="x", pady=(0, 10))
                project_card.columnconfigure(0, weight=1)

                summary = tk.Frame(project_card, bg=self.SURFACE)
                summary.grid(row=0, column=0, sticky="nsew", padx=18, pady=16)
                tk.Label(
                    summary, text=title,
                    bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 11, "bold"),
                    justify="left", anchor="w", wraplength=620,
                ).pack(fill="x")
                tk.Label(
                    summary,
                    text=(
                        f"이미지 {len(existing)}/6   ·   "
                        f"{project.workflow_state.value}   ·   "
                        f"최근 수정 {project.updated_at[:10]}"
                    ),
                    bg=self.SURFACE, fg=self.TEXT_SOFT,
                    font=(self.FONT, 8), anchor="w",
                ).pack(fill="x", pady=(7, 0))
                HoverButton(
                    project_card, "프로젝트 이미지 보기  →",
                    lambda value=project: show_project_detail(value),
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=16, pady=10,
                ).grid(row=0, column=1, sticky="e", padx=18, pady=16)

        gallery_window._gallery_photos = gallery_photos  # type: ignore[attr-defined]
        show_project_list()
        self._fade_in(gallery_window)

    def _open_project_video_gallery(self) -> None:
        """Show saved Runway and final videos grouped by short project."""
        data = self.data_loader(self.config_data)
        projects = [
            project for project in data.projects
            if any(
                path and Path(path).is_file()
                for path in project.generated_video_paths
            )
            or (
                self.config_data.project_root
                / "learning_data" / "projects"
                / project.project_directory_name
                / "videos" / "final" / "instagram_reel.mp4"
            ).is_file()
        ]
        window = tk.Toplevel(self)
        window.title("PRISM FORGE — 생성 영상 모음")
        self._fit_window(window, 1080, 740, 760, 520)
        window.configure(bg=self.BG)
        window.transient(self)
        window.grab_set()
        self._window_header(
            window,
            "PROJECT VIDEO GALLERY",
            "생성 영상 모음",
            "프로젝트를 선택해 장면별 Runway 영상과 최종 병합 영상을 확인합니다.",
        )

        footer = tk.Frame(window, bg=self.BG)
        footer.pack(side="bottom", fill="x", padx=20, pady=(4, 14))
        total_clips = sum(
            sum(
                bool(path) and Path(path).is_file()
                for path in project.generated_video_paths
            )
            for project in projects
        )
        tk.Label(
            footer,
            text=f"프로젝트 {len(projects)}개  ·  장면 영상 {total_clips}개",
            bg=self.BG, fg=self.MUTED, font=(self.FONT, 8),
        ).pack(side="left")
        HoverButton(
            footer, "닫기", window.destroy,
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 8, "bold"), padx=14, pady=8,
        ).pack(side="right")

        shell = tk.Frame(window, bg=self.BG)
        shell.pack(fill="both", expand=True, padx=20, pady=(14, 4))
        canvas = tk.Canvas(shell, bg=self.BG, highlightthickness=0)
        scrollbar = ttk.Scrollbar(shell, orient="vertical", command=canvas.yview)
        content = tk.Frame(canvas, bg=self.BG)
        content_window = canvas.create_window((0, 0), window=content, anchor="nw")
        content.bind(
            "<Configure>",
            lambda _event: canvas.configure(scrollregion=canvas.bbox("all")),
        )
        canvas.bind(
            "<Configure>",
            lambda event: canvas.itemconfigure(content_window, width=event.width),
        )
        canvas.configure(yscrollcommand=scrollbar.set)
        scrollbar.pack(side="right", fill="y")
        canvas.pack(side="left", fill="both", expand=True)
        self._bind_scroll_canvas(canvas)

        def clear_content() -> None:
            for child in content.winfo_children():
                child.destroy()
            canvas.yview_moveto(0)

        def project_video_root(project: ProjectContext) -> Path:
            return (
                self.config_data.project_root
                / "learning_data" / "projects"
                / project.project_directory_name / "videos"
            )

        def show_project_detail(project: ProjectContext) -> None:
            clear_content()
            title = str(project.story.get("title") or project.topic)
            root = project_video_root(project)
            clips = [
                Path(path) if path else root / "runway" / f"scene{number}.mp4"
                for number, path in enumerate(
                    list(project.generated_video_paths)[:6], start=1
                )
            ]
            while len(clips) < 6:
                clips.append(root / "runway" / f"scene{len(clips) + 1}.mp4")
            final_path = root / "final" / "instagram_reel.mp4"

            toolbar = tk.Frame(content, bg=self.BG)
            toolbar.pack(fill="x", pady=(0, 12))
            HoverButton(
                toolbar, "← 프로젝트 목록", show_project_list,
                background=self.SURFACE_3, hover=self.BORDER,
                font=(self.FONT, 8, "bold"), padx=12, pady=7,
            ).pack(side="left")
            HoverButton(
                toolbar, "전체 영상 재생성",
                lambda value=project: (
                    window.destroy(),
                    self._open_runway_confirmation(value, force_all=True),
                ),
                background="#6B2432", hover="#96384B",
                font=(self.FONT, 8, "bold"), padx=12, pady=7,
            ).pack(side="right")
            tk.Label(
                toolbar, text=title, bg=self.BG, fg=self.GOLD,
                font=(self.FONT, 9, "bold"), anchor="e",
            ).pack(side="right", fill="x", expand=True, padx=12)

            for number, clip in enumerate(clips, start=1):
                card = self._card(content)
                card.pack(fill="x", pady=(0, 8))
                card.columnconfigure(1, weight=1)
                exists = clip.is_file()
                tk.Label(
                    card, text=f"Scene {number:02d}",
                    bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 10, "bold"), width=11, anchor="w",
                ).grid(row=0, column=0, rowspan=2, sticky="nsw", padx=16, pady=14)
                tk.Label(
                    card,
                    text=(clip.name if exists else "생성된 영상 없음"),
                    bg=self.SURFACE,
                    fg=self.GREEN if exists else self.MUTED,
                    font=(self.FONT, 8, "bold"), anchor="w",
                ).grid(row=0, column=1, sticky="ew", pady=(13, 2))
                tk.Label(
                    card, text=str(clip.parent), bg=self.SURFACE,
                    fg=self.MUTED, font=("Consolas", 7), anchor="w",
                    wraplength=520, justify="left",
                ).grid(row=1, column=1, sticky="ew", pady=(0, 12))
                button = HoverButton(
                    card, "영상 재생",
                    lambda value=clip: open_local_path(value),
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=14, pady=8,
                )
                button.grid(row=0, column=2, rowspan=2, padx=16, pady=12)
                if not exists:
                    button.configure(state="disabled")

            final_card = self._card(content)
            final_card.pack(fill="x", pady=(8, 12))
            tk.Label(
                final_card, text="최종 병합 영상",
                bg=self.SURFACE, fg=self.TEXT,
                font=(self.FONT, 11, "bold"), anchor="w",
            ).pack(side="left", padx=16, pady=16)
            final_button = HoverButton(
                final_card,
                "Instagram Reels MP4 재생" if final_path.is_file() else "아직 병합되지 않음",
                lambda: open_local_path(final_path),
                background=self.PURPLE, hover="#7048D9",
                font=(self.FONT, 8, "bold"), padx=14, pady=8,
            )
            final_button.pack(side="right", padx=8, pady=12)
            if not final_path.is_file():
                final_button.configure(state="disabled")
            HoverButton(
                final_card, "영상 폴더 열기",
                lambda: open_local_path(root),
                background=self.SURFACE_3, hover=self.BORDER,
                font=(self.FONT, 8, "bold"), padx=14, pady=8,
            ).pack(side="right", padx=8, pady=12)
            HoverButton(
                final_card, "영상 검토",
                lambda value=project: (window.destroy(), self._open_video_review(value)),
                background="#176344", hover="#20845B",
                font=(self.FONT, 8, "bold"), padx=14, pady=8,
            ).pack(side="right", padx=8, pady=12)

        def show_project_list() -> None:
            clear_content()
            tk.Label(
                content,
                text="프로젝트를 선택하면 해당 프로젝트의 영상만 표시됩니다.",
                bg=self.BG, fg=self.TEXT_SOFT,
                font=(self.FONT, 9), anchor="w",
            ).pack(fill="x", pady=(0, 12))
            if not projects:
                empty = self._card(content)
                empty.pack(fill="x", pady=8)
                tk.Label(
                    empty, text="아직 생성된 프로젝트 영상이 없습니다.",
                    bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 12, "bold"),
                ).pack(pady=(40, 8))
                tk.Label(
                    empty,
                    text="Runway 영상 생성이 완료되면 이곳에 프로젝트별로 표시됩니다.",
                    bg=self.SURFACE, fg=self.MUTED,
                    font=(self.FONT, 9),
                ).pack(pady=(0, 40))
                return
            for project in projects:
                clip_count = sum(
                    bool(path) and Path(path).is_file()
                    for path in project.generated_video_paths
                )
                final_exists = (
                    project_video_root(project)
                    / "final" / "instagram_reel.mp4"
                ).is_file()
                title = str(project.story.get("title") or project.topic)
                card = self._card(content)
                card.pack(fill="x", pady=(0, 10))
                card.columnconfigure(0, weight=1)
                summary = tk.Frame(card, bg=self.SURFACE)
                summary.grid(row=0, column=0, sticky="nsew", padx=18, pady=16)
                tk.Label(
                    summary, text=title, bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 11, "bold"), anchor="w",
                    wraplength=620, justify="left",
                ).pack(fill="x")
                tk.Label(
                    summary,
                    text=(
                        f"장면 영상 {clip_count}/6   ·   "
                        f"최종 영상 {'완료' if final_exists else '미완료'}   ·   "
                        f"{project.workflow_state.value}"
                    ),
                    bg=self.SURFACE, fg=self.TEXT_SOFT,
                    font=(self.FONT, 8), anchor="w",
                ).pack(fill="x", pady=(7, 0))
                HoverButton(
                    card, "프로젝트 영상 보기  →",
                    lambda value=project: show_project_detail(value),
                    background=self.PURPLE, hover="#7048D9",
                    font=(self.FONT, 8, "bold"), padx=16, pady=10,
                ).grid(row=0, column=1, sticky="e", padx=18, pady=16)

        show_project_list()
        self._fade_in(window)

    def _choose_short_video_generation(self) -> None:
        """Open the existing Runway confirmation, progress, or review stage."""
        self.dashboard_data = load_dashboard_data(self.config_data)
        projects = [
            project for project in self.dashboard_data.projects
            if project.project_type == "short_project"
        ]
        picker = tk.Toplevel(self)
        picker.title("PRISM FORGE — 영상 생성·진행")
        self._fit_window(picker, 760, 620, 620, 500)
        picker.configure(bg=self.BG)
        picker.transient(self)
        picker.grab_set()
        self._window_header(
            picker,
            "RUNWAY VIDEO  /  PROJECT SELECT",
            "영상 생성·진행",
            (
                "이미지 검토를 마친 프로젝트의 Runway 프롬프트·비용을 "
                "확인하거나, 생성 진행 상태와 영상 검토 화면으로 다시 "
                "들어갑니다. 프로젝트 선택만으로는 API를 호출하지 않습니다."
            ),
        )
        listing = tk.Listbox(
            picker,
            bg=self.SURFACE,
            fg=self.TEXT,
            selectbackground=self.PURPLE,
            relief="flat",
            font=(self.FONT, 9),
            activestyle="none",
            exportselection=False,
        )
        listing.pack(fill="both", expand=True, padx=22, pady=16)
        rows: list[ProjectContext] = []
        for project in projects:
            image_count = sum(
                Path(path).is_file() for path in project.generated_images
            )
            video_count = sum(
                Path(path).is_file() for path in project.generated_video_paths
            )
            rows.append(project)
            listing.insert(
                "end",
                f"{project.topic}\n"
                f"    이미지 {image_count}/6 · 영상 {video_count}/6 · "
                f"{project.workflow_state.value} · {project.updated_at[:10]}",
            )
        if not rows:
            listing.insert("end", "저장된 단기 프로젝트가 없습니다.")
            listing.configure(state="disabled")
        status_value = tk.StringVar(
            value=(
                "프로젝트를 선택하면 현재 영상 단계에 맞는 화면을 엽니다."
                if rows else "먼저 단기 프로젝트를 생성하세요."
            )
        )
        tk.Label(
            picker, textvariable=status_value, bg=self.BG, fg=self.MUTED,
            font=(self.FONT, 8),
        ).pack(anchor="w", padx=22, pady=(0, 8))

        def open_stage(_event: tk.Event[tk.Misc] | None = None) -> None:
            selection = listing.curselection()
            if not selection or not rows:
                status_value.set("영상 작업을 확인할 프로젝트를 선택하세요.")
                return
            project = rows[selection[0]]
            state = project.workflow_state
            if state in {
                WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
                WorkflowState.INTERRUPTED,
            }:
                picker.destroy()
                self._open_runway_confirmation(project)
                return
            if state == WorkflowState.GENERATING_VIDEOS:
                picker.destroy()
                self._reopen_runway_progress(project)
                return
            if state in {
                WorkflowState.VIDEOS_READY,
                WorkflowState.REVIEWING_VIDEOS,
                WorkflowState.VIDEOS_APPROVED,
                WorkflowState.RENDERING,
                WorkflowState.COMPLETED,
            }:
                picker.destroy()
                self._open_video_review(project)
                return
            if state in {
                WorkflowState.IMAGES_READY,
                WorkflowState.IMAGES_REVIEW,
            }:
                status_value.set(
                    "영상 생성 전에 이미지 6장을 검토하고 사용 확정하세요."
                )
                self._toast("먼저 이미지 검토를 완료하세요.", kind="warning")
                return
            status_value.set(
                "이 프로젝트는 대본·이미지 생성 단계를 먼저 완료해야 합니다."
            )
            self._toast("아직 영상 생성 단계가 아닙니다.", kind="warning")

        listing.bind("<Double-Button-1>", open_stage)
        actions = tk.Frame(
            picker, name="video_project_picker_action_bar", bg=self.BG
        )
        actions.pack(
            side="bottom", fill="x", padx=18, pady=(0, 18), before=listing
        )
        HoverButton(
            actions, "닫기", picker.destroy,
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 8, "bold"), padx=14, pady=8,
        ).pack(side="right", padx=4)
        HoverButton(
            actions, "현재 영상 단계 열기", open_stage,
            background=self.PURPLE, hover="#765DE4",
            font=(self.FONT, 8, "bold"), padx=16, pady=8,
        ).pack(side="right", padx=4)
        self._fade_in(picker)

    def _choose_short_image_generation(self) -> None:
        """Select a short project and continue its existing image workflow."""
        self.dashboard_data = load_dashboard_data(self.config_data)
        projects = [
            project for project in self.dashboard_data.projects
            if project.project_type == "short_project"
        ]
        picker = tk.Toplevel(self)
        picker.title("PRISM FORGE — 이미지 생성")
        self._fit_window(picker, 720, 600, 600, 500)
        picker.configure(bg=self.BG)
        picker.transient(self)
        picker.grab_set()
        self._window_header(
            picker,
            "IMAGE GENERATION  /  PROJECT SELECT",
            "이미지를 생성할 단기 프로젝트 선택",
            (
                "프로젝트를 선택하면 기존 Candidate 전달 확인과 이미지 "
                "생성 단계로 이어집니다. 이 창을 여는 것만으로는 API를 "
                "호출하지 않습니다."
            ),
        )
        listing = tk.Listbox(
            picker,
            bg=self.SURFACE,
            fg=self.TEXT,
            selectbackground=self.PURPLE,
            relief="flat",
            font=(self.FONT, 9),
            activestyle="none",
        )
        listing.pack(fill="both", expand=True, padx=22, pady=16)
        rows: list[ProjectContext] = []
        for project in projects:
            image_count = sum(
                Path(path).is_file() for path in project.generated_images
            )
            rows.append(project)
            listing.insert(
                "end",
                f"{project.topic}\n"
                f"    이미지 {image_count}/6 · {project.workflow_state.value} · "
                f"최근 수정 {project.updated_at[:10]}",
            )
        if not rows:
            listing.insert("end", "저장된 단기 프로젝트가 없습니다.")
            listing.configure(state="disabled")

        status_value = tk.StringVar(
            value=(
                "프로젝트를 선택한 뒤 아래 버튼을 누르세요."
                if rows else "먼저 단기 프로젝트를 생성하세요."
            )
        )
        tk.Label(
            picker, textvariable=status_value, bg=self.BG, fg=self.MUTED,
            font=(self.FONT, 8),
        ).pack(anchor="w", padx=22, pady=(0, 8))

        def continue_selected(
            _event: tk.Event[tk.Misc] | None = None,
        ) -> None:
            selection = listing.curselection()
            if not selection or not rows:
                status_value.set("이미지를 생성할 프로젝트를 선택하세요.")
                return
            project = rows[selection[0]]
            state = project.workflow_state
            if state == WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW:
                picker.destroy()
                self._confirm_short_automatic_references(project)
                return
            if state == WorkflowState.ASSET_MAPPING_APPROVED:
                picker.destroy()
                self._start_short_image_generation(project)
                return
            if state == WorkflowState.GENERATING_IMAGES:
                picker.destroy()
                if (
                    self._generation_progress_window is not None
                    and self._generation_progress_window.winfo_exists()
                ):
                    self._generation_progress_window.deiconify()
                    self._generation_progress_window.lift()
                else:
                    self._toast(
                        "이미지 생성 작업 상태를 복구 중입니다.",
                        kind="warning",
                    )
                return
            if any(Path(path).is_file() for path in project.generated_images):
                picker.destroy()
                self._open_result_viewer(project)
                return
            status_value.set(
                "이 프로젝트는 먼저 대본 생성과 Character 전달 확인이 필요합니다."
            )
            self._toast(
                "단기 프로젝트를 열어 앞 단계를 완료하세요.", kind="warning"
            )

        listing.bind("<Double-Button-1>", continue_selected)
        actions = tk.Frame(
            picker, name="image_project_picker_action_bar", bg=self.BG
        )
        actions.pack(
            side="bottom", fill="x", padx=18, pady=(0, 18), before=listing
        )
        HoverButton(
            actions, "닫기", picker.destroy,
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 8, "bold"), padx=14, pady=8,
        ).pack(side="right", padx=4)
        HoverButton(
            actions, "선택 프로젝트 계속", continue_selected,
            background=self.PURPLE, hover="#765DE4",
            font=(self.FONT, 8, "bold"), padx=16, pady=8,
        ).pack(side="right", padx=4)
        self._fade_in(picker)

    def _choose_short_image_review(self) -> None:
        """Let the user select a short project before opening Image Review."""
        self.dashboard_data = load_dashboard_data(self.config_data)
        projects = [
            project
            for project in self.dashboard_data.projects
            if project.project_type == "short_project"
        ]

        picker = tk.Toplevel(self)
        picker.title("PRISM FORGE — 단기 프로젝트 이미지 검토")
        self._fit_window(picker, 680, 580, 580, 500)
        picker.configure(bg=self.BG)
        picker.transient(self)
        picker.grab_set()
        self._window_header(
            picker,
            "IMAGE REVIEW  /  SHORT PROJECT SELECT",
            "검토할 단기 프로젝트 선택",
            "프로젝트를 선택하면 기존 Image Review Workspace에서 "
            "해당 프로젝트의 이미지만 엽니다.",
        )

        listing = tk.Listbox(
            picker,
            bg=self.SURFACE,
            fg=self.TEXT,
            selectbackground=self.PURPLE,
            relief="flat",
            font=(self.FONT, 9),
            activestyle="none",
        )
        listing.pack(fill="both", expand=True, padx=22, pady=16)

        projects_root = (
            self.config_data.project_root / "learning_data" / "projects"
        )
        project_rows: list[tuple[ProjectContext, int]] = []
        for project in projects:
            image_count = sum(
                Path(path).is_file() for path in project.generated_images
            )
            try:
                reviews = GeneratedImageManager(
                    projects_root / project.project_directory_name
                ).load_all()
                approved_count = sum(
                    review.status == "approved" for review in reviews
                )
            except (OSError, ValueError):
                approved_count = sum(
                    review.get("status") == "approved"
                    for review in project.generated_image_reviews
                    if isinstance(review, dict)
                )
            project_rows.append((project, image_count))
            listing.insert(
                "end",
                f"{project.topic}\n"
                f"    이미지 {image_count}/6 · 승인 {approved_count}/6 · "
                f"{project.workflow_state.value} · "
                f"{project.updated_at[:10]}",
            )

        if not project_rows:
            listing.insert("end", "저장된 단기 프로젝트가 없습니다.")
            listing.configure(state="disabled")

        status_value = tk.StringVar(
            value=(
                "이미지가 1장 이상 생성된 프로젝트를 선택하세요."
                if project_rows
                else "먼저 단기 프로젝트를 생성하세요."
            )
        )
        tk.Label(
            picker,
            textvariable=status_value,
            bg=self.BG,
            fg=self.MUTED,
            font=(self.FONT, 8),
        ).pack(anchor="w", padx=22, pady=(0, 8))

        def open_selected(
            _event: tk.Event[tk.Misc] | None = None,
        ) -> None:
            selection = listing.curselection()
            if not selection or not project_rows:
                status_value.set("검토할 단기 프로젝트를 선택하세요.")
                return
            project, image_count = project_rows[selection[0]]
            if image_count == 0:
                status_value.set(
                    f"‘{project.topic}’에는 검토할 이미지가 없습니다."
                )
                self._toast(
                    "먼저 해당 단기 프로젝트의 이미지를 생성하세요.",
                    kind="warning",
                )
                return
            picker.destroy()
            self._open_result_viewer(project)

        listing.bind("<Double-Button-1>", open_selected)
        actions = tk.Frame(
            picker, name="image_review_picker_action_bar", bg=self.BG
        )
        actions.pack(
            side="bottom", fill="x", padx=18, pady=(0, 18), before=listing
        )
        HoverButton(
            actions,
            "취소",
            picker.destroy,
            background=self.SURFACE_3,
            hover=self.BORDER,
            font=(self.FONT, 8, "bold"),
            padx=14,
            pady=8,
        ).pack(side="right", padx=4)
        HoverButton(
            actions,
            "선택 프로젝트 검토",
            open_selected,
            background=self.PURPLE,
            hover="#7048D9",
            font=(self.FONT, 8, "bold"),
            padx=14,
            pady=8,
        ).pack(side="right", padx=4)
        self._fade_in(picker)

    def _open_result_viewer(
        self,
        project: ProjectContext | None = None,
        *,
        episode_store: LongStoryStore | None = None,
        episode_service: LongStoryService | None = None,
        episode_number: int | None = None,
        on_close: Callable[[], None] | None = None,
    ) -> None:
        """Open one shared Image Review Workspace for short or Episode data."""
        episode_mode = (
            episode_store is not None
            and episode_service is not None
            and episode_number is not None
        )
        episode = (
            episode_store.load_episode(episode_number)
            if episode_mode and episode_store is not None
            and episode_number is not None else None
        )
        long_project = (
            episode_store.load_project()
            if episode_mode and episode_store is not None else None
        )
        if (
            not episode_mode and project is None
            and self.dashboard_data and self.dashboard_data.projects
        ):
            project = self.dashboard_data.projects[0]

        viewer = tk.Toplevel(self)
        viewer.title("PRISM FORGE — Scene Production Workspace")
        self._fit_window(viewer, 1280, 800, 780, 520)
        viewer.configure(bg=self.BG)
        viewer.transient(self)
        viewer_closed = {"done": False}

        def close_viewer() -> None:
            if viewer_closed["done"]:
                return
            viewer_closed["done"] = True
            if viewer.winfo_exists():
                viewer.destroy()
            if on_close:
                on_close()

        viewer.protocol("WM_DELETE_WINDOW", close_viewer)

        header = self._window_header(
            viewer,
            "IMAGE REVIEW  /  SCENE 01—06",
            (
                f"{long_project.title} · Episode {episode_number:02d} · "
                f"{episode.title}"
                if episode_mode and long_project is not None
                and episode is not None and episode_number is not None
                else project.topic if project else "이미지 검토"
            ),
            "장면을 선택해 이미지·대본·프롬프트를 확인하고 승인합니다.",
        )
        if episode is not None:
            self._status_badge(
                header,
                episode.state,
                color=self.GREEN
                if episode.state == "waiting_for_video_confirmation" else self.GOLD,
            ).pack(side="right", padx=(0, 8))
        elif project is not None:
            self._status_badge(
                header,
                project.workflow_state.value,
                color=self.GREEN
                if project.workflow_state == WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION
                else self.GOLD,
            ).pack(side="right", padx=(0, 8))

        desk = tk.Frame(viewer, bg=self.BG)
        desk.pack(fill="both", expand=True, padx=20, pady=(18, 10))
        desk.columnconfigure(0, weight=2, minsize=130)
        desk.columnconfigure(1, weight=7, minsize=340)
        desk.columnconfigure(2, weight=4, minsize=230)
        desk.rowconfigure(0, weight=1)

        scene_panel = tk.Frame(
            desk, bg=self.SURFACE_2, highlightbackground=self.BORDER_SOFT,
            highlightthickness=1,
        )
        scene_panel.grid(row=0, column=0, sticky="nsew", padx=(0, 12))
        tk.Label(
            scene_panel, text="장면 목록", bg=self.SURFACE_2, fg=self.TEXT,
            font=(self.FONT, 10, "bold"),
        ).pack(anchor="w", padx=14, pady=(16, 3))
        tk.Label(
            scene_panel, text="GENERATED SCENES / 01—06", bg=self.SURFACE_2,
            fg=self.GOLD, font=("Segoe UI", 7, "bold"),
        ).pack(anchor="w", padx=14, pady=(0, 12))

        image_paths = (
            list(episode.generated_images) if episode is not None
            else list(project.generated_images) if project else []
        )
        scenes = (
            list(episode.script.get("scenes", [])) if episode is not None
            else list(project.scenes) if project else []
        )
        prompts = list(project.image_prompts) if project else []
        episode_previews: list[dict[str, object]] = []
        if episode_mode and episode_service is not None and episode_store is not None:
            prompts = []
            for scene_number in range(1, 7):
                try:
                    preview_data = episode_service.preview_scene_generation(
                        episode_store, int(episode_number), scene_number
                    )
                    prompts.append(str(preview_data["prompt"]))
                    episode_previews.append(preview_data)
                except (OSError, ValueError, ReferenceAssetError):
                    prompts.append("")
                    episode_previews.append({})
        fallback_dir = (
            episode_store.episode_root(int(episode_number)) / "images"
            if episode_mode and episode_store is not None
            else self.config_data.project_root / "images" / "generated"
        )
        scene_records: list[dict[str, object]] = []
        selected_scene = {"index": 0}
        approved_scene_numbers: set[int] = set(
            episode.approved_scene_numbers if episode is not None else []
        )
        if project is not None and not episode_mode:
            try:
                approved_scene_numbers.update(
                    review.scene_number
                    for review in GeneratedImageManager(
                        self.config_data.project_root
                        / "learning_data"
                        / "projects"
                        / project.project_directory_name
                    ).load_all()
                    if review.status == "approved"
                )
            except (OSError, ValueError):
                approved_scene_numbers.update(
                    int(review.get("scene_number", 0))
                    for review in project.generated_image_reviews
                    if isinstance(review, dict)
                    and review.get("status") == "approved"
                )
        generation_records = (
            list(episode.image_generation_records)
            if episode is not None
            else list(project.image_generation_records) if project else []
        )
        review_library = AssetLibrary(
            self.config_data.project_root / "learning_data"
        )
        for index in range(6):
            candidate = (
                Path(image_paths[index]) if index < len(image_paths)
                else fallback_dir / f"scene{index + 1}.png"
            )
            scene_data = scenes[index] if index < len(scenes) else {}
            generation_record = next(
                (
                    item for item in generation_records
                    if int(
                        item.get("scene")
                        or item.get("scene_number")
                        or 0
                    ) == index + 1
                ),
                {},
            )
            reference_ids = list(
                generation_record.get("reference_ids")
                or generation_record.get("reference_asset_ids")
                or []
            )
            reference_paths = list(
                generation_record.get("reference_paths") or []
            )
            preview_record = (
                episode_previews[index]
                if index < len(episode_previews) else {}
            )
            if not reference_paths and preview_record:
                reference_paths = list(
                    preview_record.get("reference_paths") or []
                )
            if not reference_ids and preview_record:
                reference_ids = [
                    str(item.get("asset_id", ""))
                    for item in preview_record.get("references", [])
                    if isinstance(item, dict)
                ]
            reference_details = list(
                generation_record.get("reference_details") or []
            )
            if not reference_details:
                reference_details = describe_reference_selection(
                    [str(value) for value in reference_ids],
                    [str(value) for value in reference_paths],
                    scene_data,
                )
            candidate_counts = dict(
                generation_record.get("candidate_asset_counts")
                or preview_record.get("candidate_asset_counts")
                or {}
            )
            if not candidate_counts:
                candidate_counts = {
                    "total": 0, "character": 0, "background": 0,
                    "object": 0, "style": 0, "general_reference": 0,
                }
                counted_ids: set[str] = set()
                for reference_id in reference_ids:
                    bare_id = str(reference_id).split("@v", 1)[0]
                    if bare_id in counted_ids or not bare_id.startswith("ASSET-"):
                        continue
                    try:
                        matched_asset = review_library.get(bare_id)
                    except ReferenceAssetError:
                        continue
                    counted_ids.add(bare_id)
                    candidate_counts["total"] += 1
                    candidate_counts[matched_asset.asset_type] += 1
            scene_records.append({
                "number": index + 1,
                "image": candidate,
                "script": str(
                    scene_data.get("description")
                    or scene_data.get("narration")
                    or "아직 기록된 대본이 없습니다."
                ),
                "prompt": (
                    str(scene_data.get("image_prompt_override"))
                    if scene_data.get("image_prompt_override")
                    else str(generation_record.get("prompt"))
                    if generation_record.get("prompt")
                    else prompts[index]
                    if index < len(prompts)
                    else str(
                        scene_data.get("image_prompt")
                        or "아직 이미지 프롬프트가 없습니다."
                    )
                ),
                "references": reference_ids,
                "reference_paths": reference_paths,
                "reference_details": reference_details,
                "prompt_length": int(
                    generation_record.get("prompt_length")
                    or len(prompts[index] if index < len(prompts) else "")
                ),
                "image_api_calls": (
                    int(generation_record["image_api_calls"])
                    if "image_api_calls" in generation_record
                    else "기록 없음"
                ),
                "candidate_asset_counts": candidate_counts,
            })

        evidence = tk.Frame(
            desk, bg=self.SURFACE, highlightbackground=self.BORDER_SOFT,
            highlightthickness=1,
        )
        evidence.grid(row=0, column=1, sticky="nsew", padx=(0, 12))
        evidence.rowconfigure(1, weight=1)
        evidence.columnconfigure(0, weight=1)
        tk.Label(
            evidence, text="SCENE PREVIEW", bg=self.SURFACE,
            fg=self.GOLD, font=("Segoe UI", 8, "bold"),
        ).grid(row=0, column=0, sticky="w", padx=18, pady=14)
        image_canvas = tk.Canvas(
            evidence, bg="#080D14", highlightthickness=0,
        )
        image_canvas.grid(row=1, column=0, sticky="nsew", padx=18, pady=(0, 18))

        notes = tk.Frame(
            desk, bg=self.SURFACE_2, highlightbackground=self.BORDER_SOFT,
            highlightthickness=1,
        )
        notes.grid(row=0, column=2, sticky="nsew")
        tk.Label(
            notes, text="장면 제작 정보", bg=self.SURFACE_2, fg=self.TEXT,
            font=(self.FONT, 11, "bold"),
        ).pack(anchor="w", padx=16, pady=(17, 3))
        meta_var = tk.StringVar()
        tk.Label(
            notes, textvariable=meta_var, bg=self.SURFACE_2, fg=self.MUTED,
            font=("Consolas", 7, "bold"),
        ).pack(anchor="w", padx=16)
        tk.Label(
            notes, text="대본", bg=self.SURFACE_2, fg=self.TEXT,
            font=(self.FONT, 8, "bold"),
        ).pack(anchor="w", padx=16, pady=(18, 5))
        script_text = tk.Text(
            notes, height=8, wrap="word", bg=self.SURFACE_3, fg=self.TEXT,
            insertbackground=self.GOLD, relief="flat", font=(self.FONT, 9),
            padx=9, pady=8,
        )
        script_text.pack(fill="x", padx=16)
        tk.Label(
            notes, text="장면별 이미지 구도 · 전체 카메라 느낌보다 우선",
            bg=self.SURFACE_2, fg=self.GOLD,
            font=(self.FONT, 8, "bold"),
        ).pack(anchor="w", padx=16, pady=(12, 5))
        composition_frame = tk.Frame(notes, bg=self.SURFACE_2)
        composition_frame.pack(fill="x", padx=16)
        composition_fields = (
            ("shot_size", "샷 크기"),
            ("camera_angle", "카메라 앵글"),
            ("composition", "화면 구도"),
            ("lens_feel", "렌즈·원근감"),
            ("focus_subject", "핵심 초점 대상"),
        )
        composition_vars = {
            key: tk.StringVar() for key, _label in composition_fields
        }
        for position, (key, label) in enumerate(composition_fields):
            row, column = divmod(position, 2)
            cell = tk.Frame(composition_frame, bg=self.SURFACE_2)
            cell.grid(
                row=row, column=column, sticky="ew",
                padx=(0, 6) if column == 0 else (6, 0), pady=2,
            )
            tk.Label(
                cell, text=label, width=11, anchor="w",
                bg=self.SURFACE_2, fg=self.TEXT_SOFT,
                font=(self.FONT, 7, "bold"),
            ).pack(side="left")
            tk.Entry(
                cell, textvariable=composition_vars[key],
                bg=self.SURFACE_3, fg=self.TEXT,
                insertbackground=self.GOLD, relief="flat",
                font=(self.FONT, 7),
            ).pack(side="left", fill="x", expand=True, ipady=4)
        composition_frame.columnconfigure(0, weight=1)
        composition_frame.columnconfigure(1, weight=1)
        tk.Label(
            notes, text="이미지 프롬프트", bg=self.SURFACE_2, fg=self.TEXT,
            font=(self.FONT, 8, "bold"),
        ).pack(anchor="w", padx=16, pady=(14, 5))
        prompt_text = tk.Text(
            notes, height=6, wrap="word", bg=self.SURFACE_3, fg=self.TEXT,
            insertbackground=self.GOLD, relief="flat", font=(self.FONT, 8),
            padx=9, pady=8,
        )
        prompt_text.pack(fill="both", expand=True, padx=16)
        tk.Label(
            notes,
            text=(
                "대본과 이미지 프롬프트를 직접 수정할 수 있습니다. "
                "수정값은 ‘이미지 재생성’ 확인 후 선택한 장면에만 저장·전송됩니다."
            ),
            bg=self.SURFACE_2, fg=self.MUTED,
            font=(self.FONT, 7), wraplength=520, justify="left",
        ).pack(anchor="w", padx=16, pady=(5, 0))
        tk.Label(
            notes, text="사용된 Reference", bg=self.SURFACE_2, fg=self.TEXT,
            font=(self.FONT, 8, "bold"),
        ).pack(anchor="w", padx=16, pady=(12, 5))
        reference_frame = tk.Frame(notes, bg=self.SURFACE_3)
        reference_frame.pack(fill="x", padx=16)
        tk.Label(
            notes, text="Debug", bg=self.SURFACE_2, fg=self.TEXT,
            font=(self.FONT, 8, "bold"),
        ).pack(anchor="w", padx=16, pady=(10, 4))
        debug_var = tk.StringVar()
        tk.Label(
            notes, textvariable=debug_var, justify="left",
            bg=self.SURFACE_3, fg=self.TEXT_SOFT,
            font=("Consolas", 7), padx=9, pady=7,
        ).pack(fill="x", padx=16, pady=(0, 12))
        reference_photos: list[tk.PhotoImage] = []

        scene_buttons: list[HoverButton] = []
        editor_state: dict[str, object] = {
            "loaded": False,
            "index": 0,
            "scripts": {
                index: str(record["script"])
                for index, record in enumerate(scene_records)
            },
            "prompts": {
                index: str(record["prompt"])
                for index, record in enumerate(scene_records)
            },
        }

        def composition_from_prompt(prompt: str, label: str) -> str:
            match = re.search(
                rf"^- {re.escape(label)}:\s*(.+)$", prompt, re.MULTILINE
            )
            return match.group(1).strip() if match else ""

        def apply_composition_to_prompt(prompt: str, scene: dict[str, object]) -> str:
            block = (
                "[1-1. 장면별 이미지 구도 · 최우선]\n"
                + format_scene_composition(scene)
                + "\n\n"
                "이 장면의 정적 이미지 구도에는 위 장면별 설정을 최우선으로 적용하십시오.\n"
                "프로젝트의 전체 카메라 느낌은 보조 원칙이며, 충돌하면 장면별 설정을 따르십시오.\n"
                "camera_motion은 영상 생성용이므로 정지 이미지에 이동 궤적이나 시간 경과를 표현하지 마십시오."
            )
            pattern = re.compile(
                r"\[(?:1-1|2)\. 장면별 이미지 구도 · 최우선\].*?"
                r"(?=\n\[(?:2|3)\. 실제 첨부 Reference\])",
                re.DOTALL,
            )
            if pattern.search(prompt):
                return pattern.sub(block + "\n", prompt, count=1)
            marker = "\n[2. 실제 첨부 Reference]"
            if marker in prompt:
                return prompt.replace(marker, "\n\n" + block + marker, 1)
            return block + "\n\n" + prompt

        def save_editor_draft() -> None:
            if not bool(editor_state["loaded"]):
                return
            index = int(editor_state["index"])
            scripts = editor_state["scripts"]
            prompts = editor_state["prompts"]
            assert isinstance(scripts, dict)
            assert isinstance(prompts, dict)
            scripts[index] = script_text.get("1.0", "end-1c")
            scene = scenes[index] if index < len(scenes) else {}
            for key, _label in composition_fields:
                scene[key] = composition_vars[key].get().strip()
            prompts[index] = apply_composition_to_prompt(
                prompt_text.get("1.0", "end-1c"), scene
            )
            prompt_text.delete("1.0", "end")
            prompt_text.insert("1.0", str(prompts[index]))

        def select_scene(index: int) -> None:
            save_editor_draft()
            selected_scene["index"] = index
            editor_state["index"] = index
            record = scene_records[index]
            path = Path(record["image"])
            resolution = ""
            try:
                probe = tk.PhotoImage(file=str(path))
                resolution = f"  ·  {probe.width()}×{probe.height()}"
            except (tk.TclError, OSError):
                pass
            meta_var.set(
                f"SCENE {index + 1:02d}  ·  "
                f"{'발견 완료' if path.is_file() else '미발견'}{resolution}"
            )
            script_text.delete("1.0", "end")
            scripts = editor_state["scripts"]
            prompts = editor_state["prompts"]
            assert isinstance(scripts, dict)
            assert isinstance(prompts, dict)
            script_text.insert("1.0", str(scripts[index]))
            prompt_value = str(prompts[index])
            scene = scenes[index] if index < len(scenes) else {}
            prompt_labels = {
                "shot_size": "샷 크기",
                "camera_angle": "카메라 앵글",
                "composition": "화면 구도",
                "lens_feel": "렌즈·원근감",
                "focus_subject": "핵심 초점 대상",
            }
            for key, _label in composition_fields:
                composition_vars[key].set(
                    str(scene.get(key) or "").strip()
                    or composition_from_prompt(prompt_value, prompt_labels[key])
                )
            prompt_text.delete("1.0", "end")
            prompt_text.insert("1.0", prompt_value)
            editor_state["loaded"] = True
            for child in reference_frame.winfo_children():
                child.destroy()
            reference_photos.clear()
            reference_details = [
                item for item in record["reference_details"]
                if isinstance(item, dict)
            ]
            if not reference_details:
                tk.Label(
                    reference_frame, text="Text Only",
                    bg=self.SURFACE_3, fg=self.MUTED,
                    font=(self.FONT, 8, "bold"), padx=9, pady=10,
                ).pack(anchor="w")
            for detail in reference_details:
                row = tk.Frame(reference_frame, bg=self.SURFACE_3)
                row.pack(fill="x", padx=7, pady=4)
                thumbnail = tk.Label(
                    row, text="▧", width=7, height=3,
                    bg="#080D14", fg=self.GOLD,
                    font=(self.FONT, 8, "bold"),
                )
                thumbnail.pack(side="left", padx=(0, 8))
                try:
                    photo = tk.PhotoImage(file=str(detail.get("path", "")))
                    scale = max(
                        1, (photo.width() + 55) // 56,
                        (photo.height() + 43) // 44,
                    )
                    photo = photo.subsample(scale, scale)
                    thumbnail.configure(image=photo, text="")
                    reference_photos.append(photo)
                except (tk.TclError, OSError):
                    pass
                role = str(detail.get("role") or "reference")
                reason = str(
                    detail.get("reason")
                    or "승인된 Scene Asset Mapping"
                )
                filename = str(detail.get("filename") or "")
                tk.Label(
                    row,
                    text=(
                        f"{role}\n{reason}\n{filename}"
                        if self.advanced_mode
                        else f"{role}\n{filename}"
                    ),
                    justify="left", anchor="w",
                    bg=self.SURFACE_3, fg=self.TEXT_SOFT,
                    font=(self.FONT, 7),
                ).pack(side="left", fill="x", expand=True)
            debug_var.set(
                reference_review_debug_text(
                    reference_details,
                    int(record["prompt_length"]),
                    record["image_api_calls"],
                )
                if self.advanced_mode
                else candidate_asset_debug_text(
                    record["candidate_asset_counts"]
                )
            )
            for position, button in enumerate(scene_buttons):
                active = position == index
                button.configure(
                    bg="#1A2942" if active else self.SURFACE_3,
                    highlightbackground=(
                        self.PURPLE if active else self.BORDER_SOFT
                    ),
                )
                button._base = "#1A2942" if active else self.SURFACE_3
            image_canvas.delete("all")
            image_canvas.update_idletasks()
            width = max(220, image_canvas.winfo_width())
            height = max(210, image_canvas.winfo_height())
            try:
                photo = tk.PhotoImage(file=str(path))
                scale = max(
                    1,
                    (photo.width() + width - 1) // max(1, width - 20),
                    (photo.height() + height - 1) // max(1, height - 20),
                )
                photo = photo.subsample(scale, scale)
                image_canvas.create_image(width // 2, height // 2, image=photo)
                image_canvas._scene_photo = photo  # type: ignore[attr-defined]
            except (tk.TclError, OSError):
                image_canvas.create_rectangle(
                    34, 30, width - 34, height - 30,
                    fill="#0E1824", outline=self.BORDER, width=1,
                )
                image_canvas.create_oval(
                    width * .18, height * .18, width * .82, height * .78,
                    outline="#23354A", width=2,
                )
                image_canvas.create_text(
                    width // 2, height // 2 - 12,
                    text=f"SCENE {index + 1:02d}", fill=self.GOLD,
                    font=("Consolas", 13, "bold"),
                )
                image_canvas.create_text(
                    width // 2, height // 2 + 20,
                    text="장면 이미지가 발견되면 여기에 표시됩니다.",
                    fill=self.MUTED, font=(self.FONT, 8),
                )

        for index, record in enumerate(scene_records):
            found = Path(record["image"]).is_file()
            approved = index + 1 in approved_scene_numbers
            button = HoverButton(
                scene_panel,
                f"{index + 1:02d}  "
                f"{'✓ 승인' if approved else '● 발견' if found else '○ 대기'}",
                lambda index=index: select_scene(index),
                background=self.SURFACE_3,
                hover="#20304A",
                foreground=(
                    self.GREEN if approved
                    else self.GOLD_LIGHT if found else self.MUTED
                ),
                font=("Malgun Gothic", 8, "bold"),
                padx=12,
                pady=10,
            )
            button.pack(fill="x", padx=12, pady=(0, 7))
            scene_buttons.append(button)

        actions = tk.Frame(
            viewer, bg="#0A1019",
            highlightbackground=self.BORDER_SOFT, highlightthickness=1,
        )
        # Reserve the action bar before the expanding desk. Otherwise Tk's
        # packer can let the desk consume the available height and clip these
        # controls when the window is small.
        actions.pack(
            fill="x", side="bottom", padx=20, pady=(0, 10), before=desk
        )
        approval_status_var = tk.StringVar(
            value=f"승인 {len(approved_scene_numbers)}/6"
        )

        def refresh_approval_ui(scene_number: int) -> None:
            """Make a saved approval immediately visible in the workspace."""
            approved_scene_numbers.add(scene_number)
            button = scene_buttons[scene_number - 1]
            button.configure(
                text=f"{scene_number:02d}  ✓ 승인",
                fg=self.GREEN,
            )
            approval_status_var.set(
                f"장면 {scene_number} 승인 완료  ·  "
                f"전체 {len(approved_scene_numbers)}/6"
            )

        tk.Label(
            actions,
            textvariable=approval_status_var,
            bg="#0A1019",
            fg=self.GREEN,
            font=(self.FONT, 8, "bold"),
        ).pack(side="left", padx=(10, 6))

        def approve_current() -> None:
            index = selected_scene["index"]
            path = Path(scene_records[index]["image"])
            if episode_mode:
                if (
                    episode_store is None or episode_service is None
                    or episode_number is None
                ):
                    return
                try:
                    updated_episode = episode_service.approve_image(
                        episode_store, episode_number, index + 1
                    )
                    refresh_approval_ui(index + 1)
                    self._toast(
                        "이미지 6장 승인 완료 · 영상 생성 확인 대기"
                        if updated_episode.state == "waiting_for_video_confirmation"
                        else f"장면 {index + 1} 승인 완료"
                    )
                    if updated_episode.state == "waiting_for_video_confirmation":
                        viewer.after(250, close_viewer)
                except (ValueError, OSError) as exc:
                    messagebox.showerror("승인 실패", str(exc), parent=viewer)
                return
            if project is None:
                self._toast("승인 상태를 저장할 프로젝트가 없습니다.", kind="warning")
                return
            try:
                project_root = (
                    self.config_data.project_root / "learning_data" / "projects"
                    / project.project_id
                )
                updated = ProjectImageReviewService(
                    self.config_data.project_root
                    / "learning_data" / "projects"
                ).approve_scene(
                    project, index + 1
                )
                refresh_approval_ui(index + 1)
                self._toast(
                    "이미지 6장 승인 완료 · 영상 생성 확인 대기"
                    if updated.workflow_state == WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION
                    else f"장면 {index + 1} 승인 완료"
                )
                self.refresh()
            except (ValueError, OSError) as exc:
                messagebox.showerror("승인 실패", str(exc), parent=viewer)

        def register_current() -> None:
            if episode_mode:
                if (
                    episode_store is None or episode_number is None
                    or long_project is None
                ):
                    return
                current_episode = episode_store.load_episode(episode_number)
                index = selected_scene["index"]
                if index + 1 not in current_episode.approved_scene_numbers:
                    self._toast(
                        "먼저 현재 장면 이미지를 승인하세요.", kind="warning"
                    )
                    return
                reference_type = simpledialog.askstring(
                    "Asset 유형",
                    "character / style / background / object / general_reference",
                    initialvalue="general_reference", parent=viewer,
                )
                if not reference_type:
                    return
                try:
                    registered = AssetLibrary(
                        self.config_data.project_root / "learning_data"
                    ).index_project_image(
                        Path(current_episode.generated_images[index]),
                        asset_type=reference_type,
                        display_name=(
                            f"{long_project.title} · Episode {episode_number} · "
                            f"Scene {index + 1}"
                        ),
                        tags=[
                            "approved", long_project.project_id,
                            f"episode-{episode_number}", f"scene-{index + 1}",
                        ],
                        approved=True,
                        status="approved",
                        source_project_id=long_project.project_id,
                        source_scene_number=index + 1,
                    )
                    self._toast("Episode 이미지를 Asset Library에 등록했습니다.")
                    self._open_asset_library(registered.asset_id)
                except (ReferenceAssetError, ValueError, OSError) as exc:
                    messagebox.showerror("등록 차단", str(exc), parent=viewer)
                return
            if project is None:
                self._toast("저장된 프로젝트가 필요합니다.", kind="warning")
                return
            index = selected_scene["index"]
            mode = simpledialog.askstring(
                "등록 방식",
                "new = 새 Library Asset\nversion = 기존 Asset 새 Version\n"
                "snapshot = 현재 프로젝트에만 보관",
                initialvalue="new", parent=viewer,
            )
            if not mode:
                return
            mode = mode.strip().lower()
            project_root = (
                self.config_data.project_root / "learning_data" / "projects"
                / project.project_id
            )
            manager = GeneratedImageManager(project_root)
            library = AssetLibrary(
                self.config_data.project_root / "learning_data"
            )
            if mode == "snapshot":
                try:
                    manager.save_as_project_snapshot(index + 1)
                    self._toast("승인 이미지를 프로젝트 Snapshot으로 보관했습니다.")
                except (ReferenceAssetError, ValueError, OSError) as exc:
                    messagebox.showerror("등록 차단", str(exc), parent=viewer)
                return
            if mode == "version":
                assets = library.search()
                labels = "\n".join(
                    f"{number + 1}. {asset.display_name} · "
                    f"{asset.asset_type} · v{asset.version}"
                    for number, asset in enumerate(assets)
                )
                selected = simpledialog.askinteger(
                    "기존 Asset 선택", labels, parent=viewer,
                    minvalue=1, maxvalue=len(assets),
                ) if assets else None
                if not selected:
                    return
                try:
                    manager.register_as_library_version(
                        index + 1, library, assets[selected - 1].asset_id
                    )
                    self._toast("승인 이미지를 새 Asset Version으로 등록했습니다.")
                except (ReferenceAssetError, ValueError, OSError) as exc:
                    messagebox.showerror("등록 차단", str(exc), parent=viewer)
                return
            if mode != "new":
                self._toast("등록 방식은 new/version/snapshot 중 하나입니다.", kind="warning")
                return
            reference_type = simpledialog.askstring(
                "Reference 유형",
                "character / style / background / object / general_reference",
                initialvalue="general_reference", parent=viewer,
            )
            if not reference_type:
                return
            try:
                registered = manager.register_in_library(
                    index + 1,
                    library,
                    asset_type=reference_type,
                    display_name=f"{project.topic} scene {index + 1}",
                    face_baseline=False,
                )
                self._toast("승인 이미지를 Asset Library에 등록했습니다.")
                self._open_asset_library(registered.asset_id)
            except (ReferenceAssetError, ValueError) as exc:
                messagebox.showerror("등록 차단", str(exc), parent=viewer)

        def check_face_current() -> None:
            if project is None:
                self._toast("저장된 프로젝트가 필요합니다.", kind="warning")
                return
            if not self.config_data.face_check_enabled:
                self._toast(
                    "설정에서 FACE_CHECK_ENABLED=true로 활성화하세요.",
                    kind="warning",
                )
                return
            manager = ProjectReferenceManager(
                self.config_data.project_root / "learning_data" / "projects",
                project.project_id,
            )
            baselines = [
                asset for asset in manager.load_all()
                if asset.enabled
                and asset.reference_type == "character"
                and asset.face_baseline
            ]
            if not baselines:
                self._toast("활성화된 캐릭터 얼굴 기준 이미지가 없습니다.", kind="warning")
                return
            index = selected_scene["index"]
            generated = Path(scene_records[index]["image"])
            self._toast("로컬 캐릭터 얼굴 유사도를 검사하는 중입니다.", kind="progress")

            def run_check() -> None:
                try:
                    if self.face_consistency_service is None:
                        backend = InsightFaceBackend(
                            model_name=self.config_data.face_model_name,
                            model_root=self.config_data.face_model_directory,
                        )
                        self.face_consistency_service = FaceConsistencyService(
                            backend,
                            pass_threshold=self.config_data.face_pass_threshold,
                            warning_threshold=self.config_data.face_warning_threshold,
                            model_name=f"InsightFace/{self.config_data.face_model_name}",
                        )
                    result = self.face_consistency_service.check(
                        manager.resolve_path(baselines[0]), generated
                    )
                    self.after(
                        0,
                        lambda: messagebox.showinfo(
                            "캐릭터 얼굴 유사도 참고 점수",
                            (
                                f"상태: {result.status}\n"
                                f"코사인 유사도: "
                                f"{result.similarity if result.similarity is not None else '측정 불가'}\n"
                                f"{result.message}\n\n"
                                "애니메이션 얼굴에서는 정확도가 낮을 수 있으며 "
                                "동일 인물 판정에 사용할 수 없습니다."
                            ),
                            parent=viewer,
                        ),
                    )
                except Exception as exc:
                    self.after(
                        0,
                        lambda error=exc: messagebox.showerror(
                            "얼굴 검사 비활성화",
                            (
                                f"{error}\n\n이미지 생성과 저장은 계속 정상 동작합니다."
                            ),
                            parent=viewer,
                        ),
                    )

            threading.Thread(target=run_check, daemon=True).start()

        def regenerate_current() -> None:
            scene_number = selected_scene["index"] + 1
            if self._generation_running:
                messagebox.showwarning(
                    "이미지 재생성 대기",
                    "다른 생성 작업이 진행 중입니다. 완료된 뒤 다시 시도해주세요.",
                    parent=viewer,
                )
                return
            try:
                save_editor_draft()
                scripts = editor_state["scripts"]
                prompts = editor_state["prompts"]
                assert isinstance(scripts, dict)
                assert isinstance(prompts, dict)
                edited_script = str(scripts[selected_scene["index"]]).strip()
                edited_prompt = str(prompts[selected_scene["index"]]).strip()
            except Exception as exc:
                get_logger("ui").exception(
                    "Failed to prepare scene %s regeneration", scene_number
                )
                messagebox.showerror(
                    "재생성 준비 실패",
                    f"수정한 대본과 프롬프트를 읽지 못했습니다.\n\n{exc}",
                    parent=viewer,
                )
                return
            if not edited_script or not edited_prompt:
                messagebox.showwarning(
                    "재생성 입력 확인",
                    "대본과 이미지 프롬프트를 모두 입력해주세요.",
                    parent=viewer,
                )
                return
            if episode_mode:
                if (
                    episode_store is None or episode_service is None
                    or episode_number is None
                ):
                    messagebox.showerror(
                        "Episode 정보 오류",
                        "현재 Episode 정보를 불러오지 못해 재생성을 시작할 수 없습니다.",
                        parent=viewer,
                    )
                    return
                if not self.config_data.openai_api_key:
                    messagebox.showwarning(
                        "OpenAI 연결 필요",
                        "이미지를 재생성하려면 OpenAI API 키를 연결해주세요.",
                        parent=viewer,
                    )
                    return
                if not messagebox.askyesno(
                    "이미지 재생성",
                    f"Episode {episode_number} · Scene {scene_number}만 "
                    "수정한 대본과 이미지 프롬프트로 유료 API 재생성할까요?",
                    parent=viewer,
                ):
                    return
                self._generation_running = True
                self._open_image_regeneration_progress(scene_number)

                def run_episode_regeneration() -> None:
                    try:
                        self.after(
                            0,
                            lambda: self._set_generation_progress_state(
                                "Image API 응답 대기 중",
                                detail=(
                                    f"Episode {episode_number} · Scene "
                                    f"{scene_number}을 재생성하고 있습니다."
                                ),
                                percent=45,
                                stage=1,
                            ),
                        )
                        episode_service.regenerate_episode_scene(
                            episode_store,
                            episode_number,
                            scene_number,
                            edited_script=edited_script,
                            edited_image_prompt=edited_prompt,
                        )

                        def reopen() -> None:
                            self._generation_running = False
                            self._set_generation_progress_state(
                                "이미지 재생성 완료",
                                detail=(
                                    f"Episode {episode_number} · Scene "
                                    f"{scene_number} 저장을 완료했습니다."
                                ),
                                percent=100,
                                stage=3,
                            )
                            self.after(450, finish_reopen)

                        def finish_reopen() -> None:
                            self._close_generation_progress()
                            viewer_closed["done"] = True
                            if viewer.winfo_exists():
                                viewer.destroy()
                            self._open_result_viewer(
                                episode_store=episode_store,
                                episode_service=episode_service,
                                episode_number=episode_number,
                                on_close=on_close,
                            )

                        self.after(0, reopen)
                    except Exception as exc:
                        self.after(
                            0,
                            lambda error=exc: self._generation_failed(error),
                        )

                threading.Thread(
                    target=run_episode_regeneration, daemon=True
                ).start()
                return
            self._regenerate_from_viewer(
                project,
                scene_number,
                viewer,
                edited_script=edited_script,
                edited_image_prompt=edited_prompt,
            )

        HoverButton(
            actions, "장면 승인", approve_current,
            background="#176344", hover="#20845B",
            font=(self.FONT, 8, "bold"), padx=16, pady=9,
        ).pack(side="left", padx=(10, 0), pady=10)
        def open_previous_images() -> None:
            index = selected_scene["index"]
            if index >= len(scene_records):
                return
            current = Path(str(scene_records[index].get("image", "")))
            originals = current.parent / "originals"
            archived = sorted(
                originals.glob(f"scene{index + 1}_v*.png")
            ) if originals.is_dir() else []
            if not archived:
                self._toast(
                    "이 장면에는 보관된 이전 이미지가 없습니다.",
                    kind="warning",
                )
                return
            open_local_path(originals)

        HoverButton(
            actions, "이전 이미지 보기", open_previous_images,
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 8, "bold"), padx=12, pady=9,
        ).pack(side="left", padx=5)
        if self.config_data.face_check_enabled:
            HoverButton(
                actions, "얼굴 유사도 검사", check_face_current,
                background=self.SURFACE_3, hover=self.GOLD,
                font=(self.FONT, 8, "bold"), padx=11, pady=8,
            ).pack(side="left")
        HoverButton(
            actions, "이미지 재생성",
            regenerate_current,
            background="#733B1A", hover=self.ORANGE,
            font=(self.FONT, 8, "bold"), padx=16, pady=9,
        ).pack(side="right", padx=(0, 10), pady=10)
        HoverButton(
            actions, "다음 장면",
            lambda: select_scene((selected_scene["index"] + 1) % 6),
            background=self.SURFACE_3, hover=self.BORDER,
            font=(self.FONT, 8, "bold"), padx=11, pady=8,
        ).pack(side="right", padx=5)
        select_scene(0)
        self._fade_in(viewer)

    def _regenerate_from_viewer(
        self,
        project: ProjectContext | None,
        scene_number: int,
        viewer: tk.Toplevel,
        *,
        edited_script: str,
        edited_image_prompt: str,
    ) -> None:
        if project is None:
            messagebox.showerror(
                "프로젝트 정보 오류",
                "저장된 프로젝트 정보를 불러오지 못해 재생성을 시작할 수 없습니다.",
                parent=viewer,
            )
            return
        if not self.config_data.openai_api_key:
            messagebox.showwarning(
                "OpenAI 연결 필요",
                "이미지를 재생성하려면 OpenAI API 키를 연결해주세요.",
                parent=viewer,
            )
            return
        if self._generation_running:
            messagebox.showwarning(
                "이미지 재생성 대기",
                "다른 생성 작업이 진행 중입니다. 완료된 뒤 다시 시도해주세요.",
                parent=viewer,
            )
            return
        if not messagebox.askyesno(
            "이미지 재생성",
            f"장면 {scene_number}을 수정한 대본과 이미지 프롬프트로\n"
            "유료 Image API 1회 재생성할까요?\n\n"
            "재생성 횟수 제한은 없지만, 요청마다 비용과 월 예산을 검사합니다.",
            parent=viewer,
        ):
            return
        self._generation_running = True
        self._open_image_regeneration_progress(scene_number)

        def run() -> None:
            try:
                if self.generation_service is None:
                    self.generation_service = GenerationService(self.config_data)
                self.after(
                    0,
                    lambda: self._set_generation_progress_state(
                        "Image API 응답 대기 중",
                        detail=f"Scene {scene_number} 이미지를 재생성하고 있습니다.",
                        percent=45,
                        stage=1,
                    ),
                )
                path = self.generation_service.regenerate_scene(
                    project,
                    scene_number,
                    lambda message: self.after(
                        0,
                        lambda value=message: (
                            self._toast(value, kind="progress"),
                            self._set_generation_progress_state(
                                value,
                                detail=(
                                    f"Scene {scene_number} 결과를 처리하고 있습니다."
                                ),
                                percent=72,
                                stage=2,
                            ),
                        ),
                    ),
                    edited_script=edited_script,
                    edited_image_prompt=edited_image_prompt,
                )
                self.after(0, lambda: self._regeneration_succeeded(viewer, project))
            except Exception as exc:
                self.after(0, lambda error=exc: self._generation_failed(error))

        threading.Thread(target=run, daemon=True).start()

    def _regeneration_succeeded(
        self, viewer: tk.Toplevel, project: ProjectContext
    ) -> None:
        self._generation_running = False
        self._set_generation_progress_state(
            "이미지 재생성 완료",
            detail="새 이미지를 저장했습니다. 검토 화면을 갱신합니다.",
            percent=100,
            stage=3,
        )
        self._toast("선택 장면 재생성 완료")

        def reopen() -> None:
            self._close_generation_progress()
            if viewer.winfo_exists():
                viewer.destroy()
            self._open_result_viewer(project)

        self.after(450, reopen)

    def _open_assets(self) -> None:
        open_local_path(self.config_data.project_root / "images")
        self._toast("장면 자료실 폴더를 열었습니다.")

    def _toggle_api_key_visibility(self) -> None:
        self.api_key_entry.configure(
            show="" if self.api_key_entry.cget("show") else "•"
        )
        self.api_key_entry.focus_set()

    def _connect_api_key(self) -> None:
        """Persist the key locally and rebuild provider services without a paid call."""
        raw_key = self.api_key_entry.get().strip()
        if self._generation_running:
            self._toast(
                "생성 작업이 끝난 뒤 API 연결 설정을 변경하세요.", kind="warning"
            )
            return
        try:
            if raw_key:
                save_openai_api_key(self.config_data.project_root, raw_key)
            refreshed = AppConfig.load(self.config_data.project_root, env={})
            if not refreshed.openai_api_key:
                raise APIKeySettingsError(
                    "저장된 API 키가 없습니다. 새 키를 입력하세요."
                )
            # Adapter construction verifies local configuration and SDK availability.
            service = GenerationService(refreshed)
        except (APIKeySettingsError, ConfigurationError, RuntimeError) as exc:
            self.api_key_entry.selection_range(0, "end")
            self.api_key_entry.focus_set()
            self._toast("API 키를 저장하거나 연결하지 못했습니다.", kind="error")
            messagebox.showerror("OpenAI 연결 실패", str(exc), parent=self)
            return
        self.config_data = refreshed
        self._api_session_disconnected = False
        self.generation_service = service
        self.api_key_entry.delete(0, "end")
        self.api_key_entry.configure(show="•")
        self.api_key_status.set(masked_api_key(refreshed.openai_api_key))
        self.api_key_status_label.configure(fg=self.GREEN)
        self.api_disconnect_button.configure(
            state="normal", fg=self.TEXT, text="연결 해제",
            command=self._disconnect_api_key,
        )
        self._toast("API 키 저장 완료 · 공식 OpenAI Adapter 준비됨")
        self.refresh()
        messagebox.showinfo(
            "OpenAI 연결 준비 완료",
            "API 키를 로컬 .env에 저장하고 공식 OpenAI Adapter를 준비했습니다.\n\n"
            "이 확인 과정에서는 유료 API 요청을 보내지 않았습니다.",
            parent=self,
        )

    def _disconnect_api_key(self) -> None:
        """Disable API use for this app session while retaining the saved key."""
        if self._generation_running:
            self._toast(
                "생성 작업이 끝난 뒤 API 연결을 해제하세요.", kind="warning"
            )
            return
        saved_config = AppConfig.load(self.config_data.project_root, env={})
        if not saved_config.openai_api_key:
            self._toast("현재 연결된 API 키가 없습니다.", kind="warning")
            return
        if not messagebox.askyesno(
            "OpenAI 연결 해제",
            "저장된 API 키는 삭제하지 않고 현재 프로그램의 연결만 끊습니다.\n"
            "다시 연결을 누르면 키를 재입력하지 않아도 됩니다.\n\n"
            "연결을 해제할까요?",
            parent=self,
        ):
            return
        self.config_data = replace(self.config_data, openai_api_key=None)
        self._api_session_disconnected = True
        self.generation_service = None
        self.api_key_entry.delete(0, "end")
        self.api_key_entry.configure(show="•")
        self.api_key_status.set("연결 해제됨 · 키 저장됨")
        self.api_key_status_label.configure(fg=self.ORANGE)
        self.api_disconnect_button.configure(
            state="normal", fg=self.TEXT, text="다시 연결",
            command=self._connect_api_key,
        )
        self.refresh()
        self._toast("저장된 키를 유지하고 API 연결만 해제했습니다.")

    def _show_settings(self) -> None:
        environment = (
            self.dashboard_data.environment if self.dashboard_data else None
        )
        api_status = (
            "설정됨"
            if environment and environment.api_key_configured
            else "미설정"
        )
        budget = BudgetManager(
            self.config_data.project_root
            / "learning_data"
            / "api_budget_usage.json",
            self.config_data.monthly_budget_usd,
            self.config_data.budget_warning_threshold,
        ).summary()
        window = tk.Toplevel(self)
        window.title("PRISM FORGE — Settings & Environment")
        self._fit_window(window, 760, 570, 680, 520)
        window.configure(bg=self.BG)
        window.transient(self)
        self._window_header(
            window,
            "SETTINGS  /  READ-ONLY RUNTIME SUMMARY",
            "설정·환경",
            "현재 적용된 API, 비용 보호, 출력 및 작업공간 설정입니다.",
        )
        body = tk.Frame(window, bg=self.BG)
        body.pack(fill="both", expand=True, padx=24, pady=20)
        body.columnconfigure(0, weight=1)
        body.columnconfigure(1, weight=1)
        sections = (
            (
                "OPENAI",
                (
                    ("API 연결", api_status),
                    ("Story Model", self.config_data.openai_story_model),
                    ("Image Model", self.config_data.openai_image_model),
                    ("재시도", f"최대 {self.config_data.max_retries}회"),
                ),
            ),
            (
                "비용·호출 보호",
                (
                    ("월 예산", f"${self.config_data.monthly_budget_usd:.2f}"),
                    ("이번 달 기록", f"${budget['spent_usd']:.2f}"),
                    ("남은 예산", f"${budget['remaining_usd']:.2f}"),
                    (
                        "차단 상태",
                        "예산 소진 · API 요청 차단"
                        if float(budget["remaining_usd"]) <= 0
                        else "호출 가능",
                    ),
                    ("일일 호출", str(self.config_data.app_daily_api_call_limit)),
                    ("Story / 작업", str(self.config_data.app_max_story_calls_per_job)),
                    ("Image / 작업", str(self.config_data.app_max_image_calls_per_job)),
                ),
            ),
            (
                "출력",
                (
                    ("해상도", "1080 × 1920"),
                    ("FPS", "30"),
                    ("이미지", self.config_data.openai_image_size),
                    ("FFmpeg", self.config_data.ffmpeg_binary),
                ),
            ),
            (
                "Workflow",
                (
                    ("장면 수", "6"),
                    (
                        "장기 Episode 상한",
                        str(self.config_data.app_max_long_project_episodes),
                    ),
                    (
                        "얼굴 검사",
                        "활성" if self.config_data.face_check_enabled else "비활성",
                    ),
                    ("Runway", "사용자 수동 편집"),
                ),
            ),
        )
        for index, (title, rows) in enumerate(sections):
            card = self._card(body)
            card.grid(
                row=index // 2, column=index % 2, sticky="nsew",
                padx=(0, 10) if index % 2 == 0 else 0,
                pady=(0, 10),
            )
            tk.Label(
                card, text=title, bg=self.SURFACE, fg=self.GOLD,
                font=(self.FONT, 10, "bold"),
            ).pack(anchor="w", padx=16, pady=(14, 8))
            for label, value in rows:
                row = tk.Frame(card, bg=self.SURFACE)
                row.pack(fill="x", padx=16, pady=3)
                tk.Label(
                    row, text=label, bg=self.SURFACE, fg=self.MUTED,
                    font=(self.FONT, 8),
                ).pack(side="left")
                tk.Label(
                    row, text=value, bg=self.SURFACE, fg=self.TEXT,
                    font=(self.FONT, 8, "bold"),
                ).pack(side="right")
        path_card = self._card(body, background=self.SURFACE_2)
        path_card.grid(row=2, column=0, columnspan=2, sticky="ew")
        tk.Label(
            path_card,
            text=f"작업공간  {self.config_data.project_root}",
            bg=self.SURFACE_2, fg=self.TEXT_SOFT,
            font=("Consolas", 8), anchor="w",
        ).pack(fill="x", padx=16, pady=12)
        self._fade_in(window)

    def refresh(self) -> None:
        """Reload environment and project data with a brief skeleton state."""
        self._show_skeleton()
        self.nav_status.configure(text="스튜디오 동기화 중")
        self.after(100, self._finish_refresh)

    def _finish_refresh(self) -> None:
        try:
            data = self.data_loader(self.config_data)
            self.dashboard_data = data
            environment = data.environment
            healthy = (
                environment.python_supported
                and environment.ffmpeg_installed
                and environment.ffprobe_installed
            )
            self.nav_status_dot.configure(
                fg=self.GREEN if healthy else self.RED
            )
            self.nav_status.configure(
                text="프로덕션 시스템 정상" if healthy else "환경 확인 필요"
            )
            self.footer_status.configure(
                text=(
                    f"단기 프로젝트 {len(data.projects)}개  ·  "
                    f"영상 생성 확인 대기 {data.waiting_count}개  ·  "
                    f"OpenAI {'연결 준비' if environment.api_key_configured else '키 미설정'}"
                )
            )
            if data.projects:
                current = data.projects[0]
                progress, stage = project_progress(current)
                self.hero_eyebrow.configure(
                    text=f"ACTIVE SHORT PROJECT  /  {stage}  /  {progress}%"
                )
                self.hero_title.configure(
                    text=str(current.story.get("title") or current.topic)
                )
                self.hero_primary_button.configure(
                    text="현재 프로젝트 계속  →"
                )
                self.hero_stage_badge.configure(
                    text=f"  {stage} · {progress}%  ",
                    fg=self.GREEN if progress == 100 else self.PURPLE,
                )
                self.hero_summary.configure(
                    text=(
                        f"현재 제작 단계: {stage} · 마지막 수정 {current.updated_at[:10]}\n"
                        "다음 작업을 계속하거나 생성 결과를 검토하세요."
                    )
                )
            else:
                self.hero_eyebrow.configure(
                    text="EMPTY WORKSPACE  /  AI ANIMATION  /  30 SEC"
                )
                self.hero_title.configure(text="첫 번째 이야기를 시작하세요")
                self.hero_primary_button.configure(text="＋  새 단기 프로젝트")
                self.hero_stage_badge.configure(
                    text="  IDEA · 설정 준비  ", fg=self.PURPLE
                )
            self.hero_api_badge.configure(
                text=(
                    "  API 연결  "
                    if self.config_data.openai_api_key
                    else "  API 미연결  "
                ),
                fg=(
                    self.GREEN
                    if self.config_data.openai_api_key
                    else self.ORANGE
                ),
            )
            self._render_projects(data.projects)
        except Exception as exc:
            get_logger("ui").exception("Dashboard refresh failed")
            self.nav_status_dot.configure(fg=self.RED)
            self.nav_status.configure(text="데이터 로드 오류")
            self._render_empty_projects()
            self._toast(str(exc), kind="error")

    def _toast(self, message: str, kind: str = "success") -> None:
        colors = {
            "success": self.GREEN,
            "warning": self.GOLD,
            "error": self.RED,
            "progress": self.PURPLE,
        }
        if hasattr(self, "toast") and self.toast.winfo_exists():
            self.toast.destroy()
        self.toast = tk.Frame(
            self,
            bg=self.SURFACE_3,
            highlightbackground=colors.get(kind, self.GREEN),
            highlightthickness=1,
        )
        tk.Label(
            self.toast,
            text={
                "success": "기록 완료",
                "warning": "주의 메모",
                "error": "경고 메모",
                "progress": "처리 중",
            }.get(kind, "기록 완료"),
            bg=self.SURFACE_3,
            fg=colors.get(kind, self.GREEN),
            font=(self.FONT, 7, "bold"),
        ).pack(side="left", padx=(13, 8), pady=11)
        tk.Label(
            self.toast,
            text=message,
            bg=self.SURFACE_3,
            fg=self.TEXT,
            font=(self.FONT, 8),
        ).pack(side="left", padx=(0, 15), pady=11)
        self.toast.update_idletasks()
        self.toast.place(relx=1.0, x=-28, y=86, anchor="ne")
        self.toast.lift()
        if self._toast_job:
            self.after_cancel(self._toast_job)
        self._toast_job = self.after(3200, self._hide_toast)

    def _hide_toast(self) -> None:
        if hasattr(self, "toast") and self.toast.winfo_exists():
            self.toast.destroy()
        self._toast_job = None

    def _fade_in(self, window: tk.Toplevel) -> None:
        if self.reduced_motion:
            try:
                window.attributes("-alpha", 1.0)
            except tk.TclError:
                pass
            return
        try:
            window.attributes("-alpha", 0.0)
        except tk.TclError:
            return

        def step(alpha: float = 0.0) -> None:
            if not window.winfo_exists():
                return
            next_alpha = min(1.0, alpha + 0.14)
            window.attributes("-alpha", next_alpha)
            if next_alpha < 1:
                window.after(16, lambda: step(next_alpha))

        step()

    def _scroll_to(self, widget: tk.Widget) -> None:
        self.update_idletasks()
        page_height = max(1, self.page.winfo_height())
        position = max(0.0, min(1.0, widget.winfo_y() / page_height))
        self.canvas.yview_moveto(position)

    def _on_mousewheel(self, event: tk.Event[tk.Misc]) -> str | None:
        try:
            top = event.widget.winfo_toplevel()
            target = self._scroll_targets.get(str(top))
            if target is None or not target.winfo_exists():
                return None
        except tk.TclError:
            return None
        target.yview_scroll(int(-1 * (event.delta / 120)), "units")
        return "break"

    def _on_resize(self, event: tk.Event[tk.Misc]) -> None:
        if event.widget is not self:
            return
        if self._resize_job:
            self.after_cancel(self._resize_job)
        self._resize_job = self.after(180, self._reflow)

    def _reflow(self) -> None:
        self._resize_job = None
        if self.dashboard_data:
            self._render_projects(self.dashboard_data.projects)

    def _close(self) -> None:
        if self._generation_running:
            # Closing the shell only hides the view. The paid operation keeps
            # its worker, lock and checkpoints until it finishes.
            self._close_generation_progress()
            self.withdraw()
            self.after(250, self._close_after_generation)
            return
        close_logging()
        self.destroy()

    def _close_after_generation(self) -> None:
        if self._generation_running:
            self.after(250, self._close_after_generation)
            return
        close_logging()
        self.destroy()


def run_ui(project_root: Path | None = None) -> int:
    """Configure the application and open the desktop studio."""
    try:
        # The desktop connector owns provider credentials through the local
        # .env. Ignore unrelated credentials inherited from a launcher/IDE.
        config = AppConfig.load(project_root=project_root, env={})
        config.ensure_directories()
        configure_logging(
            config.project_root / "logs",
            config.log_level,
            secrets=(config.openai_api_key or "",),
        )
        StudioApp(config).mainloop()
        return 0
    except (ConfigurationError, tk.TclError) as exc:
        close_logging()
        print(f"UI 실행 오류: {exc}", file=sys.stderr)
        return 1


def main() -> None:
    """Module entry point."""
    raise SystemExit(run_ui())


if __name__ == "__main__":
    main()



