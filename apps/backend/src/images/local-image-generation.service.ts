import { PLACEHOLDER_PNG, isPlaceholderImage } from "./placeholder-image.js";
import { ProjectLockTimeoutError, withProjectLock } from "../videos/project-lock.js";
import { OPENAI_LEDGER_FILE, isBudgetLedgerUnreadable, recordSpend, spendUnrecordedWarning } from "../providers/budget-ledger.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { IMAGE_ESTIMATED_COST_USD, MAX_SCENE_COUNT, sceneNumbersFor, WorkflowState, type SceneNumber, type StartImageGenerationResponse, type GetImageGenerationProgressResponse } from "@ai-animation-studio/shared";
import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { LocalProjectAssetMappingsRepository, scriptFingerprint } from "../mappings/mappings.repository.js";
import { validateImage } from "../assets/image-validation.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { budgetPreviewFor, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OpenAiAdapterError } from "../providers/openai-common.js";
import { OPENAI_IMAGE_MODEL, callOpenAiImageApi, callOpenAiImageEditApi } from "./openai-image-adapter.js";
import { collectReferenceImages, describeReferenceMappingsForScene } from "./image-reference-selection.js";
import { imagePromptFor, imageSizeFor, sceneValue, styleLineFor } from "./image-prompt.js";
import { previousSceneContinuityImagePath } from "../projects/project-continuity.js";
import { imageBudgetExceeded, imageBudgetLedgerUnreadable, imageContentUnavailable, imageGenerationFailed, imageGenerationLocked, imageGenerationNotAllowed, imageProviderError, imageStorageError, invalidImageRequest, mappingReviewRequired } from "./image-api.error.js";

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}
const sceneNumberFromParam = (raw: string): SceneNumber | undefined => {
  const value = Number(raw);
  return Number.isInteger(value) && String(value) === raw && value >= 1 && value <= MAX_SCENE_COUNT ? (value as SceneNumber) : undefined;
};
/** The local fake path's bytes, shared so nothing can hold a second opinion about them. */
const PNG = PLACEHOLDER_PNG;
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

/**
 * A paid run demands a real picture, not merely a file that parses.
 *
 * PLACEHOLDER_PNG — what this service writes with no credential — is a genuine 1×1 PNG, so "it parses" let a
 * keyless run's stubs count as scenes somebody had bought. Connect a key afterwards and the reuse branch below
 * keeps all six, generates nothing, and the project walks on to buy video of blank frames.
 *
 * The Episode side had the same hole and the same fix earlier today (`episode-images.service.ts`); the video
 * library has drawn this line since placeholders first counted as finished clips. Only a run that reaches a
 * provider is held to the stricter test — writing and reading stubs is exactly what the keyless path is for.
 */
async function validPng(file: string, paid = false): Promise<boolean> {
  try {
    const bytes = await fs.readFile(file);
    if (paid && isPlaceholderImage(bytes.length)) return false;
    return validateImage(bytes, "scene.png", "image/png").extension === ".png";
  } catch { return false; }
}

