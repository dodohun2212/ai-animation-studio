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
 * stopped mid-run).
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

/**
 * Plain language only, no `WorkflowState` value anywhere in the text — a project stuck in `GENERATING_IMAGES`
 * being reverted to `ASSET_MAPPING_APPROVED` told a real user exactly that in those words, and they had no way
 * to know what either name meant. The frontend already solved this once for a
 * different string (`workflowStateLabel`), but a backend-composed sentence can't be patched into shape by a
 * frontend label lookup after the fact — the fix has to be to never put the raw name in text in the first place.
 */
const RECOVERY_MESSAGES: ReadonlyMap<string, string> = new Map([
  [WorkflowState.GeneratingStory, "이전에 대본을 만들다가 서버가 꺼져서 중간에 멈췄습니다. 다시 시도할 수 있습니다."],
  [WorkflowState.GeneratingImages, "이전에 이미지를 만들다가 서버가 꺼져서 중간에 멈췄습니다. 이미 만들어진 것은 그대로 있고, 이어서 다시 만들 수 있습니다."],
  [WorkflowState.GeneratingVideos, "이전에 영상을 만들다가 서버가 꺼져서 중간에 멈췄습니다. 이미 만들어진 것은 그대로 있고, 이어서 다시 만들 수 있습니다."],
  [WorkflowState.Rendering, "이전에 최종 영상을 합치다가 서버가 꺼져서 중간에 멈췄습니다. 다시 시도할 수 있습니다."],
]);

/**
 * A recovery message stays true only while the project is still somewhere between the state it was reset to and
 * the state it was reset from (re-running the same step lands back in the "from" state, still unresolved; any
 * other state means that work has since actually finished, or the project moved on some other way). Used both
 * to decide whether to keep re-adding the same message (recoverAll below) and, read-only, to hide a stale one
 * from the API without needing to touch every downstream service that might resolve it (project.mapper.ts).
 */
export function isRecoveryMessageStillRelevant(message: string, currentState: string): boolean {
  for (const [fromState, text] of RECOVERY_MESSAGES) {
    if (text === message) return currentState === fromState || currentState === RECOVERY_TARGETS.get(fromState);
  }
  return true; // Not one of ours — never filter a message this service did not write.
}

/** Drops this service's own recovery messages once they no longer apply to `currentState`; every other warning (including any this service didn't write) passes through untouched. */
export function withoutStaleRecoveryWarnings(warnings: readonly string[], currentState: string): string[] {
  return warnings.filter((message) => isRecoveryMessageStillRelevant(message, currentState));
}

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
      const message = RECOVERY_MESSAGES.get(project.workflow_state)!;
      const updated: StoredProject = {
        ...project,
        workflow_state: target,
        updated_at: new Date().toISOString(),
        // Never stack the same sentence twice — a project crashing mid-run repeatedly must still show one line, not one per crash.
        warnings: project.warnings.includes(message) ? project.warnings : [...project.warnings, message],
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
