import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";

import { Injectable } from "@nestjs/common";
import {
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  RUNWAY_PROMPT_MAX_LENGTH,
  sceneNumbersFor,
  WorkflowState,
  type SceneNumber,
  type StartVideoGenerationRequest,
  type StartVideoGenerationResponse,
} from "@ai-animation-studio/shared";

import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { LocalVideoPreviewService, utf16Length } from "./video-preview.service.js";
import {
  invalidVideoSubmission,
  videoBudgetExceeded,
  videoCallLimitExceeded,
  videoConfirmationStale,
  videoRequestIdConflict,
  videoSubmissionNotAllowed,
} from "./video-submission-api.error.js";

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}
const ESTIMATED_COST_USD = 1.5;
const DEFAULT_MONTHLY_BUDGET_USD = 10;

type VideoRecord = {
  scene_number: SceneNumber;
  job_id: string;
  user_request_id: string;
  confirmation_id: string;
  input_hash: string;
  prompt: string;
  model: "gen4_turbo";
  ratio: "720:1280" | "1280:720";
  duration_seconds: number;
  estimated_cost_usd: number;
  status: "created";
  execution_mode: "local_fake_no_provider" | "runway";
  approved_at: string;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function isVideoRecord(value: unknown): value is VideoRecord {
  return isObject(value)
    && typeof value.scene_number === "number" && Number.isInteger(value.scene_number) && value.scene_number >= 1 && value.scene_number <= MAX_SCENE_COUNT
    && typeof value.job_id === "string"
    && typeof value.user_request_id === "string"
    && typeof value.input_hash === "string"
    && typeof value.prompt === "string";
}

function recordsForJob(project: StoredProject, jobId: string): VideoRecord[] {
  return project.video_generation_records.filter(isVideoRecord).filter((record) => record.job_id === jobId);
}

/**
 * Local-only acceptance gate. It records what a later Runway adapter may do,
 * but never imports a provider SDK, opens a network connection, polls, or
 * writes a media file.
 */
@Injectable()
export class LocalVideoSubmissionService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly previews: LocalVideoPreviewService,
    private readonly monthlyBudgetUsd = DEFAULT_MONTHLY_BUDGET_USD,
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: RunwayBudget,
  ) {}

  private validateRequest(value: unknown, scenes: readonly SceneNumber[]): StartVideoGenerationRequest {
    if (!isObject(value) || Object.keys(value).length !== 4
      || !validId(value.confirmationId) || !validId(value.userRequestId) || value.approved !== true
      || !Array.isArray(value.prompts) || value.prompts.length !== scenes.length) throw invalidVideoSubmission();
    const prompts = value.prompts.map((item, index) => {
      if (!isObject(item) || Object.keys(item).length !== 2 || item.sceneNumber !== scenes[index]
        || typeof item.prompt !== "string" || !item.prompt.trim() || utf16Length(item.prompt) > RUNWAY_PROMPT_MAX_LENGTH) throw invalidVideoSubmission();
      return { sceneNumber: item.sceneNumber as SceneNumber, prompt: item.prompt };
    });
    return { confirmationId: value.confirmationId, userRequestId: value.userRequestId, approved: true, prompts };
  }

  private hashInput(imageBytes: Buffer, prompt: string, ratio: string, durationSeconds: number): string {
    const hash = createHash("sha256");
    hash.update(imageBytes);
    hash.update(prompt, "utf8");
    hash.update("gen4_turbo", "ascii");
    hash.update(ratio, "ascii");
    hash.update(String(durationSeconds), "ascii");
    return hash.digest("hex");
  }

  private existing(project: StoredProject, request: StartVideoGenerationRequest, hashes: readonly string[]): StartVideoGenerationResponse | undefined {
    const scenes = scenesFor(project);
    const records = project.video_generation_records.filter(isVideoRecord);
    const sameRequest = records.filter((record) => record.user_request_id === request.userRequestId);
    if (sameRequest.length > 0) {
      const jobId = sameRequest[0]!.job_id;
      const job = recordsForJob(project, jobId);
      if (job.length !== scenes.length || job.some((record, index) => record.input_hash !== hashes[index] || record.prompt !== request.prompts[index]!.prompt)) {
        throw videoRequestIdConflict();
      }
      return { jobId, acceptedSceneNumbers: [...scenes] };
    }
    const jobIds = [...new Set(records.map((record) => record.job_id))];
    for (const jobId of jobIds) {
      const job = recordsForJob(project, jobId);
      if (job.length === scenes.length && job.every((record, index) => record.input_hash === hashes[index])) {
        return { jobId, acceptedSceneNumbers: [...scenes] };
      }
    }
    return undefined;
  }

  private existingRequest(project: StoredProject, request: StartVideoGenerationRequest): StartVideoGenerationResponse | undefined {
    const scenes = scenesFor(project);
    const records = project.video_generation_records.filter(isVideoRecord).filter((record) => record.user_request_id === request.userRequestId);
    if (records.length === 0) return undefined;
    const jobId = records[0]!.job_id;
    const job = recordsForJob(project, jobId);
    if (job.length !== scenes.length || job.some((record, index) => record.confirmation_id !== request.confirmationId || record.prompt !== request.prompts[index]!.prompt)) {
      throw videoRequestIdConflict();
    }
    return { jobId, acceptedSceneNumbers: [...scenes] };
  }

  async start(projectId: string, body: unknown): Promise<StartVideoGenerationResponse> {
    const project = await this.projects.findById(projectId.trim());
    const scenes = scenesFor(project);
    const request = this.validateRequest(body, scenes);
    const priorRequest = this.existingRequest(project, request);
    if (priorRequest) return priorRequest;
    if (project.workflow_state !== WorkflowState.WaitingForVideoConfirmation) throw videoSubmissionNotAllowed();
    const preview = await this.previews.preview(project.project_id, undefined);
    if (!preview.confirmationId || request.confirmationId !== preview.confirmationId) throw videoConfirmationStale();
    if (scenes.length < MIN_SCENE_COUNT || scenes.length > MAX_SCENE_COUNT) throw videoCallLimitExceeded();
    if (ESTIMATED_COST_USD > this.monthlyBudgetUsd) throw videoBudgetExceeded();

    const hashes: string[] = [];
    for (const scene of scenes) {
      const image = await fs.readFile(project.generated_images[scene - 1]!);
      hashes.push(this.hashInput(image, request.prompts[scene - 1]!.prompt, preview.previews[scene - 1]!.ratio, preview.previews[scene - 1]!.durationSeconds));
    }
    const duplicate = this.existing(project, request, hashes);
    if (duplicate) return duplicate;

    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("runway") : null;
    const executionMode: VideoRecord["execution_mode"] = apiKey && this.budget ? "runway" : "local_fake_no_provider";

    const jobId = randomUUID();
    const approvedAt = new Date().toISOString();
    const records: VideoRecord[] = scenes.map((scene, index) => ({
      scene_number: scene,
      job_id: jobId,
      user_request_id: request.userRequestId,
      confirmation_id: request.confirmationId,
      input_hash: hashes[index]!,
      prompt: request.prompts[index]!.prompt,
      model: "gen4_turbo",
      ratio: preview.previews[index]!.ratio,
      duration_seconds: preview.previews[index]!.durationSeconds,
      estimated_cost_usd: 0.25,
      status: "created",
      execution_mode: executionMode,
      approved_at: approvedAt,
    }));
    await this.projects.save({
      ...project,
      workflow_state: WorkflowState.GeneratingVideos,
      updated_at: approvedAt,
      video_generation_records: [...project.video_generation_records, ...records],
      lore_context: {
        ...project.lore_context,
        video_submission: {
          job_id: jobId,
          confirmation_id: request.confirmationId,
          user_request_id: request.userRequestId,
          approved_at: approvedAt,
          estimated_cost_usd: ESTIMATED_COST_USD,
          maximum_provider_calls: scenes.length,
          execution_mode: executionMode,
        },
      },
    });
    return { jobId, acceptedSceneNumbers: [...scenes] };
  }
}
