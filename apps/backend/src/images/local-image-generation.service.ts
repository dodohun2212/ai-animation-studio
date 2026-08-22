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
import { imageGenerationFailed, imageGenerationNotAllowed, imageStorageError, invalidImageRequest, mappingReviewRequired } from "./image-api.error.js";

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
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await this.writeImage(destination, PNG);
        if (!await validPng(destination)) throw new Error("invalid png");
        current = {
          ...current,
          image_prompts: [...current.image_prompts.slice(0, number - 1), sceneValue(current.scenes[number - 1], "description")],
          motion_prompts: [...current.motion_prompts.slice(0, number - 1), sceneValue(current.scenes[number - 1], "main_motion")],
          generated_images: [...current.generated_images.slice(0, number - 1), destination],
          image_generation_records: [...current.image_generation_records.slice(0, number - 1), { scene_number: number, prompt: sceneValue(current.scenes[number - 1], "description"), checkpoint: "completed", adapter: "local-fake-image-adapter", image_api_calls: 0 }],
          updated_at: new Date().toISOString(),
        };
        await this.projects.save(current);
        generated.push(number);
      }
      if (current.generated_images.length !== 6 || !(await Promise.all(SCENES.map((number) => validPng(this.imagePath(current.project_id, number))))).every(Boolean)) throw new Error("incomplete");
      current = { ...current, workflow_state: WorkflowState.ImagesReady, updated_at: new Date().toISOString() };
      await this.projects.save(current);
      current = { ...current, workflow_state: WorkflowState.ImagesReview, updated_at: new Date().toISOString() };
      await this.projects.save(current);
    } catch (error) {
      const recoverable = { ...current, workflow_state: WorkflowState.AssetMappingApproved, updated_at: new Date().toISOString() };
      await this.projects.save(recoverable).catch(() => undefined);
      if (error instanceof Error && error.message === "invalid png") throw imageGenerationFailed();
      if (error instanceof Error && error.message === "incomplete") throw imageGenerationFailed();
      throw imageStorageError();
    }
    return { project: toApiProject(current), generatedSceneNumbers: generated, reusedSceneNumbers: reused };
  }
}
