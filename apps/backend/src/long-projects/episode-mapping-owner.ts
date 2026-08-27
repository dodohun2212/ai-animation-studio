import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { LongEpisodeStatus } from "@ai-animation-studio/shared";

import type { MappingOwner, MappingOwners } from "../mappings/mapping-owner.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { longEpisodeNotFound, longInvalidData, longMalformed, longNotFound, longStorageError } from "./long-project-api.error.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";

/**
 * One Episode of a Long Project, answering the questions the asset-mapping flow asks.
 *
 * This is the whole of "reuse the short project's mappings for Episodes". The flow, the storage and the review
 * rules are the short project's, unchanged; what an Episode supplies is where its files live and where its four
 * facts are kept — which is all that ever actually differed. The Episode pipeline had a second implementation of
 * that flow instead, and it had drifted into a strictly worse one: no manual mapping, folders refused outright,
 * scene-level scope missing.
 *
 * The dependency points this way on purpose. `mappings/` knows nothing about Episodes and never will — it is
 * handed a location by whoever owns that layout. Were it the other way round the two modules would import each
 * other the moment this file existed.
 */

const episodeStatuses: readonly LongEpisodeStatus[] = [
  "planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review",
  "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation",
  "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted",
];

/**
 * Names one Episode. Two values, kept as two values.
 *
 * The alternative — formatting them into a single string to fit a key that happened to be a project id — would
 * have put a parser on the other side and a format both sides have to keep agreeing about.
 */
export interface EpisodeMappingKey {
  readonly projectId: string;
  readonly episodeNumber: number;
}

/** Matches every Episode stored before `scene_count` existed, the same fallback the rest of this directory uses. */
const DEFAULT_SCENE_COUNT = 6;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface StoredEpisode extends Record<string, unknown> {
  number: number;
  state: LongEpisodeStatus;
  script: Record<string, unknown>;
  script_revision: number;
}

class EpisodeMappingOwner implements MappingOwner {
  constructor(
    private readonly episode: StoredEpisode,
    private readonly projectId: string,
    readonly directory: string,
    private readonly projectFile: string,
  ) {}

  /**
   * Names the Episode, not just the Long Project it belongs to.
   *
   * This is what a stored mapping is checked against when it is read back, so a Long Project's id alone would
   * let a file copied from one Episode into another pass unnoticed — the short project's equivalent check does
   * catch that, and an Episode should not be the weaker of the two. No stored data has to be migrated for it:
   * every Episode mapping file in existence is empty.
   */
  get id(): string {
    return `${this.projectId}/${episodeDirectoryName(this.episode.number)}`;
  }

  /** Already established: this owner exists because the Episode was read to build it. */
  async ensureExists(): Promise<void> {}

  get sceneCount(): number {
    return Number.isInteger(this.episode.scene_count) ? this.episode.scene_count as number : DEFAULT_SCENE_COUNT;
  }

  get scenes(): readonly unknown[] {
    const scenes = this.episode.script.scenes;
    return Array.isArray(scenes) ? scenes : [];
  }

  get scriptRevision(): number {
    return this.episode.script_revision;
  }

  /**
   * Moves the Episode on, and only out of the state that was waiting for this.
   *
   * Same rule and same reason as the short project's: approving a review again is allowed, so without the guard
   * a later approval would drag an Episode back to a step it had already finished. The states are a different
   * set entirely, which is exactly why the judgement lives here and not in the flow.
   */
  async markMappingApproved(mappingRevision: number): Promise<void> {
    if (this.episode.state !== "waiting_for_asset_mapping_review") return;
    const updated = {
      ...this.episode,
      state: "asset_mapping_approved" satisfies LongEpisodeStatus,
      mapping_revision: mappingRevision,
      updated_at: new Date().toISOString(),
    };
    try {
      await atomicWriteUtf8File(this.projectFile, JSON.stringify(updated, null, 2));
    } catch {
      throw longStorageError();
    }
  }
}

export class EpisodeMappingOwners implements MappingOwners<EpisodeMappingKey> {
  constructor(private readonly projectsRoot: string) {}

  async get({ projectId, episodeNumber }: EpisodeMappingKey): Promise<MappingOwner> {
    const root = longStoryRoot(this.projectsRoot, projectId);
    const directory = path.join(root, episodeDirectoryName(episodeNumber));
    const projectFile = path.join(directory, "project.json");

    // The outline list is what decides an Episode exists at all — its own file could be present for a number the
    // Long Project has since dropped, and reading that would be answering about something nobody can reach.
    const outlines = await this.json(path.join(root, "episode_outlines.json"));
    if (!Array.isArray(outlines) || episodeNumber > outlines.length
      || !isObject(outlines[episodeNumber - 1]) || outlines[episodeNumber - 1].episode_number !== episodeNumber) {
      throw longEpisodeNotFound();
    }

    const raw = await this.json(projectFile);
    if (!isObject(raw) || raw.number !== episodeNumber || !episodeStatuses.includes(raw.state as LongEpisodeStatus)
      || !isObject(raw.script) || !Number.isInteger(raw.script_revision)) {
      throw longInvalidData();
    }
    return new EpisodeMappingOwner(raw as unknown as StoredEpisode, projectId, directory, projectFile);
  }

  /** Same three outcomes the rest of this directory produces, so a caller cannot tell which service read the file. */
  private async json(file: string): Promise<unknown> {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound();
      if (error instanceof SyntaxError) throw longMalformed();
      throw longStorageError();
    }
  }
}
