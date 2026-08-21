# TypeScript Foundation

The new application is being built alongside the preserved Python baseline.
No paid provider integration is part of this foundation.

## Layout

```text
apps/
  frontend/   React and Vite user interface
  backend/    NestJS local HTTP service
  desktop/    Electron Windows shell
packages/
  shared/     Types shared by frontend and backend
```

## Local commands

Run these commands from the repository root:

```text
npm install
npm run typecheck
npm run build
npm test
npm run dev:frontend
npm run dev:backend
npm run dev:desktop
```

On a Windows PowerShell installation that blocks `npm.ps1`, use `npm.cmd` in
place of `npm`.

## Current verification

- Shared workflow contracts compile with TypeScript strict mode.
- The React frontend builds as a static application suitable for Electron.
- The NestJS backend exposes `GET /health` locally.
- The Electron shell loads the built frontend with Node integration disabled.
- Existing Python code and project data remain in place.

## Deliberately not implemented yet

- OpenAI and Runway provider calls
- Project persistence and legacy data migration
- API-key secure storage
- Background generation and recovery
- Video review and FFmpeg orchestration
- Installer packaging and automatic updates
