# Repository Session Instructions

This file intentionally fixes no model, tool, role, or worktree. The user assigns those at the start of each session.

Before working, read and follow these files in order:

1. `AGENTS.md`
2. `AI_GUIDELINES.md`
3. `docs/01_CURRENT_PRODUCT_SPEC.md`
4. `docs/02_MIGRATION_PLAN.md`
5. `docs/03_TEAM_WORKFLOW.md`
6. `docs/04_INTERNAL_API_CONTRACT.md` when changing shared contracts or API code

If instructions conflict, `AGENTS.md` takes precedence.

Respect the role and worktree assigned for the current session. A single agent may be assigned Main, Frontend, and Backend together; in that case it may work in `main` without creating or switching worktrees.

The Python-to-TypeScript migration itself is complete (see `docs/02_MIGRATION_PLAN.md`'s handoff status). Current work is post-migration feature improvement and polish, tracked in the same file's dated sections. For each item: implement both required layers, run relevant checks and the integrated verification, update the migration plan only after verification, then proceed to the next item. Do not end the working loop merely because one item has completed.

Do not make paid provider requests in tests. Preserve the Python baseline and existing uncommitted user changes.

Commit each feature or fix as soon as it passes verification — do not let uncommitted work accumulate across features. Push to `origin` after each commit unless the user says otherwise. If a hook or check fails, fix it and create a new commit rather than leaving the change uncommitted.
