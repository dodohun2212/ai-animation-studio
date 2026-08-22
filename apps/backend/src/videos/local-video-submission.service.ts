import { createHash, randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";

import { Injectable } from "@nestjs/common";
import {
  WorkflowState,
  type SceneNumber,
  type StartVideoGenerationRequest,
  type StartVideoGenerationResponse,
} from "@ai-animation-studio/shared";

import { LocalProjectRepository } from "../projects/projects.repository.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { LocalVideoPreviewService, utf16Length } from "./video-preview.service.js";
import {
  invalidVideoSubmission,
  videoBudgetExceeded,
  videoCallLimitExceeded,
  videoConfirmationStale,
  videoRequestIdConflict,
  videoSubmissionNotAllowed,
} from "./video-submission-api.error.js";

const SCENES = [1, 2, 3, 4, 5, 6] as const satisfies readonly SceneNumber[];
const MAX_PROVIDER_CALLS = 6;
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
  duration_seconds: 5;
  estimated_cost_usd: number;
  status: "created";
  execution_mode: "local_fake_no_provider";
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
    && SCENES.includes(value.scene_number as SceneNumber)
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
  ) {}

  private validateRequest(value: unknown): StartVideoGenerationRequest {
    if (!isObject(value) || Object.keys(value).length !== 4
      || !validId(value.confirmationId) || !validId(value.userRequestId) || value.approved !== true
      || !Array.isArray(value.prompts) || value.prompts.length !== SCENES.length) throw invalidVideoSubmission();
    const prompts = value.prompts.map((item, index) => {
      if (!isObject(item) || Object.keys(item).length !== 2 || item.sceneNumber !== SCENES[index]
        || typeof item.prompt !== "string" || !item.prompt.trim() || utf16Length(item.prompt) > 1_000) throw invalidVideoSubmission();
      return { sceneNumber: item.sceneNumber as SceneNumber, prompt: item.prompt };
    });
    return { confirmationId: value.confirmationId, userRequestId: value.userRequestId, approved: true, prompts };
  }

  private hashInput(imageBytes: Buffer, prompt: string, ratio: string): string {
    const hash = createHash("sha256");
    hash.update(imageBytes);
    hash.update(prompt, "utf8");
    hash.update("gen4_turbo", "ascii");
    hash.update(ratio, "ascii");
    hash.update("5", "ascii");
    return hash.digest("hex");
  }

  private existing(project: StoredProject, request: StartVideoGenerationRequest, hashes: readonly string[]): StartVideoGenerationResponse | undefined {
    const records = project.video_generation_records.filter(isVideoRecord);
    const sameRequest = records.filter((record) => record.user_request_id === request.userRequestId);
    if (sameRequest.length > 0) {
      const jobId = sameRequest[0]!.job_id;
      const job = recordsForJob(project, jobId);
      if (job.length !== 6 || job.some((record, index) => record.input_hash !== hashes[index] || record.prompt !== request.prompts[index]!.prompt)) {
        throw videoRequestIdConflict();
      }
      return { jobId, acceptedSceneNumbers: [...SCENES] };
    }
    const jobIds = [...new Set(records.map((record) => record.job_id))];
    for (const jobId of jobIds) {
      const job = recordsForJob(project, jobId);
      if (job.length === 6 && job.every((record, index) => record.input_hash === hashes[index])) {
        return { jobId, acceptedSceneNumbers: [...SCENES] };
      }
    }
    return undefined;
  }

  private existingRequest(project: StoredProject, request: StartVideoGenerationRequest): StartVideoGenerationResponse | undefined {
    const records = project.video_generation_records.filter(isVideoRecord).filter((record) => record.user_request_id === request.userRequestId);
    if (records.length === 0) return undefined;
    const jobId = records[0]!.job_id;
    const job = recordsForJob(project, jobId);
    if (job.length !== 6 || job.some((record, index) => record.confirmation_id !== request.confirmationId || record.prompt !== request.prompts[index]!.prompt)) {
      throw videoRequestIdConflict();
    }
    return { jobId, acceptedSceneNumbers: [...SCENES] };
  }

  async start(projectId: string, body: unknown): Promise<StartVideoGenerationResponse> {
    const request = this.validateRequest(body);
    let project: StoredProject;
    project = await this.projects.findById(projectId.trim());
    const priorRequest = this.existingRequest(project, request);
    if (priorRequest) return priorRequest;
    if (project.workflow_state !== WorkflowState.WaitingForVideoConfirmation) throw videoSubmissionNotAllowed();
    const preview = await this.previews.preview(project.project_id, undefined);
    if (!preview.confirmationId || request.confirmationId !== preview.confirmationId) throw videoConfirmationStale();
    if (MAX_PROVIDER_CALLS !== 6) throw videoCallLimitExceeded();
    if (ESTIMATED_COST_USD > this.monthlyBudgetUsd) throw videoBudgetExceeded();

    const hashes: string[] = [];
    for (const scene of SCENES) {
      const image = await fs.readFile(project.generated_images[scene - 1]!);
      hashes.push(this.hashInput(image, request.prompts[scene - 1]!.prompt, preview.previews[scene - 1]!.ratio));
    }
    const duplicate = this.existing(project, request, hashes);
    if (duplicate) return duplicate;

    const jobId = randomUUID();
    const approvedAt = new Date().toISOString();
    const records: VideoRecord[] = SCENES.map((scene, index) => ({
      scene_number: scene,
      job_id: jobId,
      user_request_id: request.userRequestId,
      confirmation_id: request.confirmationId,
      input_hash: hashes[index]!,
      prompt: request.prompts[index]!.prompt,
      model: "gen4_turbo",
      ratio: preview.previews[index]!.ratio,
      duration_seconds: 5,
      estimated_cost_usd: 0.25,
      status: "created",
      execution_mode: "local_fake_no_provider",
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
          maximum_provider_calls: MAX_PROVIDER_CALLS,
          execution_mode: "local_fake_no_provider",
        },
      },
    });
    return { jobId, acceptedSceneNumbers: [...SCENES] };
  }
}
