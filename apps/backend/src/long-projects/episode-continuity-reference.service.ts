import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import type { GetLongEpisodeContinuityReferenceResponse, LongEpisodeContinuityReference, LongEpisodeStatus, SceneNumber } from "@ai-animation-studio/shared";
import { validateImage } from "../assets/image-validation.js";
import { isSafeProjectId, resolveSafeProjectDirectory } from "../projects/project-id.js";
import { longEpisodeNotFound, longInvalidData, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";

const SCENES = [1, 2, 3, 4, 5, 6] as const;
const COMPLETED_IMAGE_STATES: readonly LongEpisodeStatus[] = ["waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted"];
type ObjectMap = Record<string, unknown>;
const object = (value: unknown): value is ObjectMap => Boolean(value) && typeof value === "object" && !Array.isArray(value);

@Injectable()
export class EpisodeContinuityReferenceService {
  constructor(private readonly projectsRoot: string) {}

  private files(projectId: string, number: number) {
    if (!isSafeProjectId(projectId)) throw longUnsafeId();
    const root = path.resolve(resolveSafeProjectDirectory(this.projectsRoot, projectId), "long_story");
    const episode = path.resolve(root, `Episode${String(number).padStart(2, "0")}`);
    if (path.relative(root, episode).startsWith("..") || path.isAbsolute(path.relative(root, episode))) throw longUnsafeId();
    return { root, outlines: path.join(root, "episode_outlines.json"), episode, project: path.join(episode, "project.json"), reviews: path.join(episode, "generated_image_reviews.json"), sceneSix: path.join(episode, "images", "scene6.png") };
  }
  private async json(file: string): Promise<unknown> {
    try { return JSON.parse(await fs.readFile(file, "utf8")); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); }
  }
  private async assertEpisode(projectId: string, number: number): Promise<void> {
    if (!Number.isInteger(number) || number < 1) throw longEpisodeNotFound();
    const files = this.files(projectId, number); const outlines = await this.json(files.outlines);
    if (!Array.isArray(outlines) || number > outlines.length || !object(outlines[number - 1]) || outlines[number - 1].episode_number !== number) throw longEpisodeNotFound();
  }
  private async previousIsUsable(projectId: string, number: number): Promise<boolean> {
    if (number <= 1) return false;
    try {
      await this.assertEpisode(projectId, number - 1);
      const files = this.files(projectId, number - 1); const project = await this.json(files.project);
      if (!object(project) || !COMPLETED_IMAGE_STATES.includes(project.state as LongEpisodeStatus)) return false;
      const reviews = await this.json(files.reviews);
      if (!Array.isArray(reviews) || !SCENES.every((scene) => reviews.some((review) => object(review) && review.scene_number === scene && review.status === "approved"))) return false;
      return validateImage(await fs.readFile(files.sceneSix), "scene6.png", "image/png").extension === ".png";
    } catch { return false; }
  }
  async get(projectId: string, number: number): Promise<GetLongEpisodeContinuityReferenceResponse> {
    const id = projectId.trim(); await this.assertEpisode(id, number);
    if (number === 1) return { reference: null };
    const reference: LongEpisodeContinuityReference = { previousEpisodeNumber: number - 1, sourceSceneNumber: 6 as SceneNumber & 6, available: await this.previousIsUsable(id, number) };
    return { reference };
  }
}
