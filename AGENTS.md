# AI Animation Studio Agent Rules

## Read first

Always read, in this order:

0. `docs/00_NOW.md` — **read this one first, always.** What is done, what is next, and
   what is waiting on the user, on one screen. It is the only answer to "what should I
   work on"; do not choose your own next item while it exists. Finish an item, update
   that file, and stop.
1. This file, then `AI_GUIDELINES.md` (short behavioral rules).

Read the rest only when the task touches it:

- `docs/01_CURRENT_PRODUCT_SPEC.md` — product behavior, and the table of which short-project
  screen matches which long-project screen.
- `docs/03_TEAM_WORKFLOW.md` — team workflow, dev-server ports, mailbox rules.
- `docs/04_INTERNAL_API_CONTRACT.md` — changing shared contracts or API code.
- `docs/05_DESIGN_SYSTEM.md` — changing anything in `apps/frontend`.
- `docs/06_DECISIONS.md` — read its index (top of the file) and the entries for the area you
  are changing **before proposing a design.** It records the paths that were tried and
  abandoned; skipping it means proposing them again.
- `docs/02_MIGRATION_PLAN.md` (1.2 MB) and `docs/archive/` — history only. Search them for a
  fact; never read them as a plan.

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

## One agent at a time, in `main`

The default is one agent working in the `main` checkout, committing and pushing
straight to `main` once its checks pass: no branches, no second checkout, no merge
step. The frontend and backend roles below are hats one agent wears, or a hand-off
between two agents taking turns — not two agents editing at once.

Two agents editing at the same time was tried on 2026-09-25 (one git worktree
each) and dropped the next day, because it created more problems than the
collisions it prevented:

- A worktree's git data lives in `main\.git`, so a sandboxed agent (Codex's default
  `workspace-write`) cannot commit or create branches there. Verified: `git commit`
  fails with `Unable to create '...main/.git/worktrees/backend/index.lock':
  Permission denied`.
- Work on a branch reaches the person's app, which runs from `main`, only after a
  merge, so somebody has to do the merge and the pushes.
- Each checkout needs its own `node_modules` (`npm ci`), its own `dist` and its own
  ports (`vite.config.ts` still reads `DEV_FRONTEND_PORT` and `DEV_BACKEND_URL` for
  this), and it has neither the real `.env` keys nor `learning_data`.
- The 2026-08 worktrees sat at a 2026-08-23 commit for weeks and were deleted on
  2026-09-21: nobody kept them in step with `main`.

If two agents must run at once again, decide first who commits and who merges; do
not build the checkouts first.

## Agent zones

Roles are filled by whichever AI tool the user assigns at session start. This
table is the rule; tool and product names are labels, not part of it. One agent
may hold both roles, in which case it works in `main` and does everything.

| Role | Owns | Must not edit | Needs |
| --- | --- | --- | --- |
| Frontend agent | `apps/frontend`, `docs/05_DESIGN_SYSTEM.md` | `apps/backend`, `packages/shared` | File editing. Ideally a live browser (screenshot, DOM, console, network) and a shell for vitest. Without a shell, hand verification to the integration agent. |
| Backend / integration agent | `apps/backend`, `packages/shared`, `apps/desktop`, `docs/02_MIGRATION_PLAN.md` | `apps/frontend` (except plain build breakage — a typo or missing import: fix it and say so) | Shell, git, Node. Runs full typecheck/test/build. Commits and pushes once the checks pass. |

- **Contract changes (`packages/shared`):** the side that needs one writes the
  request (field, type, reason); the integration agent applies it and reports;
  only then do both sides implement. Never assume a contract before it is agreed.
- **Hand-off between agents** goes through `.claude-bridge/` (`from-cowork.md`
  = frontend agent, `from-cli.md` = integration agent — legacy file names).
  It is not versioned, so a round number is only a pointer; the reason itself
  belongs in a code comment or `docs/06_DECISIONS.md`. Each side reads the
  other's file and writes only its own. Read down to the last round you handled,
  not just the top one.
- **Who commits.** An agent that cannot run git — no shell (a chat-style editor), or a
  sandbox that blocks `.git` — hands its diff and a proposed commit message to one that
  can. That agent re-runs the checks and commits with explicit paths; it does not commit
  on trust.
- Do not undo the other zone's code decisions. Report the problem instead.
- A feature is done only when both halves pass verification.

## Git and shared-tree safety

If two agents edit one working tree, or the user edits while you work, in-flight changes are not yours: preserve existing
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
- **A pre-commit hook re-checks every code commit** (`.githooks/pre-commit`). It runs
  typecheck plus the suites the staged files can break — nothing for docs-only commits,
  every suite when `packages/shared` changes — on the commit's own bytes, and refuses a
  commit whose staged file also has unstaged changes. It is quiet when green and prints
  only the last 40 lines of a failure. Never `--no-verify`; fix it and commit again. It
  exists because red tests reached `main` twice on a report that they had been run.
  Enable it once per clone: `git config core.hooksPath .githooks`.
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
  `Get-Content`/`Set-Content` a source file — it mangles Korean text. Reading is hit
  too: without `-Encoding UTF8` the Korean docs arrive as mojibake (seen in a Codex
  trial log), so read them with `-Encoding UTF8` or a UTF-8-aware tool.
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
- **An agent's report is not the state of the tree.** In the 2026-09-25 Codex trial a
  sandboxed agent reported `git switch -c` as succeeded; its own log said `exited 1`
  and no branch existed. Before you commit or report another agent's work, check
  `git status` and the diff, and rerun the tests yourself.

## First session checklist

1. Read `docs/00_NOW.md` and take its top unfinished item, unless the user named
   another.
2. Confirm your role and zone with the user. Run `git status`; note uncommitted
   changes that are not yours.
3. Read the rules in this file: paid-provider safety, git and shared-tree safety.
4. Read the latest rounds of `.claude-bridge/from-cowork.md` and
   `.claude-bridge/from-cli.md`, if the folder exists.
5. Confirm you have the tools your role needs (table above). If not, say so
   before starting.
6. Check for a running dev server before saving under `apps/*/src`.
7. `git config core.hooksPath` must print `.githooks`; if it prints nothing, run
   `git config core.hooksPath .githooks` (the pre-commit hook is per clone).

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
- The agent that ran the checks commits and pushes. One that cannot run git hands its
  change over (see "Who commits" under "Agent zones").
- After verification, update `docs/00_NOW.md` and stop for the user; do not pick
  the next item yourself.
