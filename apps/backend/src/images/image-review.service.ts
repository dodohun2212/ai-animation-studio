import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { Injectable } from "@nestjs/common";
import {
  MAX_SCENE_COUNT,
  sceneNumbersFor,
  WorkflowState,
  type ApproveImageReviewResponse,
  type GetImageReviewResponse,
  type ImageReview,
  type RegenerateImageReviewResponse,
  type SceneNumber,
} from "@ai-animation-studio/shared";

import { validateImage } from "../assets/image-validation.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { IMAGE_ESTIMATED_COST_USD, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OpenAiAdapterError } from "../providers/openai-common.js";
import { OPENAI_IMAGE_MODEL, callOpenAiImageApi, callOpenAiImageEditApi } from "./openai-image-adapter.js";
import { collectReferenceImages } from "./image-reference-selection.js";
import { previousSceneContinuityImagePath } from "../projects/project-continuity.js";
import {
  imageReviewBudgetExceeded,
  imageReviewDataInvalid,
  imageReviewImageInvalid,
  imageReviewNotAllowed,
  imageReviewProviderError,
  imageReviewStorageError,
  invalidImageReviewRequest,
} from "./image-review-api.error.js";

const LOCAL_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}

interface StoredImageReview {
  scene_number: SceneNumber;
  image_path: string;
  status: "pending" | "approved" | "excluded";
  regeneration_count: number;
  history: Array<Record<string, unknown>>;
  updated_at: string;
}

function sceneNumber(value: unknown): SceneNumber | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= MAX_SCENE_COUNT
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

function toApiReviews(reviews: StoredImageReview[], timestamp: string, sceneNumbers: readonly SceneNumber[]): ImageReview[] {
  const byScene = new Map(reviews.map((review) => [review.scene_number, review]));
  return sceneNumbers.map((number) => {
    const review = byScene.get(number);
    return { sceneNumber: number, status: review?.status === "approved" ? "approved" : "pending", updatedAt: review?.updated_at || timestamp };
  });
}

function sceneValue(scene: unknown, key: string): string {
  return isObject(scene) && typeof (scene as Record<string, unknown>)[key] === "string" ? ((scene as Record<string, unknown>)[key] as string).trim() : "";
}

