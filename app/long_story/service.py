"""Long-story management and one-episode-at-a-time AI production."""

from __future__ import annotations

from dataclasses import asdict
import json
from pathlib import Path
from threading import Lock
from typing import Any, Protocol
from uuid import uuid4

from app.adapters.openai_image_adapter import OpenAIImageAdapter
from app.adapters.openai_story_adapter import OpenAIStoryAdapter
from app.adapters.openai_episode_planner_adapter import OpenAIEpisodePlannerAdapter
from app.config.config import AppConfig
from app.engines.image_engine import ImageEngine
from app.engines.prompt_manager import PromptManager
from app.engines.story_engine import StoryEngine
from app.long_story.context_builder import StoryContextBuilder
from app.long_story.bible_manager import BibleCollectionManager
from app.long_story.models import ContinuityMemory, Episode, LongProject, StoryBible, now
from app.long_story.store import LongStoryStore
from app.services.api_call_guard import APICallGuard
from app.services.api_job_manager import APIJobManager
from app.services.budget_manager import BudgetManager
from app.services.face_consistency import FaceConsistencyService, InsightFaceBackend
from app.services.generation_service import (
    format_scene_composition,
    generate_image_at_size,
    image_size_for_aspect,
)
from app.services.reference_asset_manager import (
    EpisodeScope, ProjectReferenceManager, SceneScope,
)
from app.services.asset_library import AssetLibrary
from app.services.project_asset_mapping import (
    ProjectAssetMapping,
    ProjectAssetMappingStore,
    ProjectAssetResolver,
    SceneAssetMatcher,
    describe_reference_selection,
    extract_scene_entities,
    script_fingerprint,
)


class StoryAdapter(Protocol):
    def generate(self, prompt: str) -> dict[str, Any]: ...


class ImageAdapter(Protocol):
    def generate(self, prompt: str, reference_images: list[Path]) -> bytes: ...


