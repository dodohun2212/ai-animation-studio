# AI Animation Studio Agent Rules

## Read first

Before changing code, read:

0. `docs/00_NOW.md` — **read this one first, always.** What is done, what is next, and
   what is waiting on the user, on one screen. It is the only answer to "what should I
   work on"; do not choose your own next item while it exists. Finish an item, update
   that file, and stop. `docs/02_MIGRATION_PLAN.md` below is the history archive it was
   extracted from — 1.2 MB, not readable as a plan, and not to be used as one.
1. `AI_GUIDELINES.md`
2. `docs/01_CURRENT_PRODUCT_SPEC.md`
3. `docs/02_MIGRATION_PLAN.md` — history only; see 0 above
4. `docs/03_TEAM_WORKFLOW.md`
5. `docs/06_DECISIONS.md` — why the code is shaped this way, especially which paths were tried and abandoned
6. `docs/04_INTERNAL_API_CONTRACT.md` when changing shared or API code
7. `docs/05_DESIGN_SYSTEM.md` when changing anything in `apps/frontend`

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

- `prompts/` is what remains of the Python baseline, and it is not only a reference: the running app reads
  `prompts/story/story_generation.txt` and the desktop packaging copies the directory into the installer. Do
  not delete it.
- `app/` and `tests/` — the Python source and its suite — were removed on 2026-09-02 at the user's request,
  after the migration was long finished and nothing in `apps/` referenced them. They are in git history if a
  question about the original behaviour ever needs settling (`git log --diff-filter=D -- app`), which is where
  such questions were answered from several times during the migration.
- The repository-root `learning_data/` — the baseline's *data* — was deleted with the source, at the same
  request. `apps/backend/learning_data` is the app's own store and is untouched by that; it is gitignored, so
  it is the one directory here that history cannot give back. Back it up before anything drastic.
- Do not modify or delete what is left of the Python baseline unless the user explicitly asks.
- New application code belongs in `apps/`.
- Shared frontend/backend contracts belong in `packages/shared/`.
- When a legacy document disagrees with actual behavior, the Python code is still
  the arbiter — it is now read out of git history rather than the working tree.

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

## Agent zones

Roles are filled by whichever AI tool the user assigns at session start. This
table is the rule; tool and product names are labels, not part of it. One agent
may hold both roles, in which case it works in `main` and does everything.

| Role | Owns | Must not edit | Needs |
| --- | --- | --- | --- |
| Frontend agent | `apps/frontend`, `docs/05_DESIGN_SYSTEM.md` | `apps/backend`, `packages/shared` | File editing. Ideally a live browser (screenshot, DOM, console, network) and a shell for vitest. Without a shell, hand verification to the integration agent. |
| Backend / integration agent | `apps/backend`, `packages/shared`, `apps/desktop`, `docs/02_MIGRATION_PLAN.md` | `apps/frontend` (except plain build breakage — a typo or missing import: fix it and say so) | Shell, git, Node. Runs full typecheck/test/build. **Sole committer and pusher.** |

- **Contract changes (`packages/shared`):** the side that needs one writes the
  request (field, type, reason); the integration agent applies it and reports;
  only then do both sides implement. Never assume a contract before it is agreed.
- **Hand-off between agents** goes through `.claude-bridge/` (`from-cowork.md`
  = frontend agent, `from-cli.md` = integration agent — legacy file names).
  It is not versioned, so a round number is only a pointer; the reason itself
  belongs in a code comment or `docs/06_DECISIONS.md`. Each side reads the
  other's file and writes only its own. Read down to the last round you handled,
  not just the top one.
- Do not undo the other zone's code decisions. Report the problem instead.
- A feature is done only when both halves pass verification.

## Git and shared-tree safety

If two agents edit one working tree (until worktrees are set up), or the user
edits while you work, in-flight changes are not yours: preserve existing
uncommitted changes. Every rule below comes from an incident that already
happened here.

- **Stage explicit file paths only.** Never `git add <dir>`, `git add .` or
  `-A`; that sweeps someone else's unfinished work into your commit. Read
  `git diff --cached` before committing.
- **Chain add and commit:** `git add <files> && git commit ...`. Never pipe
  `git add` or continue after it fails — one stale path refuses the whole add
  and the commit ships half. After a `git mv` or delete, list only paths that
  exist. If the `git diff --cached --stat` file count is not what you meant,
  stop.
- **Commit the bytes you tested.** Record `sha256sum` of the files when the test
  run starts and run `sha256sum -c` right before staging; if anything changed,
  rerun the tests. Printing two hashes is not comparing them — make the check
  fail loudly.
- **Never `git checkout -- <path>` or `git restore` a file that is not your own
  committed work,** and never break-test (inject a regression) into an
  uncommitted file. Restore an injection from a byte copy taken before it
  (`cp -p`, so the mtime survives), not from git.
- **Do not patch files by opening them for write before encoding.** A failed
  encode after truncation empties the file. Use the editor tool, or encode the
  whole string first and write bytes. On Windows PowerShell 5.1 never
  `Get-Content`/`Set-Content` a source file — it mangles Korean text.
- **After editing `packages/shared/src`,** build its `dist`
  (`npm run build --workspace @ai-animation-studio/shared`) before running
  backend `tsc`; backend types resolve through the gitignored `dist`.
- **Before saving anything under `apps/*/src` or rebuilding shared `dist`,**
  check whether the user's dev server is running (`nest start --watch` restarts
  on every save and kills in-flight work). See `docs/03_TEAM_WORKFLOW.md`.
- If you think work is lost, ask whoever wrote it before declaring it
  unrecoverable.

## Session conduct

- Reply to the user in Korean, short and to the point: conclusion and next
  action, not status recaps. Code and comments follow existing conventions
  (English identifiers, Korean UI strings and docs).
- Inside the assigned item, do not ask permission to do what the item already
  requires. Stop only after updating `docs/00_NOW.md`.
- If told to "loop" or poll, that means re-reading the `.claude-bridge/` mailbox
  for new rounds, not only scanning code.

## First session checklist

1. Read `docs/00_NOW.md` and take its top unfinished item, unless the user named
   another.
2. Confirm your role, zone and worktree with the user. Run `git status` and
   `git worktree list`; note uncommitted changes that are not yours.
3. Read the rules in this file: paid-provider safety, git and shared-tree safety.
4. Read the latest rounds of `.claude-bridge/from-cowork.md` and
   `.claude-bridge/from-cli.md`, if the folder exists.
5. Confirm you have the tools your role needs (table above). If not, say so
   before starting.
6. Check for a running dev server before saving under `apps/*/src`.

## Completion rules

Before reporting a task complete:

- Run the relevant typecheck, tests, and build.
- Confirm that no paid provider was called.
- Report changed files and remaining limitations.
- Commit each feature or fix as soon as it passes verification, and push to
  `origin` unless the user says otherwise. Do not let uncommitted work
  accumulate across features. If a hook or check fails, fix it and make a new
  commit; never leave the change uncommitted.
- Never force-push or `git reset --hard`. A bad commit is fixed forward with a
  new commit.
- Only the integration agent (see "Agent zones") commits and pushes. Other
  agents write a proposed commit message and hand the change over.
- After verification, update `docs/00_NOW.md` and stop for the user; do not pick
  the next item yourself.
