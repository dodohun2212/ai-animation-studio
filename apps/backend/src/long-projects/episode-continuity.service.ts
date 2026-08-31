import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import type { GetLongEpisodeContinuityResponse, LongEpisodeContinuityMemory, LongEpisodeDetail, LongEpisodeStatus, SaveLongEpisodeContinuityRequest, SaveLongEpisodeContinuityResponse } from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isLongProjectError, longEpisodeContinuityNotAllowed, longEpisodeNotFound, longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
import { toApiEpisodeScript } from "./episode-script-format.js";
import { toEpisodeDetail } from "./episode-detail.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";

const eligible: readonly LongEpisodeStatus[] = ["waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "rendering", "completed"];
const states: readonly LongEpisodeStatus[] = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted", "rendering", "completed", "failed"];
const memoryStrings = ["episodeSummary", "timeElapsed", "userEdits"] as const;
const memoryLists = ["events", "appearedCharacterIds", "appearedLocationIds", "resolvedConflicts", "newConflicts", "revealedSecretIds", "remainingSecretIds", "newForeshadowingIds", "resolvedForeshadowingIds", "nextActions", "worldChanges"] as const;
const changeLists = ["characterChanges", "itemChanges"] as const;
type StoredEpisode = Record<string, unknown> & { number: number; state: LongEpisodeStatus; approved: boolean; script_revision: number; updated_at: string; };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, limit = 4000): string | undefined => typeof value === "string" && value.trim().length <= limit ? value.trim() : undefined;

@Injectable()
export class EpisodeContinuityService {
  constructor(private readonly projectsRoot: string) {}

