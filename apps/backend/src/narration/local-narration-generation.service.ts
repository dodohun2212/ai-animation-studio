import * as crypto from "node:crypto";
import { OPENAI_LEDGER_FILE, isBudgetLedgerUnreadable, recordSpend, spendUnrecordedWarning } from "../providers/budget-ledger.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { sceneNumbersFor, TTS_ESTIMATED_COST_USD, type SceneNumber, type StartNarrationGenerationResponse } from "@ai-animation-studio/shared";
import { toApiProject } from "../projects/project.mapper.js";
import { ProjectLockTimeoutError, withProjectLock } from "../videos/project-lock.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { sceneValue } from "../images/image-prompt.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { budgetPreviewFor, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OpenAiAdapterError } from "../providers/openai-common.js";
import { callOpenAiTtsApi } from "./openai-narration-adapter.js";
import { narrationBudgetLedgerUnreadable, invalidNarrationRequest, narrationBudgetExceeded, narrationContentUnavailable, narrationGenerationFailed, narrationNotEnabled, narrationLocked, narrationProviderError, narrationStorageError } from "./narration-api.error.js";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
/** A silent single-frame MP3, used in local-fake mode — mirrors the local-fake single-pixel PNG used by image generation. */
/**
 * Four bytes of MP3 header and no audio, written when there is no TTS credential so the rest of the pipeline can
 * still be walked. It is a placeholder, and the record is the only thing that says so — the file itself is
 * indistinguishable from real narration to anything that only asks whether a file is there.
 */
const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00]);
/** Named once, because the reuse decision and the record that drives it have to agree on it exactly. */
export const PLACEHOLDER_ADAPTER = "local-fake-tts-adapter";

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}

export type WriteAudio = (file: string, bytes: Buffer) => Promise<void>;

