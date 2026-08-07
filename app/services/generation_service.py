"""Composition root for the real OpenAI story and image workflow."""

from __future__ import annotations

from datetime import datetime, timezone
import hashlib
from pathlib import Path
from typing import Any, Callable
from uuid import uuid4

from app.adapters.openai_image_adapter import OpenAIImageAdapter
from app.adapters.openai_story_adapter import OpenAIStoryAdapter
from app.config.config import AppConfig
from app.core.project_context import ProjectContext, WorkflowState
from app.engines.image_engine import ImageEngine
from app.engines.image_pipeline import ImagePipeline
from app.engines.prompt_manager import PromptManager
from app.engines.story_engine import StoryEngine
from app.services.api_call_guard import APICallGuard
from app.services.api_job_manager import APIJob, APIJobManager
from app.services.budget_manager import BudgetManager
from app.services.asset_library import AssetLibrary
from app.services.generated_image_manager import GeneratedImageManager
from app.services.memory_manager import MemoryManager
from app.services.image_review_service import ProjectImageReviewService
from app.services.project_asset_mapping import (
    ProjectAssetMappingStore,
    ProjectAssetResolver,
    SceneAssetMatcher,
    describe_reference_selection,
    extract_scene_entities,
    script_fingerprint,
)
from app.services.reference_asset_manager import (
    ProjectReferenceManager,
    ReferenceAssetError,
)
from app.services.reference_migration import LegacyReferenceMigrator


ProgressCallback = Callable[[str], None]
AUTONOMOUS_SETTING = "자율"
STORY_ASSET_TYPE_LABELS = {
    "character": "캐릭터",
    "background": "배경",
    "object": "소품",
    "style": "시각 스타일",
    "general_reference": "일반 참고자료",
}
IMAGE_SIZE_BY_ASPECT = {
    "16:9": "1536x1024",
    "9:16": "1024x1536",
    "1:1": "1024x1024",
}


def image_size_for_aspect(aspect_ratio: str, fallback: str) -> str:
    """Map a Wizard aspect ratio to an OpenAI-supported image size."""
    normalized = aspect_ratio.strip().replace(" ", "")
    return IMAGE_SIZE_BY_ASPECT.get(normalized, fallback)


def generate_image_at_size(
    adapter: Any,
    prompt: str,
    references: list[Path],
    size: str,
) -> bytes:
    """Use per-request size when supported, retaining Fake/legacy adapters."""
    sized = getattr(adapter, "generate_for_size", None)
    if callable(sized):
        return sized(prompt, references, size)
    return adapter.generate(prompt, references)


def format_scene_composition(scene: dict[str, object]) -> str:
    """Render image-only framing while keeping legacy scenes compatible."""
    return "\n".join((
        f"- 샷 크기: {scene.get('shot_size') or '장면 내용에 맞는 샷 크기'}",
        f"- 카메라 앵글: {scene.get('camera_angle') or '장면 내용에 맞는 앵글'}",
        f"- 화면 구도: {scene.get('composition') or scene.get('visual_action') or '핵심 행동이 명확한 구도'}",
        f"- 렌즈·원근감: {scene.get('lens_feel') or '자연스러운 영화적 원근감'}",
        f"- 핵심 초점 대상: {scene.get('focus_subject') or scene.get('visual_action') or '장면의 핵심 인물과 행동'}",
    ))


def resolve_named_character_asset(
    library: AssetLibrary, character_name: str
) -> tuple[str | None, str]:
    """Resolve one exact Character name and describe it for Story prompting."""
    asset = library.find_character_by_representative_name(character_name)
    if asset is None:
        return None, "대표 이름과 정확히 일치하는 Character Asset 없음"
    metadata = "\n".join((
        f"이름: {asset.display_name}",
        "유형: "
        + STORY_ASSET_TYPE_LABELS.get(asset.asset_type, asset.asset_type),
        f"설명: {asset.description or '별도 설명 없음'}",
    ))
    return asset.asset_id, metadata


def describe_story_assets(
    library: AssetLibrary,
    asset_ids: list[str] | set[str],
    *,
    exclude_asset_ids: set[str] | None = None,
) -> str:
    """Describe selected Assets once for Story API text-only context."""
    blocks: list[str] = []
    excluded = exclude_asset_ids or set()
    for asset_id in sorted(asset_ids):
        if asset_id in excluded:
            continue
        asset = library.get(asset_id)
        lines = [
            f"- 이름: {asset.display_name}",
            "  유형: "
            + STORY_ASSET_TYPE_LABELS.get(asset.asset_type, asset.asset_type),
            f"  설명: {asset.description or '별도 설명 없음'}",
        ]
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks) or "없음"


def describe_scene_reference_assets(
    library: AssetLibrary,
    asset_purposes: dict[str, str] | None,
) -> str:
    """Describe non-character scene references and their project-local use."""
    blocks: list[str] = []
    for asset_id, purpose in sorted((asset_purposes or {}).items()):
        asset = library.get(asset_id)
        lines = [
            f"- 이름: {asset.display_name}",
            "  유형: "
            + STORY_ASSET_TYPE_LABELS.get(asset.asset_type, asset.asset_type),
            f"  설명: {asset.description or '별도 설명 없음'}",
            f"  사용 목적: {purpose.strip() or '장면 대본에 필요할 때 참고'}",
        ]
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks) or "없음"


def describe_asset_folders(
    library: AssetLibrary, asset_ids: list[str] | set[str]
) -> str:
    """Backward-compatible alias for the previous public helper name."""
    return describe_story_assets(library, asset_ids)


