import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import { sceneNumbersFor, type GeneratedEpisodeImageSummary, type GeneratedImageSummary, type GetGeneratedImagesResponse, type SceneNumber } from "@ai-animation-studio/shared";

import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import { episodeDirectoryName, longStoryRoot } from "../long-projects/long-project-paths.js";
import { isPlaceholderImage } from "./placeholder-image.js";

/**
 * Every scene image this app generated, in one list.
 *
 * Read-only, and read straight off disk. The files are not moved or copied: a stored project keeps absolute
 * paths to its own images, so relocating one would leave the project unable to find it with nothing on disk to
 * undo it by. This only enumerates what is already there, the way the video library does.
 *
 * Placeholders are left out rather than shown as broken rows. The local fake path writes a 1x1 PNG on purpose,
 * and this screen exists to help someone find a picture they remember — a white dot is not a picture anyone is
 * looking for. `isPlaceholderImage` lives beside the bytes so this is not a fourth opinion about them.
 */
@Injectable()
export class GeneratedImageLibraryService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly projectsRoot: string,
  ) {}

  /** A real generated image, or nothing — unreadable, missing and placeholder are all "not a row". */
  private async imageFacts(file: string): Promise<{ updatedAt: string; bytes: number } | undefined> {
    try {
      const stat = await fs.stat(file);
      if (!stat.isFile() || stat.size <= 0 || isPlaceholderImage(stat.size)) return undefined;
      return { updatedAt: stat.mtime.toISOString(), bytes: stat.size };
    } catch {
      return undefined;
    }
  }

  private async shortRows(): Promise<GeneratedImageSummary[]> {
    const stored = await this.projects.list();
    const rows: GeneratedImageSummary[] = [];
    for (const project of stored) {
      const scenes = sceneNumbersFor(toShortProjectSettings(project).sceneCount);
      for (const sceneNumber of scenes) {
        const facts = await this.imageFacts(path.join(this.projectsRoot, project.project_id, "images", `scene${sceneNumber}.png`));
        if (facts) rows.push({ projectId: project.project_id, projectTitle: project.topic || project.project_id, sceneNumber, ...facts });
      }
    }
    return rows;
  }

  private async episodeRows(): Promise<GeneratedEpisodeImageSummary[]> {
    let entries: string[];
    try { entries = (await fs.readdir(this.projectsRoot, { withFileTypes: true })).filter((item) => item.isDirectory()).map((item) => item.name); } catch { return []; }
    const rows: GeneratedEpisodeImageSummary[] = [];
    for (const projectId of entries) {
      let storyRoot: string;
      try { storyRoot = longStoryRoot(this.projectsRoot, projectId); } catch { continue; }
      const project = await readObject(path.join(storyRoot, "project.json"));
      if (!project) continue;
      const projectTitle = typeof project.title === "string" ? project.title : projectId;
      const outlines = await readArray(path.join(storyRoot, "episode_outlines.json"));
      for (let index = 0; index < outlines.length; index += 1) {
        const episodeNumber = index + 1;
        const directory = path.join(storyRoot, episodeDirectoryName(episodeNumber));
        const stored = await readObject(path.join(directory, "project.json"));
        if (!stored) continue;
        const sceneCount = Number.isInteger(stored.scene_count) ? stored.scene_count as number : 6;
        const episodeTitle = typeof stored.title === "string" ? stored.title : `${episodeNumber}화`;
        for (const sceneNumber of sceneNumbersFor(sceneCount)) {
          const facts = await this.imageFacts(path.join(directory, "images", `scene${sceneNumber}.png`));
          if (facts) rows.push({ projectId, projectTitle, episodeNumber, episodeTitle, sceneNumber: sceneNumber as SceneNumber, ...facts });
        }
      }
    }
    return rows;
  }

  /** Newest first in both lists — "the picture from a while ago" is usually not the oldest one on disk. */
  async list(): Promise<GetGeneratedImagesResponse> {
    const [projects, episodes] = await Promise.all([this.shortRows(), this.episodeRows()]);
    const byNewest = <T extends { updatedAt: string }>(rows: T[]): T[] =>
      rows.sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    return { projects: byNewest(projects), episodes: byNewest(episodes) };
  }
}

/** Unreadable is absent, on purpose: one broken story must not empty the whole listing. */
async function readObject(file: string): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

async function readArray(file: string): Promise<unknown[]> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
