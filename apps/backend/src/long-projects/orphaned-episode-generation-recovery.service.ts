import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { LongEpisodeStatus } from "@ai-animation-studio/shared";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isSafeProjectId } from "../projects/project-id.js";

import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
/**
 * Episode counterpart to projects/orphaned-generation-recovery.service.ts — see that file's doc comment for the
 * full single-process-loop reasoning, which applies identically here. That file explicitly flagged Long Episodes
 * as uncovered rather than folding them in silently; this closes that gap (a real
 * user project stuck in a "generating" Episode state with no way out, same shape as the Round 129 incident that
 * created the short-project version of this file).
 *
 * Recovery targets mirror each Episode service's own successful-exception catch, exactly the same principle as
 * the short-project file — never a new state:
 *  - generating_images -> asset_mapping_approved: EpisodeImagesService's own catch already lands here on any
 *    generation failure — re-approving resumes safely and for free, reusing any scene file that still validates.
 *  - videos_generating -> interrupted: EpisodeVideosService.stop() already lands here deliberately, and its own
 *    restart() endpoint resumes verbatim — identical to the short-project GENERATING_VIDEOS case.
 *  - rendering -> failed: EpisodeVideoMergeService's own catch (fail()) already lands exactly here on any merge
 *    failure. Unlike the short-project Rendering case (which has a free-retry AssetMappingApproved-style target),
 *    Episode rendering failure is already modeled as a terminal, retryable state — matching that existing design
 *    is more correct than inventing a different one just for the orphaned path.
 *
 * A plain-language message is written into `warnings` on both the outline summary and the Episode's own detail
 * file (asked for explicitly once the shared contract
 * gained LongEpisodeOutline.warnings). Same principle as the short-project RECOVERY_MESSAGES: no raw
 * LongEpisodeStatus value in the text, never stack the same sentence twice, and self-clears once the Episode has
 * moved past the window this message was about (withoutStaleEpisodeRecoveryWarnings below) — every one of the
 * several places across this directory that reads warnings back out (each service's own detail()/outline()
 * parser; there is no single shared mapper the way project.mapper.ts is for short projects) filters through it.
 */
const RECOVERY_TARGETS: ReadonlyMap<LongEpisodeStatus, LongEpisodeStatus> = new Map([
  ["generating_images", "asset_mapping_approved"],
  ["videos_generating", "interrupted"],
  // Back to where it was, not to "failed". The server being stopped mid-merge is an interruption, not a
  // failure of the merge, and the warning below is what says so. Recording it as a failure also used to
  // make this table's own message untrue: it promised the person they could try again, into a state the
  // merge refused to start from. Matches the short project's Rendering -> VideosApproved.
  ["rendering", "videos_approved"],
]);

const RECOVERY_MESSAGES: ReadonlyMap<LongEpisodeStatus, string> = new Map([
  ["generating_images", "이전에 이미지를 만들다가 서버가 꺼져서 중간에 멈췄습니다. 이미 만들어진 것은 그대로 있고, 이어서 다시 만들 수 있습니다."],
  ["videos_generating", "이전에 영상을 만들다가 서버가 꺼져서 중간에 멈췄습니다. 이미 만들어진 것은 그대로 있고, 이어서 다시 만들 수 있습니다."],
  ["rendering", "이전에 최종 영상을 합치다가 서버가 꺼져서 중간에 멈췄습니다. 다시 시도할 수 있습니다."],
]);

/** Episode counterpart to orphaned-generation-recovery.service.ts's isRecoveryMessageStillRelevant — same "still between the from-state and the target state" rule, over LongEpisodeStatus instead of WorkflowState. */
export function isEpisodeRecoveryMessageStillRelevant(message: string, currentState: string): boolean {
  for (const [fromState, text] of RECOVERY_MESSAGES) {
    if (text === message) return currentState === fromState || currentState === RECOVERY_TARGETS.get(fromState);
  }
  return true; // Not one of ours — never filter a message this service did not write.
}

/** Episode counterpart to withoutStaleRecoveryWarnings — see that function's doc comment. */
export function withoutStaleEpisodeRecoveryWarnings(warnings: readonly string[], currentState: string): string[] {
  return warnings.filter((message) => isEpisodeRecoveryMessageStillRelevant(message, currentState));
}

