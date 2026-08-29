import * as crypto from "node:crypto";
import { isPlaceholderClip } from "./placeholder-clip.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import {
  sceneNumbersFor,
  WorkflowState,
  type GetVideoLibraryResponse,
  type GetVideoVersionsResponse,
  type RestoreVideoVersionResponse,
  type SceneNumber,
  type VideoVersionSummary,
} from "@ai-animation-studio/shared";

import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { withProjectLock } from "./project-lock.js";
import {
  videoLibraryContentUnavailable,
  videoLibraryInvalidRequest,
  videoLibraryRestoreNotAllowed,
  videoLibraryStorageError,
  videoLibraryVersionNotFound,
} from "./video-library-api.error.js";
import { shortProjectAspectRatio } from "../projects/project-aspect.js";

const FINAL_VIDEO_PATH = "videos/final/instagram_reel.mp4" as const;

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}

/** See project-aspect.ts for why this is one shared function rather than the per-file copy it used to be. */
const aspectRatioFor = shortProjectAspectRatio;

type Target = { kind: "scene"; scene: SceneNumber } | { kind: "final" };

function parseTarget(raw: string, scenes: readonly SceneNumber[]): Target {
  if (raw === "final") return { kind: "final" };
  const value = Number(raw);
  if (!Number.isInteger(value) || String(value) !== raw || !scenes.includes(value as SceneNumber)) throw videoLibraryInvalidRequest("Scene number is invalid for this project.");
  return { kind: "scene", scene: value as SceneNumber };
}

/**
 * `paid` runs demand a real clip, not merely a non-empty one.
 *
 * A placeholder is a valid `ftyp` header, so "larger than zero" counted six stubs as ready videos while the
 * download that was charged for had been thrown away — the library would have reported the batch as finished
 * and offered it for download. The local fake path writes placeholders on purpose, and listing those is its
 * normal behaviour, so only a run that reached a provider is held to the stricter test.
 */
async function validFile(file: string, paid = false): Promise<{ bytes: number; createdAt: string } | undefined> {
  try {
    const stat = await fs.stat(file);
    if (!stat.isFile() || stat.size <= 0 || (paid && isPlaceholderClip(stat.size))) return undefined;
    return { bytes: stat.size, createdAt: stat.mtime.toISOString() };
  } catch {
    return undefined;
  }
}

/**
 * Read-only browsing and restore for already-generated video results — a results archive, distinct in purpose
 * from the Asset Library's input-material role. Every scene video and the final
 * merged video get the same "current file + versions/ history" treatment; a scene's own generation pipeline
 * (local-video-workflow.service.ts) and the merge pipeline (video-merge.service.ts) remain the only writers of
 * the *current* file — this service only ever archives a displaced current file and restores an old one, never
 * generates or merges anything itself, so restoring is always free.
 */