def build_project_character_cast(
    library: AssetLibrary,
    lead_name: str,
    candidate_asset_ids: list[str] | set[str],
    supplied_cast: list[dict[str, Any]] | None = None,
) -> list[dict[str, str]]:
    """Build one project-local cast from reusable Character Assets."""
    supplied_by_id = {
        str(item.get("asset_id", "")): item
        for item in (supplied_cast or [])
        if isinstance(item, dict) and item.get("asset_id")
    }
    lead_asset = library.find_character_by_representative_name(lead_name)
    character_ids: set[str] = set()
    for asset_id in candidate_asset_ids:
        asset = library.get(asset_id)
        if asset.asset_type == "character":
            character_ids.add(asset_id)
    if lead_asset is not None:
        character_ids.add(lead_asset.asset_id)

    cast: list[dict[str, str]] = []
    lead_assigned = False
    for asset_id in sorted(character_ids):
        asset = library.get(asset_id)
        supplied = supplied_by_id.get(asset_id, {})
        requested_role = str(supplied.get("cast_role", "")).strip().lower()
        is_named_lead = (
            lead_asset is not None and asset.asset_id == lead_asset.asset_id
        )
        cast_role = (
            "lead"
            if not lead_assigned and (is_named_lead or requested_role == "lead")
            else "supporting"
        )
        if cast_role == "lead":
            lead_assigned = True
        default_story_role = (
            "주인공" if cast_role == "lead" else "서브 캐릭터"
        )
        cast.append({
            "asset_id": asset.asset_id,
            "name": asset.display_name,
            "cast_role": cast_role,
            "story_role": (
                str(supplied.get("story_role", "")).strip()
                or default_story_role
            ),
            "description": asset.description or "별도 설명 없음",
        })
    return sorted(
        cast, key=lambda item: (item["cast_role"] != "lead", item["name"])
    )


def describe_character_cast(cast: list[dict[str, str]]) -> str:
    """Render project cast metadata without tags, aliases, or image paths."""
    if not cast:
        return "등록된 Character Asset 없음"
    blocks = []
    for index, item in enumerate(cast, start=1):
        blocks.append("\n".join((
            f"{index}. 이름: {item['name']}",
            "   구분: "
            + ("대표 캐릭터" if item["cast_role"] == "lead" else "서브 캐릭터"),
            f"   이야기 역할: {item['story_role']}",
            f"   설명: {item['description']}",
        )))
    return "\n\n".join(blocks)


def short_scene_continuity_option(
    projects_root: Path,
    project_id: str,
) -> dict[str, Any]:
    """Return one approved short project's last scene as a continuity source."""
    memory = MemoryManager(projects_root)
    source = memory.load(project_id)
    allowed_states = {
        WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
        WorkflowState.GENERATING_VIDEOS,
        WorkflowState.VIDEOS_READY,
        WorkflowState.REVIEWING_VIDEOS,
        WorkflowState.VIDEOS_APPROVED,
        WorkflowState.RENDERING,
        WorkflowState.COMPLETED,
    }
    if source.workflow_state not in allowed_states:
        raise ValueError("이미지 승인이 끝난 프로젝트만 연결할 수 있습니다.")
    if len(source.generated_images) < 6 or len(source.scenes) < 6:
        raise ValueError("이전 프로젝트의 마지막 장면이 없습니다.")
    path = Path(source.generated_images[5]).resolve()
    source_root = memory.project_directory(project_id).resolve()
    if source_root not in path.parents or not path.is_file():
        raise ValueError("이전 프로젝트의 마지막 장면 파일을 찾을 수 없습니다.")
    scene = source.scenes[5]
    scene_description = str(scene.get("description", "")).strip()
    ending = str(source.story.get("ending", "")).strip()
    project_name = str(
        source.lore_context.get("project_name")
        or source.story.get("title")
        or source.topic
    ).strip()
    story_context = "\n".join((
        f"이전 프로젝트: {project_name}",
        f"이전 영상 주제: {source.topic}",
        f"마지막 장면: {scene_description or '별도 설명 없음'}",
        f"이전 결말: {ending or '별도 결말 설명 없음'}",
        "위 마지막 상황과 자연스럽게 이어지는 첫 장면을 작성하십시오.",
    ))
    return {
        "source_kind": "short_project",
        # Short-project continuity is opt-in.  The service also checks this
        # marker so stale or programmatically copied project metadata cannot
        # silently add a previous scene to a new paid image request.
        "user_selected": True,
        "project_id": project_id,
        "project_name": project_name,
        "scene_number": 6,
        "story_context": story_context,
        "image_path": str(path),
    }


def user_selected_short_scene_link(
    value: dict[str, Any] | None,
) -> dict[str, Any]:
    """Return a short-project continuity link only after explicit opt-in."""
    if not isinstance(value, dict):
        return {}
    if value.get("source_kind") != "short_project":
        return {}
    if value.get("user_selected") is not True:
        return {}
    return dict(value)


def render_short_story_prompt(
    prompt_manager: PromptManager,
    *,
    topic: str,
    genre: str,
    mood: str,
    duration_seconds: int,
    scene_count: int,
    additional_notes: str,
    character: str,
    lore: str,
    project_name: str = "",
    full_story: str = "",
    style_notes: dict[str, str] | None = None,
    character_asset_metadata: str = "",
    character_cast_metadata: str = "",
    atmosphere_asset_metadata: str = "",
    scene_reference_asset_metadata: str = "",
    project_asset_metadata: str = "",
    asset_folder_metadata: str = "",
    previous_scene_context: str = "",
) -> str:
    """Render the one canonical short-story prompt used by preview and API."""
    visual = dict(style_notes or {})
    return prompt_manager.render(
        "story/story_generation",
        {
            "project_name": project_name or "별도 이름 없음",
            "topic": topic,
            "full_story": full_story or "별도 전체 줄거리 없음",
            "genre": genre,
            "character": character,
            "character_asset_metadata": (
                character_asset_metadata
                or "대표 이름과 정확히 일치하는 Character Asset 없음"
            ),
            "character_cast_metadata": (
                character_cast_metadata
                or character_asset_metadata
                or "등록된 Character Asset 없음"
            ),
            "atmosphere_asset_metadata": (
                atmosphere_asset_metadata
                or "선택한 전체 분위기 Reference Asset 없음"
            ),
            "scene_reference_asset_metadata": (
                scene_reference_asset_metadata
                or "선택한 장면 참고 Asset 없음"
            ),
            "project_asset_metadata": (
                project_asset_metadata or asset_folder_metadata
                or "선택한 추가 Asset 없음"
            ),
            "previous_scene_context": (
                previous_scene_context or "연결된 이전 이야기 없음"
            ),
            "lore": lore.strip() or AUTONOMOUS_SETTING,
            "mood": mood,
            "visual_style": visual.get("visual_style") or AUTONOMOUS_SETTING,
            "color": visual.get("color") or AUTONOMOUS_SETTING,
            "lighting": visual.get("lighting") or AUTONOMOUS_SETTING,
            "camera": visual.get("camera") or AUTONOMOUS_SETTING,
            "dialogue": visual.get("dialogue") or AUTONOMOUS_SETTING,
            "avoid": visual.get("avoid") or AUTONOMOUS_SETTING,
            "aspect": visual.get("aspect") or "별도 지정 없음",
            "duration_seconds": duration_seconds,
            "scene_count": scene_count,
            "additional_notes": additional_notes or "별도 지시 없음",
        },
    ).text


