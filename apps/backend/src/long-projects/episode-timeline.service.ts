import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import type { AddLongEpisodeRequest, AddLongEpisodeResponse, ArchiveLongEpisodeRequest, ArchiveLongEpisodeResponse, DuplicateLongEpisodeResponse, LongEpisodeOutline, LongEpisodeStatus, LongProject, UpdateLongEpisodeOutlineRequest, UpdateLongEpisodeOutlineResponse } from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { longEpisodeLimitReached, longEpisodeNotFound, longEpisodeTimelineNotAllowed, longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";
import { LongProjectsService } from "./long-projects.service.js";

const MAX_EPISODES = Number(process.env.APP_MAX_LONG_PROJECT_EPISODES ?? "60");
const draftStates: readonly LongEpisodeStatus[] = ["planned", "outline_ready"];
type ObjectMap = Record<string, unknown>;
type StoredEpisode = ObjectMap & { number: number; state: LongEpisodeStatus };

const object = (value: unknown, error = longInvalidData): ObjectMap => { if (!value || typeof value !== "object" || Array.isArray(value)) throw error(); return value as ObjectMap; };
const text = (value: unknown): string => typeof value === "string" ? value.trim() : "";

@Injectable()
export class EpisodeTimelineService {
  private readonly projects: LongProjectsService;
  constructor(private readonly projectsRoot: string) { this.projects = new LongProjectsService(projectsRoot); }

  private root(id: string) { return longStoryRoot(this.projectsRoot, id); }
  private files(id: string, number?: number) { const root = this.root(id); const episode = number ? path.join(root, episodeDirectoryName(number)) : undefined; return { root, project: path.join(root, "project.json"), outlines: path.join(root, "episode_outlines.json"), episode, episodeProject: episode && path.join(episode, "project.json"), outline: episode && path.join(episode, "outline.json"), script: episode && path.join(episode, "script.json"), archives: path.join(root, "episode_archives") }; }
  private async json(file: string): Promise<unknown> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); } }
  private toOutline(value: unknown, number: number): LongEpisodeOutline {
    const item = object(value); const status = item.status;
    if (item.episode_number !== number || !draftStates.includes(status as LongEpisodeStatus) || ["title", "summary", "main_event", "conflict", "cliffhanger", "next_episode_hook"].some((key) => typeof item[key] !== "string")) throw longInvalidData();
    const warnings = withoutStaleEpisodeRecoveryWarnings(Array.isArray(item.warnings) ? item.warnings.filter((entry): entry is string => typeof entry === "string") : [], status as string);
    return { episodeNumber: number, title: item.title as string, summary: item.summary as string, mainEvent: item.main_event as string, conflict: item.conflict as string, cliffhanger: item.cliffhanger as string, nextEpisodeHook: item.next_episode_hook as string, status: status as LongEpisodeStatus, ...(warnings.length > 0 ? { warnings } : {}) };
  }
  private async current(id: string): Promise<{ project: LongProject; rawProject: ObjectMap; rawOutlines: ObjectMap[] }> {
    const project = (await this.projects.get(id)).project;
    if (!draftStates.includes(project.outlineStatus === "planned" ? "planned" : "outline_ready") || !project.episodes.every((item) => draftStates.includes(item.status))) throw longEpisodeTimelineNotAllowed();
    const rawProject = object(await this.json(this.files(id).project));
    const rawOutlines = await this.json(this.files(id).outlines);
    if (!Array.isArray(rawOutlines) || rawOutlines.length !== project.episodes.length || rawProject.episode_count !== rawOutlines.length) throw longInvalidData();
    rawOutlines.forEach((item, index) => this.toOutline(item, index + 1));
    return { project, rawProject, rawOutlines: rawOutlines.map((item) => object(item)) };
  }
  private episodeData(id: string, number: number, outline: LongEpisodeOutline, duration: number): StoredEpisode {
    return { episode_id: `EP-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`, number, title: outline.title, summary: outline.summary, core_event: outline.mainEvent, conflict: outline.conflict, cliffhanger: outline.cliffhanger, next_connection: outline.nextEpisodeHook, duration_seconds: duration, approved: false, state: "planned", script: {}, script_history: [], script_revision: 0, outline: { episode_number: number, title: outline.title, summary: outline.summary, main_event: outline.mainEvent, conflict: outline.conflict, cliffhanger: outline.cliffhanger, next_episode_hook: outline.nextEpisodeHook }, updated_at: new Date().toISOString() };
  }
  private async publish(id: string, rawProject: ObjectMap, outlines: ObjectMap[], episode?: StoredEpisode): Promise<LongProject> {
    const files = this.files(id, episode?.number);
    const now = new Date().toISOString();
    rawProject.episode_count = outlines.length; rawProject.updated_at = now;
    try {
      if (files.episode && files.episodeProject && files.outline && files.script && episode) await fs.mkdir(files.episode, { recursive: false });
      const writes: Promise<void>[] = [atomicWriteUtf8File(this.files(id).project, JSON.stringify(rawProject, null, 2)), atomicWriteUtf8File(this.files(id).outlines, JSON.stringify(outlines, null, 2))];
      if (episode && files.episodeProject && files.outline && files.script) writes.push(atomicWriteUtf8File(files.episodeProject, JSON.stringify(episode, null, 2)), atomicWriteUtf8File(files.outline, JSON.stringify(episode.outline, null, 2)), atomicWriteUtf8File(files.script, JSON.stringify(episode.script, null, 2)));
      await Promise.all(writes);
    } catch { throw longStorageError(); }
    return (await this.projects.get(id)).project;
  }
  async add(projectId: string, request: AddLongEpisodeRequest): Promise<AddLongEpisodeResponse> {
    const id = projectId.trim(); const { project, rawProject, rawOutlines } = await this.current(id);
    if (rawOutlines.length >= MAX_EPISODES) throw longEpisodeLimitReached();
    if (!request || Object.keys(request).some((key) => key !== "title") || (request.title !== undefined && typeof request.title !== "string")) throw longInvalidRequest();
    const number = rawOutlines.length + 1; const outline: LongEpisodeOutline = { episodeNumber: number, title: text(request.title) || "새 에피소드", summary: "", mainEvent: "", conflict: "", cliffhanger: "", nextEpisodeHook: "", status: "planned" };
    const rawOutline = { episode_number: number, title: outline.title, summary: "", main_event: "", conflict: "", cliffhanger: "", next_episode_hook: "", status: "planned" };
    const updated = await this.publish(id, rawProject, [...rawOutlines, rawOutline], this.episodeData(id, number, outline, project.settings.episodeDurationSeconds));
    return { project: updated, episode: outline };
  }
  async duplicate(projectId: string, rawNumber: number): Promise<DuplicateLongEpisodeResponse> {
    const id = projectId.trim(); const { project, rawProject, rawOutlines } = await this.current(id);
    if (!Number.isInteger(rawNumber) || rawNumber < 1 || rawNumber > rawOutlines.length) throw longEpisodeNotFound();
    if (rawOutlines.length >= MAX_EPISODES) throw longEpisodeLimitReached();
    const source = this.toOutline(rawOutlines[rawNumber - 1], rawNumber); const number = rawOutlines.length + 1;
    const outline: LongEpisodeOutline = { ...source, episodeNumber: number, title: `${source.title} 복사본`, status: "planned" };
    const rawOutline = { episode_number: number, title: outline.title, summary: outline.summary, main_event: outline.mainEvent, conflict: outline.conflict, cliffhanger: outline.cliffhanger, next_episode_hook: outline.nextEpisodeHook, status: "planned" };
    const updated = await this.publish(id, rawProject, [...rawOutlines, rawOutline], this.episodeData(id, number, outline, project.settings.episodeDurationSeconds));
    return { project: updated, episode: outline };
  }
  async archive(projectId: string, rawNumber: number, request: ArchiveLongEpisodeRequest): Promise<ArchiveLongEpisodeResponse> {
    const id = projectId.trim(); const { rawProject, rawOutlines } = await this.current(id);
    if (!request || Object.keys(request).length !== 1 || request.approved !== true) throw longInvalidRequest();
    if (!Number.isInteger(rawNumber) || rawNumber !== rawOutlines.length || rawNumber < 2) throw longEpisodeTimelineNotAllowed();
    this.toOutline(rawOutlines[rawNumber - 1], rawNumber);
    const files = this.files(id, rawNumber); if (!files.episode) throw longEpisodeNotFound();
    const archiveId = `${episodeDirectoryName(rawNumber)}-${new Date().toISOString().replaceAll(/[:.]/g, "-")}`;
    const destination = path.join(this.files(id).archives, archiveId);
    try { await fs.mkdir(this.files(id).archives, { recursive: true }); await fs.rename(files.episode, destination); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longEpisodeNotFound(); throw longStorageError(); }
    try { const project = await this.publish(id, rawProject, rawOutlines.slice(0, -1)); return { project, archivedEpisodeNumber: rawNumber, archiveId }; }
    catch (error) { await fs.rename(destination, files.episode).catch(() => undefined); throw error; }
  }
  private static readonly outlineFieldMap = { title: "title", summary: "summary", mainEvent: "main_event", conflict: "conflict", cliffhanger: "cliffhanger", nextEpisodeHook: "next_episode_hook" } as const;
  /**
   * Edits one Episode's own outline fields in place — the per-Episode plan whole-project outline approval
   * assigned, before script generation has consumed it as a prompt input. Deliberately gated on only this one
   * Episode's own status (not project-wide, unlike add/duplicate/archive above, which reshuffle numbering and so
   * need every Episode to still be a draft) — editing Episode 5's summary must stay possible even after Episode
   * 1's script has already moved on, since nothing here touches numbering or any other Episode's data.
   */
  async updateOutline(projectId: string, rawNumber: number, request: UpdateLongEpisodeOutlineRequest): Promise<UpdateLongEpisodeOutlineResponse> {
    const id = projectId.trim();
    const rawProject = object(await this.json(this.files(id).project));
    const rawOutlinesValue = await this.json(this.files(id).outlines);
    if (!Array.isArray(rawOutlinesValue)) throw longInvalidData();
    const rawOutlines = rawOutlinesValue.map((item) => object(item));
    if (!Number.isInteger(rawNumber) || rawNumber < 1 || rawNumber > rawOutlines.length) throw longEpisodeNotFound();
    const entry = rawOutlines[rawNumber - 1]!;
    if (entry.episode_number !== rawNumber) throw longInvalidData();
    if (!draftStates.includes(entry.status as LongEpisodeStatus)) throw longEpisodeTimelineNotAllowed();

    const changes = object(request?.outline, longInvalidRequest);
    const keys = Object.keys(changes);
    const fieldMap: Record<string, string> = EpisodeTimelineService.outlineFieldMap;
    if (keys.length === 0 || keys.some((key) => !(key in fieldMap))) throw longInvalidRequest();
    const updatedEntry = { ...entry };
    for (const key of keys) {
      const value = changes[key];
      if (typeof value !== "string" || !value.trim()) throw longInvalidRequest();
      updatedEntry[fieldMap[key]!] = value.trim();
    }
    const newRawOutlines = rawOutlines.map((item, index) => index === rawNumber - 1 ? updatedEntry : item);
    const project = await this.publish(id, rawProject, newRawOutlines);
    return { project, episode: this.toOutline(updatedEntry, rawNumber) };
  }
}