async function atomicWriteAudio(file: string, bytes: Buffer): Promise<void> {
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

/**
 * Whether the audio already on disk is still the audio this scene should have.
 *
 * The records are stored as unknown, so this reads them defensively: anything it cannot recognise counts as
 * not-good and the scene is regenerated. Being wrong in that direction costs one call; being wrong the other
 * way is what left placeholders in place forever.
 */
function stillGoodAudio(record: unknown, text: string, canUseRealTts: boolean): boolean {
  if (typeof record !== "object" || record === null) return false;
  const { narration, adapter } = record as { narration?: unknown; adapter?: unknown };
  if (narration !== text || typeof adapter !== "string") return false;
  return adapter !== PLACEHOLDER_ADAPTER || !canUseRealTts;
}

async function validAudio(file: string): Promise<boolean> {
  try { return (await fs.stat(file)).size > 0; } catch { return false; }
}

/**
 * Sets one index-aligned slot without disturbing the others. Plain slice-splice ([...a.slice(0,i), v,
 * ...a.slice(i+1)]) silently shifts every later scene's slot left by however many earlier scenes were skipped
 * (never written), because slice never pads a too-short array — it must pad with `pad` up to `index` first.
 */
function setAt<T>(array: readonly T[], index: number, value: T, pad: T): T[] {
  const result = [...array];
  while (result.length <= index) result.push(pad);
  result[index] = value;
  return result;
}

@Injectable()
export class LocalNarrationGenerationService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly projectsRoot: string,
    private readonly writeAudio: WriteAudio = atomicWriteAudio,
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: OpenAiBudget,
  ) {}

  narrationPath(projectId: string, scene: SceneNumber): string {
    return path.join(this.projectsRoot, projectId, "narration", `scene${scene}.mp3`);
  }

  async content(projectId: string, rawSceneNumber: string): Promise<{ path: string; extension: ".mp3" }> {
    const project = await this.projects.findById(projectId.trim());
    const scenes = scenesFor(project);
    const number = Number(rawSceneNumber);
    const scene = Number.isInteger(number) && scenes.includes(number as SceneNumber) ? (number as SceneNumber) : undefined;
    if (!scene) throw narrationContentUnavailable();
    const file = this.narrationPath(project.project_id, scene);
    if (project.generated_narrations[scene - 1] !== file || !(await validAudio(file))) throw narrationContentUnavailable();
    return { path: file, extension: ".mp3" };
  }

  /**
   * Speaking every scene that does not already have good audio.
   *
   * Under the project lock for the reason its Episode twin is: narration writes no in-progress state for a
   * second arrival to be turned away by, and the per-scene reuse check cannot stand in for one — two presses
   * that arrive together both read scene 1 as missing, because neither has written it yet. That is one charge
   * per scene where the user asked for one run.
   *
   * Refused at once rather than queued: a queued second press would re-walk every scene, find the audio the
   * first wrote, and reuse all of it — the right answer, after making the caller wait out a whole generation.
   */
  async generate(projectId: string, body: unknown): Promise<StartNarrationGenerationResponse> {
    const id = projectId.trim();
    try {
      return await withProjectLock(this.projects.projectDirectory(id), `${id}:narration`, () => this.generateCore(projectId, body), { timeoutMs: 0 });
    } catch (error) {
      if (error instanceof ProjectLockTimeoutError) throw narrationLocked();
      throw error;
    }
  }

  private async generateCore(projectId: string, body: unknown): Promise<StartNarrationGenerationResponse> {
    if (!isObject(body) || Object.keys(body).length !== 1 || body.approved !== true) throw invalidNarrationRequest();
    const project = await this.projects.findById(projectId.trim());
    if (!toShortProjectSettings(project).narrationEnabled) throw narrationNotEnabled();
    const scenes = scenesFor(project);

    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    let current: StoredProject = project;
    const generated: SceneNumber[] = [];
    /** Scenes whose paid call landed but whose cost could not be written down — see providers/budget-ledger.ts. */
    const unrecordedScenes: SceneNumber[] = [];
    const reused: SceneNumber[] = [];
    const skipped: SceneNumber[] = [];

    try {
      for (const number of scenes) {
        const text = sceneValue(current.scenes[number - 1], "narration");
        const destination = this.narrationPath(current.project_id, number);
        if (!text) { skipped.push(number); continue; }
        const existing = current.generated_narrations[number - 1];
        // Not just "is a file there" — the same question the Episode side had to stop asking. A placeholder
        // written with no credential used to pass as finished work forever: connect a TTS key afterwards and
        // every one of those scenes was skipped, so the narration could never become real. Rewording a line
        // left the old audio in place for the same reason. The record has always known both.
        const stillGood = stillGoodAudio(current.narration_generation_records[number - 1], text, Boolean(apiKey && this.budget));
        if (existing === destination && stillGood && (await validAudio(destination))) { reused.push(number); continue; }

        let bytes: Buffer = FAKE_MP3;
        let adapter = PLACEHOLDER_ADAPTER;
        let apiCalls = 0;
        if (apiKey && this.budget) {
          await this.budget.preflight(TTS_ESTIMATED_COST_USD);
          let succeeded = false;
          try {
            const result = await callOpenAiTtsApi(apiKey, text);
            bytes = result.bytes;
            succeeded = true;
          } finally {
            // A `finally` around a paid call: a throw here discards what OpenAI was already paid for, and on the
            // failure path replaces the provider's real error. Kept and reported instead
            // (providers/budget-ledger.ts, docs/06_DECISIONS.md D-037).
            if (await recordSpend(() => this.budget!.record(current.project_id, "tts", succeeded, TTS_ESTIMATED_COST_USD))) unrecordedScenes.push(number);
          }
          adapter = "gpt-4o-mini-tts";
          apiCalls = 1;
        }
        await fs.mkdir(path.dirname(destination), { recursive: true });
        await this.writeAudio(destination, bytes);
        if (!(await validAudio(destination))) throw new Error("invalid audio");

        current = {
          ...current,
          generated_narrations: setAt(current.generated_narrations, number - 1, destination, null),
          narration_generation_records: setAt(
            current.narration_generation_records, number - 1,
            { scene_number: number, narration: text, checkpoint: "completed", adapter, tts_api_calls: apiCalls },
            null,
          ),
          updated_at: new Date().toISOString(),
        };
        await this.projects.save(current);
        generated.push(number);
      }
    } catch (error) {
    // Attached on the way out too, not only on the happy path. A ledger that becomes unreadable mid-run stops
    // the *next* scene at preflight (D-036) and leaves through this catch, so the happy path never runs — and
    // the scenes already bought before it broke would have gone unmentioned, which is the whole failure this
    // guards against.
      if (unrecordedScenes.length > 0) {
        await this.projects.save({ ...current, warnings: [...current.warnings, spendUnrecordedWarning(`${unrecordedScenes.join(", ")}번 장면 내레이션 생성`, OPENAI_LEDGER_FILE)], updated_at: new Date().toISOString() }).catch(() => undefined);
      }
      if (isBudgetLedgerUnreadable(error)) throw narrationBudgetLedgerUnreadable(); if (error instanceof OpenAiBudgetExceededError) throw narrationBudgetExceeded(error.message);
      if (error instanceof OpenAiAdapterError) throw narrationProviderError(error.category, error.message);
      if (error instanceof Error && error.message === "invalid audio") throw narrationGenerationFailed();
      throw narrationStorageError();
    }

    // Said after the fact, once, rather than per scene: the person needs one instruction, not six copies of it.
    // Saved best-effort — the response below carries the same warning either way, so they see it now regardless.
    if (unrecordedScenes.length > 0) {
      current = { ...current, warnings: [...current.warnings, spendUnrecordedWarning(`${unrecordedScenes.join(", ")}번 장면 내레이션 생성`, OPENAI_LEDGER_FILE)], updated_at: new Date().toISOString() };
      await this.projects.save(current).catch(() => undefined);
    }
    // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current
    // state. Skipped when a spend went unrecorded: it reads the same file that just refused a write, and letting
    // it throw here would answer a bare 500 for a generation that actually succeeded and was paid for. The field
    // is already optional (the local fake mode has none).
    const budget = apiKey && this.budget && unrecordedScenes.length === 0 ? await budgetPreviewFor(this.budget, generated.length * TTS_ESTIMATED_COST_USD) : undefined;
    return {
      project: toApiProject(current),
      generatedSceneNumbers: generated,
      reusedSceneNumbers: reused,
      skippedSceneNumbers: skipped,
      ...(budget ? { budget } : {}),
    };
  }
}
