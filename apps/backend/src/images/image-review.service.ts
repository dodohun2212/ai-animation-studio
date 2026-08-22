import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import {
  WorkflowState,
  type ApproveImageReviewResponse,
  type GetImageReviewResponse,
  type ImageReview,
  type SceneNumber,
} from "@ai-animation-studio/shared";

import { validateImage } from "../assets/image-validation.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import {
  imageReviewDataInvalid,
  imageReviewImageInvalid,
  imageReviewNotAllowed,
  imageReviewStorageError,
  invalidImageReviewRequest,
} from "./image-review-api.error.js";

const SCENES = [1, 2, 3, 4, 5, 6] as const;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

interface StoredImageReview {
  scene_number: SceneNumber;
  image_path: string;
  status: "pending" | "approved" | "excluded";
  regeneration_count: number;
  history: Array<Record<string, unknown>>;
  updated_at: string;
}

function sceneNumber(value: unknown): SceneNumber | null {
  return typeof value === "number" && Number.isInteger(value) && SCENES.includes(value as SceneNumber)
    ? value as SceneNumber : null;
}

function parseReviews(raw: unknown): StoredImageReview[] {
  if (!Array.isArray(raw)) throw imageReviewDataInvalid();
  const parsed = raw.map((item) => {
    if (!isObject(item) || Object.keys(item).some((key) => !new Set([
      "scene_number", "image_path", "status", "regeneration_count", "history", "updated_at",
    ]).has(key))) throw imageReviewDataInvalid();
    const number = sceneNumber(item.scene_number);
    if (!number || typeof item.image_path !== "string" || !["pending", "approved", "excluded"].includes(String(item.status))
      || (item.regeneration_count !== undefined && (typeof item.regeneration_count !== "number" || !Number.isInteger(item.regeneration_count) || item.regeneration_count < 0))
      || (item.history !== undefined && (!Array.isArray(item.history) || !item.history.every(isObject)))
      || (item.updated_at !== undefined && typeof item.updated_at !== "string")) throw imageReviewDataInvalid();
    return {
      scene_number: number,
      image_path: item.image_path,
      status: item.status as StoredImageReview["status"],
      regeneration_count: (item.regeneration_count as number | undefined) ?? 0,
      history: (item.history as Array<Record<string, unknown>> | undefined) ?? [],
      updated_at: (item.updated_at as string | undefined) ?? "",
    };
  });
  if (new Set(parsed.map((item) => item.scene_number)).size !== parsed.length) throw imageReviewDataInvalid();
  return parsed;
}

function toApiReviews(reviews: StoredImageReview[], timestamp: string): ImageReview[] {
  const byScene = new Map(reviews.map((review) => [review.scene_number, review]));
  return SCENES.map((number) => {
    const review = byScene.get(number);
    return { sceneNumber: number, status: review?.status === "approved" ? "approved" : "pending", updatedAt: review?.updated_at || timestamp };
  });
}

@Injectable()
export class ImageReviewService {
  constructor(private readonly projects: LocalProjectRepository, private readonly projectsRoot: string) {}

  private reviewFile(projectId: string): string {
    return path.join(this.projectsRoot, projectId, "generated_image_reviews.json");
  }

  private async load(projectId: string): Promise<StoredImageReview[]> {
    try {
      const raw = await fs.readFile(this.reviewFile(projectId), "utf8");
      try { return parseReviews(JSON.parse(raw)); } catch (error) {
        if (error instanceof Error && "response" in error) throw error;
        throw imageReviewDataInvalid();
      }
    } catch (error) {
      if (isObject(error) && error.code === "ENOENT") return [];
      if (error instanceof Error && "response" in error) throw error;
      throw imageReviewStorageError();
    }
  }

  private async assertReviewable(project: StoredProject): Promise<void> {
    if (project.workflow_state !== WorkflowState.ImagesReview) throw imageReviewNotAllowed();
    if (project.generated_images.length !== 6) throw imageReviewImageInvalid();
    for (const file of project.generated_images) {
      try {
        const bytes = await fs.readFile(file);
        if (validateImage(bytes, "scene.png", "image/png").extension !== ".png") throw imageReviewImageInvalid();
      } catch (error) {
        if (error instanceof Error && "response" in error) throw error;
        throw imageReviewImageInvalid();
      }
    }
  }

  async getStatus(projectId: string): Promise<GetImageReviewResponse> {
    const project = await this.projects.findById(projectId.trim());
    await this.assertReviewable(project);
    const reviews = await this.load(project.project_id);
    return { project: toApiProject(project), reviews: toApiReviews(reviews, project.updated_at) };
  }

  async approve(projectId: string, rawSceneNumber: string, body: unknown): Promise<ApproveImageReviewResponse> {
    if (!isObject(body) || Object.keys(body).length !== 1 || body.approved !== true) throw invalidImageReviewRequest();
    const number = sceneNumber(Number(rawSceneNumber));
    if (!number || String(number) !== rawSceneNumber) throw invalidImageReviewRequest();
    const project = await this.projects.findById(projectId.trim());
    await this.assertReviewable(project);
    const reviews = await this.load(project.project_id);
    const timestamp = new Date().toISOString();
    const index = reviews.findIndex((item) => item.scene_number === number);
    const review: StoredImageReview = index < 0
      ? { scene_number: number, image_path: project.generated_images[number - 1]!, status: "approved", regeneration_count: 0, history: [{ event: "approved", timestamp }], updated_at: timestamp }
      : { ...reviews[index]!, image_path: project.generated_images[number - 1]!, status: "approved", history: [...reviews[index]!.history, { event: "approved", timestamp }], updated_at: timestamp };
    if (index < 0) reviews.push(review); else reviews[index] = review;
    try {
      await fs.mkdir(path.dirname(this.reviewFile(project.project_id)), { recursive: true });
      await atomicWriteUtf8File(this.reviewFile(project.project_id), JSON.stringify(reviews, null, 2));
    } catch { throw imageReviewStorageError(); }

    const allApproved = SCENES.every((scene) => reviews.some((item) => item.scene_number === scene && item.status === "approved"));
    const updated = allApproved
      ? { ...project, workflow_state: WorkflowState.WaitingForVideoConfirmation, updated_at: timestamp }
      : { ...project, updated_at: timestamp };
    try { await this.projects.save(updated); } catch { throw imageReviewStorageError(); }
    return { project: toApiProject(updated), reviews: toApiReviews(reviews, timestamp) };
  }
}