@Injectable()
export class ImageReviewService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly projectsRoot: string,
    private readonly assets: LocalAssetsRepository = new LocalAssetsRepository(path.dirname(projectsRoot)),
    private readonly mappings: LocalProjectAssetMappingsRepository = new LocalProjectAssetMappingsRepository(projectsRoot),
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: OpenAiBudget,
  ) {}

  private reviewFile(projectId: string): string {
    return path.join(this.projectsRoot, projectId, "generated_image_reviews.json");
  }

  private imagePath(projectId: string, number: SceneNumber): string {
    return path.join(this.projectsRoot, projectId, "images", `scene${number}.png`);
  }

  private async writeBinary(finalPath: string, bytes: Buffer): Promise<void> {
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

  // `generated_images` is never dereferenced for file I/O here or in regenerate() below — both
  // always read/write through `imagePath()`, this machine's current canonical location. Stored
  // entries from an older version or a moved/relocated project folder keep a stale absolute path
  // (a different machine's drive letter, or an even older per-scene archive layout), so they are
  // not trustworthy as literal paths; only the array length is used, as a completeness signal.
  private async assertReviewable(project: StoredProject, allowVideoConfirmation = false): Promise<void> {
    if (project.workflow_state !== WorkflowState.ImagesReview
      && (!allowVideoConfirmation || project.workflow_state !== WorkflowState.WaitingForVideoConfirmation)) throw imageReviewNotAllowed();
    const scenes = scenesFor(project);
    if (project.generated_images.length !== scenes.length) throw imageReviewImageInvalid();
    for (const number of scenes) {
      try {
        const bytes = await fs.readFile(this.imagePath(project.project_id, number));
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
    return { project: toApiProject(project), reviews: toApiReviews(reviews, project.updated_at, scenesFor(project)) };
  }

  async approve(projectId: string, rawSceneNumber: string, body: unknown): Promise<ApproveImageReviewResponse> {
    if (!isObject(body) || Object.keys(body).length !== 1 || body.approved !== true) throw invalidImageReviewRequest();
    const number = sceneNumber(Number(rawSceneNumber));
    if (!number || String(number) !== rawSceneNumber) throw invalidImageReviewRequest();
    const project = await this.projects.findById(projectId.trim());
    await this.assertReviewable(project);
    const scenes = scenesFor(project);
    if (!scenes.includes(number)) throw invalidImageReviewRequest();
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

    const allApproved = scenes.every((scene) => reviews.some((item) => item.scene_number === scene && item.status === "approved"));
    try { await this.assets.approveGeneratedProjectImage(project.project_id, number, allApproved); }
    catch { throw imageReviewStorageError(); }
    const updated = allApproved
      ? { ...project, workflow_state: WorkflowState.WaitingForVideoConfirmation, updated_at: timestamp }
      : { ...project, updated_at: timestamp };
    try { await this.projects.save(updated); } catch { throw imageReviewStorageError(); }
    return { project: toApiProject(updated), reviews: toApiReviews(reviews, timestamp, scenes) };
  }

  async regenerate(projectId: string, rawSceneNumber: string, body: unknown): Promise<RegenerateImageReviewResponse> {
    if (!isObject(body) || Object.keys(body).length !== 1 || body.approved !== true) throw invalidImageReviewRequest();
    const number = sceneNumber(Number(rawSceneNumber));
    if (!number || String(number) !== rawSceneNumber) throw invalidImageReviewRequest();
    const project = await this.projects.findById(projectId.trim());
    await this.assertReviewable(project, true);
    if (!scenesFor(project).includes(number)) throw invalidImageReviewRequest();
    // Parse persisted review state before changing image bytes. A damaged JSON
    // file is a read error, never a reason to replace an otherwise valid image.
    const reviews = await this.load(project.project_id);
    const currentPath = this.imagePath(project.project_id, number);
    let previous: Buffer;
    try { previous = await fs.readFile(currentPath); validateImage(previous, "scene.png", "image/png"); }
    catch { throw imageReviewImageInvalid(); }

    // Resolve the real-vs-fake regenerated bytes BEFORE touching any file: a failed real request must never
    // archive or overwrite the still-valid current image.
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    let regenerated: Buffer = LOCAL_PNG;
    let adapter = "local-fake-image-adapter";
    let apiCalls = 0;
    if (apiKey && this.budget) {
      const prompt = sceneValue(project.scenes[number - 1], "description");
      const mappings = await this.mappings.load(project.project_id);
      const continuityImagePath = previousSceneContinuityImagePath(project);
      const references = await collectReferenceImages(this.assets, mappings, this.projectsRoot, project.project_id, number, continuityImagePath);
      try {
        await this.budget.preflight(IMAGE_ESTIMATED_COST_USD);
        let succeeded = false;
        try {
          const result = references.length > 0
            ? await callOpenAiImageEditApi(apiKey, prompt, references)
            : await callOpenAiImageApi(apiKey, prompt);
          regenerated = result.bytes;
          succeeded = true;
        } finally {
          await this.budget.record(project.project_id, "image", succeeded, IMAGE_ESTIMATED_COST_USD);
        }
      } catch (error) {
        if (error instanceof OpenAiBudgetExceededError) throw imageReviewBudgetExceeded(error.message);
        if (error instanceof OpenAiAdapterError) throw imageReviewProviderError(error.category, error.message);
        throw error;
      }
      adapter = references.length > 0 ? `${OPENAI_IMAGE_MODEL}:edit` : OPENAI_IMAGE_MODEL;
      apiCalls = 1;
    }

    const originals = path.join(path.dirname(currentPath), "originals");
    let archive: string | undefined;
    try {
      await fs.mkdir(originals, { recursive: true });
      const entries = await fs.readdir(originals);
      const revisions = entries
        .map((name) => new RegExp(`^scene${number}_v(\\d{3})\\.png$`).exec(name))
        .filter((match): match is RegExpExecArray => match !== null)
        .map((match) => Number(match[1]));
      archive = path.join(originals, `scene${number}_v${String((revisions.length ? Math.max(...revisions) : 0) + 1).padStart(3, "0")}.png`);
      await this.writeBinary(archive, previous);
      await this.writeBinary(currentPath, regenerated);
      validateImage(await fs.readFile(currentPath), "scene.png", "image/png");
    } catch {
      if (archive) await fs.unlink(archive).catch(() => undefined);
      throw imageReviewStorageError();
    }

    const timestamp = new Date().toISOString();
    const index = reviews.findIndex((item) => item.scene_number === number);
    const prior = index < 0
      ? { scene_number: number, image_path: currentPath, status: "pending" as const, regeneration_count: 0, history: [], updated_at: timestamp }
      : reviews[index]!;
    const replacement: StoredImageReview = {
      ...prior,
      image_path: currentPath,
      status: "pending",
      regeneration_count: prior.regeneration_count + 1,
      history: [...prior.history, { event: "pending", timestamp }, { event: "regenerated", timestamp }],
      updated_at: timestamp,
    };
    if (index < 0) reviews.push(replacement); else reviews[index] = replacement;
    const record = {
      scene_number: number,
      prompt: project.image_prompts[number - 1] ?? "",
      checkpoint: "completed",
      adapter,
      image_api_calls: apiCalls,
      regenerated: true,
      archived_previous_path: archive,
    };
    const records = [...project.image_generation_records];
    records[number - 1] = record;
    const updated: StoredProject = {
      ...project,
      image_generation_records: records,
      workflow_state: WorkflowState.ImagesReview,
      updated_at: timestamp,
    };
    try {
      await this.assets.replaceGeneratedProjectSceneImage(project.project_id, number, currentPath, archive!);
      await atomicWriteUtf8File(this.reviewFile(project.project_id), JSON.stringify(reviews, null, 2));
      await this.projects.save(updated);
    } catch { throw imageReviewStorageError(); }
    return { project: toApiProject(updated), reviews: toApiReviews(reviews, timestamp, scenesFor(updated)), sceneNumber: number };
  }
}
