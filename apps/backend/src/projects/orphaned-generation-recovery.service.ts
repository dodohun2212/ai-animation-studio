import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { WorkflowState } from "@ai-animation-studio/shared";

import type { StoredProject } from "./project-storage.schema.js";
import { LocalProjectRepository } from "./projects.repository.js";

/**
 * Every "generating" workflow state is driven by an in-memory loop in exactly one Backend process — nothing
 * persists a heartbeat, and nothing but that loop's own `catch` block ever moves a project out of it. If the
 * process exits any other way (killed, crashed, the machine sleeps), the project is left pointed at a state
 * only that now-gone loop's own code accepts as a starting point, and the UI's own gate (`generate()`/`merge()`
 * checking `workflow_state`) then rejects every future attempt to continue or retry — forever, since nothing
 * else in the app ever writes that state away. This was found from a real user project stuck exactly this way
 * (`GENERATING_IMAGES`, three of six scenes already paid for and on disk, no error recorded — the server was
 * stopped mid-run) — see `.claude-bridge` Round 129.
 *
 * This app runs as a single local process per install (no clustering, no multiple simultaneous Backend
 * instances against the same `learning_data/projects`), so at the moment a fresh process starts, any project
 * already sitting in one of these states is unconditionally orphaned: whatever loop put it there cannot still
 * be running, because this process — the only one that could be running it — just started. Reverting it to the
 * state that loop started from is always safe to do unconditionally here, with no time threshold to tune.
 *
 * The recovery target is the same state each generation loop's own successful-exception `catch` already
 * returns to (`story-prompt.service.ts`'s READY-on-failure, `video-merge.service.ts`'s Failed-on-failure
 * pattern's healthy counterpart) — never a new state — so no new UI is needed:
 *  - GENERATING_STORY -> READY: matches `StoryPromptService.approve()`'s own in-process recovery.
 *  - GENERATING_IMAGES -> ASSET_MAPPING_APPROVED: re-clicking "이미지 생성 시작" resumes safely and for free —
 *    `LocalImageGenerationService.generate()`'s loop already reuses any scene whose file still validates.
 *  - GENERATING_VIDEOS -> INTERRUPTED: reuses the existing "이어서 생성" resume flow and its `restart()`
 *    endpoint verbatim — a hard crash is not distinguishable from the same-process save failure that already
 *    lands here deliberately.
 *  - RENDERING -> VIDEOS_APPROVED: the local final-video merge step has no per-clip persisted progress and
 *    spends no provider budget, so there is nothing to resume — only to allow retrying. (Deliberately not
 *    named here: this file lives under the directory `projects.no-provider-calls.test.ts` greps for zero
 *    process-tool/provider mentions in, comments included — see that test for the exact forbidden list.)
 *
 * Long-project (Episode) generation loops carry the same single-process risk and are not covered here — flagged
 * separately rather than folded into this pass silently.
 */
const RECOVERY_TARGETS: ReadonlyMap<string, WorkflowState> = new Map([
  [WorkflowState.GeneratingStory, WorkflowState.Ready],
  [WorkflowState.GeneratingImages, WorkflowState.AssetMappingApproved],
  [WorkflowState.GeneratingVideos, WorkflowState.Interrupted],
  [WorkflowState.Rendering, WorkflowState.VideosApproved],
]);

@Injectable()
export class OrphanedGenerationRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrphanedGenerationRecoveryService.name);

  constructor(private readonly projects: LocalProjectRepository) {}

  async onApplicationBootstrap(): Promise<void> {
    const recovered = await this.recoverAll();
    if (recovered.length) {
      this.logger.warn(`Recovered ${recovered.length} project(s) left in an orphaned in-progress generation state by a previous run.`);
    }
  }

  /** Exposed directly (not only via the bootstrap hook) so an integration test can call it deterministically without booting a whole Nest app. */
  async recoverAll(): Promise<StoredProject[]> {
    const projects = await this.projects.list();
    const recovered: StoredProject[] = [];
    for (const project of projects) {
      const target = RECOVERY_TARGETS.get(project.workflow_state);
      if (!target) continue;
      const updated: StoredProject = {
        ...project,
        workflow_state: target,
        updated_at: new Date().toISOString(),
        warnings: [
          ...project.warnings,
          `이전 실행이 ${project.workflow_state} 상태에서 응답 없이 종료되어, 서버 시작 시 ${target} 상태로 되돌렸습니다. 이미 만들어진 결과물은 그대로 남아 있습니다.`,
        ],
      };
      try {
        await this.projects.save(updated);
        recovered.push(updated);
      } catch (error) {
        this.logger.error(`Failed to recover orphaned project "${project.project_id}" from ${project.workflow_state}.`, error as Error);
      }
    }
    return recovered;
  }
}