@Injectable()
export class VideoLibraryService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly projectsRoot: string,
    private readonly budget?: RunwayBudget,
  ) {}

  private projectDirectory(projectId: string): string {
    return path.join(this.projectsRoot, projectId);
  }

  private currentFile(projectId: string, target: Target): string {
    return target.kind === "final"
      ? path.join(this.projectDirectory(projectId), FINAL_VIDEO_PATH)
      : path.join(this.projectDirectory(projectId), "videos", "runway", `scene${target.scene}.mp4`);
  }

  private historyDirectory(projectId: string, target: Target): string {
    return target.kind === "final"
      ? path.join(this.projectDirectory(projectId), "videos", "final", "history")
      : path.join(this.projectDirectory(projectId), "videos", "history");
  }

  /** scene{N}_v{NNN}.mp4 for a scene, instagram_reel_v{NNN}.mp4 for the final video — the scene pattern already exists (see local-video-workflow.service.ts's archive()); the final pattern is new here, matching the same shape. */
  private historyFileName(target: Target, version: number): string {
    const prefix = target.kind === "final" ? "instagram_reel_v" : `scene${target.scene}_v`;
    return `${prefix}${String(version).padStart(3, "0")}.mp4`;
  }

  private async historyVersions(projectId: string, target: Target): Promise<number[]> {
    const directory = this.historyDirectory(projectId, target);
    let entries: string[];
    try { entries = await fs.readdir(directory); } catch { return []; }
    const pattern = target.kind === "final" ? /^instagram_reel_v(\d{3})\.mp4$/ : new RegExp(`^scene${target.scene}_v(\\d{3})\\.mp4$`);
    return entries.map((name) => pattern.exec(name)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1]));
  }

  private async atomicBinary(finalPath: string, bytes: Buffer): Promise<void> {
    await fs.mkdir(path.dirname(finalPath), { recursive: true });
    const temporary = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${crypto.randomUUID()}.tmp`);
    let renamed = false;
    try {
      await fs.writeFile(temporary, bytes);
      await fs.rename(temporary, finalPath);
      renamed = true;
    } finally {
      if (!renamed) await fs.unlink(temporary).catch(() => undefined);
    }
  }

  /** Copies the current file into history under the next version number, if a current file actually exists — nothing to preserve otherwise. Mirrors local-video-workflow.service.ts's private archive(), generalized to the final video too. */
  private async archiveCurrent(projectId: string, target: Target): Promise<void> {
    const current = this.currentFile(projectId, target);
    const bytes = await fs.readFile(current).catch(() => undefined);
    if (!bytes || bytes.length === 0) return;
    const versions = await this.historyVersions(projectId, target);
    const next = (versions.length ? Math.max(...versions) : 0) + 1;
    await this.atomicBinary(path.join(this.historyDirectory(projectId, target), this.historyFileName(target, next)), bytes);
  }

  async list(): Promise<GetVideoLibraryResponse> {
    const projects = await this.projects.list();
    const rows: GetVideoLibraryResponse["projects"] = [];
    for (const project of projects) {
      const scenes = scenesFor(project);
      const paid = project.video_generation_records.some((item) => typeof item === "object" && item !== null && (item as { execution_mode?: unknown }).execution_mode === "runway");
      const sceneFiles = await Promise.all(scenes.map((scene) => validFile(this.currentFile(project.project_id, { kind: "scene", scene }), paid)));
      const videosReadyCount = sceneFiles.filter(Boolean).length;
      const finalFile = await validFile(this.currentFile(project.project_id, { kind: "final" }), paid);
      if (videosReadyCount === 0 && !finalFile) continue; // Never reached video generation — not a library entry.
      const costsByScene = this.budget ? await this.budget.costsByScene(project.project_id) : {};
      const totalActualCostUsd = Object.values(costsByScene).reduce((sum: number, value) => sum + (value ?? 0), 0);
      rows.push({
        projectId: project.project_id,
        topic: project.topic,
        updatedAt: project.updated_at,
        sceneCount: scenes.length,
        videosReadyCount,
        finalVideoAvailable: Boolean(finalFile),
        totalActualCostUsd,
        aspectRatio: aspectRatioFor(project),
        ...(project.used_audio?.attribution_required !== undefined ? { attributionRequired: project.used_audio.attribution_required } : {}),
        ...(project.used_audio?.attribution_text !== undefined ? { attributionText: project.used_audio.attribution_text } : {}),
      });
    }
    rows.sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
    return { projects: rows };
  }

  private async versionsFor(projectId: string, target: Target): Promise<VideoVersionSummary[]> {
    const current = await validFile(this.currentFile(projectId, target));
    const versions = await this.historyVersions(projectId, target);
    const historyEntries = await Promise.all(versions.map(async (version) => {
      const file = await validFile(path.join(this.historyDirectory(projectId, target), this.historyFileName(target, version)));
      return file ? { versionId: `v${String(version).padStart(3, "0")}`, createdAt: file.createdAt, bytes: file.bytes, isCurrent: false, sortKey: version } : undefined;
    }));
    const rows = historyEntries.filter((item): item is NonNullable<typeof item> => Boolean(item)).sort((a, b) => b.sortKey - a.sortKey).map(({ sortKey: _sortKey, ...rest }) => rest);
    return current ? [{ versionId: "current", createdAt: current.createdAt, bytes: current.bytes, isCurrent: true }, ...rows] : rows;
  }

  async versions(projectId: string, rawTarget: string): Promise<GetVideoVersionsResponse> {
    const project = await this.projects.findById(projectId.trim());
    const target = parseTarget(rawTarget, scenesFor(project));
    return { versions: await this.versionsFor(project.project_id, target) };
  }

  private resolveVersionFile(projectId: string, target: Target, versionId: string): string {
    if (versionId === "current") return this.currentFile(projectId, target);
    const match = /^v(\d{3})$/.exec(versionId);
    if (!match) throw videoLibraryVersionNotFound();
    return path.join(this.historyDirectory(projectId, target), this.historyFileName(target, Number(match[1])));
  }

  async content(projectId: string, rawTarget: string, versionId: string): Promise<{ path: string }> {
    const project = await this.projects.findById(projectId.trim());
    const target = parseTarget(rawTarget, scenesFor(project));
    const file = this.resolveVersionFile(project.project_id, target, versionId);
    if (!await validFile(file)) throw videoLibraryContentUnavailable();
    return { path: file };
  }

  /**
   * Always free (no provider call, no budget row) and never destructive: the file about to be replaced is
   * archived first via archiveCurrent(), so restoring is itself reversible, and no version is ever deleted.
   * Restoring a scene reopens VideosApproved (from Completed, if the project had already merged) so the final
   * video's staleness is real and actionable rather than a label the user cannot do anything about — the
   * shared WORKFLOW_TRANSITIONS table does not list Completed -> VideosApproved (it lists no outgoing
   * transitions from Completed at all), but that table is documentation only today (nothing in this codebase
   * enforces it at runtime) and a restored project that cannot be re-merged would be a dead end, worse than not
   * having the feature — flagged to Cowork rather than silently decided.
   */
  async restore(projectId: string, rawTarget: string, versionId: string, request: unknown): Promise<RestoreVideoVersionResponse> {
    if (!request || typeof request !== "object" || Array.isArray(request) || (request as Record<string, unknown>).approved !== true || Object.keys(request).length !== 1) {
      throw videoLibraryInvalidRequest("Restore requires explicit approval.");
    }
    const id = projectId.trim();
    const initial = await this.projects.findById(id);
    const target = parseTarget(rawTarget, scenesFor(initial));
    if (versionId === "current") throw videoLibraryRestoreNotAllowed();
    const sourceFile = this.resolveVersionFile(id, target, versionId);
    if (!await validFile(sourceFile)) throw videoLibraryVersionNotFound();

    return withProjectLock(this.projectDirectory(id), "videos:restore", async () => {
      const project = await this.projects.findById(id);
      const bytes = await fs.readFile(sourceFile).catch(() => undefined);
      if (!bytes) throw videoLibraryVersionNotFound();
      try {
        await this.archiveCurrent(id, target);
        await this.atomicBinary(this.currentFile(id, target), bytes);
      } catch {
        throw videoLibraryStorageError();
      }

      // Either branch invalidates ProjectSummary.usedAudio: a scene restore voids the final video entirely
      // (must re-merge to get a new one), and a restored final version's own audio was never recorded
      // per-history-version, so the project's single "most recent merge" record cannot correctly describe it.
      let updated: StoredProject = { ...project, updated_at: new Date().toISOString(), used_audio: null };
      if (target.kind === "scene") {
        const hadFinal = updated.final_video_path !== null;
        updated = { ...updated, final_video_path: null };
        if (hadFinal && updated.workflow_state === WorkflowState.Completed) {
          updated = { ...updated, workflow_state: WorkflowState.VideosApproved };
        }
      } else {
        updated = { ...updated, final_video_path: FINAL_VIDEO_PATH };
      }
      try { await this.projects.save(updated); } catch { throw videoLibraryStorageError(); }
      return { project: toApiProject(updated) };
    });
  }
}
