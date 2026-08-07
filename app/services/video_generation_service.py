"""Sequential Runway scene-video generation, recovery, and review."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import re
import shutil
from threading import Event
import time
from typing import Any, Callable

from app.adapters.runway_video_adapter import (
    RunwayAPIError,
    RunwayTask,
    RunwayVideoAdapter,
)
from app.config.config import AppConfig
from app.core.project_context import ProjectContext, WorkflowState
from app.engines.ffmpeg_engine import FFmpegEngine
from app.services.api_job_manager import APIJob, APIJobManager
from app.services.budget_manager import BudgetManager
from app.services.memory_manager import MemoryManager
from app.services.reference_asset_manager import (
    ReferenceAssetError,
    validate_image_file,
)


ProgressCallback = Callable[[dict[str, Any]], None]
Sleep = Callable[[float], None]


class VideoGenerationStopped(RuntimeError):
    """Raised after the current submitted task finishes and no new task starts."""


@dataclass(frozen=True, slots=True)
class VideoPromptPreview:
    """Editable preflight information that cannot itself call Runway."""

    scene_number: int
    prompt: str
    image_path: Path
    model: str
    ratio: str
    duration_seconds: int
    estimated_cost_usd: float


def _scene_value(scene: dict[str, Any], *keys: str) -> str:
    for key in keys:
        value = scene.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _motion_summary_value(summary: str, label: str) -> str:
    """Read one value from persisted human-readable motion summaries."""
    prefix = f"{label}:"
    for line in summary.splitlines():
        if line.strip().startswith(prefix):
            return line.split(":", 1)[1].strip()
    return ""


def _legacy_motion_is_usable(value: str) -> bool:
    """Reject old meta-instructions that were mistakenly stored as motion."""
    markers = (
        "작성하십시오", "write motion", "권장 길이",
        "왜곡 방지 조건",
    )
    lowered = value.casefold()
    return bool(value.strip()) and not any(
        marker.casefold() in lowered for marker in markers
    )


def _utf16_length(value: str) -> int:
    return len(value.encode("utf-16-le")) // 2


def runway_ratio_for_project(
    context: ProjectContext,
    fallback: str = "720:1280",
) -> str:
    """Match Runway orientation to the reviewed source images.

    The persisted Wizard aspect is only a fallback for legacy or unreadable
    files.  This prevents a stale/missing setting from turning a landscape
    OpenAI image into a portrait Runway request.
    """
    orientations: set[str] = set()
    for value in context.generated_images:
        path = Path(value)
        try:
            width, height, _digest = validate_image_file(path)
        except (ReferenceAssetError, OSError, ValueError):
            continue
        if width > height:
            orientations.add("1280:720")
        elif height > width:
            orientations.add("720:1280")
    if len(orientations) > 1:
        raise ValueError(
            "검토된 장면 이미지의 가로·세로 방향이 서로 다릅니다. "
            "Runway 요청 전에 이미지 비율을 통일하세요."
        )
    if orientations:
        return orientations.pop()

    aspect = str(context.style_profile.get("aspect", "")).strip().replace(" ", "")
    if aspect == "16:9":
        return "1280:720"
    if aspect == "9:16":
        return "720:1280"
    return fallback if fallback in {"720:1280", "1280:720"} else "720:1280"


def _fit_runway_prompt(
    fixed_start: list[str],
    sections: list[list[str]],
    fixed_end: list[str],
    limit: int = 1000,
) -> str:
    """Fit complete prompt sections without splicing incomplete sentences."""
    priority = {
        "Main action": 0,
        "Ending movement": 1,
        "Motivated camera": 2,
        "Opening movement": 3,
        "Continuity cue": 4,
        "Performance": 5,
        "Environment": 6,
        "Pacing": 7,
    }

    def normalize(value: str) -> str:
        compact = re.sub(r"\s+", " ", value).strip()
        # Story output occasionally repeats the exact same full sentence.
        sentences = re.split(r"(?<=[.!?。！？])\s+", compact)
        unique: list[str] = []
        seen: set[str] = set()
        for sentence in sentences:
            key = sentence.casefold().strip()
            if key and key not in seen:
                unique.append(sentence.strip())
                seen.add(key)
        return " ".join(unique)

    normalized_sections: list[list[str]] = []
    exact_values: set[str] = set()
    for label, raw_value in sections:
        value = normalize(raw_value)
        key = value.casefold()
        if key and key in exact_values:
            value = ""
        elif key:
            exact_values.add(key)
        normalized_sections.append([label, value])
    sections = normalized_sections

    def render() -> str:
        return "\n".join(
            fixed_start
            + [f"{label}: {value}" for label, value in sections if value]
            + fixed_end
        )

    # Admit complete fields by semantic importance, then render them in the
    # original chronological order. A field that cannot fit is omitted whole;
    # no prefix/suffix fragments or ellipsis are ever sent to the provider.
    original_sections = sections
    selected: set[int] = set()
    for index, (label, value) in sorted(
        enumerate(original_sections),
        key=lambda item: (priority.get(item[1][0], 99), item[0]),
    ):
        if not value:
            continue
        trial_selected = selected | {index}
        sections = [
            pair if position in trial_selected else [pair[0], ""]
            for position, pair in enumerate(original_sections)
        ]
        if _utf16_length(render()) <= limit:
            selected = trial_selected
    sections = [
        pair if position in selected else [pair[0], ""]
        for position, pair in enumerate(original_sections)
    ]
    prompt = render()
    if _utf16_length(prompt) > limit:
        raise ValueError("Runway prompt cannot fit the provider limit")
    return prompt


def _cinematic_pacing_for_scene(scene_number: int) -> str:
    """Give the six shots a deterministic dramatic arc without inventing action."""
    pacing = {
        1: (
            "start restrained, build visible tension gradually, then hold the "
            "ending pose briefly"
        ),
        2: (
            "increase momentum through the main action with stronger depth and "
            "foreground parallax"
        ),
        3: (
            "intensify the performance and camera proximity toward a clear "
            "emotional turning point"
        ),
        4: (
            "deliver the strongest readable action and camera energy, then land "
            "on a decisive pose"
        ),
        5: (
            "carry residual energy briefly, then decelerate into charged "
            "stillness for contrast"
        ),
        6: (
            "resolve the action decisively and settle into a memorable final "
            "composition with a short lingering hold"
        ),
    }
    return pacing[scene_number]


def _active_camera_for_scene(
    scene_number: int,
    story_camera: str,
    action_text: str,
) -> str:
    """Create one motivated camera move suited to action and story position.

    This is deliberately local and deterministic: it improves visual attention
    without an extra AI call or inventing a second subject action.
    """
    action = action_text.casefold()
    if any(token in action for token in ("달리", "추격", "쫓", "run", "chase")):
        move = (
            "track laterally with the subject using strong foreground parallax, "
            "then make a short inward arc at the action beat"
        )
    elif any(token in action for token in ("추락", "떨어", "낙하", "fall", "drop")):
        move = (
            "descend with the action in a controlled crane-and-tilt move, then "
            "settle at the subject's eye line"
        )
    elif any(token in action for token in ("발견", "드러", "나타", "reveal", "discover")):
        move = (
            "make a deliberate dolly-in followed by a compact 20-degree arc, "
            "landing the revealed subject on a strong third"
        )
    elif any(token in action for token in ("대치", "전투", "공격", "fight", "confront")):
        move = (
            "make a decisive diagonal push with controlled lateral parallax, "
            "landing close on the emotional action beat"
        )
    else:
        move = {
            1: (
                "begin wide, then make a deliberate diagonal dolly-in with "
                "foreground parallax to establish depth and focus"
            ),
            2: (
                "track laterally with the subject, then tighten through a short "
                "inward arc at the main action"
            ),
            3: (
                "use a controlled 25-degree orbit that tightens from medium-wide "
                "to medium on the emotional turn"
            ),
            4: (
                "make the most energetic diagonal push-in with foreground "
                "parallax, landing firmly on the climax"
            ),
            5: (
                "counter-track across the subject, then transition into a "
                "measured pullback that reveals the consequence"
            ),
            6: (
                "sweep backward on a rising crane with a gentle arc, revealing "
                "the full final composition before a brief hold"
            ),
        }[scene_number]
    cleaned_intent = re.sub(
        r"\b(very slowly|slowly|static)\b|아주\s*천천히|천천히|고정된?",
        "",
        story_camera,
        flags=re.IGNORECASE,
    )
    cleaned_intent = re.sub(r"\s+", " ", cleaned_intent).strip(" ,.;")
    if cleaned_intent:
        return f"{move}. Preserve this framing intent: {cleaned_intent}"
    return move


def build_runway_scene_prompt(
    context: ProjectContext,
    scene_number: int,
) -> str:
    """Build one motion-only prompt with automatic prior-scene continuity."""
    if not 1 <= scene_number <= 6:
        raise ValueError("scene_number must be between 1 and 6")
    scene = (
        context.scenes[scene_number - 1]
        if len(context.scenes) >= scene_number
        else {}
    )
    previous = (
        context.scenes[scene_number - 2]
        if scene_number > 1 and len(context.scenes) >= scene_number - 1
        else {}
    )
    current_summary = (
        context.motion_prompts[scene_number - 1].strip()
        if len(context.motion_prompts) >= scene_number
        else ""
    )
    previous_summary = (
        context.motion_prompts[scene_number - 2].strip()
        if scene_number > 1
        and len(context.motion_prompts) >= scene_number - 1
        else ""
    )
    previous_motion = _scene_value(
        previous, "end_motion", "ending_motion", "motion_end"
    ) or _motion_summary_value(previous_summary, "종료 움직임")
    previous_hint = _scene_value(previous, "continuity_hint")
    if previous_hint and previous_hint not in previous_motion:
        previous_motion = " ".join(
            part for part in (previous_motion, previous_hint) if part
        )
    visual_action = _scene_value(
        scene, "visual_action", "visual_description", "action", "scene"
    )
    description = _scene_value(scene, "description")
    start_motion = _scene_value(
        scene, "start_motion", "starting_motion", "motion_start"
    ) or _motion_summary_value(current_summary, "시작 움직임")
    main_motion = _scene_value(
        scene, "main_motion", "motion"
    ) or _motion_summary_value(current_summary, "주요 움직임")
    if not main_motion and _legacy_motion_is_usable(current_summary):
        main_motion = current_summary
    main_motion = main_motion or visual_action or description
    end_motion = _scene_value(
        scene, "end_motion", "ending_motion", "motion_end"
    ) or _motion_summary_value(current_summary, "종료 움직임")
    end_motion = end_motion or _scene_value(scene, "continuity_hint")
    camera = _scene_value(
        scene, "camera_motion", "camera", "shot", "composition"
    ) or _motion_summary_value(current_summary, "카메라 움직임")
    environment = _scene_value(
        scene, "environment_motion", "background_motion"
    ) or _motion_summary_value(current_summary, "환경 움직임")
    intensity = _scene_value(
        scene, "motion_intensity"
    ) or _motion_summary_value(current_summary, "움직임 강도")
    speed = _scene_value(
        scene, "motion_speed"
    ) or _motion_summary_value(current_summary, "움직임 속도")
    expression = _scene_value(
        scene, "expression_change"
    ) or _motion_summary_value(current_summary, "표정 변화")

    action_text = " ".join(
        value for value in (start_motion, main_motion, end_motion) if value
    )
    active_camera = _active_camera_for_scene(
        scene_number, camera, action_text
    )
    pacing_parts = [_cinematic_pacing_for_scene(scene_number)]
    if speed:
        pacing_parts.append(f"motion speed {speed}")
    if intensity:
        pacing_parts.append(f"intensity {intensity}")
    transformation = any(
        marker in action_text.casefold()
        for marker in (
            "사라", "소멸", "변신", "변형", "disappear", "dissolv", "transform"
        )
    )
    consistency = (
        "Keep anatomy, clothing and identity stable until the specified final "
        "transformation; preserve essential objects, lighting and continuity."
        if transformation else
        "Maintain stable identity, anatomy, clothing, essential objects, "
        "lighting and scene continuity throughout the shot."
    )

    ratio = runway_ratio_for_project(context)
    orientation = "horizontal" if ratio == "1280:720" else "vertical"
    return _fit_runway_prompt(
        [
            f"Create one continuous cinematic 5-second {orientation} "
            "image-to-video shot from "
            "the supplied exact first frame.",
        ],
        [
            ["Continuity cue", previous_motion],
            ["Opening movement", start_motion or (
                "begin naturally from the exact pose and gaze in the image"
            )],
            ["Main action", main_motion],
            ["Performance", expression],
            ["Ending movement", end_motion or (
                "settle into a stable, readable pose for the next scene"
            )],
            ["Motivated camera", active_camera],
            ["Environment", environment],
            ["Pacing", "; ".join(pacing_parts)],
        ],
        [consistency],
        limit=750,
    )


class VideoGenerationService:
    """Coordinate existing project state with one sequential Runway task queue."""

    CREDIT_COST_USD = 0.01
    GEN4_TURBO_CREDITS_PER_SECOND = 5

    def __init__(
        self,
        config: AppConfig,
        *,
        adapter: RunwayVideoAdapter | None = None,
        budget_manager: BudgetManager | None = None,
        job_manager: APIJobManager | None = None,
        ffmpeg_engine: FFmpegEngine | None = None,
        sleep: Sleep = time.sleep,
    ) -> None:
        if adapter is None and not config.runway_api_secret:
            raise ValueError("RUNWAYML_API_SECRET is required")
        self.config = config
        self.adapter = adapter or RunwayVideoAdapter(
            config.runway_api_secret or "",
            model=config.runway_model,
            timeout_seconds=config.runway_request_timeout_seconds,
        )
        self.memory = MemoryManager(
            config.project_root / "learning_data" / "projects"
        )
        self.budget = budget_manager or BudgetManager(
            config.project_root
            / "learning_data"
            / "runway_budget_usage.json",
            config.runway_monthly_budget_usd,
            config.budget_warning_threshold,
        )
        self.jobs = job_manager or APIJobManager(
            config.project_root / "learning_data" / "api_jobs.json",
            config.app_max_concurrent_api_jobs,
        )
        self.ffmpeg = ffmpeg_engine or FFmpegEngine(
            config.ffmpeg_binary, config.ffprobe_binary
        )
        self._sleep = sleep
        self._stop = Event()

    @property
    def scene_estimated_cost_usd(self) -> float:
        """Return the conservative local Runway estimate for one scene."""
        return round(
            self.config.runway_duration_seconds
            * self.GEN4_TURBO_CREDITS_PER_SECOND
            * self.CREDIT_COST_USD,
            8,
        )

    def previews(self, context: ProjectContext) -> list[VideoPromptPreview]:
        """Build six editable previews without performing network activity."""
        if len(context.generated_images) != 6:
            raise ValueError("Six approved generated images are required")
        ratio = runway_ratio_for_project(context, self.config.runway_ratio)
        return [
            VideoPromptPreview(
                scene_number=number,
                prompt=build_runway_scene_prompt(context, number),
                image_path=Path(context.generated_images[number - 1]),
                model=self.config.runway_model,
                ratio=ratio,
                duration_seconds=self.config.runway_duration_seconds,
                estimated_cost_usd=self.scene_estimated_cost_usd,
            )
            for number in range(1, 7)
        ]

    def request_stop(self) -> None:
        """Prevent submission of the next scene; do not cancel a paid task."""
        self._stop.set()

    def expected_new_paid_requests(
        self,
        context: ProjectContext,
        *,
        retry_scene: int | None = None,
        force_all: bool = False,
    ) -> int:
        """Count only provider tasks that a confirmed action would newly submit.

        Completed local files and already-submitted, non-terminal Runway tasks
        are recovery work, not new paid requests.  An explicit single-scene or
        full regeneration always creates a new provider task.
        """
        if retry_scene is not None:
            return 1
        if force_all:
            return 6
        active_statuses = {
            "PENDING", "THROTTLED", "RUNNING", "SUCCEEDED", "SUBMITTED"
        }
        count = 0
        for scene_number in range(1, 7):
            record = self._record(context, scene_number)
            destination = (
                self._video_directory(context) / f"scene{scene_number}.mp4"
            )
            status = str(record.get("status", "")).upper()
            if (
                status == "SUCCEEDED"
                and destination.is_file()
                and destination.stat().st_size > 0
            ):
                continue
            if record.get("task_id") and status in active_statuses:
                continue
            count += 1
        return count

    def generate(
        self,
        context: ProjectContext,
        approved_prompts: list[str],
        *,
        progress: ProgressCallback = lambda event: None,
        retry_scene: int | None = None,
        force_all: bool = False,
    ) -> ProjectContext:
        """Generate or resume scene videos sequentially after explicit approval."""
        if len(approved_prompts) != 6 or any(
            not prompt.strip() for prompt in approved_prompts
        ):
            raise ValueError("Six approved Runway prompts are required")
        allowed = {
            WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
            WorkflowState.INTERRUPTED,
            WorkflowState.VIDEOS_READY,
            WorkflowState.REVIEWING_VIDEOS,
            WorkflowState.VIDEOS_APPROVED,
        }
        if context.workflow_state not in allowed:
            raise ValueError(
                "Video generation requires confirmation, recovery, or review state"
            )
        if retry_scene is not None and not 1 <= retry_scene <= 6:
            raise ValueError("retry_scene must be between 1 and 6")
        if retry_scene is not None and force_all:
            raise ValueError("retry_scene and force_all cannot be combined")
        self._stop.clear()
        if retry_scene is not None or force_all:
            context.video_reviews = [
                item for item in context.video_reviews
                if not force_all
                and int(item.get("scene_number", 0)) != retry_scene
            ]
        context.transition_to(WorkflowState.GENERATING_VIDEOS)
        self.memory.save(context)
        expected_calls = self.expected_new_paid_requests(
            context, retry_scene=retry_scene, force_all=force_all
        )
        job = self.jobs.begin(
            project_id=context.project_id,
            project_type=context.project_type,
            operation="runway_video_generation",
            resource_key=f"{context.project_id}:runway_video_generation",
            expected_api_calls=expected_calls,
        )
        try:
            scene_numbers = [retry_scene] if retry_scene else list(range(1, 7))
            for scene_number in scene_numbers:
                if self._stop.is_set():
                    self._mark_interrupted(context, "사용자가 다음 장면 제출을 중지했습니다.")
                    raise VideoGenerationStopped(
                        "No new Runway task was submitted after the stop request"
                    )
                self._generate_scene(
                    context,
                    scene_number,
                    approved_prompts[scene_number - 1],
                    job,
                    progress,
                    force=force_all or retry_scene == scene_number,
                )
            if retry_scene is not None and not self._all_scene_files_exist(context):
                self._mark_interrupted(
                    context, "아직 생성되지 않은 장면 영상이 있습니다."
                )
                self.jobs.finish(job, "interrupted")
                return context
            context.transition_to(WorkflowState.VIDEOS_READY)
            context.transition_to(WorkflowState.REVIEWING_VIDEOS)
            self.memory.save(context)
            self.jobs.finish(job, "completed")
            progress({"kind": "completed", "scene_number": 6})
            return context
        except VideoGenerationStopped:
            self.jobs.finish(job, "cancelled")
            raise
        except Exception as exc:
            if context.workflow_state == WorkflowState.GENERATING_VIDEOS:
                self._mark_interrupted(context, str(exc))
            self.jobs.finish(
                job, "failed", error_category=type(exc).__name__
            )
            raise

    def approve_scene(
        self, context: ProjectContext, scene_number: int, approved: bool
    ) -> ProjectContext:
        """Persist a local video-review decision without copying to Asset Library."""
        if context.workflow_state not in {
            WorkflowState.REVIEWING_VIDEOS,
            WorkflowState.VIDEOS_READY,
        }:
            raise ValueError("Video review is not available in the current state")
        reviews = {
            int(item.get("scene_number", 0)): dict(item)
            for item in context.video_reviews
        }
        reviews[scene_number] = {
            "scene_number": scene_number,
            "approved": bool(approved),
        }
        context.video_reviews = [
            reviews[number] for number in sorted(reviews)
        ]
        if context.workflow_state == WorkflowState.VIDEOS_READY:
            context.transition_to(WorkflowState.REVIEWING_VIDEOS)
        if all(
            reviews.get(number, {}).get("approved") for number in range(1, 7)
        ):
            context.transition_to(WorkflowState.VIDEOS_APPROVED)
        self.memory.save(context)
        return context

    def _generate_scene(
        self,
        context: ProjectContext,
        scene_number: int,
        prompt: str,
        job: APIJob,
        progress: ProgressCallback,
        *,
        force: bool,
    ) -> None:
        image_path = Path(context.generated_images[scene_number - 1])
        if not image_path.is_file():
            raise FileNotFoundError(image_path)
        destination = self._video_directory(context) / f"scene{scene_number}.mp4"
        ratio = runway_ratio_for_project(context, self.config.runway_ratio)
        input_hash = self._input_hash(image_path, prompt, ratio=ratio)
        record = self._record(context, scene_number)
        if (
            not force
            and str(record.get("status", "")).upper() == "SUCCEEDED"
            and destination.is_file()
            and destination.stat().st_size > 0
        ):
            progress({"kind": "skipped", "scene_number": scene_number})
            self._set_generated_path(context, scene_number, destination)
            return
        previous_output_path = ""
        if force and destination.is_file() and destination.stat().st_size > 0:
            history = destination.parent.parent / "history"
            history.mkdir(parents=True, exist_ok=True)
            timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            backup = history / f"scene{scene_number}_{timestamp}.mp4"
            shutil.copy2(destination, backup)
            previous_output_path = str(backup)
        progress({"kind": "submitting", "scene_number": scene_number})
        task_id = ""
        if (
            not force
            and record.get("task_id")
            and str(record.get("status", "")).upper() in {
                "PENDING", "THROTTLED", "RUNNING", "SUCCEEDED", "SUBMITTED"
            }
        ):
            task_id = str(record["task_id"])
        else:
            task_id = self.budget.run_budgeted(
                context.project_id,
                "video",
                lambda: self.adapter.create_image_to_video(
                    image_path,
                    prompt,
                    ratio=ratio,
                    duration=self.config.runway_duration_seconds,
                ),
                estimated_cost_usd=self.scene_estimated_cost_usd,
            )
            self.jobs.record_call(
                job,
                call_type="runway_image_to_video",
                model=self.config.runway_model,
                status="succeeded",
                provider_request_id=task_id,
            )
            record = {
                "scene_number": scene_number,
                "task_id": task_id,
                "input_hash": input_hash,
                "prompt": prompt,
                "status": "submitted",
                "estimated_cost_usd": self.scene_estimated_cost_usd,
                "ratio": ratio,
            }
            if previous_output_path:
                record["previous_output_path"] = previous_output_path
            self._replace_record(context, record)
            self.memory.save(context)
        task = self._poll_task(context, record, progress)
        if task.status != "SUCCEEDED" or not task.output_urls:
            record["status"] = task.status
            record["error"] = task.failure or "Runway task failed"
            self._replace_record(context, record)
            self.memory.save(context)
            raise RunwayAPIError(
                f"Scene {scene_number} Runway task failed "
                f"(Task ID: {task.task_id}): {record['error']}"
            )
        progress({"kind": "downloading", "scene_number": scene_number})
        self.adapter.download_output(task.output_urls[0], destination)
        record["status"] = "succeeded"
        record["output_path"] = str(destination)
        self._replace_record(context, record)
        self._set_generated_path(context, scene_number, destination)
        continuity = (
            self.memory.project_directory(context.project_directory_name)
            / "videos"
            / "continuity"
            / f"scene{scene_number}_last.png"
        )
        try:
            self.ffmpeg.extract_last_frame(destination, continuity)
            record["last_frame_path"] = str(continuity)
            self._replace_record(context, record)
        except Exception as exc:
            context.warnings.append(
                f"Scene {scene_number} 마지막 프레임 추출 실패: {exc}"
            )
        self.memory.save(context)
        progress({"kind": "scene_completed", "scene_number": scene_number})

    def _poll_task(
        self,
        context: ProjectContext,
        record: dict[str, Any],
        progress: ProgressCallback,
    ) -> RunwayTask:
        deadline = time.monotonic() + self.config.runway_task_timeout_seconds
        while time.monotonic() < deadline:
            task = self.adapter.get_task(str(record["task_id"]))
            record["status"] = task.status
            self._replace_record(context, record)
            self.memory.save(context)
            progress({
                "kind": "polling",
                "scene_number": int(record["scene_number"]),
                "status": task.status,
                "task_progress": task.progress,
            })
            if task.terminal:
                return task
            self._sleep(self.config.runway_poll_interval_seconds)
        raise TimeoutError("Runway task polling timed out")

    def _video_directory(self, context: ProjectContext) -> Path:
        path = (
            self.memory.project_directory(context.project_directory_name)
            / "videos"
            / "runway"
        )
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _record(
        self, context: ProjectContext, scene_number: int
    ) -> dict[str, Any]:
        return next(
            (
                dict(item)
                for item in context.video_generation_records
                if int(item.get("scene_number", 0)) == scene_number
            ),
            {},
        )

    def _replace_record(
        self, context: ProjectContext, record: dict[str, Any]
    ) -> None:
        number = int(record["scene_number"])
        records = [
            dict(item)
            for item in context.video_generation_records
            if int(item.get("scene_number", 0)) != number
        ]
        records.append(dict(record))
        context.video_generation_records = sorted(
            records, key=lambda item: int(item["scene_number"])
        )

    @staticmethod
    def _set_generated_path(
        context: ProjectContext, scene_number: int, path: Path
    ) -> None:
        values = list(context.generated_video_paths)
        while len(values) < 6:
            values.append("")
        values[scene_number - 1] = str(path)
        context.generated_video_paths = values

    @staticmethod
    def _all_scene_files_exist(context: ProjectContext) -> bool:
        return len(context.generated_video_paths) == 6 and all(
            value and Path(value).is_file() and Path(value).stat().st_size > 0
            for value in context.generated_video_paths
        )

    def _mark_interrupted(
        self, context: ProjectContext, message: str
    ) -> None:
        context.errors.append(message)
        context.transition_to(WorkflowState.INTERRUPTED)
        self.memory.save(context)

    def _input_hash(
        self, image_path: Path, prompt: str, *, ratio: str | None = None
    ) -> str:
        digest = sha256()
        digest.update(image_path.read_bytes())
        digest.update(prompt.encode("utf-8"))
        digest.update(self.config.runway_model.encode("ascii"))
        digest.update((ratio or self.config.runway_ratio).encode("ascii"))
        digest.update(str(self.config.runway_duration_seconds).encode("ascii"))
        return digest.hexdigest()