class LongStoryService:
    """Manage projects offline and invoke AI only for explicit episode actions."""

    def __init__(
        self,
        config: AppConfig,
        *,
        story_adapter: StoryAdapter | None = None,
        image_adapter: ImageAdapter | None = None,
        planner_adapter: Any | None = None,
        budget_manager: BudgetManager | None = None,
    ) -> None:
        self.config = config
        self.projects_root = config.project_root / "learning_data" / "projects"
        self.prompts = PromptManager(config.project_root / "prompts")
        self.prompts.initialize()
        self.context_builder = StoryContextBuilder()
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
        self.story_adapter = story_adapter
        self.image_adapter = image_adapter
        self.planner_adapter = planner_adapter
        self._active_episodes: set[tuple[str, int]] = set()
        self._lock = Lock()
        if config.openai_api_key:
            self.story_adapter = self.story_adapter or OpenAIStoryAdapter(
                config.openai_api_key, config.openai_story_model,
                config.api_timeout_seconds, config.max_retries,
            )
            self.image_adapter = self.image_adapter or OpenAIImageAdapter(
                config.openai_api_key, config.openai_image_model,
                config.openai_image_size, config.openai_image_quality,
                config.openai_image_format, config.image_api_timeout_seconds,
                0,
            )
            self.planner_adapter = self.planner_adapter or OpenAIEpisodePlannerAdapter(
                config.openai_api_key, config.openai_story_model,
                config.api_timeout_seconds, config.max_retries,
            )

    def create_project(self, project: LongProject) -> LongStoryStore:
        project.validate()
        if project.episode_count > self.config.app_max_long_project_episodes:
            raise ValueError(
                "Episode 수가 APP_MAX_LONG_PROJECT_EPISODES 설정을 초과합니다."
            )
        store = LongStoryStore(self.projects_root, project.project_id)
        store.save_project(project)
        store.save_bible(StoryBible(basic={
            "title": project.title, "logline": project.logline,
            "overview": project.overview, "genre": project.genre,
            "tone": project.tone, "theme": project.theme,
            "ending_direction": project.ending_direction,
            "audience": project.audience,
        }))
        for number in range(1, project.episode_count + 1):
            store.save_episode(Episode(
                episode_id=f"EP-{number:03d}", number=number,
                title=f"Episode {number}", duration_seconds=project.episode_duration_seconds,
            ))
        return store

    def generate_project_outline(
        self,
        store: LongStoryStore,
        user_request_id: str | None = None,
        *,
        approved_prompt: str | None = None,
    ) -> list[Episode]:
        """Generate only the whole-story overview and Episode plans in one call."""
        if self.planner_adapter is None or not hasattr(
            self.planner_adapter, "generate_outline"
        ):
            raise RuntimeError(
                "장기 프로젝트 개요 생성을 지원하는 OpenAI Adapter가 필요합니다."
            )
        project = store.load_project()
        original_project = LongProject(**asdict(project))
        original_episodes = [
            Episode.from_dict(item.to_dict()) for item in store.list_episodes()
        ]
        persistence_started = False
        if project.episode_count > self.config.app_max_long_project_episodes:
            raise ValueError(
                "Episode 수가 APP_MAX_LONG_PROJECT_EPISODES 설정을 초과합니다."
            )
        prompt = (
            approved_prompt
            if approved_prompt is not None
            else self.render_project_outline_prompt(store)
        )
        if not prompt.strip():
            raise ValueError("장기 프로젝트 Prompt가 비어 있습니다.")
        job = self.jobs.begin(
            project_id=project.project_id,
            project_type="long_story_project",
            operation="long_project_outline",
            resource_key=f"long-outline:{project.project_id}",
            expected_api_calls=1,
            user_request_id=user_request_id,
        )
        try:
            self.guard.record(
                job.job_id, project.project_id, "long_project_outline"
            )
            payload = self.budget.run_budgeted(
                project.project_id,
                "long_story_outline",
                lambda: self.planner_adapter.generate_outline(
                    prompt, project.episode_count
                ),
            )
            project_data = dict(payload["project"])
            episode_payloads = list(payload["episodes"])
            numbers = [int(item["episode_number"]) for item in episode_payloads]
            if sorted(numbers) != list(range(1, project.episode_count + 1)):
                raise ValueError("Episode 개요 번호가 연속적이지 않습니다.")
            for field_name in (
                "title", "logline", "overview", "genre", "tone", "theme",
                "starting_state", "midpoint", "ending_direction",
                "story_flow_summary",
            ):
                # User-entered long-project settings are authoritative. The
                # outline response may fill blanks, but never replaces them.
                if not str(getattr(project, field_name)).strip():
                    setattr(project, field_name, str(project_data[field_name]))
            project.updated_at = now()
            persistence_started = True
            store.save_project(project)
            updated: list[Episode] = []
            by_number = {
                int(item["episode_number"]): item for item in episode_payloads
            }
            for number in range(1, project.episode_count + 1):
                item = by_number[number]
                episode = store.load_episode(number)
                episode.title = str(item["title"])
                episode.summary = str(item["summary"])
                episode.core_event = str(item["main_event"])
                episode.conflict = str(item["conflict"])
                episode.cliffhanger = str(item["cliffhanger"])
                episode.next_connection = str(item["next_episode_hook"])
                episode.outline = {
                    **item,
                    "status": "outline_ready",
                }
                if not episode.script:
                    episode.state = "outline_ready"
                episode.updated_at = now()
                store.save_episode(episode)
                updated.append(episode)
            self.jobs.record_call(
                job,
                call_type="long_project_outline",
                model=self.config.openai_story_model,
                status="succeeded",
                retries=getattr(self.planner_adapter, "last_retries", 0),
                provider_request_id=getattr(
                    self.planner_adapter, "last_request_id", ""
                ),
            )
            self.jobs.finish(job, "completed")
            return updated
        except Exception as exc:
            if persistence_started:
                try:
                    store.save_project(original_project)
                    for original in original_episodes:
                        store.save_episode(original)
                except Exception:
                    pass
            self.jobs.record_call(
                job,
                call_type="long_project_outline",
                model=self.config.openai_story_model,
                status="failed",
                retries=getattr(self.planner_adapter, "last_retries", 0),
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            self.jobs.finish(
                job,
                "failed",
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            raise

    def render_project_outline_prompt(self, store: LongStoryStore) -> str:
        """Return the exact prompt used for one long-project outline request."""
        project = store.load_project()
        bible_payload = asdict(store.load_bible())
        bible_payload.pop("updated_at", None)
        project_payload = {
            "작품 제목": project.title,
            "한 줄 주제": project.logline or "자율",
            "세계관·전체 줄거리": project.overview or "자율",
            "장르": project.genre or "자율",
            "전체 분위기": project.tone or "자율",
            "핵심 주제": project.theme or "자율",
            "시작 상태": project.starting_state or "자율",
            "중간 전환점": project.midpoint or "자율",
            "결말 방향": project.ending_direction or "자율",
            "전체 이야기 흐름": project.story_flow_summary or "자율",
            "대상 시청자": project.audience or "자율",
            "추가 지시사항": project.notes or "없음",
            "총 Episode 수": project.episode_count,
            "Episode당 길이(초)": project.episode_duration_seconds,
        }
        return "\n".join((
            "[1. 작업 목표]",
            "장기 애니메이션의 전체 작품 개요와 모든 Episode Outline을 "
            "한 번에 작성하십시오.",
            "",
            "[2. 작품 전체 설정]",
            json.dumps(project_payload, ensure_ascii=False, indent=2),
            "",
            "[3. Story Bible]",
            json.dumps(bible_payload, ensure_ascii=False, indent=2),
            "",
            "[4. 출력 요구사항]",
            f"Episode를 정확히 {project.episode_count}개 작성하십시오.",
            "전체 작품 개요와 각 Episode의 제목, 요약, 핵심 사건, 갈등, "
            "클리프행어, 다음 Episode 연결을 서로 모순 없이 구성하십시오.",
            "장면별 상세 대본, 이미지 프롬프트, 이미지, Reference 선택, "
            "영상 생성 데이터는 생성하지 마십시오.",
        )
        )

    def add_episode(self, store: LongStoryStore, title: str = "") -> Episode:
        episodes = store.list_episodes()
        number = max((item.number for item in episodes), default=0) + 1
        episode = Episode(f"EP-{uuid4().hex[:8].upper()}", number, title=title)
        store.save_episode(episode)
        return episode

    def generate_plan_preview(
        self, store: LongStoryStore, start: int = 1, count: int | None = None,
        user_request_id: str | None = None,
    ) -> list[Episode]:
        if self.planner_adapter is None:
            raise RuntimeError(
                "OpenAI API 키가 설정되지 않았습니다. .env 파일에 "
                "OPENAI_API_KEY를 입력한 뒤 앱을 다시 실행하십시오."
            )
        project = store.load_project()
        requested = count or min(project.episode_count, 30)
        if self.config.app_max_plan_calls_per_job < 1:
            raise RuntimeError("작업별 Episode Planner 호출 한도를 초과했습니다.")
        job = self.jobs.begin(
            project_id=project.project_id, project_type="long_story_project",
            operation="episode_plan_generation",
            resource_key=f"plan:{project.project_id}:{start}:{requested}",
            expected_api_calls=1, user_request_id=user_request_id,
        )
        prompt = (
            "다음 Story Bible을 바탕으로 대본이나 이미지를 생성하지 말고 "
            f"{requested}개 회차 계획만 작성하십시오. 시작 번호는 {start}입니다.\n"
            + json.dumps(asdict(store.load_bible()), ensure_ascii=False)
        )
        try:
            self.guard.record(job.job_id, project.project_id, "episode_plan")
            preview = self.budget.run_budgeted(
                project.project_id,
                "long_story_plan",
                lambda: self.planner_adapter.generate(prompt, requested),
            )
            self.jobs.record_call(
                job, call_type="episode_plan", model=self.config.openai_story_model,
                status="succeeded",
                retries=getattr(self.planner_adapter, "last_retries", 0),
                provider_request_id=getattr(
                    self.planner_adapter, "last_request_id", ""
                ),
            )
            self.jobs.finish(job, "completed")
        except Exception as exc:
            self.jobs.record_call(
                job, call_type="episode_plan", model=self.config.openai_story_model,
                status="failed",
                retries=getattr(self.planner_adapter, "last_retries", 0),
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            self.jobs.finish(
                job, "failed",
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            raise
        return [
            Episode(
                episode_id=f"EP-{int(item['number']):03d}",
                number=int(item["number"]), title=str(item["title"]),
                summary=str(item["summary"]), core_event=str(item["core_event"]),
                conflict=str(item["conflict"]),
                cliffhanger=str(item["cliffhanger"]),
                state="planning_review",
            )
            for item in preview
        ]

    def approve_plan(
        self, store: LongStoryStore, preview: list[Episode]
    ) -> None:
        for episode in preview:
            episode.state = "planned"
            store.save_episode(episode)

    def duplicate_episode(self, store: LongStoryStore, number: int) -> Episode:
        source = store.load_episode(number)
        clone = self.add_episode(store, f"{source.title} 복사본")
        for key, value in asdict(source).items():
            if key not in {"episode_id", "number", "state", "script", "generated_images", "approved_scene_numbers"}:
                setattr(clone, key, value)
        clone.state = "planned"
        store.save_episode(clone)
        return clone

    def save_bible(self, store: LongStoryStore, bible: StoryBible) -> None:
        bible.updated_at = now()
        store.save_bible(bible)

    def link_bible_asset(
        self, store: LongStoryStore, collection: str, item_id: str,
        asset_id: str, *, version_policy: str = "pinned_version",
        episode_scope: EpisodeScope | None = None,
    ) -> dict[str, Any]:
        """Link a typed Story Bible entity to a Library ID, never a file path."""
        expected = {
            "characters": "character",
            "locations": "background",
            "props": "object",
        }
        if collection not in expected:
            raise ValueError("Unsupported Story Bible Asset collection")
        if version_policy not in {"pinned_version", "follow_latest", "snapshot"}:
            raise ValueError("Invalid Asset version policy")
        library = AssetLibrary(self.config.project_root / "learning_data")
        asset = library.get(asset_id)
        if asset.asset_type != expected[collection]:
            raise ValueError(
                f"{collection}에는 {expected[collection]} Asset만 연결할 수 있습니다."
            )
        bible = store.load_bible()
        manager = BibleCollectionManager(bible, collection)
        item = manager.get(item_id)
        scope = episode_scope or EpisodeScope()
        scope.validate()
        item["asset_link"] = {
            "asset_id": asset.asset_id,
            "version_policy": version_policy,
            "pinned_version": asset.version,
            "episode_scope": asdict(scope),
        }
        self.save_bible(store, bible)
        return item

    def unlink_bible_asset(
        self, store: LongStoryStore, collection: str, item_id: str
    ) -> dict[str, Any]:
        bible = store.load_bible()
        manager = BibleCollectionManager(bible, collection)
        item = manager.get(item_id)
        item.pop("asset_link", None)
        self.save_bible(store, bible)
        return item

    def link_bible_style(
        self, store: LongStoryStore, asset_id: str,
        *, version_policy: str = "pinned_version",
    ) -> StoryBible:
        library = AssetLibrary(self.config.project_root / "learning_data")
        asset = library.get(asset_id)
        if asset.asset_type != "style":
            raise ValueError("전체 시각 스타일에는 style Asset만 연결할 수 있습니다.")
        if version_policy not in {"pinned_version", "follow_latest", "snapshot"}:
            raise ValueError("Invalid Asset version policy")
        bible = store.load_bible()
        bible.basic["style_asset_link"] = {
            "asset_id": asset.asset_id,
            "version_policy": version_policy,
            "pinned_version": asset.version,
        }
        self.save_bible(store, bible)
        return bible

    def build_context(
        self, store: LongStoryStore, episode_number: int, instruction: str = ""
    ) -> dict[str, Any]:
        return self.context_builder.build(
            store, store.load_bible(), store.load_episode(episode_number), instruction
        )

    def generate_episode_script(
        self, store: LongStoryStore, episode_number: int,
        instruction: str = "", user_request_id: str | None = None,
        *, regenerate: bool = False,
    ) -> Episode:
        if self.story_adapter is None:
            raise RuntimeError(
                "OpenAI API 키가 설정되지 않았습니다. .env 파일에 "
                "OPENAI_API_KEY를 입력한 뒤 앱을 다시 실행하십시오."
            )
        key = (store.load_project().project_id, episode_number)
        project = store.load_project()
        with self._lock:
            if key in self._active_episodes:
                raise RuntimeError("동일 회차 생성 작업이 이미 실행 중입니다.")
            self._active_episodes.add(key)
        episode = store.load_episode(episode_number)
        try:
            if episode.script and not regenerate:
                raise ValueError(
                    "상세 대본이 이미 존재합니다. 명시적 재생성을 선택하십시오."
                )
            if episode.state not in {
                "planned", "outline_ready", "failed", "script_review",
                "script_approved", "waiting_for_asset_mapping_review",
                "asset_mapping_approved", "images_review", "waiting_for_video_confirmation",
            }:
                raise ValueError(
                    "현재 Episode 상태에서는 상세 대본을 생성할 수 없습니다."
                )
            job = self.jobs.begin(
                project_id=project.project_id, project_type="long_story_project",
                operation="episode_script_generation",
                resource_key=(
                    f"episode-script:{project.project_id}:{episode_number}"
                ),
                expected_api_calls=1, user_request_id=user_request_id,
                episode_number=episode_number,
            )
        except Exception:
            with self._lock:
                self._active_episodes.discard(key)
            raise
        try:
            episode.state = "script_generating"
            store.save_episode(episode)
            context = self.build_context(store, episode_number, instruction)
            mapping_store = ProjectAssetMappingStore(
                self.projects_root,
                project.project_id,
                review_scope=f"episode_{episode_number}",
            )
            asset_context = []
            library = AssetLibrary(
                self.config.project_root / "learning_data"
            )
            for mapping in mapping_store.load_all():
                if (
                    not mapping.candidate_only
                    or not mapping.enabled
                    or not mapping.episode_scope.includes(episode_number)
                ):
                    continue
                asset = library.get(mapping.asset_id)
                item = {
                    "asset_id": asset.asset_id,
                    "name": asset.display_name,
                    "type": asset.asset_type,
                    "description": asset.description,
                }
                if asset.is_folder:
                    item["image_roles"] = [
                        child.role or "other"
                        for child in library.folder_children(asset)
                    ]
                asset_context.append(item)
            if asset_context:
                context["candidate_assets"] = asset_context
            self.guard.record(job.job_id, key[0], "episode_story")
            prompt = "\n".join((
                "[1. 작업 목표]",
                "다음 장기 애니메이션에서 선택한 Episode 한 편의 상세 "
                "대본만 작성하십시오.",
                "",
                "[2. 설정 우선순위]",
                "Story Bible > 장기 프로젝트 전체 설정(project_overview) > "
                "Episode Outline > Continuity > Episode Wizard 수정값 > "
                "사용자 추가 지시사항",
                "설정이 충돌하면 앞쪽 설정을 우선하며 뒤쪽 입력으로 "
                "덮어쓰지 마십시오.",
                "",
                "[3. Episode 제작 Context]",
                json.dumps(context, ensure_ascii=False, indent=2),
                "",
                "[4. Asset 적용 규칙]",
                "candidate_assets는 Asset Library에서 가져온 이름·유형·설명의 "
                "텍스트 정보입니다. Story API에는 이미지가 첨부되지 않습니다.",
                "Asset의 핵심 특징을 대본 전체에서 일관되게 유지하십시오.",
                "",
                "[5. 출력 요구사항]",
                "이번 Episode만 작성하고 다른 Episode의 상세 대본은 "
                "생성하지 마십시오.",
                "공개 금지 정보를 노출하지 마십시오.",
                "정확히 6개 장면을 지정된 JSON 형식으로만 반환하십시오.",
                "각 장면에는 description과 함께 visual_action, "
                "start_motion, main_motion, end_motion, camera_motion, "
                "environment_motion, motion_speed, motion_intensity, "
                "expression_change, "
                "continuity_hint를 구체적인 현재형 문장으로 작성하십시오.",
                "대사 문장을 움직임으로 복사하지 말고 화면에 보이는 행동으로 "
                "변환하며, 다음 장면은 이전 장면의 end_motion을 자연스럽게 "
                "이어받게 하십시오.",
            ))
            engine = StoryEngine(self.story_adapter.generate)
            engine.initialize()
            episode.script = self.budget.run_budgeted(
                project.project_id,
                "episode_story",
                lambda: engine.execute(prompt),
            )
            self.jobs.record_call(
                job, call_type="episode_story",
                model=self.config.openai_story_model, status="succeeded",
                retries=getattr(self.story_adapter, "last_retries", 0),
                provider_request_id=getattr(
                    self.story_adapter, "last_request_id", ""
                ),
            )
            episode.script_history.append(
                {"created_at": now(), "context": context, "script": episode.script}
            )
            episode.script_revision += 1
            episode.state = "script_review"
            episode.updated_at = now()
            store.save_episode(episode)
            self.jobs.finish(job, "completed")
            return episode
        except Exception as exc:
            episode = store.load_episode(episode_number)
            episode.state = "failed"
            episode.error = str(exc)
            store.save_episode(episode)
            self.jobs.record_call(
                job, call_type="episode_story",
                model=self.config.openai_story_model, status="failed",
                retries=getattr(self.story_adapter, "last_retries", 0),
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            self.jobs.finish(
                job, "failed",
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            raise
        finally:
            with self._lock:
                self._active_episodes.discard(key)

    def approve_script(self, store: LongStoryStore, number: int) -> Episode:
        episode = store.load_episode(number)
        if episode.state != "script_review" or not episode.script:
            raise ValueError("Only a reviewed script can be approved")
        episode.approved = True
        project = store.load_project()
        mapping_store = ProjectAssetMappingStore(
            self.projects_root, project.project_id,
            review_scope=f"episode_{number}",
        )
        library = AssetLibrary(self.config.project_root / "learning_data")
        bible = store.load_bible()
        linked_items = [
            item for collection in (
                bible.characters, bible.locations, bible.props
            )
            for item in collection
            if isinstance(item.get("asset_link"), dict)
        ]
        for item in linked_items:
            link = item["asset_link"]
            link_scope = EpisodeScope(**link.get("episode_scope", {}))
            if not link_scope.includes(number):
                continue
            mapping_store.add_candidate(
                library.get(str(link["asset_id"])),
                episode_scope=link_scope,
            )
        style_link = bible.basic.get("style_asset_link")
        if isinstance(style_link, dict):
            style_asset = library.get(str(style_link["asset_id"]))
            mapping_store.add_candidate(
                style_asset,
                usage_role="style",
                episode_scope=EpisodeScope(
                    mode="episode", episode=number
                ),
            )
        review = mapping_store.begin_review(
            episode.script.get("scenes", []), episode.script_revision
        )
        episode.mapping_revision = review.mapping_revision
        episode.state = "waiting_for_asset_mapping_review"
        store.save_episode(episode)
        return episode

    def update_episode_script(
        self, store: LongStoryStore, number: int, script: dict[str, Any]
    ) -> Episode:
        """Persist a user edit as a new review Revision without any API call."""
        episode = store.load_episode(number)
        scenes = script.get("scenes", [])
        if len(scenes) != 6 or [
            int(item.get("number", 0)) for item in scenes
        ] != list(range(1, 7)):
            raise ValueError("상세 대본은 1~6번 장면을 정확히 포함해야 합니다.")
        if episode.script:
            episode.script_history.append({
                "created_at": now(),
                "source": "before_user_edit",
                "script": episode.script,
            })
        episode.script = script
        episode.script_revision += 1
        episode.approved = False
        episode.state = "script_review"
        episode.updated_at = now()
        store.save_episode(episode)
        return episode

    def approve_episode_asset_mapping(
        self, store: LongStoryStore, number: int, *,
        text_only_confirmed: bool = False, legacy_confirmed: bool = False,
    ) -> Episode:
        episode = store.load_episode(number)
        if episode.state != "waiting_for_asset_mapping_review":
            raise ValueError("Episode is not waiting for Asset Mapping review")
        project = store.load_project()
        mapping_store = ProjectAssetMappingStore(
            self.projects_root, project.project_id,
            review_scope=f"episode_{number}",
        )
        review = mapping_store.approve_review(
            episode.script.get("scenes", []), episode.script_revision,
            text_only_confirmed=text_only_confirmed,
            legacy_confirmed=legacy_confirmed,
        )
        try:
            ProjectAssetResolver(
                AssetLibrary(self.config.project_root / "learning_data"),
                mapping_store,
                ProjectReferenceManager(
                    self.projects_root, project.project_id
                ) if legacy_confirmed else None,
            ).validate_approved_assets(
                number, max_references=getattr(
                    self.image_adapter, "MAX_REFERENCE_IMAGES", 16
                ), scenes=episode.script.get("scenes", []),
            )
        except (OSError, ReferenceAssetError):
            mapping_store.invalidate_review(
                episode.script.get("scenes", []), episode.script_revision
            )
            raise
        episode.mapping_revision = review.mapping_revision
        episode.state = "asset_mapping_approved"
        store.save_episode(episode)
        return episode

    def automatic_reference_summary(
        self, store: LongStoryStore, number: int
    ) -> dict[str, Any]:
        """Return deterministic per-scene selections without an API call."""
        project = store.load_project()
        mapping_store = ProjectAssetMappingStore(
            self.projects_root, project.project_id,
            review_scope=f"episode_{number}",
        )
        candidates = {
            item.asset_id for item in mapping_store.load_all()
            if item.candidate_only and item.enabled
        }
        return {
            "candidate_asset_ids": sorted(candidates),
            "selected_asset_ids_by_scene":
                mapping_store.automatic_selection_summary(number),
            "estimated_image_api_calls": 6,
        }

    def confirm_automatic_references(
        self, store: LongStoryStore, number: int
    ) -> Episode:
        """Approve local Resolver output after the user's simple confirmation."""
        episode = store.load_episode(number)
        if episode.state != "waiting_for_asset_mapping_review":
            raise ValueError("Episode is not waiting for Reference confirmation")
        project = store.load_project()
        mapping_store = ProjectAssetMappingStore(
            self.projects_root, project.project_id,
            review_scope=f"episode_{number}",
        )
        review = mapping_store.approve_automatic_selection(
            episode.script.get("scenes", []), episode.script_revision
        )
        episode.mapping_revision = review.mapping_revision
        episode.state = "asset_mapping_approved"
        store.save_episode(episode)
        return episode

    def rerun_episode_asset_matching(
        self, store: LongStoryStore, number: int
    ) -> Episode:
        episode = store.load_episode(number)
        if episode.state not in {
            "waiting_for_asset_mapping_review", "asset_mapping_approved"
        }:
            raise ValueError("Episode is not in an Asset Mapping review state")
        project = store.load_project()
        mapping_store = ProjectAssetMappingStore(
            self.projects_root, project.project_id,
            review_scope=f"episode_{number}",
        )
        mappings = [
            item for item in mapping_store.load_all()
            if item.candidate_only
            or item.assignment_source != "auto"
            or not item.episode_scope.includes(number)
        ]
        candidate_ids = {
            item.asset_id for item in mappings
            if item.candidate_only and item.enabled
        }
        library = AssetLibrary(self.config.project_root / "learning_data")
        candidates = [
            asset for asset in library.load_all()
            if asset.asset_id in candidate_ids and asset.enabled
        ]
        matcher = SceneAssetMatcher()
        for scene in episode.script.get("scenes", []):
            matched = matcher.match(
                project.project_id, int(scene["number"]),
                extract_scene_entities(scene), candidates,
            )
            for item in matched:
                item.episode_scope = EpisodeScope(
                    mode="episode", episode=number
                )
            mappings.extend(matched)
        mapping_store.save_all(mappings)
        review = mapping_store.begin_review(
            episode.script.get("scenes", []), episode.script_revision
        )
        episode.mapping_revision = review.mapping_revision
        episode.state = "waiting_for_asset_mapping_review"
        store.save_episode(episode)
        return episode

    def generate_episode_images(
        self, store: LongStoryStore, number: int,
        user_request_id: str | None = None,
    ) -> Episode:
        if self.image_adapter is None:
            raise RuntimeError("OPENAI_API_KEY가 필요합니다.")
        episode = store.load_episode(number)
        if episode.state not in {"asset_mapping_approved", "images_partial"}:
            raise ValueError("장면 Asset Mapping 승인 전에는 이미지를 생성할 수 없습니다.")
        project = store.load_project()
        review = ProjectAssetMappingStore(
            self.projects_root, project.project_id,
            review_scope=f"episode_{number}",
        ).assert_generation_allowed(
            episode.script.get("scenes", []), episode.script_revision
        )
        if review.mapping_revision != episode.mapping_revision:
            raise ValueError("Episode Mapping Revision이 일치하지 않습니다.")
        resolver = ProjectAssetResolver(
            AssetLibrary(self.config.project_root / "learning_data"),
            ProjectAssetMappingStore(self.projects_root, project.project_id),
            ProjectReferenceManager(self.projects_root, project.project_id)
            if review.legacy_confirmed else None,
        )
        resolver.validate_approved_assets(
            number, max_references=getattr(
                self.image_adapter, "MAX_REFERENCE_IMAGES", 16
            ), scenes=episode.script.get("scenes", []),
        )
        job = self.jobs.begin(
            project_id=project.project_id, project_type="long_story_project",
            operation="episode_image_generation",
            resource_key=f"episode-images:{project.project_id}:{number}",
            expected_api_calls=self.config.app_max_image_calls_per_job,
            user_request_id=user_request_id, episode_number=number,
        )
        episode.state = "images_generating"
        store.save_episode(episode)
        output = store.episode_root(number) / "images"
        request_image_size = image_size_for_aspect(
            project.aspect_ratio, self.config.openai_image_size
        )
        engine = ImageEngine(
            lambda prompt, references: generate_image_at_size(
                self.image_adapter, prompt, references, request_image_size
            ),
            output,
            self.config.project_root / "cache" / "images",
            (
                f"{self.config.openai_image_model}|{request_image_size}|"
                f"{self.config.openai_image_quality}|{self.config.openai_image_format}|"
                f"episode:{number}|adapter:v1|mapping:{episode.mapping_revision}|"
                f"script:{episode.script_revision}"
            ),
        )
        engine.initialize()
        while len(episode.generated_images) < 6:
            episode.generated_images.append("")
        episode.failed_scene_numbers = []
        try:
            provider_calls = 0
            for scene in episode.script["scenes"]:
                scene_number = int(scene["number"])
                preview = self.preview_scene_generation(store, number, scene_number)
                paths = [Path(value) for value in preview["reference_paths"]]
                descriptors = list(preview["reference_descriptors"])
                prompt = str(preview["prompt"])
                cached = engine.is_cached(prompt, paths, descriptors)
                if not cached:
                    if provider_calls >= self.config.app_max_image_calls_per_job:
                        raise RuntimeError("작업별 이미지 API 호출 한도를 초과했습니다.")
                    self.guard.record(job.job_id, project.project_id, "episode_image")
                    provider_calls += 1
                try:
                    execute_image = lambda: engine.execute(
                        scene_number, prompt, paths,
                        reference_descriptors=descriptors,
                    )
                    path = (
                        execute_image()
                        if cached
                        else self.budget.run_budgeted(
                            project.project_id, "image", execute_image
                        )
                    )
                except Exception as exc:
                    episode.failed_scene_numbers = [scene_number]
                    episode.state = "images_partial"
                    store.save_episode(episode)
                    self.jobs.record_call(
                        job, call_type="episode_image",
                        model=self.config.openai_image_model, status="failed",
                        retries=getattr(self.image_adapter, "last_retries", 0),
                        error_category=getattr(exc, "category", type(exc).__name__),
                        reference_ids=[
                            item["asset_id"] for item in preview["references"]
                        ],
                        reference_paths=list(preview["reference_paths"]),
                        reference_reasons=[
                            item["reason"]
                            for item in preview["reference_details"]
                        ],
                    )
                    raise
                episode.generated_images[scene_number - 1] = str(path)
                AssetLibrary(
                    self.config.project_root / "learning_data"
                ).index_project_image(
                    path,
                    asset_type="general_reference",
                    display_name=(
                        f"{project.title} · Episode {number} · Scene {scene_number}"
                    ),
                    tags=[
                        "generated", project.project_id,
                        f"episode-{number}", f"scene-{scene_number}",
                    ],
                    status="generated",
                    source_project_id=project.project_id,
                    source_scene_number=scene_number,
                )
                episode.image_generation_records = [
                    item for item in episode.image_generation_records
                    if int(item.get("scene", 0)) != scene_number
                ]
                episode.image_generation_records.append({
                    "scene": scene_number,
                    "cache_hit": cached,
                    "reference_ids": [
                        item["asset_id"] for item in preview["references"]
                    ],
                    "reference_paths": list(preview["reference_paths"]),
                    "reference_details": list(
                        preview["reference_details"]
                    ),
                    "prompt_length": len(prompt),
                    "image_api_calls": 0 if cached else 1,
                    "candidate_asset_counts": (
                        resolver.candidate_asset_counts(
                            number, scene_number
                        )
                    ),
                    "completed_at": now(),
                })
                store.save_episode(episode)
                self.jobs.record_call(
                    job, call_type="episode_image",
                    model=self.config.openai_image_model,
                    status="cached" if cached else "succeeded",
                    cache_hit=cached,
                    retries=getattr(self.image_adapter, "last_retries", 0),
                    reference_ids=[
                        item["asset_id"] for item in preview["references"]
                    ],
                    reference_paths=list(preview["reference_paths"]),
                    reference_reasons=[
                        item["reason"]
                        for item in preview["reference_details"]
                    ],
                    provider_request_id=getattr(
                        self.image_adapter, "last_request_id", ""
                    ),
                )
            episode.failed_scene_numbers = []
            episode.state = "images_review"
            store.save_episode(episode)
            self.jobs.finish(job, "completed")
            return episode
        except Exception as exc:
            self.jobs.finish(
                job, "partially_completed" if job.successful_calls else "failed",
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            raise

    def preview_scene_generation(
        self, store: LongStoryStore, number: int, scene_number: int
    ) -> dict[str, Any]:
        """Return the exact prompt and ordered references without an API call."""
        episode = store.load_episode(number)
        if scene_number not in range(1, 7):
            raise ValueError("Scene number must be between 1 and 6")
        scenes = episode.script.get("scenes", [])
        scene = next(
            (item for item in scenes if int(item.get("number", 0)) == scene_number),
            None,
        )
        if scene is None:
            raise ValueError("Selected scene is not present in the episode script")
        project = store.load_project()
        manager = ProjectReferenceManager(self.projects_root, project.project_id)
        mapping_store = ProjectAssetMappingStore(
            self.projects_root, project.project_id,
            review_scope=f"episode_{number}",
        )
        review = mapping_store.load_review()
        resolver = ProjectAssetResolver(
            AssetLibrary(self.config.project_root / "learning_data"),
            mapping_store,
            manager if review.legacy_confirmed else None,
        )
        paths, reference_ids, warnings = resolver.select_for_episode_scene(
            number, scene_number, scene
        )
        continuity_link = episode.outline.get("previous_scene_link", {})
        continuity_reference: dict[str, Any] = {}
        if (
            scene_number == 1
            and isinstance(continuity_link, dict)
            and continuity_link.get("source_kind") == "long_episode"
        ):
            previous_number = int(
                continuity_link.get("episode_number", 0)
            )
            if previous_number <= 0 or previous_number >= number:
                raise ValueError("이전 Episode 연결 정보가 올바르지 않습니다.")
            previous = store.load_episode(previous_number)
            if (
                previous.state not in {
                    "waiting_for_video_confirmation", "edited", "upload_ready",
                    "uploaded", "completed",
                }
                or len(previous.generated_images) < 6
            ):
                raise ValueError(
                    "연결한 이전 Episode의 이미지 승인이 완료되지 않았습니다."
                )
            continuity_path = Path(previous.generated_images[5]).resolve()
            previous_root = store.episode_root(previous_number).resolve()
            if (
                previous_root not in continuity_path.parents
                or not continuity_path.is_file()
            ):
                raise ValueError(
                    "연결한 이전 Episode의 마지막 장면을 찾을 수 없습니다."
                )
            paths.append(continuity_path)
            reference_ids.append(
                f"continuity:{project.project_id}:episode{previous_number}:scene6"
            )
            continuity_reference = {
                "asset_id": reference_ids[-1],
                "reference_type": "continuity",
                "display_name": (
                    f"Episode {previous_number:02d} 마지막 장면"
                ),
                "face_baseline": False,
                "version": "current",
            }
        if len(paths) > getattr(
            self.image_adapter, "MAX_REFERENCE_IMAGES", 16
        ):
            raise ValueError(
                "이전 장면을 포함한 Reference 이미지 수가 한도를 초과합니다."
            )
        legacy_by_id = {item.asset_id: item for item in manager.load_all()}
        references = []
        library = AssetLibrary(self.config.project_root / "learning_data")
        for reference_id in reference_ids:
            if reference_id.startswith("continuity:"):
                continue
            bare_id = reference_id.split("@v", 1)[0]
            if bare_id in legacy_by_id:
                references.append(asdict(legacy_by_id[bare_id]))
            else:
                asset = library.get(bare_id)
                references.append({
                    "asset_id": reference_id,
                    "reference_type": asset.asset_type,
                    "display_name": asset.display_name,
                    "face_baseline": asset.face_baseline,
                    "version": reference_id.split("@v", 1)[-1],
                })
        if continuity_reference:
            references.append(continuity_reference)
        reference_manifest = resolver.prompt_reference_manifest(
            number, scene_number, scene
        )
        if continuity_reference:
            reference_manifest += (
                "\n\n[이전 장면 연속성 Reference]\n"
                f"파일: {paths[-1].name}\n"
                f"이전 Episode: {continuity_reference['display_name']}\n"
                "역할: 직전 이야기의 마지막 장면\n"
                "배경 구조·시간대·조명·인물 배치를 자연스럽게 이어가되, "
                "새 행동과 카메라 구성은 허용하십시오."
            )
        prompt = self.prompts.render(
            "image/scene_generation",
            {
                "project_name": project.title,
                "topic": episode.title or episode.core_event or project.theme,
                "story_context": (
                    episode.summary or episode.outline.get("summary")
                    or project.overview
                ),
                "scene": scene,
                "character": "Story Bible characters",
                "character_cast_metadata": (
                    "Story Bible과 Episode 대본에 정의된 등장 캐릭터를 "
                    "대표 이름과 역할에 따라 유지"
                ),
                "atmosphere_asset_metadata": (
                    "장기 프로젝트의 Story Bible, 장르와 분위기 설정"
                ),
                "scene_reference_asset_metadata": (
                    "단기 프로젝트 전용 장면 참고 Asset 없음"
                ),
                "style": project.tone,
                "lore": project.overview,
                "references": reference_manifest,
                "production_settings": "\n".join((
                    f"- 장르: {project.genre or '별도 지정 없음'}",
                    f"- 전체 분위기: {project.tone or '별도 지정 없음'}",
                    f"- 핵심 주제: {project.theme or '별도 지정 없음'}",
                    "- 시각적 스타일: Story Bible과 프로젝트 설정 유지",
                    "- 색감: Story Bible과 프로젝트 설정 유지",
                    "- 조명: 장면 설명과 프로젝트 분위기 유지",
                    "- 카메라 느낌: 장면 설명에 맞는 애니메이션 카메라",
                    "- 대사 스타일: Episode 상세 대본 유지",
                    f"- 피해야 할 요소: {project.notes or '별도 지정 없음'}",
                    f"- 화면 비율: {project.aspect_ratio}",
                    f"- 전체 영상 길이: 약 {episode.duration_seconds}초",
                    f"- 전체 장면 수: {len(scenes)}개",
                    f"- 대상 시청자: {project.audience or '별도 지정 없음'}",
                )),
                "scene_composition": format_scene_composition(scene),
            },
        ).text
        output = store.episode_root(number) / "images"
        request_image_size = image_size_for_aspect(
            project.aspect_ratio, self.config.openai_image_size
        )
        engine = ImageEngine(
            (
                lambda prompt, references: generate_image_at_size(
                    self.image_adapter, prompt, references, request_image_size
                )
                if self.image_adapter else lambda *_: b""
            ),
            output,
            self.config.project_root / "cache" / "images",
            (
                f"{self.config.openai_image_model}|{request_image_size}|"
                f"{self.config.openai_image_quality}|{self.config.openai_image_format}|"
                f"episode:{number}|adapter:v1"
            ),
        )
        descriptors = resolver.cache_descriptors(
            number, scene_number,
            review.mapping_revision, review.script_revision,
            scene,
        )
        if continuity_reference:
            descriptors.append(str(continuity_reference["asset_id"]))
        cache_hit = engine.is_cached(prompt, paths, descriptors)
        reference_details = describe_reference_selection(
            reference_ids, paths, scene
        )
        return {
            "episode": number,
            "scene": scene_number,
            "prompt": prompt,
            "references": references,
            "reference_paths": [str(path) for path in paths],
            "reference_details": reference_details,
            "candidate_asset_counts": resolver.candidate_asset_counts(
                number, scene_number
            ),
            "reference_descriptors": descriptors,
            "warnings": warnings,
            "estimated_api_calls": 0 if cache_hit else 1,
            "cache_hit": cache_hit,
        }

    def regenerate_episode_scene(
        self, store: LongStoryStore, number: int, scene_number: int,
        user_request_id: str | None = None,
        *,
        edited_script: str | None = None,
        edited_image_prompt: str | None = None,
    ) -> Episode:
        """Replace exactly one scene image after an explicit UI confirmation."""
        if self.image_adapter is None:
            raise RuntimeError("OPENAI_API_KEY가 필요합니다.")
        episode = store.load_episode(number)
        if episode.state not in {"images_review", "waiting_for_video_confirmation"}:
            raise ValueError("이미지 검토 단계의 회차만 재생성할 수 있습니다.")
        project = store.load_project()
        mapping_review = ProjectAssetMappingStore(
            self.projects_root, project.project_id,
            review_scope=f"episode_{number}",
        ).assert_generation_allowed(
            episode.script.get("scenes", []), episode.script_revision
        )
        if mapping_review.mapping_revision != episode.mapping_revision:
            raise ValueError("Episode Mapping Revision이 일치하지 않습니다.")
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
        if script_override is not None:
            scenes = episode.script.get("scenes", [])
            scene = next(
                (
                    item for item in scenes
                    if int(item.get("number", 0)) == scene_number
                ),
                None,
            )
            if scene is None:
                raise ValueError("선택한 장면 대본을 찾을 수 없습니다.")
            scene["description"] = script_override
        if prompt_override is not None:
            scenes = episode.script.get("scenes", [])
            scene = next(
                (
                    item for item in scenes
                    if int(item.get("number", 0)) == scene_number
                ),
                None,
            )
            if scene is None:
                raise ValueError("선택한 장면 대본을 찾을 수 없습니다.")
            scene["image_prompt_override"] = prompt_override
        if script_override is not None or prompt_override is not None:
            store.save_episode(episode)
        preview = self.preview_scene_generation(store, number, scene_number)
        if prompt_override is not None:
            preview["prompt"] = prompt_override
        job = self.jobs.begin(
            project_id=project.project_id, project_type="long_story_project",
            operation="episode_scene_regeneration",
            resource_key=f"episode-regen:{project.project_id}:{number}:{scene_number}",
            expected_api_calls=1, user_request_id=user_request_id,
            episode_number=number, scene_number=scene_number,
        )
        output = store.episode_root(number) / "images"
        request_image_size = image_size_for_aspect(
            project.aspect_ratio, self.config.openai_image_size
        )
        engine = ImageEngine(
            lambda prompt, references: generate_image_at_size(
                self.image_adapter, prompt, references, request_image_size
            ),
            output,
            self.config.project_root / "cache" / "images",
            (
                f"{self.config.openai_image_model}|{request_image_size}|"
                f"{self.config.openai_image_quality}|{self.config.openai_image_format}|"
                f"episode:{number}|adapter:v1"
            ),
        )
        engine.initialize()
        try:
            self.guard.record(
                job.job_id, project.project_id, "episode_image_regeneration"
            )
            path = self.budget.run_budgeted(
                project.project_id,
                "image",
                lambda: engine.execute(
                    scene_number,
                    str(preview["prompt"]),
                    [Path(value) for value in preview["reference_paths"]],
                    regenerate=True,
                    reference_descriptors=list(preview["reference_descriptors"]),
                ),
            )
            self.jobs.record_call(
                job, call_type="episode_image_regeneration",
                model=self.config.openai_image_model, status="succeeded",
                retries=getattr(self.image_adapter, "last_retries", 0),
                reference_ids=[
                    item["asset_id"] for item in preview["references"]
                ],
                reference_paths=list(preview["reference_paths"]),
                reference_reasons=[
                    item["reason"]
                    for item in preview["reference_details"]
                ],
                provider_request_id=getattr(
                    self.image_adapter, "last_request_id", ""
                ),
            )
        except Exception as exc:
            self.jobs.record_call(
                job, call_type="episode_image_regeneration",
                model=self.config.openai_image_model, status="failed",
                retries=getattr(self.image_adapter, "last_retries", 0),
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            self.jobs.finish(
                job, "failed",
                error_category=getattr(exc, "category", type(exc).__name__),
            )
            raise
        while len(episode.generated_images) < 6:
            episode.generated_images.append("")
        previous_path = Path(episode.generated_images[scene_number - 1])
        library = AssetLibrary(self.config.project_root / "learning_data")
        if previous_path.is_file():
            library.index_project_image(
                previous_path,
                asset_type="general_reference",
                display_name=(
                    f"{project.title} · Episode {number} · "
                    f"Scene {scene_number} · 교체됨"
                ),
                status="replaced",
                source_project_id=project.project_id,
                source_scene_number=scene_number,
            )
        episode.generated_images[scene_number - 1] = str(path)
        library.index_project_image(
            path,
            asset_type="general_reference",
            display_name=(
                f"{project.title} · Episode {number} · Scene {scene_number}"
            ),
            tags=["replaced", project.project_id, f"episode-{number}"],
            status="generated",
            source_project_id=project.project_id,
            source_scene_number=scene_number,
        )
        if scene_number in episode.approved_scene_numbers:
            episode.approved_scene_numbers.remove(scene_number)
        episode.state = "images_review"
        episode.scene_regeneration_history.append({
            "scene": scene_number,
            "created_at": now(),
            "prompt": preview["prompt"],
            "reference_ids": [
                item["asset_id"] for item in preview["references"]
            ],
            "reference_paths": list(preview["reference_paths"]),
            "reference_details": list(preview["reference_details"]),
            "prompt_length": len(str(preview["prompt"])),
            "image_api_calls": 1,
            "candidate_asset_counts": dict(
                preview["candidate_asset_counts"]
            ),
            "cache_bypassed": True,
            "user_edited_script": script_override is not None,
            "user_edited_prompt": prompt_override is not None,
        })
        episode.image_generation_records = [
            item for item in episode.image_generation_records
            if int(item.get("scene", 0)) != scene_number
        ]
        episode.image_generation_records.append({
            "scene": scene_number,
            "cache_hit": False,
            "reference_ids": [
                item["asset_id"] for item in preview["references"]
            ],
            "reference_paths": list(preview["reference_paths"]),
            "reference_details": list(preview["reference_details"]),
            "prompt_length": len(str(preview["prompt"])),
            "image_api_calls": 1,
            "candidate_asset_counts": dict(
                preview["candidate_asset_counts"]
            ),
            "completed_at": now(),
            "prompt": preview["prompt"],
            "user_edited_script": script_override is not None,
            "user_edited_prompt": prompt_override is not None,
        })
        if script_override is not None:
            # A scene-text edit does not alter the Episode Candidate Assets.
            # Refresh only the approved fingerprint so a later regeneration
            # is not incorrectly rejected as an unreviewed Mapping change.
            mapping_review.script_fingerprint = script_fingerprint(
                episode.script.get("scenes", [])
            )
            ProjectAssetMappingStore(
                self.projects_root,
                project.project_id,
                review_scope=f"episode_{number}",
            ).save_review(mapping_review)
        episode.face_consistency_results = [
            item for item in episode.face_consistency_results
            if int(item.get("scene", 0)) != scene_number
        ]
        if self.config.face_check_enabled:
            character_references = [
                item for item in preview["references"]
                if item["reference_type"] == "character"
                and item.get("face_baseline")
            ]
            try:
                if character_references:
                    backend = InsightFaceBackend(
                        model_name=self.config.face_model_name,
                        model_root=self.config.face_model_directory,
                    )
                    checker = FaceConsistencyService(
                        backend,
                        pass_threshold=self.config.face_pass_threshold,
                        warning_threshold=self.config.face_warning_threshold,
                        model_name=f"InsightFace/{self.config.face_model_name}",
                    )
                    baseline_id = character_references[0]["asset_id"]
                    reference_path = next(
                        Path(path_value)
                        for item, path_value in zip(
                            preview["references"], preview["reference_paths"]
                        )
                        if item["asset_id"] == baseline_id
                    )
                    result = checker.check(
                        reference_path, path,
                    )
                    episode.face_consistency_results.append({
                        "scene": scene_number, **asdict(result)
                    })
            except Exception as exc:
                episode.face_consistency_results.append({
                    "scene": scene_number,
                    "status": "check_unavailable",
                    "message": str(exc),
                })
        episode.updated_at = now()
        store.save_episode(episode)
        self.jobs.finish(job, "completed")
        return episode

    def approve_image(self, store: LongStoryStore, number: int, scene: int) -> Episode:
        episode = store.load_episode(number)
        if episode.state != "images_review" or scene not in range(1, 7):
            raise ValueError("Image is not awaiting review")
        if scene not in episode.approved_scene_numbers:
            episode.approved_scene_numbers.append(scene)
            episode.approved_scene_numbers.sort()
        project = store.load_project()
        AssetLibrary(
            self.config.project_root / "learning_data"
        ).index_project_image(
            Path(episode.generated_images[scene - 1]),
            asset_type="general_reference",
            display_name=f"{project.title} · Episode {number} · Scene {scene}",
            tags=["approved", project.project_id, f"episode-{number}"],
            status="approved",
            approved=True,
            source_project_id=project.project_id,
            source_scene_number=scene,
        )
        if len(episode.approved_scene_numbers) == 6:
            episode.state = "waiting_for_video_confirmation"
        store.save_episode(episode)
        return episode

    def prepare_next_episode(
        self, store: LongStoryStore, current_number: int,
        memory: ContinuityMemory,
    ) -> Episode | None:
        current = store.load_episode(current_number)
        if current.state not in {
            "waiting_for_video_confirmation",
            "videos_generating",
            "videos_ready",
            "videos_review",
            "videos_approved",
            "rendering",
            "waiting_for_video_confirmation",
            "edited",
            "upload_ready",
            "uploaded",
            "completed",
        }:
            raise ValueError("Current episode is not approved")
        store.save_continuity(memory)
        try:
            return store.load_episode(current_number + 1)
        except ValueError:
            return None


