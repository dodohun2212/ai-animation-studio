import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { IMAGE_ESTIMATED_COST_USD, isSceneNumber, sceneNumbersFor, type ApproveLongEpisodeImageReviewRequest, type ApproveLongEpisodeImageReviewResponse, type GetLongEpisodeImageReviewResponse, type LongEpisodeDetail, type LongEpisodeImageReview, type LongEpisodeStatus, type RegenerateLongEpisodeImageReviewRequest, type RegenerateLongEpisodeImageReviewResponse, type SceneNumber, type StartLongEpisodeImageGenerationRequest, type StartLongEpisodeImageGenerationResponse } from "@ai-animation-studio/shared";
import { validateImage } from "../assets/image-validation.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isSafeProjectId, resolveSafeProjectDirectory } from "../projects/project-id.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { budgetPreviewFor, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError } from "../providers/openai-common.js";
import { OPENAI_IMAGE_MODEL, callOpenAiImageApi, callOpenAiImageEditApi } from "../images/openai-image-adapter.js";
import { imagePromptFor } from "../images/image-prompt.js";
import { longEpisodeImagesBudgetExceeded, longEpisodeImagesInvalid, longEpisodeImagesNotAllowed, longEpisodeImagesProviderError, longEpisodeNotFound, longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { toApiEpisodeScript } from "./episode-script-format.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";
import { EpisodeAssetMappingsService } from "./episode-asset-mappings.service.js";
import { EpisodeContinuityReferenceService } from "./episode-continuity-reference.service.js";
import { collectEpisodeReferenceImages } from "./episode-image-reference-selection.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const statuses: readonly LongEpisodeStatus[] = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted"];
type StoredEpisode = Record<string, unknown> & { number: number; state: LongEpisodeStatus; approved: boolean; script: Record<string, unknown>; script_revision: number; updated_at: string };
type StoredReview = { scene_number: SceneNumber; status: "pending" | "approved"; updated_at: string; regeneration_count: number; history: Record<string, unknown>[]; references_used_count?: number; references_omitted_count?: number };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : object(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
// Must compute byte-for-byte the same fingerprint as episode-asset-mappings.service.ts's fingerprint() (see its
// doc comment) — this is the check that confirms a mapping's stored script_fingerprint still matches the
// Episode's current script before allowing image generation, so the two algorithms disagreeing on whether
// narration counts would make every mapping look stale (or not) inconsistently between the two services.
const withoutNarration = (scene: unknown): unknown => { if (!object(scene)) return scene; const { narration: _narration, ...rest } = scene; return rest; };
const fingerprint = (scenes: unknown[]) => crypto.createHash("sha256").update(JSON.stringify(stable(scenes.map(withoutNarration))), "utf8").digest("hex");
// Format-only check (1..MAX_SCENE_COUNT) — a scene number is confirmed to be within THIS episode's own
// scene_count separately, once the episode has been loaded (see sceneCount()/scenes()).
const sceneNumber = (value: unknown): SceneNumber | undefined => Number.isInteger(value) && isSceneNumber(value as number) ? value as SceneNumber : undefined;

@Injectable()
export class EpisodeImagesService {
  constructor(
    private readonly projectsRoot: string,
    private readonly assets: LocalAssetsRepository = new LocalAssetsRepository(path.dirname(projectsRoot)),
    private readonly mappings: EpisodeAssetMappingsService = new EpisodeAssetMappingsService(projectsRoot, assets),
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: OpenAiBudget,
  ) {}

  private files(projectId: string, number: number) {
    if (!isSafeProjectId(projectId)) throw longUnsafeId();
    const root = path.join(resolveSafeProjectDirectory(this.projectsRoot, projectId), "long_story");
    const episode = path.join(root, `Episode${String(number).padStart(2, "0")}`);
    const images = path.join(episode, "images");
    return { root, outlines: path.join(root, "episode_outlines.json"), episode, project: path.join(episode, "project.json"), longProject: path.join(root, "project.json"), mapping: path.join(episode, "asset_mapping_review.json"), images, reviews: path.join(episode, "generated_image_reviews.json"), continuityMetadata: path.join(episode, "image_generation_metadata.json") };
  }
  private async json(file: string): Promise<unknown> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); } }
  /**
   * Same source as episode-videos.service.ts's ratio() (project.aspect_ratio), translated into OpenAI's own
   * image-generation size vocabulary instead of a Runway ratio string — see image-prompt.ts's imageSizeFor doc
   * comment for why this was missing entirely (`.claude-bridge` Round 165). The short-project side reads this
   * from style_profile.aspect on the project itself; a Long Episode has no such per-project style_profile, so
   * this reads the same aspect_ratio field episode-videos.service.ts already trusts for the same Episode.
   */
  private async imageSize(projectId: string, number: number): Promise<"1024x1536" | "1536x1024"> {
    const raw = await this.json(this.files(projectId, number).longProject);
    if (!object(raw) || (raw.aspect_ratio !== "9:16" && raw.aspect_ratio !== "16:9")) throw longInvalidData();
    return raw.aspect_ratio === "16:9" ? "1536x1024" : "1024x1536";
  }
  private async episode(projectId: string, number: number): Promise<StoredEpisode> {
    if (!Number.isInteger(number) || number < 1) throw longEpisodeNotFound();
    const files = this.files(projectId, number); const outlines = await this.json(files.outlines);
    if (!Array.isArray(outlines) || number > outlines.length || !object(outlines[number - 1]) || outlines[number - 1].episode_number !== number) throw longEpisodeNotFound();
    const raw = await this.json(files.project);
    if (!object(raw) || raw.number !== number || !statuses.includes(raw.state as LongEpisodeStatus) || typeof raw.approved !== "boolean" || !object(raw.script) || !Number.isInteger(raw.script_revision) || Number(raw.script_revision) < 1 || typeof raw.updated_at !== "string") throw longInvalidData();
    return raw as StoredEpisode;
  }
  /** Falls back to 6, matching every Episode stored before scene_count existed (see episode-scripts.service.ts's parseStored). */
  private sceneCount(episode: StoredEpisode): number { return Number.isInteger(episode.scene_count) ? episode.scene_count as number : 6; }
  private scenes(episode: StoredEpisode): unknown[] { const scenes = episode.script.scenes; const count = this.sceneCount(episode); if (!Array.isArray(scenes) || scenes.length !== count || scenes.some((scene, index) => !object(scene) || scene.number !== index + 1 || typeof scene.description !== "string" || !scene.description.trim() || typeof scene.visual_action !== "string" || !scene.visual_action.trim())) throw longInvalidData(); return scenes; }
  private detail(episode: StoredEpisode): LongEpisodeDetail { const script = toApiEpisodeScript(episode.script); const warnings = withoutStaleEpisodeRecoveryWarnings(Array.isArray(episode.warnings) ? episode.warnings.filter((item): item is string => typeof item === "string") : [], episode.state); return { episodeNumber: episode.number, title: String(episode.title), summary: String(episode.summary), mainEvent: String(episode.core_event), conflict: String(episode.conflict), cliffhanger: String(episode.cliffhanger), nextEpisodeHook: String(episode.next_connection), status: episode.state, approved: episode.approved, scriptRevision: episode.script_revision, ...(script ? { script } : {}), scriptHistoryCount: Array.isArray(episode.script_history) ? episode.script_history.length : 0, ...(warnings.length > 0 ? { warnings } : {}) }; }
  private async saveEpisode(projectId: string, number: number, episode: StoredEpisode): Promise<void> {
    const files = this.files(projectId, number); const outlines = await this.json(files.outlines);
    if (!Array.isArray(outlines) || !object(outlines[number - 1])) throw longInvalidData();
    const copied = [...outlines]; copied[number - 1] = { ...copied[number - 1], status: episode.state };
    try { await atomicWriteUtf8File(files.project, JSON.stringify(episode, null, 2)); await atomicWriteUtf8File(files.outlines, JSON.stringify(copied, null, 2)); } catch { throw longStorageError(); }
  }
  private async mappingCurrent(projectId: string, number: number, episode: StoredEpisode): Promise<void> {
    const mapping = await this.json(this.files(projectId, number).mapping);
    if (!object(mapping) || mapping.status !== "approved" || mapping.script_revision !== episode.script_revision || mapping.script_fingerprint !== fingerprint(this.scenes(episode))) throw longEpisodeImagesNotAllowed();
  }
  private image(projectId: string, number: number, scene: SceneNumber) { return path.join(this.files(projectId, number).images, `scene${scene}.png`); }
  private async validImage(file: string): Promise<boolean> { try { return validateImage(await fs.readFile(file), "scene.png", "image/png").extension === ".png"; } catch { return false; } }
  private async writeImage(file: string, bytes: Buffer): Promise<void> {
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`); let renamed = false;
    try { await fs.writeFile(temp, bytes); await fs.rename(temp, file); renamed = true; } finally { if (!renamed) await fs.unlink(temp).catch(() => undefined); }
  }
  private parseReviews(value: unknown): StoredReview[] {
    if (!Array.isArray(value)) throw longInvalidData(); const reviews = value.map((item) => {
      if (!object(item) || Object.keys(item).some((key) => !["scene_number", "status", "updated_at", "regeneration_count", "history", "references_used_count", "references_omitted_count"].includes(key)) || !sceneNumber(item.scene_number) || !["pending", "approved"].includes(item.status as string) || typeof item.updated_at !== "string" || !Number.isInteger(item.regeneration_count) || Number(item.regeneration_count) < 0 || !Array.isArray(item.history) || !item.history.every(object) || (item.references_used_count !== undefined && !Number.isInteger(item.references_used_count)) || (item.references_omitted_count !== undefined && !Number.isInteger(item.references_omitted_count))) throw longInvalidData();
      return item as StoredReview;
    });
    if (new Set(reviews.map((review) => review.scene_number)).size !== reviews.length) throw longInvalidData(); return reviews;
  }
  private async loadReviews(projectId: string, number: number): Promise<StoredReview[]> { try { return this.parseReviews(await this.json(this.files(projectId, number).reviews)); } catch (error) { if (error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404) return []; throw error; } }
  private async saveReviews(projectId: string, number: number, reviews: StoredReview[]) { try { await atomicWriteUtf8File(this.files(projectId, number).reviews, JSON.stringify(reviews, null, 2)); } catch { throw longStorageError(); } }
  private async saveContinuityMetadata(projectId: string, number: number): Promise<void> {
    if (number === 1) return;
    const reference = await new EpisodeContinuityReferenceService(this.projectsRoot).get(projectId, number);
    const value = [{ scene_number: 1, continuity_reference: reference.reference ? { previous_episode_number: reference.reference.previousEpisodeNumber, source_scene_number: reference.reference.sourceSceneNumber, available: reference.reference.available } : null }];
    try { await atomicWriteUtf8File(this.files(projectId, number).continuityMetadata, JSON.stringify(value, null, 2)); } catch { throw longStorageError(); }
  }
  private apiReviews(reviews: StoredReview[], timestamp: string, sceneCount: number): LongEpisodeImageReview[] { const index = new Map(reviews.map((review) => [review.scene_number, review])); return sceneNumbersFor(sceneCount).map((sceneNumber) => { const review = index.get(sceneNumber); const omission = review?.references_used_count !== undefined && review.references_omitted_count !== undefined ? { referencesUsedCount: review.references_used_count, referencesOmittedCount: review.references_omitted_count } : {}; return { sceneNumber, status: review?.status === "approved" ? "approved" : "pending", updatedAt: review?.updated_at || timestamp, ...omission }; }); }
  private async assertReviewable(projectId: string, number: number, episode: StoredEpisode, allowWaiting = false) {
    if (episode.state !== "images_review" && (!allowWaiting || episode.state !== "waiting_for_video_confirmation")) throw longEpisodeImagesNotAllowed();
    if (!(await Promise.all(sceneNumbersFor(this.sceneCount(episode)).map((scene) => this.validImage(this.image(projectId, number, scene))))).every(Boolean)) throw longEpisodeImagesInvalid();
  }
  private approval(request: unknown): asserts request is { approved: true } { if (!object(request) || Object.keys(request).length !== 1 || request.approved !== true) throw longInvalidRequest("Episode image approval request is invalid."); }

  /** The previous Episode's approved final-scene image path, when usable — null otherwise (including Episode 1, which has no predecessor). */
  private async continuityImagePath(projectId: string, number: number): Promise<string | null> {
    const reference = await new EpisodeContinuityReferenceService(this.projectsRoot).get(projectId, number);
    return reference.reference?.available ? this.image(projectId, number - 1, reference.reference.sourceSceneNumber) : null;
  }

  async generate(projectId: string, number: number, request: StartLongEpisodeImageGenerationRequest): Promise<StartLongEpisodeImageGenerationResponse> {
    const id = projectId.trim(); this.approval(request); const episode = await this.episode(id, number);
    if (episode.state !== "asset_mapping_approved" || !episode.approved) throw longEpisodeImagesNotAllowed(); await this.mappingCurrent(id, number, episode);
    const scenes = this.scenes(episode);
    episode.state = "generating_images"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode);
    const generated: SceneNumber[] = []; const reused: SceneNumber[] = [];
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    const candidates = apiKey && this.budget ? (await this.mappings.get(id, number)).review.candidates : [];
    const referenceOmissions = new Map<SceneNumber, { references_used_count: number; references_omitted_count: number }>();
    try {
      await fs.mkdir(this.files(id, number).images, { recursive: true });
      await this.saveContinuityMetadata(id, number);
      const continuityPath = apiKey && this.budget ? await this.continuityImagePath(id, number) : null;
      for (const scene of sceneNumbersFor(this.sceneCount(episode))) {
        const file = this.image(id, number, scene);
        if (await this.validImage(file)) { reused.push(scene); continue; }
        let bytes: Buffer = PNG;
        if (apiKey && this.budget) {
          const prompt = imagePromptFor(scenes[scene - 1], "");
          const references = await collectEpisodeReferenceImages(this.assets, candidates, number, scene, continuityPath);
          if (references.omittedCount > 0) referenceOmissions.set(scene, { references_used_count: references.images.length, references_omitted_count: references.omittedCount });
          const size = await this.imageSize(id, number);
          await this.budget.preflight(IMAGE_ESTIMATED_COST_USD);
          let succeeded = false;
          try {
            const result = references.images.length > 0 ? await callOpenAiImageEditApi(apiKey, prompt, references.images, { size }) : await callOpenAiImageApi(apiKey, prompt, { size });
            bytes = result.bytes; succeeded = true;
          } finally { await this.budget.record(id, "image", succeeded, IMAGE_ESTIMATED_COST_USD); }
        }
        await this.writeImage(file, bytes); if (!await this.validImage(file)) throw new Error("invalid image"); generated.push(scene);
      }
      if (referenceOmissions.size > 0) {
        const reviews = await this.loadReviews(id, number);
        for (const [scene, omission] of referenceOmissions) {
          const index = reviews.findIndex((item) => item.scene_number === scene);
          const now = new Date().toISOString();
          const base: StoredReview = index < 0 ? { scene_number: scene, status: "pending", updated_at: now, regeneration_count: 0, history: [] } : reviews[index]!;
          const updatedReview: StoredReview = { ...base, ...omission };
          if (index < 0) reviews.push(updatedReview); else reviews[index] = updatedReview;
        }
        await this.saveReviews(id, number, reviews);
      }
      episode.state = "images_ready"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode);
      episode.state = "images_review"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode);
    } catch (error) {
      episode.state = "asset_mapping_approved"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode).catch(() => undefined);
      if (error instanceof OpenAiBudgetExceededError) throw longEpisodeImagesBudgetExceeded(error.message);
      if (error instanceof OpenAiAdapterError) throw longEpisodeImagesProviderError(error.category, error.message);
      if (error instanceof Error && error.message === "invalid image") throw longEpisodeImagesInvalid();
      throw longStorageError();
    }
    // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current state.
    const budget = apiKey && this.budget ? await budgetPreviewFor(this.budget, generated.length * IMAGE_ESTIMATED_COST_USD) : undefined;
    return { episode: this.detail(episode), generatedSceneNumbers: generated, reusedSceneNumbers: reused, ...(budget ? { budget } : {}) };
  }
  async get(projectId: string, number: number): Promise<GetLongEpisodeImageReviewResponse> {
    const id = projectId.trim(); const episode = await this.episode(id, number); await this.assertReviewable(id, number, episode);
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    const budget = apiKey && this.budget ? await budgetPreviewFor(this.budget, IMAGE_ESTIMATED_COST_USD) : undefined;
    return { episode: this.detail(episode), reviews: this.apiReviews(await this.loadReviews(id, number), episode.updated_at, this.sceneCount(episode)), ...(budget ? { budget } : {}) };
  }
  async approve(projectId: string, number: number, rawScene: string, request: ApproveLongEpisodeImageReviewRequest): Promise<ApproveLongEpisodeImageReviewResponse> {
    const id = projectId.trim(); this.approval(request); const scene = sceneNumber(Number(rawScene)); if (!scene || String(scene) !== rawScene) throw longInvalidRequest("Episode image scene number is invalid."); const episode = await this.episode(id, number); await this.assertReviewable(id, number, episode);
    if (scene > this.sceneCount(episode)) throw longInvalidRequest("Episode image scene number is invalid.");
    const reviews = await this.loadReviews(id, number); const now = new Date().toISOString(); const index = reviews.findIndex((review) => review.scene_number === scene); const old = index < 0 ? undefined : reviews[index]; const review: StoredReview = { scene_number: scene, status: "approved", updated_at: now, regeneration_count: old?.regeneration_count ?? 0, history: [...(old?.history ?? []), { event: "approved", timestamp: now }], ...(old?.references_used_count !== undefined && old.references_omitted_count !== undefined ? { references_used_count: old.references_used_count, references_omitted_count: old.references_omitted_count } : {}) }; if (index < 0) reviews.push(review); else reviews[index] = review;
    const all = sceneNumbersFor(this.sceneCount(episode)).every((current) => reviews.some((item) => item.scene_number === current && item.status === "approved")); if (all) episode.state = "waiting_for_video_confirmation"; episode.updated_at = now; await this.saveReviews(id, number, reviews); await this.saveEpisode(id, number, episode); return { episode: this.detail(episode), reviews: this.apiReviews(reviews, now, this.sceneCount(episode)) };
  }
  async regenerate(projectId: string, number: number, rawScene: string, request: RegenerateLongEpisodeImageReviewRequest): Promise<RegenerateLongEpisodeImageReviewResponse> {
    const id = projectId.trim(); this.approval(request); const scene = sceneNumber(Number(rawScene)); if (!scene || String(scene) !== rawScene) throw longInvalidRequest("Episode image scene number is invalid."); const episode = await this.episode(id, number); await this.assertReviewable(id, number, episode, true);
    if (scene > this.sceneCount(episode)) throw longInvalidRequest("Episode image scene number is invalid.");
    const reviews = await this.loadReviews(id, number);
    const current = this.image(id, number, scene); let bytes: Buffer; try { bytes = await fs.readFile(current); if (!await this.validImage(current)) throw new Error(); } catch { throw longEpisodeImagesInvalid(); }

    // Resolve the real-vs-fake regenerated bytes BEFORE touching any file: a failed real request must never
    // archive or overwrite the still-valid current image.
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    let regenerated: Buffer = PNG;
    let retryEstimate: RegenerateLongEpisodeImageReviewResponse["retryEstimate"];
    let referenceOmission: { references_used_count: number; references_omitted_count: number } | undefined;
    if (apiKey && this.budget) {
      const scenes = this.scenes(episode);
      const prompt = imagePromptFor(scenes[scene - 1], "");
      const candidates = (await this.mappings.get(id, number)).review.candidates;
      const continuityPath = await this.continuityImagePath(id, number);
      const references = await collectEpisodeReferenceImages(this.assets, candidates, number, scene, continuityPath);
      if (references.omittedCount > 0) referenceOmission = { references_used_count: references.images.length, references_omitted_count: references.omittedCount };
      try {
        const size = await this.imageSize(id, number);
        await this.budget.preflight(IMAGE_ESTIMATED_COST_USD);
        let succeeded = false;
        try {
          const result = references.images.length > 0 ? await callOpenAiImageEditApi(apiKey, prompt, references.images, { size }) : await callOpenAiImageApi(apiKey, prompt, { size });
          regenerated = result.bytes; succeeded = true;
        } finally { await this.budget.record(id, "image", succeeded, IMAGE_ESTIMATED_COST_USD); }
      } catch (error) {
        if (error instanceof OpenAiBudgetExceededError) throw longEpisodeImagesBudgetExceeded(error.message);
        if (error instanceof OpenAiAdapterError) throw longEpisodeImagesProviderError(error.category, error.message);
        throw longEpisodeImagesProviderError("unknown", OPENAI_KOREAN_MESSAGES.unknown);
      }
      // Read-only, computed after the fact: reflects the ledger's state right after this regeneration's own record().
      retryEstimate = { perSceneCostUsd: IMAGE_ESTIMATED_COST_USD, budget: await budgetPreviewFor(this.budget, IMAGE_ESTIMATED_COST_USD) };
    }

    const originals = path.join(this.files(id, number).images, "originals"); let archive = "";
    try { await fs.mkdir(originals, { recursive: true }); const entries = await fs.readdir(originals); const versions = entries.map((name) => new RegExp(`^scene${scene}_v(\\d{3})\\.png$`).exec(name)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1])); archive = path.join(originals, `scene${scene}_v${String((versions.length ? Math.max(...versions) : 0) + 1).padStart(3, "0")}.png`); await this.writeImage(archive, bytes); await this.writeImage(current, regenerated); if (!await this.validImage(current)) throw new Error("invalid image"); } catch { if (archive) await fs.unlink(archive).catch(() => undefined); throw longStorageError(); }
    const now = new Date().toISOString(); const index = reviews.findIndex((review) => review.scene_number === scene); const old = index < 0 ? undefined : reviews[index]; const review: StoredReview = { scene_number: scene, status: "pending", updated_at: now, regeneration_count: (old?.regeneration_count ?? 0) + 1, history: [...(old?.history ?? []), { event: "regenerated", timestamp: now, archive: path.basename(archive) }], ...(referenceOmission ?? {}) }; if (index < 0) reviews.push(review); else reviews[index] = review; episode.state = "images_review"; episode.updated_at = now; await this.saveReviews(id, number, reviews); await this.saveEpisode(id, number, episode); return { episode: this.detail(episode), reviews: this.apiReviews(reviews, now, this.sceneCount(episode)), sceneNumber: scene, ...(retryEstimate ? { retryEstimate } : {}) };
  }
}
