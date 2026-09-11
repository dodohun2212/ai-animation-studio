import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { sceneNumbersFor, videoSceneEstimatedCostUsd, WorkflowState, type GetVideoPromptPreviewResponse, type SceneNumber, type VideoPromptPreview } from "@ai-animation-studio/shared";

import { validateImage } from "../assets/image-validation.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { resolveVideoModel } from "./runway-video-adapter.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import {
  invalidVideoPreviewRequest,
  videoPreviewDataInvalid,
  videoPreviewImagesInvalid,
  videoPreviewNotAllowed,
} from "./video-preview-api.error.js";
import { runwayRatioForAspect } from "../projects/project-aspect.js";
import { compileVideoPrompt, OPTIONAL_SCENE_FIELDS, SCENE_FIELDS, type StoredScene } from "./video-prompt-compiler.js";

/**
 * The prompt grammar moved to video-prompt-compiler.ts so that one file answers "what text does this model
 * get", and these names are re-exported rather than relocated at every call site: the six modules importing
 * them from here were importing the right thing, just from the file it used to live in.
 */
export { SCENE_FIELDS, STABILITY_RULE, compileVideoPrompt, describesSameScene, promptFor, utf16Length, videoPromptDrift } from "./video-prompt-compiler.js";
export type { StoredScene, VideoPromptDrift, VideoPromptInput, VideoPromptResult } from "./video-prompt-compiler.js";

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}


function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}


function parseScenes(project: StoredProject, sceneNumbers: readonly SceneNumber[]): StoredScene[] {
  if (project.scenes.length !== sceneNumbers.length) throw videoPreviewDataInvalid();
  return project.scenes.map((raw, index) => {
    const keys = Object.keys(raw as object);
    if (!isObject(raw)
      || keys.some((key) => !(SCENE_FIELDS as readonly string[]).includes(key) && !(OPTIONAL_SCENE_FIELDS as readonly string[]).includes(key))
      || SCENE_FIELDS.some((key) => !(key in raw)) || raw.number !== sceneNumbers[index]
      || SCENE_FIELDS.filter((key) => key !== "number").some((key) => typeof raw[key] !== "string" || !raw[key].trim())
      || ("narration" in raw && typeof raw.narration !== "string")) {
      throw videoPreviewDataInvalid();
    }
    return raw as StoredScene;
  });
}

/** See project-aspect.ts — this used to read a field nothing writes, so every project rendered portrait. */
export const ratioFor = runwayRatioForAspect;






@Injectable()
export class LocalVideoPreviewService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly projectsRoot: string,
    private readonly budget: RunwayBudget,
    /** Only for the chosen video model, which decides what a scene is quoted at. */
    private readonly providerSettings?: ProviderSettingsService,
  ) {}

  private imagePath(projectId: string, scene: SceneNumber): string {
    return path.join(this.projectsRoot, projectId, "images", `scene${scene}.png`);
  }

  private async assertApprovedImages(project: StoredProject, sceneNumbers: readonly SceneNumber[]): Promise<void> {
    if (project.workflow_state !== WorkflowState.WaitingForVideoConfirmation) throw videoPreviewNotAllowed();
    if (project.generated_images.length !== sceneNumbers.length) throw videoPreviewImagesInvalid();
    for (const scene of sceneNumbers) {
      const expected = this.imagePath(project.project_id, scene);
      if (project.generated_images[scene - 1] !== expected) throw videoPreviewImagesInvalid();
      try {
        const bytes = await fs.readFile(expected);
        if (validateImage(bytes, "scene.png", "image/png").extension !== ".png") throw videoPreviewImagesInvalid();
      } catch (error) {
        if (error instanceof Error && "response" in error) throw error;
        throw videoPreviewImagesInvalid();
      }
    }
  }

  async preview(projectId: string, body: unknown): Promise<GetVideoPromptPreviewResponse> {
    if (body !== undefined && body !== null && (!isObject(body) || Object.keys(body).length !== 0)) throw invalidVideoPreviewRequest();
    const project = await this.projects.findById(projectId.trim());
    const sceneNumbers = scenesFor(project);
    const clipDurationSeconds = toShortProjectSettings(project).clipDurationSeconds;
    const model = await resolveVideoModel(this.providerSettings?.settingsStore());
    await this.assertApprovedImages(project, sceneNumbers);
    const scenes = parseScenes(project, sceneNumbers);
    const ratio = ratioFor(project);
    const previews: VideoPromptPreview[] = scenes.map((scene, index) => {
      // The model is already in hand here for the quote; the prompt is compiled for that same model rather
      // than for whichever one this file was written against.
      const { prompt, omittedSections } = compileVideoPrompt(model, { scene, previous: scenes[index - 1], ratio, clipDurationSeconds });
      return {
        sceneNumber: sceneNumbers[index]!,
        prompt,
        model,
        ratio,
        durationSeconds: clipDurationSeconds,
        estimatedCostUsd: videoSceneEstimatedCostUsd(clipDurationSeconds, model),
        ...(omittedSections.length > 0 ? { omittedSections } : {}),
      };
    });
    // This is an opaque, deterministic snapshot of the reviewed images and
    // preflight settings. It is deliberately not persisted: generating a
    // preview must remain provider-free and side-effect-free.
    const digest = createHash("sha256");
    digest.update(project.project_id, "utf8");
    for (const preview of previews) {
      digest.update(await fs.readFile(this.imagePath(project.project_id, preview.sceneNumber)));
      digest.update(preview.prompt, "utf8");
      digest.update(preview.model, "ascii");
      digest.update(preview.ratio, "ascii");
      digest.update(String(preview.durationSeconds), "ascii");
    }
    const estimatedRequestCostUsd = previews.reduce((sum, preview) => sum + preview.estimatedCostUsd, 0);
    // Read-only: previewing never reserves or records budget, it only reports the ledger's current state.
    const [monthlyLimitUsd, spentUsd, remainingUsd] = await Promise.all([this.budget.monthlyLimit(), this.budget.spentThisMonth(), this.budget.remaining()]);
    return {
      previews,
      confirmationId: digest.digest("hex"),
      maximumProviderCalls: sceneNumbers.length,
      budget: {
        monthlyLimitUsd,
        spentUsd,
        remainingUsd,
        estimatedRequestCostUsd,
        canSpend: estimatedRequestCostUsd <= remainingUsd,
      },
    };
  }
}