type ObjectMap = Record<string, unknown>;
const object = (value: unknown): value is ObjectMap => Boolean(value) && typeof value === "object" && !Array.isArray(value);

@Injectable()
export class OrphanedEpisodeGenerationRecoveryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(OrphanedEpisodeGenerationRecoveryService.name);

  constructor(private readonly projectsRoot: string) {}

  async onApplicationBootstrap(): Promise<void> {
    const recovered = await this.recoverAll();
    if (recovered > 0) {
      this.logger.warn(`Recovered ${recovered} Long Episode(s) left in an orphaned in-progress generation state by a previous run.`);
    }
  }

  /** Exposed directly (not only via the bootstrap hook) so an integration test can call it deterministically without booting a whole Nest app. Returns a count, not a project list, since (unlike the short-project repository) there is no single object representing "a Long Project" cheap enough to hand back here — recoverProject() below does the real per-Episode work. */
  async recoverAll(): Promise<number> {
    let entries: string[];
    try {
      entries = (await fs.readdir(this.projectsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && isSafeProjectId(entry.name))
        .map((entry) => entry.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
    let recovered = 0;
    for (const projectId of entries) recovered += await this.recoverProject(projectId);
    return recovered;
  }

  private async recoverProject(projectId: string): Promise<number> {
    const root = longStoryRoot(this.projectsRoot, projectId);
    const outlinesFile = path.join(root, "episode_outlines.json");
    let outlines: unknown;
    try {
      outlines = JSON.parse(await fs.readFile(outlinesFile, "utf8"));
    } catch {
      return 0; // Not a Long Project directory (no long_story/episode_outlines.json) — a short project, or unreadable. Same "skip silently" behavior as LongProjectsService.list().
    }
    if (!Array.isArray(outlines)) return 0;

    const updatedOutlines = [...outlines];
    let outlinesChanged = false;
    let recovered = 0;

    for (let index = 0; index < outlines.length; index += 1) {
      const summary = outlines[index];
      if (!object(summary) || summary.episode_number !== index + 1) continue;
      const target = RECOVERY_TARGETS.get(summary.status as LongEpisodeStatus);
      if (!target) continue;
      const number = index + 1;
      const episodeFile = path.join(root, episodeDirectoryName(number), "project.json");

      let episode: unknown;
      try {
        episode = JSON.parse(await fs.readFile(episodeFile, "utf8"));
      } catch (error) {
        this.logger.error(`Failed to read orphaned Episode ${number} of Long Project "${projectId}".`, error as Error);
        continue;
      }
      if (!object(episode)) continue;
      // The outline summary and the Episode's own detail file disagree about status already — leave it alone
      // rather than guess which one is stale; a human should look at this, not this pass.
      if (episode.state !== summary.status) continue;

      const message = RECOVERY_MESSAGES.get(summary.status as LongEpisodeStatus)!;
      const episodeWarnings = Array.isArray(episode.warnings) ? episode.warnings.filter((item): item is string => typeof item === "string") : [];
      const outlineWarnings = Array.isArray(summary.warnings) ? summary.warnings.filter((item): item is string => typeof item === "string") : [];
      const updatedEpisode: ObjectMap = {
        ...episode,
        state: target,
        updated_at: new Date().toISOString(),
        // Never stack the same sentence twice — an Episode crashing mid-run repeatedly must still show one line.
        warnings: episodeWarnings.includes(message) ? episodeWarnings : [...episodeWarnings, message],
      };

      try {
        await atomicWriteUtf8File(episodeFile, JSON.stringify(updatedEpisode, null, 2));
      } catch (error) {
        this.logger.error(`Failed to recover orphaned Episode ${number} of Long Project "${projectId}" from ${String(summary.status)}.`, error as Error);
        continue;
      }
      updatedOutlines[index] = { ...summary, status: target, warnings: outlineWarnings.includes(message) ? outlineWarnings : [...outlineWarnings, message] };
      outlinesChanged = true;
      recovered += 1;
    }

    if (outlinesChanged) {
      try {
        await atomicWriteUtf8File(outlinesFile, JSON.stringify(updatedOutlines, null, 2));
      } catch (error) {
        this.logger.error(`Failed to persist recovered Episode statuses for Long Project "${projectId}".`, error as Error);
      }
    }
    return recovered;
  }
}
