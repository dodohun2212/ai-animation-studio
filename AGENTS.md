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

## Worktree roles

- `main`: planning, shared contracts, integration, and full verification
- `feature/frontend`: React UI and user interaction
- `feature/backend`: workflow, persistence, adapters, media orchestration

A worktree does not restrict file access. It identifies the assigned role and
branch. Avoid editing another role's area unless the task explicitly requires
it.

### Running two agents at once: one checkout each

One agent alone works in `main` and none of this applies. When two agents run at
the same time, each gets its own checkout, so one agent's half-written file, test
run or break-test never lands in the other's tree.

```
C:\dev\AI-Animation-Studio-Workspace\
  main\       branch main          the person's own app. Nobody edits files here;
                                   work only lands by fast-forward (below).
  frontend\   branch feature/frontend   frontend agent
  backend\    branch feature/backend    backend / integration agent
```

- **Each checkout is complete:** its own `node_modules` and its own `dist`. Create one
  with `git worktree add ..\frontend -b feature/frontend main`, then
  `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci` (about 20 s with a warm npm cache;
  the Electron binary is only for the desktop shell, which is not run from here). A
  copied or linked `node_modules` is wrong: its workspace links would point back
  into `main`.
- **Left behind on purpose:** `apps/backend/.env` (real provider keys) and
  `apps/backend/learning_data/` (real projects) are git-ignored, so a worktree has
  neither. Its backend has no keys and an empty store, which is the point: an agent
  testing a screen must not write into the person's projects or reach a paid
  provider. If sample data is needed, point `LEARNING_DATA_ROOT` at a **copy**, never at
  `main`'s folder.
- **Ports.** `main` keeps `3000` (backend) and `5173` (Vite); the desktop shell keeps
  `4317`. Do not run `dev:desktop` from a worktree. Vite binds `localhost`, so open
  `http://localhost:<port>`; `127.0.0.1` will not connect.

  | Checkout | Backend | Vite |
  | --- | --- | --- |
  | `main` (the person's) | `3000` | `5173` |
  | `backend` | `PORT=3100 npm run dev:backend` | — |
  | `frontend` | `PORT=3200 npm run dev:backend` | `DEV_FRONTEND_PORT=5273 DEV_BACKEND_URL=http://127.0.0.1:3200 npm run dev:frontend` |

  (`vite.config.ts` reads those two variables; with neither set it behaves as before.)
- **The mailbox** `.claude-bridge/` is not versioned and exists only in `main`:
  `..\main\.claude-bridge\`. A tool that can see only its own folder cannot read it;
  say so at session start rather than working without it.
- **A sandboxed agent cannot commit in a worktree.** Codex's default `workspace-write`
  sandbox can read everywhere but write only inside its own checkout, and a worktree's
  git data lives in `main\.git`. Verified 2026-09-25: `git commit` fails with
  `Unable to create '...main/.git/worktrees/backend/index.lock': Permission denied`, and
  `git switch -c` with `cannot lock ref`. Such an agent stops with its diff uncommitted and
  its report; whoever is unsandboxed commits it (explicit paths, after rerunning the
  checks). Widening the sandbox to `main\.git` would let it rewrite `main`'s refs, so it is
  not the default.
- **An agent's report is not the state of the tree.** In the same trial a sandboxed
  agent reported `git switch -c` as succeeded; its own log said `exited 1` and no branch
  existed. Before landing anything, check `git status`, the diff, and rerun the tests
  yourself.
- **Landing work, in order:**
  1. Commit on your branch (the integration agent commits for the frontend agent with
     `git -C ..\frontend add <files> && git -C ..\frontend commit`; explicit paths, as above).
  2. `git rebase main` in your worktree (clean tree required), rebuild `packages/shared`,
     and rerun the tests. Merge conflicts are most likely in `docs/00_NOW.md` and
     this file — keep both sides.
  3. In `main`: `git merge --ff-only feature/<branch>`, then `git push origin main`.
     `main` moves under the person's watch server, which restarts once; say so.
  4. The other branch rebases onto `main` before its next task.
- **Removing one:** `git worktree remove ..\frontend`, then `git branch -d feature/frontend`.
  Earlier worktrees (`feature/backend`, `feature/frontend`, from 2026-08-21) were still
  at a 2026-08-23 commit on 2026-09-06 while all the work happened in `main`, and were
  deleted on 2026-09-21. A worktree that is not rebased onto `main` before each task
  goes stale the same way.

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

If two agents edit one working tree (the two-checkout setup above avoids this), or
the user edits while you work, in-flight changes are not yours: preserve existing
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
