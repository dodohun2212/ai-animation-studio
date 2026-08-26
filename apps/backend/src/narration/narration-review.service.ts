import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import {
  sceneNumbersFor,
  TTS_ESTIMATED_COST_USD,
  type GetNarrationReviewResponse,
  type NarrationReview,
  type RegenerateNarrationResponse,
  type SceneNumber,
} from "@ai-animation-studio/shared";
import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { sceneValue } from "../images/image-prompt.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { budgetPreviewFor, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError } from "../providers/openai-common.js";
import { callOpenAiTtsApi } from "./openai-narration-adapter.js";
import { invalidNarrationRequest, narrationBudgetExceeded, narrationMissingText, narrationNotEnabled, narrationProviderError, narrationStorageError } from "./narration-api.error.js";
import { computeSceneStaleness } from "../projects/scene-staleness.js";
import type { LocalNarrationGenerationService } from "./local-narration-generation.service.js";
import { probeAudioDurationSeconds } from "./audio-duration.js";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}

async function validAudio(file: string): Promise<boolean> {
  try { return (await fs.stat(file)).size > 0; } catch { return false; }
}

async function toApiNarrations(
  project: StoredProject,
  scenes: readonly SceneNumber[],
  generation: LocalNarrationGenerationService,
  probeDuration: typeof probeAudioDurationSeconds,
): Promise<NarrationReview[]> {
  return Promise.all(scenes.map(async (number) => {
    const narration = sceneValue(project.scenes[number - 1], "narration");
    const file = project.generated_narrations[number - 1];
    const hasAudio = typeof file === "string" && file === generation.narrationPath(project.project_id, number) && (await validAudio(file));
    const audioDurationSeconds = hasAudio ? await probeDuration(file as string) : undefined;
    return { sceneNumber: number, narration, hasAudio, ...(audioDurationSeconds !== undefined ? { audioDurationSeconds } : {}) };
  }));
}

@Injectable()
export class NarrationReviewService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly generation: LocalNarrationGenerationService,
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: OpenAiBudget,
    private readonly probeDuration: typeof probeAudioDurationSeconds = probeAudioDurationSeconds,
  ) {}

  async getStatus(projectId: string): Promise<GetNarrationReviewResponse> {
    const project = await this.projects.findById(projectId.trim());
    const scenes = scenesFor(project);
    const narrations = await toApiNarrations(project, scenes, this.generation, this.probeDuration);
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current state.
    const budget = apiKey && this.budget ? await budgetPreviewFor(this.budget, TTS_ESTIMATED_COST_USD) : undefined;
    // TODO: no LocalAssetsRepository/mappings injected here yet — same gap as scene-edit.service.ts, see its
    // comment (`.claude-bridge` Round 148). This screen doesn't act on imageStale directly, but the field is
    // still part of the shared staleness shape returned here.
    return { project: toApiProject(project), narrations, staleness: await computeSceneStaleness(project), ...(budget ? { budget } : {}) };
  }

  async regenerate(projectId: string, rawSceneNumber: string, body: unknown): Promise<RegenerateNarrationResponse> {
    if (!isObject(body) || body.approved !== true
      || Object.keys(body).some((key) => key !== "approved" && key !== "additionalInstruction")
      || (body.additionalInstruction !== undefined && typeof body.additionalInstruction !== "string")) throw invalidNarrationRequest();
    const additionalInstruction = typeof body.additionalInstruction === "string" ? body.additionalInstruction.trim() : "";
    const number = Number(rawSceneNumber);
    const project = await this.projects.findById(projectId.trim());
    const scenes = scenesFor(project);
    if (!Number.isInteger(number) || String(number) !== rawSceneNumber || !scenes.includes(number as SceneNumber)) throw invalidNarrationRequest();
    if (!toShortProjectSettings(project).narrationEnabled) throw narrationNotEnabled();
    const sceneNumber = number as SceneNumber;
    const text = sceneValue(project.scenes[sceneNumber - 1], "narration");
    if (!text) throw narrationMissingText();

    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    let bytes: Buffer = FAKE_MP3;
    let adapter = "local-fake-tts-adapter";
    let apiCalls = 0;
    let retryEstimate: RegenerateNarrationResponse["retryEstimate"];
    if (apiKey && this.budget) {
      try {
        await this.budget.preflight(TTS_ESTIMATED_COST_USD);
        let succeeded = false;
        try {
          const result = await callOpenAiTtsApi(apiKey, text, additionalInstruction ? { instructions: additionalInstruction } : {});
          bytes = result.bytes;
          succeeded = true;
        } finally {
          await this.budget.record(project.project_id, "tts", succeeded, TTS_ESTIMATED_COST_USD);
        }
      } catch (error) {
        if (error instanceof OpenAiBudgetExceededError) throw narrationBudgetExceeded(error.message);
        if (error instanceof OpenAiAdapterError) throw narrationProviderError(error.category, error.message);
        throw narrationProviderError("unknown", OPENAI_KOREAN_MESSAGES.unknown);
      }
      adapter = "gpt-4o-mini-tts";
      apiCalls = 1;
      // Read-only, computed after the fact: reflects the ledger's state right after this regeneration's own record().
      retryEstimate = { perSceneCostUsd: TTS_ESTIMATED_COST_USD, budget: await budgetPreviewFor(this.budget, TTS_ESTIMATED_COST_USD) };
    }

    const destination = this.generation.narrationPath(project.project_id, sceneNumber);
    try {
      await fs.mkdir(path.dirname(destination), { recursive: true });
      await fs.writeFile(destination, bytes);
      if (!(await validAudio(destination))) throw new Error("invalid audio");
    } catch { throw narrationStorageError(); }

    const timestamp = new Date().toISOString();
    const records = [...project.narration_generation_records];
    records[sceneNumber - 1] = { scene_number: sceneNumber, narration: text, checkpoint: "completed", adapter, tts_api_calls: apiCalls, regenerated: true };
    const generatedNarrations = [...project.generated_narrations];
    generatedNarrations[sceneNumber - 1] = destination;
    const updated: StoredProject = {
      ...project,
      generated_narrations: generatedNarrations,
      narration_generation_records: records,
      updated_at: timestamp,
    };
    try { await this.projects.save(updated); } catch { throw narrationStorageError(); }
    return {
      project: toApiProject(updated),
      narrations: await toApiNarrations(updated, scenes, this.generation, this.probeDuration),
      sceneNumber,
      ...(retryEstimate ? { retryEstimate } : {}),
    };
  }
}
