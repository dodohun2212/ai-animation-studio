# API Stability Audit

## Paid call paths

| Operation | Service entry | Provider adapter | Base calls | Cache |
|---|---|---|---:|---|
| Short project story | `GenerationService.generate_project` | `OpenAIStoryAdapter.generate` | 1 | no |
| Short project images | `GenerationService.generate_project` | `OpenAIImageAdapter.generate` | 0–6 | per scene |
| Short scene regeneration | `GenerationService.regenerate_scene` | `OpenAIImageAdapter.generate` | 1 | deliberately bypassed |
| Episode plan preview | `LongStoryService.generate_plan_preview` | `OpenAIEpisodePlannerAdapter.generate` | 1 | no |
| Episode script | `LongStoryService.generate_episode_script` | `OpenAIStoryAdapter.generate` | 1 | no |
| Episode images | `LongStoryService.generate_episode_images` | `OpenAIImageAdapter.generate` | 0–6 | per scene |
| Episode scene regeneration | `LongStoryService.regenerate_episode_scene` | `OpenAIImageAdapter.generate` | 1 | deliberately bypassed |

There is no AI story-summary, continuity-summary, plan-revision, or separate
script-regeneration entry point in v1.1. Manual Continuity editing makes no paid
request.

## Retry policy

Official SDK clients use `max_retries=0`. The application retries only rate
limits, temporary network/timeout errors, and HTTP 5xx failures. Authentication,
permission/quota, invalid request, schema/response validation, and safety-policy
errors are not retried. `MAX_RETRIES` defaults to 2 and exponential backoff is
capped at four seconds; a bounded `Retry-After` value is honored.

## Jobs and recovery

`learning_data/api_jobs.json` contains persistent job and per-call audit data.
Resource locks are process-wide across service instances and are scoped to the
project, episode, or scene operation. A previous process's `running` record is
marked `unknown` at startup rather than treated as completed.

Image jobs checkpoint each completed scene. Long episodes use
`images_partial` plus `failed_scene_numbers`; a later explicit resume reuses
validated cache entries and requests only missing scenes. Corrupt cache entries
are discarded.

Scene regeneration deliberately bypasses the normal cache because the user is
requesting a different result. The confirmation UI states this and therefore
shows one expected provider request. Normal generation and partial recovery use
the cache.

Local daily limits are safety controls only. They do not replace OpenAI platform
billing limits and the application does not claim an exact dollar cost.
