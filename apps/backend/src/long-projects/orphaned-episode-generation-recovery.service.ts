import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { LongEpisodeStatus } from "@ai-animation-studio/shared";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isSafeProjectId, resolveSafeProjectDirectory } from "../projects/project-id.js";

/**
 * Episode counterpart to projects/orphaned-generation-recovery.service.ts — see that file's doc comment for the
 * full single-process-loop reasoning, which applies identically here. That file explicitly flagged Long Episodes
 * as uncovered rather than folding them in silently; this closes that gap (`.claude-bridge` Round 164 — a real
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
 * No user-facing message is added here (unlike the short-project file's RECOVERY_MESSAGES): LongEpisodeOutline/
 * LongEpisodeDetail have no warnings-equivalent field in the shared contract today. The state transition alone is
 * the load-bearing fix — an Episode that can be retried beats one that is silently mislabeled but still stuck.
 * Surfacing *why* is a real follow-up, not a silent scope cut (flagged in `.claude-bridge`, not folded in here).
 */
const RECOVERY_TARGETS: ReadonlyMap<LongEpisodeStatus, LongEpisodeStatus> = new Map([
  ["generating_images", "asset_mapping_approved"],
  ["videos_generating", "interrupted"],
  ["rendering", "failed"],
]);

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
    const root = path.join(resolveSafeProjectDirectory(this.projectsRoot, projectId), "long_story");
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
      const episodeFile = path.join(root, `Episode${String(number).padStart(2, "0")}`, "project.json");

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

      const updatedEpisode: ObjectMap = {
        ...episode,
        state: target,
        updated_at: new Date().toISOString(),
        ...(target === "failed"
          ? { errors: [...(Array.isArray(episode.errors) ? episode.errors : []), "Backend process exited while rendering. Recovered to a retryable state on restart."] }
          : {}),
      };

      try {
        await atomicWriteUtf8File(episodeFile, JSON.stringify(updatedEpisode, null, 2));
      } catch (error) {
        this.logger.error(`Failed to recover orphaned Episode ${number} of Long Project "${projectId}" from ${String(summary.status)}.`, error as Error);
        continue;
      }
      updatedOutlines[index] = { ...summary, status: target };
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
