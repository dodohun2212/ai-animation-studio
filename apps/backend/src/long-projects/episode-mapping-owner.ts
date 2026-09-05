import * as fs from "node:fs/promises";
import { readLongProjectJson } from "./long-project-json.js";
import * as path from "node:path";

import { DEFAULT_SCENE_COUNT, LONG_EPISODE_STATUSES, type LongEpisodeStatus } from "@ai-animation-studio/shared";

import type { MappingOwner, MappingOwners } from "../mappings/mapping-owner.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isLongProjectError, longEpisodeMappingNotAllowed, longEpisodeNotFound, longInvalidData, longMalformed, longNotFound, longStorageError } from "./long-project-api.error.js";
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

/**
 * Every status an Episode can legitimately hold, taken from the shared list rather than written out again.
 *
 * This is a *shape* check — "is this a well-formed Episode record" — not a gate. Anything the type allows has to
 * pass, so a hand-written copy is a defect waiting for the next status to be added. It already was one: this
 * list stopped at `interrupted` and never gained `rendering`, `completed` or `failed`, so an Episode that had
 * been finished answered **500, data invalid** on both of its Asset Mapping routes. Measured on real data —
 * both Episodes of a real long story, whose only fault was being done.
 *
 * A finished Episode is exactly when someone opens this screen: to see which character a scene used before
 * writing the next one, or to work out why an image came out wrong.
 */
const episodeStatuses: readonly LongEpisodeStatus[] = LONG_EPISODE_STATUSES;

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


const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface StoredEpisode extends Record<string, unknown> {
  number: number;
  approved?: boolean;
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

  /**
   * The Episode's scenes, with each one's narration left out.
   *
   * The mapping flow hashes these to decide whether a review still describes the script it was approved
   * against, and narration is the one part of a scene that says nothing about which assets appear in it. Leaving
   * it in would invalidate an approved mapping every time someone reworded a line — the Episode pipeline already
   * knew that and stripped it before hashing, in two copies of the same helper.
   *
   * Answering it here rather than hashing differently downstream is what makes the two sides agree by
   * construction. They used to agree only because two functions in two files happened to match, and the moment
   * this flow started producing the review they stopped matching: an approved mapping would have left image
   * generation refusing forever, with nothing to point at.
   */
  get scenes(): readonly unknown[] {
    const scenes = this.episode.script.scenes;
    if (!Array.isArray(scenes)) return [];
    return scenes.map((scene) => {
      if (typeof scene !== "object" || scene === null || Array.isArray(scene)) return scene;
      const { narration: _narration, ...rest } = scene as Record<string, unknown>;
      return rest;
    });
  }

  get scriptRevision(): number {
    return this.episode.script_revision;
  }

  /**
   * Moves the Episode into "waiting for asset mapping review", and refuses when that would make no sense.
   *
   * An Episode reaches this step from an approved script, and the implementation this replaces did the same
   * transition inside its own begin(). Dropping it left approved reviews sitting on an Episode still in
   * script_approved, which image generation's gate reads as not ready — the mapping would have looked done and
   * generation would have refused, with the two facts in different files and nothing connecting them.
   *
   * Starting again from "waiting" is allowed and changes nothing: re-confirming a review is an ordinary thing
   * to do, and it is the same state either way.
   */
  async markMappingReviewBegun(): Promise<void> {
    if (this.episode.state === "waiting_for_asset_mapping_review") return;
    if (this.episode.state !== "script_approved" || this.episode.approved !== true) throw longEpisodeMappingNotAllowed();
    await this.write({ state: "waiting_for_asset_mapping_review" satisfies LongEpisodeStatus });
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
    await this.write({ state: "asset_mapping_approved" satisfies LongEpisodeStatus, mapping_revision: mappingRevision });
  }

  /** One writer, so the in-memory Episode and the file cannot disagree about what this owner has already done. */
  private async write(changes: Record<string, unknown>): Promise<void> {
    Object.assign(this.episode, changes, { updated_at: new Date().toISOString() });
    try {
      await atomicWriteUtf8File(this.projectFile, JSON.stringify(this.episode, null, 2));
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
    const outlines = await readLongProjectJson(path.join(root, "episode_outlines.json"));
    if (!Array.isArray(outlines) || episodeNumber > outlines.length
      || !isObject(outlines[episodeNumber - 1]) || outlines[episodeNumber - 1].episode_number !== episodeNumber) {
      throw longEpisodeNotFound();
    }

    // An Episode the outline lists but nobody has scripted has no directory yet — the script save is what
    // creates it — so this read is ENOENT, and json() reports that as "Long project was not found". The project
    // is right there; the person was looking at it a moment ago, and that answer sends them hunting for
    // something that is not missing. episode-videos.service.ts made the same correction on its own route
    // (loadEpisode) for the same reason; this is the mapping route catching up. A scripted Episode in the wrong
    // state already answers with this code, so the two cases now agree.
    let raw: unknown;
    try { raw = await readLongProjectJson(projectFile); }
    catch (error) { if (isLongProjectError(error, "LONG_PROJECT_NOT_FOUND")) throw longEpisodeMappingNotAllowed(); throw error; }
    if (!isObject(raw) || raw.number !== episodeNumber || !episodeStatuses.includes(raw.state as LongEpisodeStatus)
      || !isObject(raw.script) || !Number.isInteger(raw.script_revision)) {
      throw longInvalidData();
    }
    return new EpisodeMappingOwner(raw as unknown as StoredEpisode, projectId, directory, projectFile);
  }

}
