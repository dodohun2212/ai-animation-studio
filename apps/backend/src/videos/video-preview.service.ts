import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { sceneNumbersFor, WorkflowState, type GetVideoPromptPreviewResponse, type SceneNumber, type VideoPromptPreview } from "@ai-animation-studio/shared";

import { validateImage } from "../assets/image-validation.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import {
  invalidVideoPreviewRequest,
  videoPreviewDataInvalid,
  videoPreviewImagesInvalid,
  videoPreviewNotAllowed,
} from "./video-preview-api.error.js";

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}
const SCENE_FIELDS = [
  "number", "description", "visual_action", "start_motion", "main_motion", "end_motion",
  "shot_size", "camera_angle", "composition", "lens_feel", "focus_subject", "camera_motion",
  "environment_motion", "motion_speed", "motion_intensity", "expression_change", "continuity_hint",
] as const;
const UTF16_PROMPT_LIMIT = 1_000;
const ESTIMATED_REQUEST_COST_USD = 1.5;
const LOCAL_MONTHLY_BUDGET_USD = 10;

type StoredScene = Record<(typeof SCENE_FIELDS)[number], string | number>;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Equivalent to JavaScript's UTF-16 code-unit count used by the Python UI. */
export function utf16Length(value: string): number {
  return value.length;
}

function parseScenes(project: StoredProject, sceneNumbers: readonly SceneNumber[]): StoredScene[] {
  if (project.scenes.length !== sceneNumbers.length) throw videoPreviewDataInvalid();
  return project.scenes.map((raw, index) => {
    if (!isObject(raw) || Object.keys(raw).length !== SCENE_FIELDS.length
      || SCENE_FIELDS.some((key) => !(key in raw)) || raw.number !== sceneNumbers[index]
      || SCENE_FIELDS.filter((key) => key !== "number").some((key) => typeof raw[key] !== "string" || !raw[key].trim())) {
      throw videoPreviewDataInvalid();
    }
    return raw as StoredScene;
  });
}

function ratioFor(project: StoredProject): "720:1280" | "1280:720" {
  const aspect = typeof project.style_profile.aspect === "string"
    ? project.style_profile.aspect.replaceAll(" ", "")
    : "";
  return aspect === "16:9" ? "1280:720" : "720:1280";
}

function promptFor(scene: StoredScene, previous: StoredScene | undefined, ratio: "720:1280" | "1280:720", clipDurationSeconds: number): string {
  const orientation = ratio === "1280:720" ? "horizontal" : "vertical";
  const continuity = previous
    ? [previous.end_motion, previous.continuity_hint].filter((value, index, values) => values.indexOf(value) === index).join(" ")
    : "";
  const sections: Array<[string, string]> = [
    ["Continuity cue", continuity],
    ["Opening movement", String(scene.start_motion)],
    ["Main action", String(scene.main_motion)],
    ["Performance", String(scene.expression_change)],
    ["Ending movement", String(scene.end_motion)],
    ["Motivated camera", String(scene.camera_motion)],
    ["Environment", String(scene.environment_motion)],
    ["Pacing", `motion speed ${scene.motion_speed}; intensity ${scene.motion_intensity}`],
  ];
  const prefix = `Create one continuous cinematic ${clipDurationSeconds}-second ${orientation} image-to-video shot from the supplied exact first frame.`;
  const suffix = "Maintain stable identity, anatomy, clothing, essential objects, lighting and scene continuity throughout the shot.";
  const render = (included: readonly [string, string][]) => [prefix, ...included.map(([label, value]) => `${label}: ${value}`), suffix].join("\n");
  let included = [...sections];
  const removable = ["Pacing", "Environment", "Performance", "Continuity cue"];
  while (utf16Length(render(included)) > UTF16_PROMPT_LIMIT && removable.length > 0) {
    const label = removable.shift();
    included = included.filter(([candidate]) => candidate !== label);
  }
  const prompt = render(included);
  if (utf16Length(prompt) > UTF16_PROMPT_LIMIT) throw videoPreviewDataInvalid();
  return prompt;
}

@Injectable()
export class LocalVideoPreviewService {
  constructor(private readonly projects: LocalProjectRepository, private readonly projectsRoot: string) {}

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
    await this.assertApprovedImages(project, sceneNumbers);
    const scenes = parseScenes(project, sceneNumbers);
    const ratio = ratioFor(project);
    const previews: VideoPromptPreview[] = scenes.map((scene, index) => ({
      sceneNumber: sceneNumbers[index]!,
      prompt: promptFor(scene, scenes[index - 1], ratio, clipDurationSeconds),
      model: "gen4_turbo",
      ratio,
      durationSeconds: clipDurationSeconds,
      estimatedCostUsd: 0.25,
    }));
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
    return {
      previews,
      confirmationId: digest.digest("hex"),
      maximumProviderCalls: sceneNumbers.length,
      budget: {
        monthlyLimitUsd: LOCAL_MONTHLY_BUDGET_USD,
        spentUsd: 0,
        remainingUsd: LOCAL_MONTHLY_BUDGET_USD,
        estimatedRequestCostUsd: ESTIMATED_REQUEST_COST_USD,
        canSpend: ESTIMATED_REQUEST_COST_USD <= LOCAL_MONTHLY_BUDGET_USD,
      },
    };
  }
}
