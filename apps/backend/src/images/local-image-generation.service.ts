import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { WorkflowState, type SceneNumber, type StartImageGenerationResponse } from "@ai-animation-studio/shared";
import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { LocalProjectAssetMappingsRepository, scriptFingerprint } from "../mappings/mappings.repository.js";
import { validateImage } from "../assets/image-validation.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { IMAGE_ESTIMATED_COST_USD, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OpenAiAdapterError } from "../providers/openai-common.js";
import { OPENAI_IMAGE_MODEL, callOpenAiImageApi, callOpenAiImageEditApi } from "./openai-image-adapter.js";
import { collectReferenceImages } from "./image-reference-selection.js";
import { previousSceneContinuityImagePath } from "../projects/project-continuity.js";
import { imageBudgetExceeded, imageGenerationFailed, imageGenerationNotAllowed, imageProviderError, imageStorageError, invalidImageRequest, mappingReviewRequired } from "./image-api.error.js";

const SCENES = [1, 2, 3, 4, 5, 6] as const;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export type WriteImage = (file: string, bytes: Buffer) => Promise<void>;

async function atomicWriteImage(file: string, bytes: Buffer): Promise<void> {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`);
  let renamed = false;
  try {
    await fs.writeFile(temporary, bytes);
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { await fs.rename(temporary, file); renamed = true; return; }
      catch (error) {
        const code = isObject(error) && typeof error.code === "string" ? error.code : "";
        if (!new Set(["EPERM", "EBUSY", "EACCES"]).has(code) || attempt === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, attempt * 25));
      }
    }
  } finally { if (!renamed) await fs.unlink(temporary).catch(() => undefined); }
}

async function validPng(file: string): Promise<boolean> {
  try {
    const bytes = await fs.readFile(file);
    return validateImage(bytes, "scene.png", "image/png").extension === ".png";
  } catch { return false; }
}

function sceneValue(scene: unknown, key: string): string {
  return isObject(scene) && typeof scene[key] === "string" ? scene[key].trim() : "";
}

function assertSixScenes(project: StoredProject): void {
  if (project.scenes.length !== 6 || project.scenes.some((scene, index) => !isObject(scene) || scene.number !== index + 1 || !sceneValue(scene, "description"))) {
    throw imageGenerationFailed();
  }
}

@Injectable()
export class LocalImageGenerationService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly mappings: LocalProjectAssetMappingsRepository,
    private readonly projectsRoot: string,
    private readonly writeImage: WriteImage = atomicWriteImage,
    private readonly assets: LocalAssetsRepository = new LocalAssetsRepository(path.dirname(projectsRoot)),
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: OpenAiBudget,
  ) {}

  private imagePath(projectId: string, scene: SceneNumber): string {
    return path.join(this.projectsRoot, projectId, "images", `scene${scene}.png`);
  }

  private async approvedMapping(project: StoredProject): Promise<void> {
    const review = await this.mappings.loadReview(project.project_id);
    if (review.status !== "approved" || review.script_revision !== project.script_revision || review.script_fingerprint !== scriptFingerprint(project.scenes)) {
      throw mappingReviewRequired();
    }
  }

  async generate(projectId: string, body: unknown): Promise<StartImageGenerationResponse> {
    if (!isObject(body) || Object.keys(body).length !== 1 || body.approved !== true) throw invalidImageRequest();
    const project = await this.projects.findById(projectId.trim());
    if (project.workflow_state !== WorkflowState.AssetMappingApproved) throw imageGenerationNotAllowed();
    assertSixScenes(project);
    await this.approvedMapping(project);

    const startedAt = new Date().toISOString();
    let current: StoredProject = { ...project, workflow_state: WorkflowState.GeneratingImages, updated_at: startedAt };
    try { await this.projects.save(current); } catch { throw imageStorageError(); }

    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    const mappings = apiKey && this.budget ? await this.mappings.load(current.project_id) : [];
    const continuityImagePath = previousSceneContinuityImagePath(current);
    const generated: SceneNumber[] = [];
    const reused: SceneNumber[] = [];
    try {
      for (const number of SCENES) {
        const destination = this.imagePath(current.project_id, number);
        const existing = current.generated_images[number - 1];
        if (existing === destination && await validPng(destination)) {
          reused.push(number);
          continue;
        }
        const prompt = sceneValue(current.scenes[number - 1], "description");
        let bytes: Buffer = PNG;
        let adapter = "local-fake-image-adapter";
        let apiCalls = 0;
        if (apiKey && this.budget) {
          const references = await collectReferenceImages(this.assets, mappings, this.projectsRoot, current.project_id, number, continuityImagePath);
          await this.budget.preflight(IMAGE_ESTIMATED_COST_USD);
          let succeeded = false;
          try {
            const result = references.length > 0
              ? await callOpenAiImageEditApi(apiKey, prompt, references)
              : await callOpenAiImageApi(apiKey, prompt);
            bytes = result.bytes;
            succeeded = true;
          } finally {
            await this.budget.record(current.project_id, "image", succeeded, IMAGE_ESTIMATED_COST_USD);
          }
          adapter = references.length > 0 ? `${OPENAI_IMAGE_MODEL}:edit` : OPENAI_IMAGE_MODEL;
          apiCalls = 1;
        }
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await this.writeImage(destination, bytes);
        if (!await validPng(destination)) throw new Error("invalid png");
        current = {
          ...current,
          image_prompts: [...current.image_prompts.slice(0, number - 1), prompt],
          motion_prompts: [...current.motion_prompts.slice(0, number - 1), sceneValue(current.scenes[number - 1], "main_motion")],
          generated_images: [...current.generated_images.slice(0, number - 1), destination],
          image_generation_records: [...current.image_generation_records.slice(0, number - 1), { scene_number: number, prompt, checkpoint: "completed", adapter, image_api_calls: apiCalls }],
          updated_at: new Date().toISOString(),
        };
        await this.projects.save(current);
        generated.push(number);
      }
      if (current.generated_images.length !== 6 || !(await Promise.all(SCENES.map((number) => validPng(this.imagePath(current.project_id, number))))).every(Boolean)) throw new Error("incomplete");
      await this.assets.indexGeneratedProjectImages(
        current.project_id,
        current.topic,
        current.scenes.map((scene) => sceneValue(scene, "description")),
      );
      current = { ...current, workflow_state: WorkflowState.ImagesReady, updated_at: new Date().toISOString() };
      await this.projects.save(current);
      current = { ...current, workflow_state: WorkflowState.ImagesReview, updated_at: new Date().toISOString() };
      await this.projects.save(current);
    } catch (error) {
      const recoverable = { ...current, workflow_state: WorkflowState.AssetMappingApproved, updated_at: new Date().toISOString() };
      await this.projects.save(recoverable).catch(() => undefined);
      if (error instanceof OpenAiBudgetExceededError) throw imageBudgetExceeded(error.message);
      if (error instanceof OpenAiAdapterError) throw imageProviderError(error.category, error.message);
      if (error instanceof Error && error.message === "invalid png") throw imageGenerationFailed();
      if (error instanceof Error && error.message === "incomplete") throw imageGenerationFailed();
      throw imageStorageError();
    }
    return { project: toApiProject(current), generatedSceneNumbers: generated, reusedSceneNumbers: reused };
  }
}
