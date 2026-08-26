# AI Animation Studio Agent Rules

## Read first

Before changing code, read:

1. `AI_GUIDELINES.md`
2. `docs/01_CURRENT_PRODUCT_SPEC.md`
3. `docs/02_MIGRATION_PLAN.md`
4. `docs/03_TEAM_WORKFLOW.md`
5. `docs/04_INTERNAL_API_CONTRACT.md` when changing shared or API code
6. `docs/05_DESIGN_SYSTEM.md` when changing anything in `apps/frontend`

Project-specific rules in this file take precedence over shared guidelines.

## Current objective

The migration is complete: every required Python behavior has been
reimplemented in TypeScript, verified, and committed (see
`docs/02_MIGRATION_PLAN.md`). Current work is post-migration feature
improvement and polish — driven by real usage feedback and UI/UX audits
against the Python original, tracked in the same file's dated sections
after the migration checklist.

This does not relax the discipline below (surgical changes, no speculative
abstractions, verify before marking done) — it only means new user-visible
work is now in scope, not just Python parity.

Do not translate Python line by line when a Python behavior still needs
porting. Preserve observable behavior and data, then implement it in the
appropriate TypeScript layer.

## Source and target

- `app/`, `tests/`, and `prompts/` are the preserved Python baseline.
- Do not modify or delete the Python baseline unless the user explicitly asks.
- New application code belongs in `apps/`.
- Shared frontend/backend contracts belong in `packages/shared/`.
- The Python code is the source of truth when a legacy document disagrees with
  actual behavior.

## Fixed TypeScript stack

- TypeScript strict mode
- npm workspaces and Node.js 22+
- React with Vite for the frontend
- NestJS for the backend
- Electron for the Windows desktop shell
- Shared request, response, entity, and workflow types in `packages/shared`

The application must run locally first. Its architecture must allow a later
server deployment and user accounts without implementing those features now.

## Product safety rules

- Never send a paid OpenAI or Runway request in tests.
- Use fake or mock adapters until approval and budget gates are tested.
- A preview or confirmation screen must never submit a paid request.
- Runway submission requires explicit user approval.
- Prevent duplicate provider requests with persisted IDs and input hashes.
- Do not log, return, or commit API keys or secret values.
- Do not implement automatic infinite retries.
- Preserve completed scene outputs when resuming or retrying work.

## Required product flow

```text
주제 및 프로젝트 설정
→ 대본과 설정한 장면 수(2~12)만큼 장면 생성
→ 장면 수만큼 이미지 생성
→ 사용자 이미지 검토
→ Runway 프롬프트와 예상 비용 확인·수정
→ 사용자의 명시적 전송 승인
→ 장면 영상 순차 생성
→ 사용자 영상 검토 및 모든 장면 사용 확정
→ FFmpeg 순서 병합
→ Instagram Reels용 최종 MP4
```

## UI and visual work

All visual decisions in `apps/frontend` (color, spacing, radius, shadows,
typography, state colors, component recipes) come from
`docs/05_DESIGN_SYSTEM.md`. Do not invent new visual patterns inline.
If a needed pattern is missing, add it to the design system document in
the same task, then implement it. Before reporting UI work complete, run
the checklist in that document's final section.

## Feature discipline

Applies to migration work and post-migration improvement work alike.

- Deliver one user-visible feature or fix at a time.
- Define completion criteria before implementation.
- Update `docs/02_MIGRATION_PLAN.md` only after verification.
- Do not mark a feature complete when only its UI or backend half exists.
- Keep frontend and backend aligned through `packages/shared` contracts.
- Integrate and test each feature before starting the next large feature.
- Do not create speculative abstractions, endpoints, or database tables.

## Worktree roles

- `main`: planning, shared contracts, integration, and full verification
- `feature/frontend`: React UI and user interaction
- `feature/backend`: workflow, persistence, adapters, media orchestration

A worktree does not restrict file access. It identifies the assigned role and
branch. Avoid editing another role's area unless the task explicitly requires
it.

## Completion rules

Before reporting a task complete:

- Run the relevant typecheck, tests, and build.
- Confirm that no paid provider was called.
- Report changed files and remaining limitations.
- Do not commit or push unless the user requests it or the task explicitly
  includes it.
