import { PLACEHOLDER_PNG } from "./placeholder-image.js";
import { OPENAI_LEDGER_FILE, isBudgetLedgerUnreadable, recordSpend, spendUnrecordedWarning } from "../providers/budget-ledger.js";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as crypto from "node:crypto";

import { Injectable } from "@nestjs/common";
import {
  IMAGE_ESTIMATED_COST_USD,
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
import { ProjectLockTimeoutError, withProjectLock } from "../videos/project-lock.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { budgetPreviewFor, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError } from "../providers/openai-common.js";
import { OPENAI_IMAGE_MODEL, callOpenAiImageApi, callOpenAiImageEditApi } from "./openai-image-adapter.js";
import { collectReferenceImages, describeReferenceMappingsForScene } from "./image-reference-selection.js";
import { imagePromptFor, imageSizeFor, sceneValue, styleLineFor } from "./image-prompt.js";
import { previousSceneContinuityImagePath } from "../projects/project-continuity.js";
import { computeSceneStaleness } from "../projects/scene-staleness.js";
import { imageReviewBudgetLedgerUnreadable,
  imageReviewBudgetExceeded,
  imageReviewDataInvalid,
  imageReviewImageInvalid,
  imageReviewNotAllowed, imageReviewLocked,
  imageReviewProviderError,
  imageReviewStorageError,
  invalidImageReviewRequest,
} from "./image-review-api.error.js";

/** The local fake path's bytes, shared so nothing can hold a second opinion about them. */
const LOCAL_PNG = PLACEHOLDER_PNG;
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

/**
 * referencesUsedCount/referencesOmittedCount live on the project's own image_generation_records (written at
 * generate()/regenerate() time — see local-image-generation.service.ts and this file's own regenerate()), not on
 * StoredImageReview: a review entry does not exist until the scene is first approved or regenerated, but the cap
 * can already have applied at plain generation time. Reading both sources here keeps every GetImageReviewResponse
 * caller (getStatus/approve/regenerate) in sync without needing three separate merges.
 */
function toApiReviews(reviews: StoredImageReview[], timestamp: string, sceneNumbers: readonly SceneNumber[], generationRecords: readonly unknown[] = []): ImageReview[] {
  const byScene = new Map(reviews.map((review) => [review.scene_number, review]));
  const isObject = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
  return sceneNumbers.map((number) => {
    const review = byScene.get(number);
    const record = generationRecords[number - 1];
    const omission = isObject(record) && typeof record.references_used_count === "number" && typeof record.references_omitted_count === "number"
      ? { referencesUsedCount: record.references_used_count, referencesOmittedCount: record.references_omitted_count }
      : {};
    return { sceneNumber: number, status: review?.status === "approved" ? "approved" : "pending", updatedAt: review?.updated_at || timestamp, ...omission };
  });
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

  /**
   * Index this project's generated images on demand when the Library has no record of them.
   *
   * Approving and replacing both look the records up and read a missing Folder as corruption, which is right
   * for a project that was indexed once and wrong for one whose Folder is simply gone. It can be gone: the
   * Library lets a generated Folder be deleted, and `usageProjects()` answers "nobody" for it — mappings point
   * at the references a person chose, never at the pictures this project produced — so nothing refuses the
   * deletion. Without this, that deletion left the project stuck in image review: every approval and every
   * regeneration answered IMAGE_REVIEW_STORAGE_ERROR, with no way back short of paying for the images again.
   *
   * The Episode path already carries this guard (`episode-images.service.ts`), for the same reason in a
   * different disguise — Episodes whose pictures predate indexing. Both owners re-derive the records from what
   * is on disk, which is where the pictures were the source of truth all along.
   */
  private async indexAssetsIfMissing(project: StoredProject): Promise<void> {
    if (await this.assets.hasGeneratedProjectFolder(project.project_id)) return;
    await this.assets.indexGeneratedProjectImages(
      { sourceProjectId: project.project_id, imagesDirectory: path.dirname(this.imagePath(project.project_id, 1)), kind: "short project" },
      project.topic,
      scenesFor(project).map((number) => sceneValue(project.scenes[number - 1], "description")),
    );
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
    // Read-only, so as permissive as regenerate(): once every scene is approved and the project has moved on to
    // WaitingForVideoConfirmation, the review list (all approved) must still be viewable — the Frontend's video
    // confirmation screen relies on this GET succeeding to show it.
    await this.assertReviewable(project, true);
    // Repair on the way past, never at the cost of the read.
    //
    // The seeding this calls existed only on approve and regenerate — two things a finished project never does
    // again — so an project that predates indexing stayed missing from the Library forever, which is exactly
    // what a real project turned out to be (the Episode side). Opening the review screen now fixes it.
    //
    // 🔴 Deliberately swallowed. Indexing reads every scene file and refuses if one is gone, and a GET whose job
    // is to show the review must not start failing because a repair it was doing on the side could not finish.
    await this.indexAssetsIfMissing(project).catch(() => undefined);
    const reviews = await this.load(project.project_id);
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current state.
    const budget = apiKey && this.budget ? await budgetPreviewFor(this.budget, IMAGE_ESTIMATED_COST_USD) : undefined;
    const mappings = await this.mappings.load(this.mappings.projectLocation(project.project_id));
    return {
      project: toApiProject(project),
      reviews: toApiReviews(reviews, project.updated_at, scenesFor(project), project.image_generation_records),
      staleness: await computeSceneStaleness(project, { assets: this.assets, mappings, directory: this.mappings.projectLocation(project.project_id).directory }),
      ...(budget ? { budget } : {}),
    };
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
    try { await this.indexAssetsIfMissing(project); await this.assets.setGeneratedProjectImageApproval(project.project_id, number, true, allApproved); }
    catch { throw imageReviewStorageError(); }
    const updated = allApproved
      ? { ...project, workflow_state: WorkflowState.WaitingForVideoConfirmation, updated_at: timestamp }
      : { ...project, updated_at: timestamp };
    try { await this.projects.save(updated); } catch { throw imageReviewStorageError(); }
    return { project: toApiProject(updated), reviews: toApiReviews(reviews, timestamp, scenes, updated.image_generation_records) };
  }

  /**
   * Drawing one scene again, at the reviewer's request.
   *
   * Keyed on the scene, not the project: regenerating two scenes without waiting for the first is ordinary in a
   * review screen and must not be refused. Two presses on the *same* scene are one intent, and without this
   * they were two charges — the gate and the write sit on opposite sides of the provider call.
   */
  async regenerate(projectId: string, rawSceneNumber: string, body: unknown): Promise<RegenerateImageReviewResponse> {
    const id = projectId.trim();
    try {
      return await withProjectLock(this.projects.projectDirectory(id), `${id}:image-scene-${rawSceneNumber}`,
        () => this.regenerateCore(projectId, rawSceneNumber, body), { timeoutMs: 0 });
    } catch (error) {
      if (error instanceof ProjectLockTimeoutError) throw imageReviewLocked();
      throw error;
    }
  }

  private async regenerateCore(projectId: string, rawSceneNumber: string, body: unknown): Promise<RegenerateImageReviewResponse> {
    if (!isObject(body) || body.approved !== true
      || Object.keys(body).some((key) => key !== "approved" && key !== "additionalInstruction")
      || (body.additionalInstruction !== undefined && typeof body.additionalInstruction !== "string")) throw invalidImageReviewRequest();
    const additionalInstruction = typeof body.additionalInstruction === "string" ? body.additionalInstruction.trim() : "";
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
    let retryEstimate: RegenerateImageReviewResponse["retryEstimate"];
    /** The money is gone and the ledger does not know — carried to the warning and past the estimate below. */
    let spendUnrecorded = false;
    let referenceOmission: { references_used_count: number; references_omitted_count: number } | undefined;
    /** See the same field in local-image-generation.service.ts: the prompt names the Asset, not its bytes. */
    let referenceSources: string[] | undefined;
    if (apiKey && this.budget) {
      const mappings = await this.mappings.load(this.mappings.projectLocation(project.project_id));
      const referenceNotes = await describeReferenceMappingsForScene(this.assets, mappings, number);
      const basePrompt = imagePromptFor(project.scenes[number - 1], styleLineFor(project), referenceNotes);
      const prompt = additionalInstruction ? `${basePrompt}\n${additionalInstruction}` : basePrompt;
      const continuityImagePath = previousSceneContinuityImagePath(project);
      const references = await collectReferenceImages(this.assets, mappings, this.mappings.projectLocation(project.project_id).directory, number, continuityImagePath);
      referenceSources = references.sources;
      if (references.omittedCount > 0) referenceOmission = { references_used_count: references.images.length, references_omitted_count: references.omittedCount };
      try {
        const size = imageSizeFor(project);
        await this.budget.preflight(IMAGE_ESTIMATED_COST_USD);
        let succeeded = false;
        try {
          const result = references.images.length > 0
            ? await callOpenAiImageEditApi(apiKey, prompt, references.images, { size })
            : await callOpenAiImageApi(apiKey, prompt, { size });
          regenerated = result.bytes;
          succeeded = true;
        } finally {
          // A `finally` around a paid call: a throw here discards the bytes OpenAI was already paid for, and on
          // the failure path replaces the provider's real error. Kept and reported instead
          // (providers/budget-ledger.ts, docs/06_DECISIONS.md D-037).
          spendUnrecorded = await recordSpend(() => this.budget!.record(project.project_id, "image", succeeded, IMAGE_ESTIMATED_COST_USD));
        }
      } catch (error) {
        if (isBudgetLedgerUnreadable(error)) throw imageReviewBudgetLedgerUnreadable(); if (error instanceof OpenAiBudgetExceededError) throw imageReviewBudgetExceeded(error.message);
        if (error instanceof OpenAiAdapterError) throw imageReviewProviderError(error.category, error.message);
        throw imageReviewProviderError("unknown", OPENAI_KOREAN_MESSAGES.unknown);
      }
      adapter = references.images.length > 0 ? `${OPENAI_IMAGE_MODEL}:edit` : OPENAI_IMAGE_MODEL;
      apiCalls = 1;
      // Read-only, computed after the fact: reflects the ledger's state right after this regeneration's own
      // record(). Skipped when that record could not be written, because this reads the same file and would
      // throw — taking the response, and the image just paid for, with it. The field is already optional.
      if (!spendUnrecorded) retryEstimate = { perSceneCostUsd: IMAGE_ESTIMATED_COST_USD, budget: await budgetPreviewFor(this.budget, IMAGE_ESTIMATED_COST_USD) };
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
      ...(referenceOmission ?? {}),
      ...(referenceSources !== undefined ? { reference_sources: referenceSources } : {}),
    };
    const records = [...project.image_generation_records];
    records[number - 1] = record;
    const updated: StoredProject = {
      ...project,
      image_generation_records: records,
      workflow_state: WorkflowState.ImagesReview,
      updated_at: timestamp,
      ...(spendUnrecorded ? { warnings: [...project.warnings, spendUnrecordedWarning(`${number}번 장면 이미지 재생성`, OPENAI_LEDGER_FILE)] } : {}),
    };
    try {
      await this.indexAssetsIfMissing(project);
      await this.assets.replaceGeneratedProjectSceneImage(project.project_id, number, currentPath, archive!);
      await atomicWriteUtf8File(this.reviewFile(project.project_id), JSON.stringify(reviews, null, 2));
      await this.projects.save(updated);
    } catch { throw imageReviewStorageError(); }
    return { project: toApiProject(updated), reviews: toApiReviews(reviews, timestamp, scenesFor(updated), updated.image_generation_records), sceneNumber: number, ...(retryEstimate ? { retryEstimate } : {}) };
  }
}
