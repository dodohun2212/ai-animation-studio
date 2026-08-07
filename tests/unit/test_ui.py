"""Headless tests for UI data loading."""

from pathlib import Path
import ast
import tempfile
import unittest

from app.config.config import AppConfig
from app.core.project_context import ProjectContext, WorkflowState
from app.services.asset_library import LibraryAsset
from app.services.memory_manager import MemoryManager
from app.ui import (
    ASSET_SEARCH_DISPLAY_PRIORITY,
    ASSET_SEARCH_GUIDANCE,
    ASSET_UX_LABELS,
    StudioApp,
    asset_search_match_summary,
    candidate_asset_debug_text,
    compose_asset_visual_description,
    copy_story_prompt,
    highlight_search_matches,
    inspect_video_clips,
    load_dashboard_data,
    migrate_asset_visual_values,
    parse_asset_visual_description,
    project_delete_confirmation_matches,
    project_progress,
    reference_role_options,
    reference_review_debug_text,
    required_video_paths,
    runway_prompt_code_units,
    set_story_prompt_text,
    story_prompt_submission_error,
)


class DashboardDataTest(unittest.TestCase):
    def test_primary_toplevel_action_bars_are_reserved_at_bottom(self) -> None:
        source_path = Path(__file__).parents[2] / "app" / "ui.py"
        source = source_path.read_text(encoding="utf-8")
        for name in (
            "runway_confirmation_action_bar",
            "video_review_action_bar",
            "short_project_action_bar",
            "asset_action_bar",
        ):
            self.assertIn(f'name="{name}"', source)
        self.assertGreaterEqual(source.count('side="bottom", fill="x"'), 8)

    def test_runway_prompt_counter_uses_utf16_code_units(self) -> None:
        self.assertEqual(runway_prompt_code_units("한글ABC"), 5)
        self.assertEqual(runway_prompt_code_units("장면🎬"), 4)

    def test_generation_progress_window_does_not_lock_main_window(self) -> None:
        source_path = Path(__file__).parents[2] / "app" / "ui.py"
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        progress_method = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
            and node.name == "_open_generation_progress"
        )
        grab_calls = [
            node
            for node in ast.walk(progress_method)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and node.func.attr == "grab_set"
        ]
        self.assertEqual(grab_calls, [])

    def test_header_exposes_runway_key_connection_controls(self) -> None:
        source_path = Path(__file__).parents[2] / "app" / "ui.py"
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        methods = {
            node.name: node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
        }
        header = methods["_build_api_key_panel"]
        labels = {
            node.value
            for node in ast.walk(header)
            if isinstance(node, ast.Constant) and isinstance(node.value, str)
        }
        self.assertIn("RUNWAY VIDEO", labels)
        self.assertIn("키 저장·연결", labels)
        self.assertIn("_disconnect_runway", methods)
        self.assertIn("_reconnect_runway", methods)
        self.assertIn("_connect_runway_key", methods)
        self.assertIn("_toggle_runway_key_visibility", methods)

        connect = methods["_open_runway_key_dialog"]
        called_attributes = {
            node.func.attr
            for node in ast.walk(connect)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
        }
        self.assertNotIn("create_image_to_video", called_attributes)

    def test_short_wizard_style_step_is_scrollable(self) -> None:
        source_path = Path(__file__).parents[2] / "app" / "ui.py"
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        wizard = next(
            node for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
            and node.name == "_build_short_project_wizard"
        )
        render_style = next(
            node for node in ast.walk(wizard)
            if isinstance(node, ast.FunctionDef)
            and node.name == "render_style"
        )
        calls = [
            node for node in ast.walk(render_style)
            if isinstance(node, ast.Call)
        ]
        self.assertTrue(any(
            isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "tk"
            and node.func.attr == "Canvas"
            for node in calls
        ))
        self.assertTrue(any(
            isinstance(node.func, ast.Attribute)
            and node.func.attr == "_bind_scroll_canvas"
            for node in calls
        ))

    def test_short_wizard_separates_character_and_atmosphere_assets(self) -> None:
        source_path = Path(__file__).parents[2] / "app" / "ui.py"
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        wizard = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
            and node.name == "_build_short_project_wizard"
        )
        nested = {
            node.name: node
            for node in ast.walk(wizard)
            if isinstance(node, ast.FunctionDef)
        }
        folder_picker = nested["choose_folder_references"]
        selected_adds = [
            node
            for node in ast.walk(folder_picker)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "selected_ids"
            and node.func.attr == "add"
        ]
        self.assertEqual(selected_adds, [])

        delivery = nested["all_delivery_asset_ids"]
        delivery_names = {
            node.id for node in ast.walk(delivery)
            if isinstance(node, ast.Name)
        }
        self.assertIn("selected_ids", delivery_names)
        self.assertIn("atmosphere_asset_ids", delivery_names)
        self.assertIn("scene_reference_assets", delivery_names)

        labels = {
            node.value for node in ast.walk(wizard)
            if isinstance(node, ast.Constant)
            and isinstance(node.value, str)
        }
        self.assertIn("등장 캐릭터 선택", labels)
        self.assertIn(
            "Character Asset만 표시 · 대표 또는 서브 역할 지정",
            labels,
        )
        self.assertIn("장면 참고 Asset", labels)
        self.assertIn("장면 참고 Asset 사용 목적", labels)

    def test_image_confirmation_no_reopens_candidate_wizard_step(self) -> None:
        source_path = Path(__file__).parents[2] / "app" / "ui.py"
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        confirmation = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
            and node.name == "_confirm_short_automatic_references"
        )
        calls = [
            node for node in ast.walk(confirmation)
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
        ]
        called_methods = [node.func.attr for node in calls]
        self.assertIn("_open_project_brief", called_methods)
        self.assertNotIn("_open_project_assets", called_methods)
        reopen = next(
            node for node in calls
            if node.func.attr == "_open_project_brief"
        )
        keywords = {item.arg: item.value for item in reopen.keywords}
        self.assertEqual(keywords["initial_step"].value, 3)
        self.assertIn("on_project_saved", keywords)

    def test_image_confirmation_initializes_generation_service(self) -> None:
        source_path = Path(__file__).parents[2] / "app" / "ui.py"
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        confirmation = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
            and node.name == "_confirm_short_automatic_references"
        )
        assignments = [
            node for node in ast.walk(confirmation)
            if isinstance(node, ast.Assign)
        ]
        service_assignments = [
            node for node in assignments
            if any(
                isinstance(target, ast.Attribute)
                and target.attr == "generation_service"
                for target in node.targets
            )
            and isinstance(node.value, ast.Call)
            and getattr(node.value.func, "id", "") == "GenerationService"
        ]
        self.assertEqual(len(service_assignments), 1)

    def test_image_gallery_loads_images_only_after_project_selection(self) -> None:
        source_path = Path(__file__).parents[2] / "app" / "ui.py"
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        gallery_method = next(
            node
            for node in ast.walk(tree)
            if isinstance(node, ast.FunctionDef)
            and node.name == "_open_project_image_gallery"
        )
        nested = {
            node.name: node
            for node in gallery_method.body
            if isinstance(node, ast.FunctionDef)
        }
        self.assertIn("show_project_list", nested)
        self.assertIn("show_project_detail", nested)

        list_calls = [
            node.func.attr
            for node in ast.walk(nested["show_project_list"])
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
        ]
        detail_calls = [
            node.func.attr
            for node in ast.walk(nested["show_project_detail"])
            if isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
        ]
        self.assertNotIn("PhotoImage", list_calls)
        self.assertIn("PhotoImage", detail_calls)
        self.assertIsInstance(gallery_method.body[-2], ast.Expr)
        initial_call = gallery_method.body[-2].value
        self.assertIsInstance(initial_call, ast.Call)
        self.assertEqual(initial_call.func.id, "show_project_list")

    def test_atmosphere_asset_button_opens_picker_and_folder_selector(self) -> None:
        source_path = Path(__file__).parents[2] / "app" / "ui.py"
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        functions = {
            node.name: node
            for node in ast.walk(tree)
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        }
        atmosphere = functions["add_atmosphere_asset"]
        calls = [
            node for node in ast.walk(atmosphere)
            if isinstance(node, ast.Call)
        ]
        self.assertTrue(any(
            isinstance(call.func, ast.Attribute)
            and isinstance(call.func.value, ast.Name)
            and call.func.value.id == "tk"
            and call.func.attr == "Toplevel"
            for call in calls
        ))
        self.assertTrue(any(
            isinstance(call.func, ast.Name)
            and call.func.id == "choose_folder_references"
            for call in calls
        ))

    def test_ui_uses_only_defined_uppercase_theme_attributes(self) -> None:
        source_path = Path(__file__).parents[2] / "app" / "ui.py"
        tree = ast.parse(source_path.read_text(encoding="utf-8"))
        referenced = {
            node.attr
            for node in ast.walk(tree)
            if isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "self"
            and node.attr.isupper()
        }
        missing = sorted(
            name for name in referenced if not hasattr(StudioApp, name)
        )
        self.assertEqual(missing, [])

    def test_character_visual_inputs_form_prompt_ready_description(self) -> None:
        description = compose_asset_visual_description(
            "character",
            {
                "appearance": "둥근 얼굴과 작은 체형",
                "wardrobe": "파란 재킷과 은색 가방",
                "consistency": "왼쪽 눈 아래 점 유지",
            },
        )
        self.assertIn("외형·실루엣: 둥근 얼굴과 작은 체형", description)
        self.assertIn("복장·대표 색상·소품: 파란 재킷과 은색 가방", description)
        self.assertIn("일관성 유지 기준: 왼쪽 눈 아래 점 유지", description)

    def test_background_visual_inputs_focus_on_scene_atmosphere(self) -> None:
        description = compose_asset_visual_description(
            "background",
            {
                "setting": "넓은 유리 온실",
                "conditions": "비 오는 저녁",
                "atmosphere": "청록색 저조도와 고요한 분위기",
            },
        )
        self.assertIn("장소·공간 구조: 넓은 유리 온실", description)
        self.assertIn("시간대·계절·날씨: 비 오는 저녁", description)
        self.assertIn(
            "분위기·색감·조명: 청록색 저조도와 고요한 분위기",
            description,
        )

    def test_asset_visual_description_round_trip_for_metadata_editor(
        self,
    ) -> None:
        original = {
            "appearance": "각진 얼굴과 긴 꼬리",
            "wardrobe": "초록 재킷과 금색 나침반",
            "consistency": "오른쪽 귀의 흉터 유지",
        }
        description = compose_asset_visual_description(
            "character", original
        )
        self.assertEqual(
            parse_asset_visual_description("character", description),
            original,
        )

    def test_legacy_free_description_is_preserved_in_first_editor_field(
        self,
    ) -> None:
        parsed = parse_asset_visual_description(
            "background", "오래된 돌다리와 잔잔한 강"
        )
        self.assertEqual(
            parsed["setting"], "오래된 돌다리와 잔잔한 강"
        )
        self.assertEqual(parsed["conditions"], "")
        self.assertEqual(parsed["atmosphere"], "")

    def test_asset_type_change_keeps_only_shared_visual_fields(self) -> None:
        values = {
            "appearance": "둥근 실루엣",
            "wardrobe": "붉은 외투",
            "consistency": "눈 색 유지",
            "scale": "",
            "atmosphere": "차분한 공기",
            "setting": "숲",
        }

        object_values = migrate_asset_visual_values(
            "character", "object", values
        )
        self.assertEqual(object_values["appearance"], "둥근 실루엣")
        self.assertEqual(object_values["wardrobe"], "")
        self.assertEqual(object_values["consistency"], "")

        general_values = migrate_asset_visual_values(
            "background", "general_reference", values
        )
        self.assertEqual(general_values["atmosphere"], "차분한 공기")
        self.assertEqual(general_values["setting"], "")

    def test_project_delete_confirmation_allows_harmless_differences(
        self,
    ) -> None:
        title = "첫 번째 셔터: 이배드의 탄생"
        self.assertTrue(
            project_delete_confirmation_matches(
                "  첫 번째 셔터： 이배드의 탄생  ", title
            )
        )
        self.assertTrue(
            project_delete_confirmation_matches(
                "project_123", title, "project_123"
            )
        )
        self.assertFalse(
            project_delete_confirmation_matches("다른 프로젝트", title)
        )
        self.assertFalse(project_delete_confirmation_matches(None, title))

    def test_reference_roles_are_type_specific_and_korean_except_character(
        self,
    ) -> None:
        self.assertEqual(
            reference_role_options("character")[:3],
            ("front", "left45", "right45"),
        )
        self.assertIn("전체 전경", reference_role_options("background"))
        self.assertIn("사용 모습", reference_role_options("object"))
        self.assertIn("질감", reference_role_options("style"))
        self.assertIn(
            "분위기", reference_role_options("general_reference")
        )
        self.assertNotIn("front", reference_role_options("background"))

    """Verify UI data without requiring a graphical display."""

    def test_loads_projects_and_waiting_count(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            config = AppConfig.load(root, env={})
            memory = MemoryManager(root / "learning_data" / "projects")
            memory.save(
                ProjectContext(
                    "project_0001",
                    "별빛 모험",
                    workflow_state=WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
                )
            )
            data = load_dashboard_data(config)
            self.assertEqual(len(data.projects), 1)
            self.assertEqual(data.waiting_count, 1)

    def test_empty_workspace_has_no_projects(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            config = AppConfig.load(Path(directory), env={})
            data = load_dashboard_data(config)
            self.assertEqual(data.projects, ())

    def test_story_prompt_submission_requires_text_and_api_key(self) -> None:
        self.assertIn("비어", story_prompt_submission_error("  ", "key"))
        self.assertIn(
            "OPENAI_API_KEY",
            story_prompt_submission_error("prompt", ""),
        )
        self.assertEqual(
            story_prompt_submission_error("prompt", "test-key"), ""
        )

    def test_story_prompt_copy_uses_exact_text(self) -> None:
        class Clipboard:
            def __init__(self) -> None:
                self.value = ""
                self.updated = False

            def clipboard_clear(self) -> None:
                self.value = ""

            def clipboard_append(self, value: str) -> None:
                self.value += value

            def update(self) -> None:
                self.updated = True

        clipboard = Clipboard()
        copy_story_prompt(clipboard, "정확한\nPrompt")  # type: ignore[arg-type]
        self.assertEqual(clipboard.value, "정확한\nPrompt")
        self.assertTrue(clipboard.updated)

    def test_story_prompt_restore_preserves_edit_state(self) -> None:
        class TextWidget:
            def __init__(self) -> None:
                self.value = "수정본"
                self.state = "normal"

            def configure(self, *, state: str) -> None:
                self.state = state

            def delete(self, _start: str, _end: str) -> None:
                self.value = ""

            def insert(self, _start: str, value: str) -> None:
                self.value = value

        widget = TextWidget()
        set_story_prompt_text(  # type: ignore[arg-type]
            widget, "원래 Prompt", editable=False
        )
        self.assertEqual(widget.value, "원래 Prompt")
        self.assertEqual(widget.state, "disabled")
        set_story_prompt_text(  # type: ignore[arg-type]
            widget, "수정 가능 Prompt", editable=True
        )
        self.assertEqual(widget.state, "normal")

    def test_required_video_paths_are_in_scene_order(self) -> None:
        paths = required_video_paths(Path("videos/runway"))
        self.assertEqual(paths[0].name, "scene1.mp4")
        self.assertEqual(paths[-1].name, "scene6.mp4")

    def test_clip_inspection_reports_all_missing_files(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            clips, problems = inspect_video_clips(
                Path(directory), lambda path: {}
            )
            self.assertEqual(len(clips), 6)
            self.assertEqual(len(problems), 6)

    def test_project_progress_preserves_waiting_as_runway_stage(self) -> None:
        project = ProjectContext(
            "project_0001",
            "topic",
            workflow_state=WorkflowState.WAITING_FOR_VIDEO_CONFIRMATION,
        )
        progress, stage = project_progress(project)
        self.assertEqual(stage, "VIDEO")
        self.assertGreater(progress, 0)

    def test_project_progress_covers_mapping_and_image_review_states(self) -> None:
        for state, expected_stage in (
            (WorkflowState.WAITING_FOR_ASSET_MAPPING_REVIEW, "REVIEW"),
            (WorkflowState.ASSET_MAPPING_APPROVED, "VISUAL"),
            (WorkflowState.IMAGES_REVIEW, "REVIEW"),
        ):
            progress, stage = project_progress(
                ProjectContext("project_0001", "topic", workflow_state=state)
            )
            self.assertEqual(stage, expected_stage)
            self.assertGreater(progress, 0)

    def test_image_generation_progress_advances_per_completed_scene(self) -> None:
        project = ProjectContext(
            "project_0001",
            "topic",
            workflow_state=WorkflowState.GENERATING_IMAGES,
        )
        self.assertEqual(project_progress(project), (40, "VISUAL"))
        project.generated_images = ["scene1.png", "scene2.png"]
        self.assertEqual(project_progress(project), (45, "VISUAL"))
        project.generated_images.extend(
            ["scene3.png", "scene4.png", "scene5.png"]
        )
        self.assertEqual(project_progress(project), (53, "VISUAL"))

    def test_asset_search_result_highlights_matching_metadata(self) -> None:
        asset = LibraryAsset(
            asset_id="ASSET-CHAR-TEST",
            asset_type="character",
            display_name="이배드 기본 캐릭터",
            description="어린왕자 느낌의 판다",
            stored_path="panda.png",
            original_filename="panda.png",
            content_sha256="digest",
            tags=["판다", "여행"],
            aliases=["panda"],
        )
        self.assertEqual(
            highlight_search_matches("Panda", "pan"), "[Pan]da"
        )
        summary = asset_search_match_summary(asset, "판다")
        self.assertIn("설명: 어린왕자 느낌의 [판다]", summary)
        self.assertIn("검색 태그: [판다], 여행", summary)

    def test_asset_ux_uses_representative_name_label(self) -> None:
        self.assertEqual(ASSET_UX_LABELS["display_name"], "대표 이름")

    def test_asset_search_ui_does_not_request_aliases(self) -> None:
        self.assertNotIn("aliases", ASSET_SEARCH_DISPLAY_PRIORITY)

    def test_asset_ux_uses_search_tag_label(self) -> None:
        self.assertEqual(ASSET_UX_LABELS["tags"], "검색 태그")

    def test_asset_search_guidance_lists_searchable_user_fields(self) -> None:
        for label in (
            "대표 이름", "설명", "검색 태그"
        ):
            with self.subTest(label=label):
                self.assertIn(label, ASSET_SEARCH_GUIDANCE)

    def test_asset_ux_preserves_legacy_fields_and_display_priority(self) -> None:
        self.assertEqual(
            ASSET_SEARCH_DISPLAY_PRIORITY,
            ("display_name", "tags", "description"),
        )
        asset = LibraryAsset(
            asset_id="ASSET-LEGACY-UX",
            asset_type="character",
            display_name="기존 이름",
            description="기존 설명",
            stored_path="legacy.png",
            original_filename="legacy.png",
            content_sha256="digest",
            tags=["기존 태그"],
            aliases=["기존 별칭"],
        )
        self.assertEqual(asset.display_name, "기존 이름")
        self.assertEqual(asset.tags, ["기존 태그"])
        self.assertEqual(asset.aliases, ["기존 별칭"])

    def test_reference_review_displays_text_only(self) -> None:
        debug = reference_review_debug_text([], 320, 1)
        self.assertIn("Reference Used   Text Only", debug)

    def test_reference_review_displays_reference_count(self) -> None:
        debug = reference_review_debug_text(
            [{"role": "front"}, {"role": "side"}], 320, 1
        )
        self.assertIn("Reference Count  2", debug)

    def test_default_review_displays_candidate_type_counts(self) -> None:
        debug = candidate_asset_debug_text({
            "total": 5,
            "character": 2,
            "background": 1,
            "object": 1,
            "style": 1,
        })
        self.assertIn("전달한 Candidate Asset 수  5", debug)
        self.assertIn("Character Asset 수         2", debug)
        self.assertNotIn("선택 이유", debug)

    def test_mousewheel_routes_only_to_active_window_canvas(self) -> None:
        class Top:
            def __init__(self, name: str) -> None:
                self.name = name

            def __str__(self) -> str:
                return self.name

        class Widget:
            def __init__(self, top: Top) -> None:
                self.top = top

            def winfo_toplevel(self) -> Top:
                return self.top

        class Canvas:
            def __init__(self) -> None:
                self.calls: list[tuple[int, str]] = []

            def winfo_exists(self) -> bool:
                return True

            def yview_scroll(self, amount: int, unit: str) -> None:
                self.calls.append((amount, unit))

        long_top = Top("long")
        main_top = Top("main")
        long_canvas = Canvas()
        fake_app = type(
            "FakeApp",
            (),
            {"_scroll_targets": {"long": long_canvas}},
        )()
        event = type(
            "Event", (), {"widget": Widget(long_top), "delta": -120}
        )()
        self.assertEqual(
            StudioApp._on_mousewheel(fake_app, event), "break"
        )
        self.assertEqual(long_canvas.calls, [(1, "units")])

        background_event = type(
            "Event", (), {"widget": Widget(main_top), "delta": -120}
        )()
        self.assertIsNone(
            StudioApp._on_mousewheel(fake_app, background_event)
        )
        self.assertEqual(long_canvas.calls, [(1, "units")])


if __name__ == "__main__":
    unittest.main()

