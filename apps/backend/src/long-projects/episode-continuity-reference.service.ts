import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { sceneNumbersFor, type GetLongEpisodeContinuityReferenceResponse, type LongEpisodeContinuityReference, type LongEpisodeStatus } from "@ai-animation-studio/shared";
import { validateImage } from "../assets/image-validation.js";
import { longEpisodeNotFound, longInvalidData, longMalformed, longNotFound, longStorageError } from "./long-project-api.error.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";

const COMPLETED_IMAGE_STATES: readonly LongEpisodeStatus[] = ["waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted"];
type ObjectMap = Record<string, unknown>;
const object = (value: unknown): value is ObjectMap => Boolean(value) && typeof value === "object" && !Array.isArray(value);

@Injectable()
export class EpisodeContinuityReferenceService {
  constructor(private readonly projectsRoot: string) {}

  private files(projectId: string, number: number) {
    const root = longStoryRoot(this.projectsRoot, projectId);
    const episode = path.join(root, episodeDirectoryName(number));
    return { root, outlines: path.join(root, "episode_outlines.json"), episode, project: path.join(episode, "project.json"), reviews: path.join(episode, "generated_image_reviews.json"), images: path.join(episode, "images") };
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
  /** The previous Episode's own scene_count (falls back to 6 for episodes stored before that field existed, same as episode-scripts.service.ts's parseStored) and whether its final scene's image is usable as a continuity reference. */
  private async previousReference(projectId: string, number: number): Promise<{ sceneCount: number; available: boolean }> {
    let sceneCount = 6;
    try {
      await this.assertEpisode(projectId, number - 1);
      const files = this.files(projectId, number - 1); const project = await this.json(files.project);
      if (!object(project)) return { sceneCount, available: false };
      sceneCount = Number.isInteger(project.scene_count) ? (project.scene_count as number) : 6;
      if (!COMPLETED_IMAGE_STATES.includes(project.state as LongEpisodeStatus)) return { sceneCount, available: false };
      const reviews = await this.json(files.reviews);
      const scenes = sceneNumbersFor(sceneCount);
      if (!Array.isArray(reviews) || !scenes.every((scene) => reviews.some((review) => object(review) && review.scene_number === scene && review.status === "approved"))) return { sceneCount, available: false };
      const lastImage = path.join(files.images, `scene${sceneCount}.png`);
      const available = validateImage(await fs.readFile(lastImage), `scene${sceneCount}.png`, "image/png").extension === ".png";
      return { sceneCount, available };
    } catch { return { sceneCount, available: false }; }
  }
  async get(projectId: string, number: number): Promise<GetLongEpisodeContinuityReferenceResponse> {
    const id = projectId.trim(); await this.assertEpisode(id, number);
    if (number === 1) return { reference: null };
    const { sceneCount, available } = await this.previousReference(id, number);
    const reference: LongEpisodeContinuityReference = { previousEpisodeNumber: number - 1, sourceSceneNumber: sceneCount, available };
    return { reference };
  }
}