function assertValidScenes(project: StoredProject): void {
  const expected = scenesFor(project);
  if (project.scenes.length !== expected.length || project.scenes.some((scene, index) =>
    !isObject(scene) || scene.number !== index + 1 || !sceneValue(scene, "description") || !sceneValue(scene, "visual_action"))) {
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

  /**
   * How far a run has got, scene by scene — readable while the pictures are still coming.
   *
   * Asserts nothing about the project's state on purpose. `review()` is entitled to refuse a project that has
   * not finished, and does; this exists for the moment before that, which is the moment somebody is watching.
   *
   * A scene counts as done when the project's own record names its file and that file reads as a PNG — the
   * identical question `generateCore` asks before skipping a scene. Asking it the same way is what keeps this
   * from ever describing a picture the generation would redraw. `validPng`, not a `stat`: the loop writes the
   * bytes and then validates them, so a file that exists but does not parse is one being written this instant,
   * and calling it finished would move the marker onto a picture nobody has yet.
   */
  async progress(projectId: string): Promise<GetImageGenerationProgressResponse> {
    const project = await this.projects.findById(projectId.trim());
    const sceneNumbers = scenesFor(project);
    const completedSceneNumbers: SceneNumber[] = [];
    const pending: SceneNumber[] = [];
    for (const number of sceneNumbers) {
      const destination = this.imagePath(project.project_id, number);
      if (project.generated_images[number - 1] === destination && await validPng(destination)) completedSceneNumbers.push(number);
      else pending.push(number);
    }
    // Only while the run is in flight. The loop is sequential, so the first unfinished scene is the one being
    // drawn — but that sentence is only true during a run.
    const currentSceneNumber = project.workflow_state === WorkflowState.GeneratingImages ? pending[0] : undefined;
    return { project: toApiProject(project), progress: { sceneNumbers, completedSceneNumbers, ...(currentSceneNumber ? { currentSceneNumber } : {}) } };
  }

  async content(projectId: string, rawSceneNumber: string): Promise<{ path: string; extension: ".png" }> {
    const project = await this.projects.findById(projectId.trim());
    const number = sceneNumberFromParam(rawSceneNumber);
    if (!number) throw imageContentUnavailable();
    const file = this.imagePath(project.project_id, number);
    if (!(await validPng(file))) throw imageContentUnavailable();
    return { path: file, extension: ".png" };
  }

  private async approvedMapping(project: StoredProject): Promise<void> {
    const review = await this.mappings.loadReview(this.mappings.projectLocation(project.project_id));
    if (review.status !== "approved" || review.script_revision !== project.script_revision || review.script_fingerprint !== scriptFingerprint(project.scenes)) {
      throw mappingReviewRequired();
    }
  }

  /**
   * Refuses a second run while one is in flight, the way narration already does.
   *
   * `generate` reads the workflow state, decides it may run, and only then writes `generating_images`. Two
   * presses that arrive together both read `asset_mapping_approved`, and both walk every scene finding no image
   * yet — because neither has written one. That is **two paid images per scene where a person asked for one
   * run**, and this is the most expensive button in the app to press twice.
   *
   * Refused at once rather than queued: a queued second press would re-walk every scene, find the images the
   * first one wrote and reuse them all — the right answer, after making someone wait out a whole generation.
   * `PROJECT_LOCKED` is the code every module sends for this (docs/06_DECISIONS.md D-005).
   */
  async generate(projectId: string, body: unknown): Promise<StartImageGenerationResponse> {
    const id = projectId.trim();
    try {
      return await withProjectLock(this.projects.projectDirectory(id), `${id}:images`, () => this.generateCore(projectId, body), { timeoutMs: 0 });
    } catch (error) {
      if (error instanceof ProjectLockTimeoutError) throw imageGenerationLocked();
      throw error;
    }
  }

  private async generateCore(projectId: string, body: unknown): Promise<StartImageGenerationResponse> {
    if (!isObject(body) || Object.keys(body).length !== 1 || body.approved !== true) throw invalidImageRequest();
    const project = await this.projects.findById(projectId.trim());
    if (project.workflow_state !== WorkflowState.AssetMappingApproved) throw imageGenerationNotAllowed();
    assertValidScenes(project);
    const scenes = scenesFor(project);
    await this.approvedMapping(project);

    const startedAt = new Date().toISOString();
    let current: StoredProject = { ...project, workflow_state: WorkflowState.GeneratingImages, updated_at: startedAt };
    try { await this.projects.save(current); } catch { throw imageStorageError(); }

    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    const mappings = apiKey && this.budget ? await this.mappings.load(this.mappings.projectLocation(current.project_id)) : [];
    const continuityImagePath = previousSceneContinuityImagePath(current);
    const styleLine = styleLineFor(current);
    const generated: SceneNumber[] = [];
    /** Scenes whose paid call landed but whose cost could not be written down — see providers/budget-ledger.ts. */
    const unrecordedScenes: SceneNumber[] = [];
    const reused: SceneNumber[] = [];
    try {
      for (const number of scenes) {
        const destination = this.imagePath(current.project_id, number);
        const existing = current.generated_images[number - 1];
        if (existing === destination && await validPng(destination, Boolean(apiKey && this.budget))) {
          reused.push(number);
          continue;
        }
        const referenceNotes = await describeReferenceMappingsForScene(this.assets, mappings, number);
        const prompt = imagePromptFor(current.scenes[number - 1], styleLine, referenceNotes);
        let bytes: Buffer = PNG;
        let adapter = "local-fake-image-adapter";
        let apiCalls = 0;
        let referenceOmission: { references_used_count: number; references_omitted_count: number } | undefined;
        // Recorded alongside the prompt because the prompt cannot hold it: the reference text names the Asset,
        // but the bytes come from whichever version that Asset currently resolves to, and a Folder mapping is
        // always follow_latest. A redrawn representative child therefore changes every picture the next run
        // would make while leaving the description word-for-word identical.
        let referenceSources: string[] | undefined;
        if (apiKey && this.budget) {
          const references = await collectReferenceImages(this.assets, mappings, this.mappings.projectLocation(current.project_id).directory, number, continuityImagePath);
          referenceSources = references.sources;
          if (references.omittedCount > 0) referenceOmission = { references_used_count: references.images.length, references_omitted_count: references.omittedCount };
          await this.budget.preflight(IMAGE_ESTIMATED_COST_USD);
          let succeeded = false;
          try {
            const size = imageSizeFor(current);
            const result = references.images.length > 0
              ? await callOpenAiImageEditApi(apiKey, prompt, references.images, { size })
              : await callOpenAiImageApi(apiKey, prompt, { size });
            bytes = result.bytes;
            succeeded = true;
          } finally {
            // A `finally` around a paid call: a throw here discards what OpenAI was already paid for, and on the
            // failure path replaces the provider's real error. Kept and reported instead
            // (providers/budget-ledger.ts, docs/06_DECISIONS.md D-037).
            if (await recordSpend(() => this.budget!.record(current.project_id, "image", succeeded, IMAGE_ESTIMATED_COST_USD))) unrecordedScenes.push(number);
          }
          adapter = references.images.length > 0 ? `${OPENAI_IMAGE_MODEL}:edit` : OPENAI_IMAGE_MODEL;
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
          image_generation_records: [...current.image_generation_records.slice(0, number - 1), { scene_number: number, prompt, checkpoint: "completed", adapter, image_api_calls: apiCalls, ...(referenceOmission ?? {}), ...(referenceSources !== undefined ? { reference_sources: referenceSources } : {}) }],
          updated_at: new Date().toISOString(),
        };
        await this.projects.save(current);
        generated.push(number);
      }
      if (current.generated_images.length !== scenes.length || !(await Promise.all(scenes.map((number) => validPng(this.imagePath(current.project_id, number))))).every(Boolean)) throw new Error("incomplete");
      await this.assets.indexGeneratedProjectImages(
        { sourceProjectId: current.project_id, imagesDirectory: path.dirname(this.imagePath(current.project_id, 1)), kind: "short project" },
        current.topic,
        current.scenes.map((scene) => sceneValue(scene, "description")),
      );
      current = { ...current, workflow_state: WorkflowState.ImagesReady, updated_at: new Date().toISOString() };
      await this.projects.save(current);
      current = { ...current, workflow_state: WorkflowState.ImagesReview, updated_at: new Date().toISOString() };
      await this.projects.save(current);
    } catch (error) {
    // Attached on the way out too, not only on the happy path. A ledger that becomes unreadable mid-run stops
    // the *next* scene at preflight (D-036) and leaves through this catch, so the happy path never runs — and
    // the scenes already bought before it broke would have gone unmentioned, which is the whole failure this
    // guards against.
      const recoverable = {
        ...current, workflow_state: WorkflowState.AssetMappingApproved, updated_at: new Date().toISOString(),
        ...(unrecordedScenes.length > 0 ? { warnings: [...current.warnings, spendUnrecordedWarning(`${unrecordedScenes.join(", ")}번 장면 이미지 생성`, OPENAI_LEDGER_FILE)] } : {}),
      };
      await this.projects.save(recoverable).catch(() => undefined);
      if (isBudgetLedgerUnreadable(error)) throw imageBudgetLedgerUnreadable(); if (error instanceof OpenAiBudgetExceededError) throw imageBudgetExceeded(error.message);
      if (error instanceof OpenAiAdapterError) throw imageProviderError(error.category, error.message);
      if (error instanceof Error && error.message === "invalid png") throw imageGenerationFailed();
      if (error instanceof Error && error.message === "incomplete") throw imageGenerationFailed();
      throw imageStorageError();
    }
    // Said after the fact, once, rather than per scene: the person needs one instruction, not six copies of it.
    // Saved best-effort — the response below carries the same warning either way, so they see it now regardless.
    if (unrecordedScenes.length > 0) {
      current = { ...current, warnings: [...current.warnings, spendUnrecordedWarning(`${unrecordedScenes.join(", ")}번 장면 이미지 생성`, OPENAI_LEDGER_FILE)], updated_at: new Date().toISOString() };
      await this.projects.save(current).catch(() => undefined);
    }
    // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current
    // state. Skipped when a spend went unrecorded: it reads the same file that just refused a write, and letting
    // it throw here would answer a bare 500 for a generation that actually succeeded and was paid for. The field
    // is already optional (the local fake mode has none).
    const budget = apiKey && this.budget && unrecordedScenes.length === 0 ? await budgetPreviewFor(this.budget, generated.length * IMAGE_ESTIMATED_COST_USD) : undefined;
    return { project: toApiProject(current), generatedSceneNumbers: generated, reusedSceneNumbers: reused, ...(budget ? { budget } : {}) };
  }
}
