# Internal API Contract

This API is the free, local contract between the React frontend and the NestJS
backend. It is separate from paid OpenAI and Runway provider APIs.

## Contract rules

- JSON fields use `camelCase`.
- Timestamps use UTC ISO 8601 strings.
- A generated short project contains exactly six scenes numbered 1 through 6.
- Preview endpoints never submit paid provider requests.
- Runway submission requires a valid `confirmationId`, a unique
  `userRequestId`, `approved: true`, and six non-empty editable prompts.
- Reusing a `userRequestId` must not create another provider job.
- Provider task IDs and input hashes must be persisted before polling begins.
- API keys and secret values never appear in responses or logs.
- Errors use `{ "code": string, "message": string, "details"?: object }`.

## Initial routes

| Method | Route | Purpose | Provider call |
|---|---|---|---|
| `GET` | `/health` | Local backend readiness | Never |
| `GET` | `/projects` | List local projects | Never |
| `POST` | `/projects` | Create a local project | Never |
| `GET` | `/projects/:projectId` | Read a project | Never |
| `POST` | `/projects/:projectId/videos/preview` | Show prompts and cost | Never |
| `POST` | `/projects/:projectId/videos/generations` | Start approved video work | Only after gates pass |
| `GET` | `/projects/:projectId/videos/generations/:jobId` | Read progress | Polls only persisted tasks |

Story, image, review, retry, stop, recovery, and render routes will be added when
their corresponding backend feature is implemented. They are not invented in
advance in order to keep the contract minimal.

## Source of truth

The executable TypeScript definitions live in `packages/shared/src`. Frontend
and backend code must import those types instead of copying request or response
shapes.