class GenerationService:
    """Build provider adapters outside the UI and execute one paid job."""

    def __init__(
        self,
        config: AppConfig,
        *,
        story_adapter: OpenAIStoryAdapter | None = None,
        image_adapter: OpenAIImageAdapter | None = None,
        budget_manager: BudgetManager | None = None,
    ) -> None:
        config.validate(require_api_key=True)
        self.config = config
        self.memory = MemoryManager(
            config.project_root / "learning_data" / "projects"
        )
        self.prompts = PromptManager(config.project_root / "prompts")
        self.prompts.initialize()
        self.story_adapter = story_adapter or OpenAIStoryAdapter(
            config.openai_api_key or "", config.openai_story_model,
            config.api_timeout_seconds, config.max_retries,
        )
        self.image_adapter = image_adapter or OpenAIImageAdapter(
            config.openai_api_key or "", config.openai_image_model,
            config.openai_image_size, config.openai_image_quality,
            config.openai_image_format, config.image_api_timeout_seconds,
            0,
        )
        self.guard = APICallGuard(
            config.project_root / "learning_data" / "api_calls.json",
            config.app_daily_api_call_limit,
        )
        self.jobs = APIJobManager(
            config.project_root / "learning_data" / "api_jobs.json",
            config.app_max_concurrent_api_jobs,
        )
        self.budget = budget_manager or BudgetManager(
            config.project_root / "learning_data" / "api_budget_usage.json",
            config.monthly_budget_usd,
            config.budget_warning_threshold,
        )

    def generate_project(
        self,
        topic: str,
        *,
        genre: str = "미스터리",
        mood: str = "시네마틱",
        duration_seconds: int = 30,
        scene_count: int = 6,
        additional_notes: str = "",
        character: str = "대표 캐릭터",
        lore: str = AUTONOMOUS_SETTING,
        reference_source_project_id: str | None = None,
        initial_reference_paths: list[Path] | None = None,
        project_name: str = "",
        full_story: str = "",
        style_notes: dict[str, str] | None = None,
        candidate_asset_ids: list[str] | None = None,
        folder_child_selections: dict[str, list[str]] | None = None,
        character_cast: list[dict[str, Any]] | None = None,
        atmosphere_asset_ids: list[str] | None = None,
        scene_reference_assets: dict[str, str] | None = None,
        previous_scene_link: dict[str, Any] | None = None,
        approved_story_prompt: str | None = None,
        original_story_prompt: str | None = None,
        story_prompt_approved_at: str = "",
        progress: ProgressCallback = lambda message: None,
        user_request_id: str | None = None,
        existing_project_id: str | None = None,
    ) -> ProjectContext:
        if duration_seconds <= 0:
            raise ValueError("duration_seconds must be positive")
        if scene_count != 6:
            raise ValueError("The short-project workflow requires exactly 6 scenes")
        character_asset_id, character_asset_metadata = (
            resolve_named_character_asset(
                AssetLibrary(self.config.project_root / "learning_data"),
                character,
            )
        )
        effective_candidate_ids = set(candidate_asset_ids or [])
        effective_atmosphere_ids = set(atmosphere_asset_ids or [])
        effective_scene_references = {
            str(asset_id): str(purpose).strip()
            for asset_id, purpose in (scene_reference_assets or {}).items()
            if str(asset_id).strip()
        }
        effective_candidate_ids.update(effective_atmosphere_ids)
        effective_candidate_ids.update(effective_scene_references)
        if character_asset_id is not None:
            effective_candidate_ids.add(character_asset_id)
        effective_folder_selections = {
            key: list(dict.fromkeys(value))
            for key, value in (folder_child_selections or {}).items()
        }
        if character_asset_id is not None:
            character_asset = AssetLibrary(
                self.config.project_root / "learning_data"
            ).get(character_asset_id)
            if (
                character_asset.is_folder
                and character_asset_id not in effective_folder_selections
            ):
                children = AssetLibrary(
                    self.config.project_root / "learning_data"
                ).folder_children(character_asset)
                defaults = [
                    child.asset_id for child in children
                    if child.asset_id == character_asset.thumbnail_asset_id
                    or child.role == "front"
                ]
                effective_folder_selections[character_asset_id] = (
                    defaults[:2] or [child.asset_id for child in children[:1]]
                )
        project_cast = build_project_character_cast(
            AssetLibrary(self.config.project_root / "learning_data"),
            character,
            effective_candidate_ids,
            character_cast,
        )
        explicit_previous_scene_link = user_selected_short_scene_link(
            previous_scene_link
        )
        if approved_story_prompt is None:
            request_prompt = render_short_story_prompt(
                self.prompts,
                topic=topic,
                genre=genre,
                mood=mood,
                duration_seconds=duration_seconds,
                scene_count=scene_count,
                additional_notes=additional_notes,
                character=character,
                lore=lore,
                project_name=project_name,
                full_story=full_story,
                style_notes=style_notes,
                character_asset_metadata=character_asset_metadata,
                character_cast_metadata=describe_character_cast(project_cast),
                atmosphere_asset_metadata=describe_story_assets(
                    AssetLibrary(self.config.project_root / "learning_data"),
                    effective_atmosphere_ids,
                ),
                project_asset_metadata=describe_story_assets(
                    AssetLibrary(self.config.project_root / "learning_data"),
                    effective_candidate_ids,
                    exclude_asset_ids={
                        item["asset_id"] for item in project_cast
                    } | effective_atmosphere_ids | set(effective_scene_references),
                ),
                scene_reference_asset_metadata=describe_scene_reference_assets(
                    AssetLibrary(self.config.project_root / "learning_data"),
                    effective_scene_references,
                ),
                previous_scene_context=str(
                    explicit_previous_scene_link.get("story_context", "")
                ),
            )
            source_prompt = request_prompt
        else:
            # The preview already rendered the canonical request. Never render
            # it again after approval: this exact string is the adapter input.
            request_prompt = approved_story_prompt
            source_prompt = (
                original_story_prompt
                if original_story_prompt is not None
                else approved_story_prompt
            )
        if not request_prompt.strip():
            raise ValueError("Story Prompt가 비어 있어 요청할 수 없습니다.")
        original_prompt = source_prompt
        if existing_project_id:
            context = self.memory.load(existing_project_id)
            if context.workflow_state not in {
                WorkflowState.INIT,
                WorkflowState.READY,
                WorkflowState.FAILED,
                WorkflowState.CANCELLED,
            }:
                raise RuntimeError(
                    "대본 생성이 시작된 프로젝트의 기본 설정은 변경할 수 없습니다."
                )
            project_id = context.project_id
            context.topic = topic
            context.story = {}
            context.scenes = []
            context.errors = []
            context.warnings = []
            if context.workflow_state != WorkflowState.READY:
                context.workflow_state = WorkflowState.READY
        else:
            project_id = f"project_{uuid4().hex[:12]}"
            context = ProjectContext(project_id, topic)
        context.style_profile = {
            "genre": genre,
            "mood": mood,
        }
        context.character_profile = {
            "name": character,
            "cast": project_cast,
        }
        context.lore_context = {
            "lore": lore.strip() or AUTONOMOUS_SETTING,
            "full_story": full_story,
            "duration_seconds": duration_seconds,
            "scene_count": scene_count,
            "additional_notes": additional_notes,
            "project_name": project_name.strip(),
            "style_notes": dict(style_notes or {}),
            "candidate_asset_ids": sorted(effective_candidate_ids),
            "folder_child_selections": effective_folder_selections,
            "atmosphere_asset_ids": sorted(effective_atmosphere_ids),
            "scene_reference_assets": effective_scene_references,
            "previous_scene_link": explicit_previous_scene_link,
            "story_prompt_request": {
                "actual_prompt": request_prompt,
                "original_prompt": original_prompt,
                "modified": request_prompt != original_prompt,
                "sha256": hashlib.sha256(
                    request_prompt.encode("utf-8")
                ).hexdigest(),
                "approved_at": (
                    story_prompt_approved_at
                    or datetime.now(timezone.utc).isoformat()
                ),
                "model": self.config.openai_story_model,
                "character_count": len(request_prompt),
            },
        }
        job = self.jobs.begin(
            project_id=project_id,
            project_type="short_project",
            operation="short_project_generation",
            resource_key=f"short-generation:{topic.strip().lower()}",
            expected_api_calls=(
                self.config.app_max_story_calls_per_job
            ),
            user_request_id=user_request_id,
        )
        job_id = job.job_id
        self.guard.begin(project_id)
        try:
            references = ProjectReferenceManager(
                self.config.project_root / "learning_data" / "projects",
                project_id,
            )
            if effective_candidate_ids:
                learning_root = self.config.project_root / "learning_data"
                candidate_store = ProjectAssetMappingStore(
                    learning_root / "projects", project_id
                )
                candidate_library = AssetLibrary(learning_root)
                for asset_id in sorted(effective_candidate_ids):
                    candidate_store.add_candidate(
                        candidate_library.get(asset_id),
                        usage_role="candidate",
                        selected_child_asset_ids=(
                            effective_folder_selections.get(asset_id)
                        ),
                    )
            if (
                reference_source_project_id
                and reference_source_project_id != project_id
            ):
                learning_root = self.config.project_root / "learning_data"
                LegacyReferenceMigrator(learning_root).migrate_all()
                source_store = ProjectAssetMappingStore(
                    learning_root / "projects", reference_source_project_id,
                )
                destination_store = ProjectAssetMappingStore(
                    learning_root / "projects", project_id,
                )
                library = AssetLibrary(learning_root)
                for source_mapping in source_store.load_all():
                    if not source_mapping.enabled:
                        continue
                    copied = destination_store.add_candidate(
                        library.get(source_mapping.asset_id),
                        usage_role=source_mapping.usage_role,
                        always_apply=not source_mapping.candidate_only,
                    )
                    copied.scene_scope = source_mapping.scene_scope
                    copied.episode_scope = source_mapping.episode_scope
                    copied.candidate_only = source_mapping.candidate_only
                    destination_mappings = destination_store.load_all()
                    for index, item in enumerate(destination_mappings):
                        if item.mapping_id == copied.mapping_id:
                            destination_mappings[index] = copied
                            break
                    destination_store.save_all(destination_mappings)
            for index, source_path in enumerate(initial_reference_paths or []):
                references.import_file(
                    source_path,
                    reference_type="character" if index == 0 else "general_reference",
                    display_name=(
                        "대표 캐릭터" if index == 0 else source_path.stem
                    ),
                    face_baseline=index == 0,
                )
            learning_root = self.config.project_root / "learning_data"
            story_engine = StoryEngine(self.story_adapter.generate)
            story_engine.initialize()

            def story_stage(value: ProjectContext) -> ProjectContext:
                progress("대본 생성 중")
                if job.successful_calls >= self.config.app_max_story_calls_per_job:
                    raise RuntimeError("작업별 대본 API 호출 한도를 초과했습니다.")
                self.guard.record(job_id, project_id, "story")
                try:
                    value.story = self.budget.run_budgeted(
                        project_id,
                        "story",
                        lambda: story_engine.execute(request_prompt),
                    )
                except Exception as exc:
                    self.jobs.record_call(
                        job, call_type="story", model=self.config.openai_story_model,
                        status="failed",
                        retries=getattr(self.story_adapter, "last_retries", 0),
                        error_category=getattr(exc, "category", type(exc).__name__),
                    )
                    raise
                self.jobs.record_call(
                    job, call_type="story", model=self.config.openai_story_model,
                    status="succeeded",
                    retries=getattr(self.story_adapter, "last_retries", 0),
                    provider_request_id=getattr(
                        self.story_adapter, "last_request_id", ""
                    ),
                )
                value.scenes = list(value.story["scenes"])
                progress("대본 응답 수신 · 6개 장면 검증 완료")
                return value

            if context.workflow_state == WorkflowState.INIT:
                context.transition_to(WorkflowState.READY)
            self.memory.save(context)
            context.transition_to(WorkflowState.GENERATING_STORY)
            story_stage(context)
            context.script_revision += 1
            review = ProjectAssetMappingStore(
                learning_root / "projects", project_id
            ).begin_review(context.scenes, context.script_revision)
            context.mapping_revision = review.mapping_revision
            context.transition_to(WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW)
            self.memory.save(context)
            progress("프로젝트 저장 완료")
            self.memory.append_event(project_id, "ASSET_MAPPING_REVIEW_REQUIRED")
            self.jobs.finish(job, "completed")
            progress("Scene Mapping 사용자 검토 대기")
            return context
        except Exception as exc:
            status = "partially_completed" if job.successful_calls else "failed"
            self.jobs.finish(
                job, status,
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            raise
        finally:
            self.guard.finish(project_id)

    def approve_asset_mapping(
        self,
        context: ProjectContext,
        *,
        text_only_confirmed: bool = False,
        legacy_confirmed: bool = False,
    ) -> ProjectContext:
        """Persist explicit user approval without calling any provider."""
        if context.workflow_state != WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW:
            raise ValueError("Project is not waiting for Asset Mapping review")
        store = ProjectAssetMappingStore(
            self.config.project_root / "learning_data" / "projects",
            context.project_id,
        )
        review = store.approve_review(
            context.scenes, context.script_revision,
            text_only_confirmed=text_only_confirmed,
            legacy_confirmed=legacy_confirmed,
        )
        try:
            ProjectAssetResolver(
                AssetLibrary(self.config.project_root / "learning_data"),
                store,
                ProjectReferenceManager(
                    self.config.project_root / "learning_data" / "projects",
                    context.project_id,
                ) if legacy_confirmed else None,
            ).validate_approved_assets(
                1, max_references=getattr(
                    self.image_adapter, "MAX_REFERENCE_IMAGES", 16
                ), scenes=context.scenes,
            )
        except (OSError, ReferenceAssetError):
            store.invalidate_review(context.scenes, context.script_revision)
            raise
        context.mapping_revision = review.mapping_revision
        context.transition_to(WorkflowState.ASSET_MAPPING_APPROVED)
        self.memory.save(context)
        self.memory.append_event(context.project_id, "ASSET_MAPPING_APPROVED")
        return context

    def rerun_asset_matching(self, context: ProjectContext) -> ProjectContext:
        """Rebuild only automatic suggestions and invalidate final approval."""
        if context.workflow_state not in {
            WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW,
            WorkflowState.ASSET_MAPPING_APPROVED,
        }:
            raise ValueError("Project is not in an Asset Mapping review state")
        learning_root = self.config.project_root / "learning_data"
        store = ProjectAssetMappingStore(
            learning_root / "projects", context.project_id
        )
        mappings = [
            item for item in store.load_all()
            if item.candidate_only or item.assignment_source != "auto"
        ]
        candidate_ids = {
            item.asset_id for item in mappings
            if item.candidate_only and item.enabled
        }
        candidates = [
            asset for asset in AssetLibrary(learning_root).load_all()
            if asset.asset_id in candidate_ids and asset.enabled
        ]
        matcher = SceneAssetMatcher()
        for scene in context.scenes:
            mappings.extend(matcher.match(
                context.project_id, int(scene["number"]),
                extract_scene_entities(scene), candidates,
            ))
        store.save_all(mappings)
        review = store.begin_review(context.scenes, context.script_revision)
        context.mapping_revision = review.mapping_revision
        if context.workflow_state == WorkflowState.ASSET_MAPPING_APPROVED:
            context.transition_to(WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW)
        self.memory.save(context)
        return context

    def generate_approved_images(
        self,
        context: ProjectContext,
        progress: ProgressCallback = lambda message: None,
        user_request_id: str | None = None,
    ) -> ProjectContext:
        """Resume a saved project only after a fresh service-level approval check."""
        if context.workflow_state != WorkflowState.ASSET_MAPPING_APPROVED:
            raise ValueError("장면 Asset Mapping이 아직 승인되지 않았습니다.")
        learning_root = self.config.project_root / "learning_data"
        store = ProjectAssetMappingStore(
            learning_root / "projects", context.project_id
        )
        review = store.assert_generation_allowed(
            context.scenes, context.script_revision
        )
        if review.mapping_revision != context.mapping_revision:
            raise ValueError("Mapping Revision이 프로젝트 상태와 일치하지 않습니다.")
        legacy = ProjectReferenceManager(
            learning_root / "projects", context.project_id
        )
        resolver = ProjectAssetResolver(
            AssetLibrary(learning_root), store, legacy if review.legacy_confirmed else None
        )
        resolver.validate_approved_assets(
            1, max_references=getattr(
                self.image_adapter, "MAX_REFERENCE_IMAGES", 16
            ), scenes=context.scenes,
        )
        job = self.jobs.begin(
            project_id=context.project_id, project_type="short_project",
            operation="short_project_images",
            resource_key=f"short-images:{context.project_id}:m{review.mapping_revision}",
            expected_api_calls=self.config.app_max_image_calls_per_job,
            user_request_id=user_request_id,
        )
        self.guard.begin(context.project_id)
        genre = str(context.style_profile.get("genre", "미스터리"))
        character = str(context.character_profile.get("name", "대표 캐릭터"))
        cast = context.character_profile.get("cast", [])
        cast_metadata = describe_character_cast(
            cast if isinstance(cast, list) else []
        )
        atmosphere_ids = context.lore_context.get(
            "atmosphere_asset_ids", []
        )
        atmosphere_metadata = describe_story_assets(
            AssetLibrary(learning_root),
            {
                str(asset_id) for asset_id in atmosphere_ids
            } if isinstance(atmosphere_ids, list) else set(),
        )
        raw_scene_references = context.lore_context.get(
            "scene_reference_assets", {}
        )
        scene_reference_metadata = describe_scene_reference_assets(
            AssetLibrary(learning_root),
            raw_scene_references if isinstance(raw_scene_references, dict) else {},
        )
        lore = str(context.lore_context.get("lore", "기본 세계관"))
        calls = 0
        scene_api_calls: dict[int, int] = {}
        reference_debug_by_scene: dict[int, list[dict[str, str]]] = {}
        style_notes = context.lore_context.get("style_notes", {})
        if not isinstance(style_notes, dict):
            style_notes = {}
        mood = str(context.style_profile.get("mood", "시네마틱"))
        duration = int(context.lore_context.get("duration_seconds", 30))
        scene_count = int(context.lore_context.get("scene_count", 6))
        aspect_ratio = str(style_notes.get("aspect", "9:16"))
        request_image_size = image_size_for_aspect(
            aspect_ratio, self.config.openai_image_size
        )
        engine = ImageEngine(
            lambda prompt, references: generate_image_at_size(
                self.image_adapter, prompt, references, request_image_size
            ),
            self.memory.project_directory(context.project_id) / "images",
            self.config.project_root / "cache" / "images",
            cache_namespace=(
                f"{self.config.openai_image_model}|{request_image_size}|"
                f"{self.config.openai_image_quality}|{self.config.openai_image_format}|"
                f"mapping:{review.mapping_revision}|script:{review.script_revision}"
            ),
        )
        engine.initialize()
        production_settings = "\n".join((
            f"- 전체 분위기: {mood}",
            f"- 시각적 스타일: {style_notes.get('visual_style') or AUTONOMOUS_SETTING}",
            f"- 색감: {style_notes.get('color') or AUTONOMOUS_SETTING}",
            f"- 조명: {style_notes.get('lighting') or AUTONOMOUS_SETTING}",
            f"- 카메라 느낌: {style_notes.get('camera') or AUTONOMOUS_SETTING}",
            f"- 대사 스타일: {style_notes.get('dialogue') or AUTONOMOUS_SETTING}",
            f"- 피해야 할 요소: {style_notes.get('avoid') or AUTONOMOUS_SETTING}",
            f"- 화면 비율: {aspect_ratio}",
            f"- 전체 영상 길이: 약 {duration}초",
            f"- 전체 장면 수: {scene_count}개",
        ))
        continuity_link = user_selected_short_scene_link(
            context.lore_context.get("previous_scene_link", {})
        )
        continuity_reference: dict[str, Any] = {}
        if isinstance(continuity_link, dict) and continuity_link.get(
            "source_kind"
        ) == "short_project":
            source_id = str(continuity_link.get("project_id", "")).strip()
            if source_id and source_id != context.project_id:
                continuity_reference = short_scene_continuity_option(
                    self.memory.projects_directory, source_id
                )

        def selected_references(
            number: int,
        ) -> tuple[list[Path], list[str], list[str]]:
            paths, ids, warnings = resolver.image_pipeline_selection(
                number, context.scenes[number - 1]
            )
            if number == 1 and continuity_reference:
                continuity_path = Path(
                    str(continuity_reference["image_path"])
                )
                paths.append(continuity_path)
                ids.append(
                    "continuity:"
                    + str(continuity_reference["project_id"])
                    + "#scene6"
                )
            if len(paths) > getattr(
                self.image_adapter, "MAX_REFERENCE_IMAGES", 16
            ):
                raise ValueError(
                    "이전 장면을 포함한 Reference 이미지 수가 한도를 초과합니다."
                )
            return paths, ids, warnings

        def prompts(scene: dict[str, object]) -> tuple[str, str]:
            scene_number = int(scene.get("number", 1))
            story_summary = (
                str(context.story.get("synopsis", "")).strip()
                if isinstance(context.story, dict) else ""
            )
            reference_manifest = resolver.prompt_reference_manifest(
                1, scene_number, scene
            )
            if scene_number == 1 and continuity_reference:
                reference_manifest += (
                    "\n\n[이전 장면 연속성 Reference]\n"
                    f"파일: {Path(str(continuity_reference['image_path'])).name}\n"
                    f"이전 프로젝트: {continuity_reference['project_name']}\n"
                    "역할: 직전 이야기의 마지막 장면\n"
                    "배경 구조·시간대·조명·인물 배치를 자연스럽게 이어가되, "
                    "새 행동과 카메라 구성은 허용하십시오."
                )
            image = self.prompts.render("image/scene_generation", {
                "project_name": (
                    context.lore_context.get("project_name")
                    or "별도 이름 없음"
                ),
                "topic": context.topic,
                "story_context": (
                    context.lore_context.get("full_story")
                    or story_summary
                    or "장면 대본 기준"
                ),
                "scene": scene, "character": character, "style": genre,
                "character_cast_metadata": cast_metadata,
                "atmosphere_asset_metadata": atmosphere_metadata,
                "scene_reference_asset_metadata": scene_reference_metadata,
                "lore": lore,
                "references": reference_manifest,
                "production_settings": production_settings,
                "scene_composition": format_scene_composition(scene),
            }).text
            motion = self.prompts.render("templates/motion_generation", {
                "start_motion": scene.get(
                    "start_motion", "현재 이미지의 자세에서 자연스럽게 시작"
                ),
                "main_motion": scene.get(
                    "main_motion"
                ) or scene.get("visual_action") or scene.get("description", ""),
                "end_motion": scene.get(
                    "end_motion", "움직임을 안정적으로 마무리"
                ),
                "camera_motion": scene.get(
                    "camera_motion", "안정적인 고정 카메라"
                ),
                "environment_motion": scene.get(
                    "environment_motion", "배경은 자연스럽고 미세하게 움직임"
                ),
                "motion_speed": scene.get("motion_speed", "보통"),
                "motion_intensity": scene.get("motion_intensity", "보통"),
                "expression_change": scene.get(
                    "expression_change", "장면 감정에 맞는 미세한 표정 변화"
                ),
                "continuity_hint": scene.get(
                    "continuity_hint", "다음 장면과 연결 가능한 안정된 종료 상태"
                ),
            }).text
            return image, motion

        def generate(number: int, prompt: str, paths: list[Path] | None = None) -> Path:
            nonlocal calls
            selected = paths or []
            if calls >= self.config.app_max_image_calls_per_job:
                raise RuntimeError("작업별 이미지 API 호출 한도를 초과했습니다.")
            descriptors = resolver.cache_descriptors(
                1, number, review.mapping_revision, review.script_revision,
                context.scenes[number - 1],
            )
            if number == 1 and continuity_reference:
                descriptors.append(
                    "continuity:"
                    + str(continuity_reference["project_id"])
                    + ":scene6"
                )
            cached = engine.is_cached(prompt, selected, descriptors)
            if not cached:
                self.guard.record(job.job_id, context.project_id, "image")
                calls += 1
            execute_image = lambda: engine.execute(
                number, prompt, selected,
                reference_descriptors=descriptors,
            )
            path = (
                execute_image()
                if cached
                else self.budget.run_budgeted(
                    context.project_id, "image", execute_image
                )
            )
            _paths, ids, _warnings = selected_references(number)
            debug_rows = describe_reference_selection(
                ids, selected, context.scenes[number - 1]
            )
            scene_api_calls[number] = 0 if cached else 1
            reference_debug_by_scene[number] = debug_rows
            self.jobs.record_call(
                job, call_type="image", model=self.config.openai_image_model,
                status="cached" if cached else "succeeded", cache_hit=cached,
                reference_ids=ids,
                reference_paths=[str(path) for path in selected],
                reference_reasons=[
                    row["reason"] for row in debug_rows
                ],
                retries=getattr(self.image_adapter, "last_retries", 0),
                provider_request_id=getattr(self.image_adapter, "last_request_id", ""),
            )
            progress(f"이미지 {number}/6 생성 완료")
            return path

        pipeline = ImagePipeline(
            prompts, lambda n, p: generate(n, p), self.memory.save,
            self.memory.project_directory(context.project_id)
            / "runway_motion_prompts.txt",
            reference_selector=selected_references,
            reference_image_generator=lambda n, p, paths: generate(n, p, paths),
            checkpoint_saver=self.memory.save,
        )
        pipeline.initialize()
        context.transition_to(WorkflowState.GENERATING_IMAGES)
        self.memory.save(context)
        try:
            result = pipeline.execute(context)
            for number, record in enumerate(
                context.image_generation_records, start=1
            ):
                if not isinstance(record, dict):
                    continue
                record["reference_details"] = reference_debug_by_scene.get(
                    number, []
                )
                record["prompt_length"] = len(
                    context.image_prompts[number - 1]
                )
                record["image_api_calls"] = scene_api_calls.get(number, 0)
                record["candidate_asset_counts"] = (
                    resolver.candidate_asset_counts(1, number)
                )
            self.memory.save(context)
            image_manager = GeneratedImageManager(
                self.memory.project_directory(context.project_id)
            )
            library = AssetLibrary(learning_root)
            for number, image_path in enumerate(result.generated_images, start=1):
                image_manager.set_status(number, Path(image_path), "pending")
            image_manager.index_generated_project_folder(
                [Path(path) for path in result.generated_images],
                library,
                project_name=str(
                    context.lore_context.get("project_name", "")
                ),
                topic=context.topic,
                genre=str(context.style_profile.get("genre", "")),
                mood=str(context.style_profile.get("mood", "")),
                scene_descriptions=[
                    str(scene.get("description", ""))
                    for scene in context.scenes
                    if isinstance(scene, dict)
                ],
            )
            self.jobs.finish(job, "completed")
            return result
        except Exception as exc:
            self.jobs.finish(
                job, "partially_completed" if job.successful_calls else "failed",
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            # A timed-out image request may still have reached the provider.
            # Never repeat it automatically. Return to the explicit approval
            # gate; any completed files remain reusable through the image cache.
            if context.workflow_state == WorkflowState.GENERATING_IMAGES:
                context.transition_to(WorkflowState.ASSET_MAPPING_APPROVED)
                self.memory.save(context)
            raise
        finally:
            self.guard.finish(context.project_id)

    def regenerate_scene(
        self, context: ProjectContext, scene_number: int,
        progress: ProgressCallback = lambda message: None,
        user_request_id: str | None = None,
        *,
        edited_script: str | None = None,
        edited_image_prompt: str | None = None,
    ) -> Path:
        if context.workflow_state not in {
            WorkflowState.IMAGES_REVIEW,
            WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
        }:
            raise ValueError("Only an image-review project can regenerate a scene")
        if scene_number not in range(1, 7):
            raise ValueError("scene_number must be between 1 and 6")
        mapping_store = ProjectAssetMappingStore(
            self.config.project_root / "learning_data" / "projects",
            context.project_id,
        )
        try:
            mapping_review = mapping_store.assert_generation_allowed(
                context.scenes, context.script_revision
            )
        except ReferenceAssetError:
            # Image review already proves that the project passed its original
            # Candidate confirmation gate.  Asset metadata/file maintenance can
            # invalidate the legacy MappingReview later, but a one-scene
            # regeneration must not send the user back to the removed manual
            # Scene Mapping UI.  Rebuild the same Candidate collection locally;
            # the paid request still requires the explicit regeneration dialog.
            mapping_store.begin_review(
                context.scenes, context.script_revision
            )
            mapping_review = mapping_store.approve_automatic_selection(
                context.scenes, context.script_revision
            )
            context.mapping_revision = mapping_review.mapping_revision
            self.memory.save(context)
            self.memory.append_event(
                context.project_id,
                "REGENERATION_REFERENCES_REFRESHED",
            )
        script_override = (
            edited_script.strip() if edited_script is not None else None
        )
        prompt_override = (
            edited_image_prompt.strip()
            if edited_image_prompt is not None else None
        )
        if script_override is not None and not script_override:
            raise ValueError("수정한 장면 대본은 비워둘 수 없습니다.")
        if prompt_override is not None and not prompt_override:
            raise ValueError("수정한 이미지 프롬프트는 비워둘 수 없습니다.")
        project_root = self.memory.project_directory(context.project_id)
        job = self.jobs.begin(
            project_id=context.project_id,
            project_type="short_project",
            operation="short_scene_regeneration",
            resource_key=f"short-regen:{context.project_id}:{scene_number}",
            expected_api_calls=1,
            user_request_id=user_request_id,
            scene_number=scene_number,
        )
        manager = ProjectReferenceManager(
            self.config.project_root / "learning_data" / "projects",
            context.project_id,
        )
        resolver = ProjectAssetResolver(
            AssetLibrary(self.config.project_root / "learning_data"),
            mapping_store,
            manager if mapping_review.legacy_confirmed else None,
        )
        paths, ids, warnings = resolver.image_pipeline_selection(
            scene_number, context.scenes[scene_number - 1]
        )
        descriptors = resolver.cache_descriptors(
            1, scene_number, mapping_review.mapping_revision,
            mapping_review.script_revision,
            context.scenes[scene_number - 1],
        )
        scene = context.scenes[scene_number - 1]
        if script_override is not None:
            scene["description"] = script_override
        prompt = (
            prompt_override
            if prompt_override is not None
            else context.image_prompts[scene_number - 1]
        )
        if prompt_override is not None:
            context.image_prompts[scene_number - 1] = prompt_override
        reference_debug = describe_reference_selection(
            ids, paths, context.scenes[scene_number - 1]
        )
        candidate_counts = resolver.candidate_asset_counts(
            1, scene_number
        )
        style_notes = context.lore_context.get("style_notes", {})
        if not isinstance(style_notes, dict):
            style_notes = {}
        request_image_size = image_size_for_aspect(
            str(style_notes.get("aspect", "9:16")),
            self.config.openai_image_size,
        )
        engine = ImageEngine(
            lambda prompt, references: generate_image_at_size(
                self.image_adapter, prompt, references, request_image_size
            ),
            self.config.project_root / "images" / "generated" / context.project_id,
            self.config.project_root / "cache" / "images",
            cache_namespace=(
                f"{self.config.openai_image_model}|{request_image_size}|"
                f"{self.config.openai_image_quality}|{self.config.openai_image_format}"
            ),
        )
        engine.initialize()
        progress(f"장면 {scene_number} 재생성 중")
        try:
            self.guard.record(job.job_id, context.project_id, "image_regeneration")
            path = self.budget.run_budgeted(
                context.project_id,
                "image",
                lambda: engine.execute(
                    scene_number, prompt, paths, regenerate=True,
                    reference_descriptors=descriptors,
                ),
            )
            self.jobs.record_call(
                job, call_type="image_regeneration",
                model=self.config.openai_image_model, status="succeeded",
                retries=getattr(self.image_adapter, "last_retries", 0),
                reference_ids=ids,
                reference_paths=[str(path) for path in paths],
                reference_reasons=[
                    row["reason"] for row in reference_debug
                ],
                provider_request_id=getattr(
                    self.image_adapter, "last_request_id", ""
                ),
            )
        except Exception as exc:
            self.jobs.record_call(
                job, call_type="image_regeneration",
                model=self.config.openai_image_model, status="failed",
                retries=getattr(self.image_adapter, "last_retries", 0),
                error_category=getattr(exc, "category", type(exc).__name__),
                reference_ids=ids,
                reference_paths=[str(path) for path in paths],
                reference_reasons=[
                    row["reason"] for row in reference_debug
                ],
            )
            self.jobs.finish(
                job, "failed",
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            raise
        previous_path = Path(context.generated_images[scene_number - 1])
        image_manager = GeneratedImageManager(project_root)
        path, archived_previous_path = (
            image_manager.promote_regenerated_image(
                scene_number,
                previous_path,
                path,
            )
        )
        library = AssetLibrary(self.config.project_root / "learning_data")
        library.replace_project_scene_image(
            source_project_id=context.project_id,
            source_scene_number=scene_number,
            current_path=path,
            archived_previous_path=archived_previous_path,
            previous_current_path=previous_path,
        )
        context.generated_images[scene_number - 1] = str(path)
        context.image_generation_records[scene_number - 1] = {
            "scene_number": scene_number,
            "reference_asset_ids": ids,
            "reference_paths": [str(value) for value in paths],
            "reference_details": reference_debug,
            "prompt_length": len(prompt),
            "image_api_calls": 1,
            "candidate_asset_counts": candidate_counts,
            "warnings": warnings,
            "regenerated": True,
            "user_edited_script": script_override is not None,
            "user_edited_prompt": prompt_override is not None,
            "current_image_path": str(path),
            "archived_previous_path": (
                str(archived_previous_path)
                if archived_previous_path is not None
                else ""
            ),
        }
        image_manager.record_regeneration(scene_number, path)
        image_manager.sync_library_status(scene_number, library, "generated")
        image_manager.index_generated_project_folder(
            [Path(value) for value in context.generated_images],
            library,
            project_name=str(
                context.lore_context.get("project_name", "")
            ),
            topic=context.topic,
            genre=str(context.style_profile.get("genre", "")),
            mood=str(context.style_profile.get("mood", "")),
            scene_descriptions=[
                str(scene.get("description", ""))
                for scene in context.scenes
                if isinstance(scene, dict)
            ],
        )
        if script_override is not None:
            # Candidate Assets did not change. Keep the approved local review
            # aligned with this user-authored scene text for later regenerations.
            mapping_review.script_fingerprint = script_fingerprint(
                context.scenes
            )
            mapping_store.save_review(mapping_review)
        if context.workflow_state in {
            WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
        }:
            context.transition_to(WorkflowState.GENERATING_IMAGES)
            context.transition_to(WorkflowState.IMAGES_READY)
            context.transition_to(WorkflowState.IMAGES_REVIEW)
        self.memory.save(context)
        self.jobs.finish(job, "completed")
        return path

    def automatic_reference_summary(
        self, context: ProjectContext
    ) -> dict[str, object]:
        """Build the zero-API confirmation summary shown before image generation."""
        store = ProjectAssetMappingStore(
            self.config.project_root / "learning_data" / "projects",
            context.project_id,
        )
        candidates = {
            item.asset_id for item in store.load_all()
            if item.candidate_only and item.enabled
        }
        selected = store.automatic_selection_summary()
        return {
            "candidate_asset_ids": sorted(candidates),
            "selected_asset_ids_by_scene": selected,
            "estimated_image_api_calls": 6,
        }

    def confirm_automatic_references(
        self, context: ProjectContext
    ) -> ProjectContext:
        """Approve local Resolver output after the simple user confirmation."""
        if context.workflow_state != WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW:
            raise ValueError("Project is not waiting for Reference confirmation")
        store = ProjectAssetMappingStore(
            self.config.project_root / "learning_data" / "projects",
            context.project_id,
        )
        review = store.approve_automatic_selection(
            context.scenes, context.script_revision
        )
        context.mapping_revision = review.mapping_revision
        context.transition_to(WorkflowState.ASSET_MAPPING_APPROVED)
        self.memory.save(context)
        self.memory.append_event(
            context.project_id, "AUTOMATIC_REFERENCES_CONFIRMED"
        )
        return context

    def approve_scene_image(
        self, context: ProjectContext, scene_number: int
    ) -> ProjectContext:
        """Approve one image and unlock video confirmation after all six."""
        return ProjectImageReviewService(
            self.memory.projects_directory
        ).approve_scene(context, scene_number)
