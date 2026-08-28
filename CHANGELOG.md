# Changelog

> **이 파일은 Python 시절의 기록이다.** 마지막 항목이 2026-07-27이고, 그 뒤의 TypeScript 작업은
> 여기 없다. 현재 진행 중인 작업 로그는 `docs/02_MIGRATION_PLAN.md`의 날짜별 섹션이고, 코드가
> 지금의 모양인 *이유*는 `docs/06_DECISIONS.md`에 있다. 이 파일은 그 시절 무엇이 있었는지를
> 확인할 때만 본다.


## 2026-07-27 — Effective Reference Preview

- Renamed the ambiguous applied-Reference area to `장면에 적용된 참고 이미지`.
- Added labeled Episode/Scene inputs and a read-only effective-input results
  window with thumbnails, categories, scopes, and API inclusion status.
- Split project-wide and scene-specific References in the results.
- Fixed short-project preview to use the same scene-only selector as the actual
  short ImagePipeline; long projects continue to use episode-and-scene scope.

## 2026-07-27 — Short/Long Labels and Project Archive

- Renamed ambiguous dashboard project labels to `단기 프로젝트`.
- Added recoverable delete actions to short and long project screens.
- Project deletion requires exact title confirmation and is blocked while a
  paid API job is running.
- Increased border and secondary-text contrast for clearer project controls.

## 2026-07-27 — GUI Control Deck and API Connection

- Reordered the dashboard around a visible production control deck and
  full-width quick-action cards.
- Added consistent raised, hover, pressed, keyboard, and disabled behavior to
  shared buttons.
- Added a masked upper-corner API-key connector that atomically preserves
  `.env` settings and rebuilds official OpenAI adapters without making a paid
  request.
- Verified the layout under Windows display scaling and removed clipped
  multi-column action cards.

## 2026-07-27 — Reference Assets Project Selection

- Reference Assets now opens without an active project and shows explicit
  short-project, long-project, and existing-project actions.
- Project-dependent controls remain disabled until a valid stored project is
  selected.
- Added safe project discovery, immediate manager switching, and missing or
  damaged project recovery without creating implicit folders.

## 2026-07-27 — v1.1 API Stability Audit

- Added persistent API Job audit records and process-wide duplicate locks.
- Unified planner, story, image, and regeneration jobs under daily and
  concurrent-call protection.
- Added bounded error-classified retries while keeping SDK retries disabled.
- Added per-scene image checkpoints, partial episode recovery, and persistent
  scene regeneration limits.
- Added corrupt-cache rejection, atomic image writes, and provider request ID
  capture when the SDK supplies one.

## 2026-07-27 — v1.1 Final Polish

- Completed long-project Reference Asset episode/scene scopes, filters, and
  effective-reference preview.
- Connected exact-prompt preview and single-scene regeneration with explicit
  API confirmation, approval reset, and persisted regeneration history.
- Added dedicated table-based Character, Location, Prop, Secret, and
  Foreshadowing managers over the existing Story Bible JSON.
- Expanded the long-project Dashboard, Timeline filters, progress display, and
  Inspector production context.
- Added regression coverage for scope parsing, dashboard metrics, filtering,
  preview, and isolated scene regeneration.

## 2026-07-27 — v1.1 Long Story Studio

- Added backward-compatible `short_project` and `long_story_project` typing.
- Added atomic long-project, Story Bible, episode, and Continuity persistence.
- Added episode planning, strict state gates, priority-based context assembly,
  one-episode script/image generation, episode/scene Reference selection, and
  next-episode preparation without automatic generation.
- Added an offline-capable Tkinter Long Story Studio with project dashboard,
  Story Bible editor, timeline, episode management, Inspector, and API-key
  status.

## 2026-07-27 — Live OpenAI Composition

- Added official OpenAI SDK 2.48.0 adapters for strict six-scene Responses API
  stories and GPT Image 2 generation/editing.
- Added a composition service connecting UI, PromptManager, StoryEngine,
  Reference selection, ImageEngine cache, ImagePipeline, WorkflowEngine, and
  project persistence.
- Added paid-run confirmation, UI background execution, duplicate-run blocking,
  bounded SDK retries, daily/job/scene soft limits, and scene-only regeneration.

## 2026-07-27 — Project Reference Assets

- Added project-scoped manual and approved-generated Reference Assets with
  atomic metadata storage, safe file copying, deduplication, validation, scene
  scopes, activation, notes, and optional character face baselines.
- Extended the six-scene image pipeline with optional Reference selection and a
  backward-compatible Reference-capable generator callback.
- Added explicit generated-image approval before Reference registration.
- Added an optional, local-only InsightFace adapter with cached embeddings,
  configurable cosine thresholds, safe model-unavailable behavior, and
  advisory face-consistency statuses.
- Added Reference management, approval, registration, and non-blocking face
  check controls to the Tkinter UI.

## 2026-07-27 — Future Creative Console

- Reframed the Tkinter experience as the original **Prism Forge** AI animation
  console with a left docking rail, layered active workspace, modular production
  orbit, asymmetric action matrix, and dimensional project gallery.
- Preserved all project persistence, OpenAI configuration, manual CapCut
  boundary, six-clip validation, and FFmpeg merge behavior.
- Added keyboard-operable label buttons, visible focus styling, reduced-motion
  support, and a live project summary in the creation board.
- Kept CapCut explicitly labeled as an external, user-operated editing stage.

## 2026-07-27

- Reworked the Tkinter studio into the original **Bramblelight** forest-mystery
  production desk while preserving the existing project, CapCut inspection, and
  FFmpeg execution paths.
- Added the seven-step investigation pipeline, field-journal project brief,
  case-file project cards, and three-column scene evidence review workspace.
- Added reduced-motion handling and short field-record status notifications.
- Kept CapCut explicitly user-operated; no CapCut API or automatic control was
  introduced.
- All atmosphere, symbols, names, forest artwork, and interface props are
  original code-drawn elements and do not reuse identifiable assets from any
  existing animated series.

이 프로젝트의 주요 변경 사항을 기록합니다.

## Unreleased

- 프로젝트 기본 디렉터리 구조를 생성했습니다.
- 문서 기준 MVP 기반 모듈, 관리 엔진, 미디어 파이프라인과 CLI를 추가했습니다.
- 각 모듈의 단위 테스트를 추가했습니다.
- 무료 Tkinter 데스크톱 대시보드와 더블클릭 실행 파일을 추가했습니다.
- UI를 시네마틱 크리에이티브 스튜디오 경험으로 전면 개편했습니다.