  private files(projectId: string, number: number) { const root = longStoryRoot(this.projectsRoot, projectId); const episode = path.join(root, episodeDirectoryName(number)); return { root, outlines: path.join(root, "episode_outlines.json"), project: path.join(episode, "project.json"), continuity: path.join(episode, "continuity.json") }; }
  private async json(file: string): Promise<unknown> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); } }
  private async episode(id: string, number: number): Promise<StoredEpisode> { if (!Number.isInteger(number) || number < 1) throw longEpisodeNotFound(); const files = this.files(id, number); const outlines = await this.json(files.outlines); if (!Array.isArray(outlines) || number > outlines.length || !object(outlines[number - 1]) || outlines[number - 1].episode_number !== number) throw longEpisodeNotFound(); const raw = await this.json(files.project); if (!object(raw) || raw.number !== number || !states.includes(raw.state as LongEpisodeStatus) || typeof raw.approved !== "boolean" || !Number.isInteger(raw.script_revision) || typeof raw.updated_at !== "string") throw longInvalidData(); return raw as StoredEpisode; }
  /**
   * This Episode's record, or null when it has none yet.
   *
   * An Episode listed in the outline but never scripted has no directory, so reading its record is ENOENT — which
   * `json()` reports as "Long project was not found". Measured over real data: a real Episode 2 answered 200 for
   * its own detail and 404 "Long project was not found" for its continuity memo, in the same breath.
   *
   * Only that one code is absorbed. `longEpisodeNotFound()` — an Episode number the outline does not have — is a
   * different thing and still refuses; without the distinction this would answer for Episode 99 as calmly as for
   * Episode 2.
   */
  private async episodeOrNull(id: string, number: number): Promise<StoredEpisode | null> {
    try { return await this.episode(id, number); }
    catch (error) { if (isLongProjectError(error, "LONG_PROJECT_NOT_FOUND")) return null; throw error; }
  }

  private detail(episode: StoredEpisode): LongEpisodeDetail { return toEpisodeDetail(episode); }
  private parse(value: unknown, expectedNumber: number, request = false): LongEpisodeContinuityMemory { const source = request ? (object(value) && Object.keys(value).length === 1 && object(value.memory) ? value.memory : undefined) : value; if (!object(source)) throw request ? longInvalidRequest("Episode Continuity Memory request is invalid.") : longInvalidData(); const expected = new Set(request ? [...memoryStrings, ...memoryLists, ...changeLists] : ["episodeNumber", "updatedAt", ...memoryStrings, ...memoryLists, ...changeLists]); if (Object.keys(source).length !== expected.size || Object.keys(source).some((key) => !expected.has(key)) || (!request && (source.episodeNumber !== expectedNumber || typeof source.updatedAt !== "string"))) throw request ? longInvalidRequest("Episode Continuity Memory request is invalid.") : longInvalidData(); const invalid = request ? longInvalidRequest("Episode Continuity Memory request is invalid.") : longInvalidData(); const updatedAt = request ? new Date().toISOString() : text(source.updatedAt, 100); if (!updatedAt) throw invalid; const result: Record<string, unknown> = { episodeNumber: expectedNumber, updatedAt };
    for (const key of memoryStrings) { const value = text(source[key]); if (value === undefined) throw invalid; result[key] = value; }
    for (const key of memoryLists) { const value = source[key]; if (!Array.isArray(value) || value.length > 100 || value.some((item) => text(item, 1000) === undefined)) throw invalid; result[key] = value.map((item) => text(item, 1000)!); }
    for (const key of changeLists) { const value = source[key]; if (!Array.isArray(value) || value.length > 100 || value.some((item) => !object(item) || JSON.stringify(item).length > 8000)) throw invalid; result[key] = value; }
    return result as unknown as LongEpisodeContinuityMemory; }
  private stored(memory: LongEpisodeContinuityMemory): Record<string, unknown> { return { episode_number: memory.episodeNumber, episode_summary: memory.episodeSummary, events: memory.events, appeared_character_ids: memory.appearedCharacterIds, character_changes: memory.characterChanges, appeared_location_ids: memory.appearedLocationIds, item_changes: memory.itemChanges, resolved_conflicts: memory.resolvedConflicts, new_conflicts: memory.newConflicts, revealed_secret_ids: memory.revealedSecretIds, remaining_secret_ids: memory.remainingSecretIds, new_foreshadowing_ids: memory.newForeshadowingIds, resolved_foreshadowing_ids: memory.resolvedForeshadowingIds, next_actions: memory.nextActions, time_elapsed: memory.timeElapsed, world_changes: memory.worldChanges, user_edits: memory.userEdits, updated_at: memory.updatedAt }; }
  private fromStored(value: unknown, number: number): LongEpisodeContinuityMemory { if (!object(value)) throw longInvalidData(); return this.parse({ episodeNumber: value.episode_number, updatedAt: value.updated_at, episodeSummary: value.episode_summary, events: value.events, appearedCharacterIds: value.appeared_character_ids, characterChanges: value.character_changes, appearedLocationIds: value.appeared_location_ids, itemChanges: value.item_changes, resolvedConflicts: value.resolved_conflicts, newConflicts: value.new_conflicts, revealedSecretIds: value.revealed_secret_ids, remainingSecretIds: value.remaining_secret_ids, newForeshadowingIds: value.new_foreshadowing_ids, resolvedForeshadowingIds: value.resolved_foreshadowing_ids, nextActions: value.next_actions, timeElapsed: value.time_elapsed, worldChanges: value.world_changes, userEdits: value.user_edits }, number); }
  /**
   * This Episode's memo, or null.
   *
   * Null covers both "never written" and "written and no longer readable". The second used to throw, which made
   * this the one screen a person could not open to fix the file it is about: a corrupt continuity.json refused
   * here and refused every later Episode's script generation, with nothing in the app able to replace it. The
   * screen already handles null by pre-filling from the outline and saying so, and saving overwrites the file
   * — which is exactly the repair.
   */
  async get(projectId: string, number: number): Promise<GetLongEpisodeContinuityResponse> { const id = projectId.trim(); const episode = await this.episodeOrNull(id, number);
    // An Episode with no record yet has no memo and cannot have one saved — which is exactly what this screen
    // already shows for "never written", so it opens rather than erroring. The same reasoning as the comment
    // above: the screen a person goes to in order to write this file must not be closed by the file's absence.
    if (!episode) return { memory: null, canSave: false };
    const canSave = eligible.includes(episode.state); try { return { memory: this.fromStored(await this.json(this.files(id, number).continuity), number), canSave }; } catch (error) { if (isLongProjectError(error, "LONG_PROJECT_NOT_FOUND", "LONG_PROJECT_JSON_MALFORMED", "LONG_PROJECT_DATA_INVALID")) return { memory: null, canSave }; throw error; } }
  async save(projectId: string, number: number, request: SaveLongEpisodeContinuityRequest): Promise<SaveLongEpisodeContinuityResponse> { const id = projectId.trim(); const current = await this.episodeOrNull(id, number); if (!current || !eligible.includes(current.state)) throw longEpisodeContinuityNotAllowed(); const memory = this.parse(request, number, true); try { await atomicWriteUtf8File(this.files(id, number).continuity, JSON.stringify(this.stored(memory), null, 2)); } catch { throw longStorageError(); } let nextEpisode: LongEpisodeDetail | null = null; try { nextEpisode = this.detail(await this.episode(id, number + 1)); } catch (error) { if (!(error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404)) throw error; } return { memory, nextEpisode }; }
}
