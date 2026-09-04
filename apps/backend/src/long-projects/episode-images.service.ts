import { PLACEHOLDER_PNG } from "../images/placeholder-image.js";
import { ProjectLockTimeoutError, withProjectLock } from "../videos/project-lock.js";
import { resolveSafeProjectDirectory } from "../projects/project-id.js";
import { persistEpisodeWarning } from "./episode-warnings.js";
import { OPENAI_LEDGER_FILE, isBudgetLedgerUnreadable, recordSpend, spendUnrecordedWarning } from "../providers/budget-ledger.js";
import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { LONG_EPISODE_STATUSES, IMAGE_ESTIMATED_COST_USD, longEpisodeHasImages, isSceneNumber, sceneNumbersFor, type ApproveLongEpisodeImageReviewRequest, type ApproveLongEpisodeImageReviewResponse, type GetLongEpisodeImagePreviewResponse, type GetLongEpisodeImageProgressResponse, type GetLongEpisodeImageReviewResponse, type LongEpisodeDetail, type LongEpisodeImageReview, type LongEpisodeImageStaleness, type LongEpisodeStatus, type LongEpisodeStoryBibleLinkDrift, type RegenerateLongEpisodeImageReviewRequest, type RegenerateLongEpisodeImageReviewResponse, type SceneNumber, type StartLongEpisodeImageGenerationRequest, type StartLongEpisodeImageGenerationResponse } from "@ai-animation-studio/shared";
import { validateImage } from "../assets/image-validation.js";
import { LocalAssetsRepository, type GeneratedImageSource } from "../assets/assets.repository.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { budgetPreviewFor, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OPENAI_KOREAN_MESSAGES, OpenAiAdapterError } from "../providers/openai-common.js";
import { OPENAI_IMAGE_MODEL, callOpenAiImageApi, callOpenAiImageEditApi } from "../images/openai-image-adapter.js";
import { imagePromptFor } from "../images/image-prompt.js";
import { longBudgetLedgerUnreadable, longEpisodeImagesBudgetExceeded, longEpisodeImagesInvalid, longEpisodeImagesNotAllowed, longEpisodeImagesProviderError, longEpisodeNotFound, longInvalidData, longInvalidRequest, longLocked, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { episodeDirectoryName, longStoryRoot } from "./long-project-paths.js";
import { toApiEpisodeScript } from "./episode-script-format.js";
import { toEpisodeDetail } from "./episode-detail.js";
import { withoutStaleEpisodeRecoveryWarnings } from "./orphaned-episode-generation-recovery.service.js";
import { EpisodeContinuityReferenceService } from "./episode-continuity-reference.service.js";
import type { StoredAssetMapping } from "../mappings/mapping-storage.js";
import { storyBibleLinkDrift } from "./episode-story-bible-drift.js";
import { describeReferenceMappingsForScene } from "../images/image-reference-selection.js";
import { collectReferenceImages, referenceSourcesForScene } from "../images/image-reference-selection.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { EpisodeMappingOwners } from "./episode-mapping-owner.js";

/** The local fake path's bytes, shared so nothing can hold a second opinion about them. */
const PNG = PLACEHOLDER_PNG;
const statuses: readonly LongEpisodeStatus[] = LONG_EPISODE_STATUSES;
type StoredEpisode = Record<string, unknown> & { number: number; state: LongEpisodeStatus; approved: boolean; script: Record<string, unknown>; script_revision: number; updated_at: string };
/** `prompt` is what this scene's image was actually generated from — written only when a provider made it, so a placeholder records nothing and is never reported as behind. */


type StoredReview = { scene_number: SceneNumber; status: "pending" | "approved"; updated_at: string; regeneration_count: number; history: Record<string, unknown>[]; references_used_count?: number; references_omitted_count?: number; prompt?: string; reference_sources?: string[] };
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
    /**
     * The short project's mapping store and this Episode's owner, rather than the Episode's own mapping
     * service. Reference images now come from the same mappings a person can create by hand, with the same
     * per-scene scope — the reimplementation this replaces had neither.
     */
    private readonly mappingStore: LocalProjectAssetMappingsRepository = new LocalProjectAssetMappingsRepository(projectsRoot),
    private readonly mappingOwners: EpisodeMappingOwners = new EpisodeMappingOwners(projectsRoot),
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: OpenAiBudget,
  ) {}

  private files(projectId: string, number: number) {
    const root = longStoryRoot(this.projectsRoot, projectId);
    const episode = path.join(root, episodeDirectoryName(number));
    const images = path.join(episode, "images");
    return { root, outlines: path.join(root, "episode_outlines.json"), episode, project: path.join(episode, "project.json"), longProject: path.join(root, "project.json"), mapping: path.join(episode, "asset_mapping_review.json"), images, reviews: path.join(episode, "generated_image_reviews.json"), continuityMetadata: path.join(episode, "image_generation_metadata.json") };
  }
  private async json(file: string): Promise<unknown> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); } }
  /**
   * Same source as episode-videos.service.ts's ratio() (project.aspect_ratio), translated into OpenAI's own
   * image-generation size vocabulary instead of a Runway ratio string — see image-prompt.ts's imageSizeFor doc
   * comment for why this was missing entirely. The short-project side reads this
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
    // An Episode listed in the outline but never scripted has no directory yet, so this read is ENOENT — which
    // `json()` reports as `longNotFound()`, "Long project was not found". The project is right there; the person
    // was looking at it a moment ago. Measured over real data: Episode 2 of a real long project answered 200 for
    // its detail and 404 "Long project was not found" for its image review, in the same breath.
    //
    // The truthful answer is the one a scripted Episode in the wrong state already gets. episode-narration
    // does exactly this and says why: a per-episode project.json that is not there yet is "no script yet", not
    // a storage failure and not a missing project.
    let raw: unknown;
    try { raw = await this.json(files.project); }
    catch (error) { if (error instanceof Error && "getStatus" in error && (error as { getStatus(): number }).getStatus() === 404) throw longEpisodeImagesNotAllowed(); throw error; }
    if (!object(raw) || raw.number !== number || !statuses.includes(raw.state as LongEpisodeStatus) || typeof raw.approved !== "boolean" || !object(raw.script) || !Number.isInteger(raw.script_revision) || Number(raw.script_revision) < 1 || typeof raw.updated_at !== "string") throw longInvalidData();
    return raw as StoredEpisode;
  }
  /** Falls back to 6, matching every Episode stored before scene_count existed (see episode-scripts.service.ts's parseStored). */
  private sceneCount(episode: StoredEpisode): number { return Number.isInteger(episode.scene_count) ? episode.scene_count as number : 6; }
  private scenes(episode: StoredEpisode): unknown[] { const scenes = episode.script.scenes; const count = this.sceneCount(episode); if (!Array.isArray(scenes) || scenes.length !== count || scenes.some((scene, index) => !object(scene) || scene.number !== index + 1 || typeof scene.description !== "string" || !scene.description.trim() || typeof scene.visual_action !== "string" || !scene.visual_action.trim())) throw longInvalidData(); return scenes; }
  private detail(episode: StoredEpisode): LongEpisodeDetail { return toEpisodeDetail(episode); }
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
  /**
   * Where one Episode scene's generated image actually is, once it is confirmed to be one.
   *
   * There was no way to fetch these at all: the Episode had four routes and none of them served bytes, so its
   * screen had nothing to put in an <img> and rendered none. People were approving and paying to regenerate
   * pictures they could not see. The short project has had this route the whole time.
   *
   * Deliberately no state gate. A picture that exists can be looked at whenever — refusing to show it because
   * the Episode has moved on is how a review screen ends up unable to display the thing being reviewed.
   */
  async content(projectId: string, number: number, rawSceneNumber: string): Promise<{ path: string }> {
    const id = projectId.trim();
    const episode = await this.episode(id, number);
    const scene = sceneNumber(Number(rawSceneNumber));
    if (!scene || scene > this.sceneCount(episode)) throw longEpisodeImagesInvalid();
    const file = this.image(id, number, scene);
    if (!(await this.validImage(file))) throw longEpisodeImagesInvalid();
    return { path: file };
  }

  private image(projectId: string, number: number, scene: SceneNumber) { return path.join(this.files(projectId, number).images, `scene${scene}.png`); }
  private async validImage(file: string): Promise<boolean> { try { return validateImage(await fs.readFile(file), "scene.png", "image/png").extension === ".png"; } catch { return false; } }
  private async writeImage(file: string, bytes: Buffer): Promise<void> {
    const temp = path.join(path.dirname(file), `.${path.basename(file)}.${crypto.randomUUID()}.tmp`); let renamed = false;
    try { await fs.writeFile(temp, bytes); await fs.rename(temp, file); renamed = true; } finally { if (!renamed) await fs.unlink(temp).catch(() => undefined); }
  }
  private parseReviews(value: unknown): StoredReview[] {
    if (!Array.isArray(value)) throw longInvalidData(); const reviews = value.map((item) => {
      if (!object(item) || Object.keys(item).some((key) => !["scene_number", "status", "updated_at", "regeneration_count", "history", "references_used_count", "references_omitted_count", "prompt", "reference_sources"].includes(key)) || !sceneNumber(item.scene_number) || !["pending", "approved"].includes(item.status as string) || typeof item.updated_at !== "string" || !Number.isInteger(item.regeneration_count) || Number(item.regeneration_count) < 0 || !Array.isArray(item.history) || !item.history.every(object) || (item.references_used_count !== undefined && !Number.isInteger(item.references_used_count)) || (item.references_omitted_count !== undefined && !Number.isInteger(item.references_omitted_count)) || (item.prompt !== undefined && typeof item.prompt !== "string") || (item.reference_sources !== undefined && !(Array.isArray(item.reference_sources) && item.reference_sources.every((entry) => typeof entry === "string")))) throw longInvalidData();
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
    await this.assertImagesOnDisk(projectId, number, episode);
  }

  /** Every scene's picture actually present — the half of reviewability that is about files rather than state. */
  private async assertImagesOnDisk(projectId: string, number: number, episode: StoredEpisode) {
    if (!(await Promise.all(sceneNumbersFor(this.sceneCount(episode)).map((scene) => this.validImage(this.image(projectId, number, scene))))).every(Boolean)) throw longEpisodeImagesInvalid();
  }
  private approval(request: unknown): asserts request is { approved: true } { if (!object(request) || Object.keys(request).length !== 1 || request.approved !== true) throw longInvalidRequest("Episode image approval request is invalid."); }

  /**
   * The regeneration body: approval, plus optional one-off direction for this single attempt.
   *
   * Separate from `approval()` because approving an image and re-buying one are different acts — an approval
   * that quietly accepted an instruction would be a paid field on a free route.
   */
  private regenerationRequest(request: unknown): string {
    if (!object(request) || request.approved !== true
      || Object.keys(request).some((key) => key !== "approved" && key !== "additionalInstruction")
      || (request.additionalInstruction !== undefined && typeof request.additionalInstruction !== "string")) {
      throw longInvalidRequest("Episode image regeneration requires explicit approval.");
    }
    return typeof request.additionalInstruction === "string" ? request.additionalInstruction.trim() : "";
  }

  /** The previous Episode's approved final-scene image path, when usable — null otherwise (including Episode 1, which has no predecessor). */
  private async continuityImagePath(projectId: string, number: number): Promise<string | null> {
    const reference = await new EpisodeContinuityReferenceService(this.projectsRoot).get(projectId, number);
    return reference.reference?.available ? this.image(projectId, number - 1, reference.reference.sourceSceneNumber) : null;
  }

  /**
   * What a generation would actually buy, before anything is sent.
   *
   * The confirmation quoted every scene while `generate()` skips any that already has a usable picture and
   * charges nothing for it — so a retry after three scenes succeeded was quoted at six and cost three. Reading
   * a price the app already knew was wrong is not the safe direction: **overstating** a cost stops people doing
   * work they could afford, and this app's whole argument for showing costs is that the number can be trusted.
   *
   * Free and provider-free: it looks at files on disk, exactly as the generation loop does, and never calls out.
   * The same eligibility gate as `generate()`, so a preflight that answers is a generation that would run.
   */
  /**
   * How the Asset Library names one Episode's generated images.
   *
   * The Episode, not just the Long Project it belongs to — the same identity `EpisodeMappingOwner.id` already
   * uses, and for the same reason: two Episodes of one project would otherwise share a Folder and a scene key,
   * so approving scene 1 of Episode 2 would find Episode 1's picture.
   *
   * These records name a directory another module renames: archiving an Episode moves it aside, and a restore
   * brings it back under a different number. Nothing repoints them, and the project-level answer
   * (`listExcludingArchivedProjects`) only knows about `<projectsRoot>/.archive`. What keeps this from leaving a
   * Folder of dead pictures is a gate two files away — archiving is refused unless every Episode is still a
   * draft, so an Episode that has images cannot be archived at all. `episode-archive-assets.integration.test.ts`
   * is what goes red if that gate is ever widened.
   */
  private assetSource(projectId: string, number: number): GeneratedImageSource {
    return {
      sourceProjectId: `${projectId}/${episodeDirectoryName(number)}`,
      imagesDirectory: this.files(projectId, number).images,
      kind: "long episode",
    };
  }

  /**
   * Put this Episode's scene images in the Asset Library, the way a short project's have always been.
   *
   * Without this the Episode's pictures exist on disk and nowhere in the Library, so the whole Folder-shaped
   * half of the app — a representative image, the Folder's own description, reusing a picture as a reference
   * for the next Episode — has nothing to act on. The Episode was already reading the Library through
   * `collectReferenceImages`; only the writing back was missing.
   */
  private async indexAssets(projectId: string, number: number, episode: StoredEpisode): Promise<void> {
    const descriptions = this.scenes(episode).map((scene) => String((scene as { description: string }).description));
    let title = "";
    try {
      const outlines = await this.json(this.files(projectId, number).outlines);
      const outline = Array.isArray(outlines) ? outlines[number - 1] : undefined;
      if (object(outline) && typeof outline.title === "string") title = outline.title;
    } catch { /* The Folder's description is a nicety; a damaged outline file must not fail image generation. */ }
    await this.assets.indexGeneratedProjectImages(this.assetSource(projectId, number), title, descriptions);
  }

  /**
   * Index on demand for an Episode whose pictures predate indexing entirely.
   *
   * Approving and replacing both look records up and treat a missing Folder as corruption, which is the right
   * reading for a source that was indexed once and the wrong one for an Episode generated before any of this
   * existed. Those Episodes are on disk right now, so the alternative is that approving one starts failing.
   */
  private async indexAssetsIfMissing(projectId: string, number: number, episode: StoredEpisode): Promise<void> {
    const source = this.assetSource(projectId, number);
    if (await this.assets.hasGeneratedProjectFolder(source.sourceProjectId)) return;
    await this.indexAssets(projectId, number, episode);
  }

  async preview(projectId: string, number: number): Promise<GetLongEpisodeImagePreviewResponse> {
    const id = projectId.trim();
    const episode = await this.episode(id, number);
    if (episode.state !== "asset_mapping_approved" || !episode.approved) throw longEpisodeImagesNotAllowed();
    const sceneNumbers = sceneNumbersFor(this.sceneCount(episode));
    const generatable: SceneNumber[] = [];
    const reusable: SceneNumber[] = [];
    for (const scene of sceneNumbers) {
      // The same question `generate()` asks per scene, asked here without acting on the answer.
      if (await this.validImage(this.image(id, number, scene))) reusable.push(scene); else generatable.push(scene);
    }
    const estimatedCostUsd = generatable.length * IMAGE_ESTIMATED_COST_USD;
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    const budget = apiKey && this.budget ? await budgetPreviewFor(this.budget, estimatedCostUsd) : undefined;
    return { preview: { sceneNumbers, generatableSceneNumbers: generatable, reusableSceneNumbers: reusable, estimatedCostUsd, ...(budget ? { budget } : {}) } };
  }

  /**
   * How far a run has got, scene by scene — the one reading the screen can take while pictures are still coming.
   *
   * Deliberately asserts nothing. `get()` below refuses unless every scene's image is on disk, which is right
   * for a review, and it is why this could not simply reuse it: the moment worth reporting is exactly the one
   * where they are not all there yet.
   *
   * The whole answer is on disk. Each scene is written and validated before the loop starts the next one, and a
   * scene that already has a usable picture is skipped rather than bought again, so "which scenes are done" and
   * "which one is being made" both fall out of the same `validImage` question `generate()` and `preview()` ask.
   * No run record is kept for this, on purpose: a second copy of the answer is a copy that can disagree with the
   * pictures, and the day it does the screen reports an image nobody has.
   *
   * `validImage` rather than a `stat`, for the same reason the generation loop uses it: a file that exists is
   * not the same as a picture, and a half-written one must not be counted as finished.
   */
  async progress(projectId: string, number: number): Promise<GetLongEpisodeImageProgressResponse> {
    const id = projectId.trim();
    const episode = await this.episode(id, number);
    const sceneNumbers = sceneNumbersFor(this.sceneCount(episode));
    const completedSceneNumbers: SceneNumber[] = [];
    const pending: SceneNumber[] = [];
    for (const scene of sceneNumbers) {
      if (await this.validImage(this.image(id, number, scene))) completedSceneNumbers.push(scene); else pending.push(scene);
    }
    // Only while the run is actually in flight. The loop is sequential, so the first scene without a picture is
    // the one being drawn right now — but that sentence is only true during a run, and outside one the same
    // number would claim work nobody has started.
    const currentSceneNumber = episode.state === "generating_images" ? pending[0] : undefined;
    return { episode: this.detail(episode), progress: { sceneNumbers, completedSceneNumbers, ...(currentSceneNumber ? { currentSceneNumber } : {}) } };
  }

  /**
   * Refuses a second run while one is in flight, the way Episode narration and Episode scripts already do.
   *
   * Same shape as the short project's: the state is read, the run is allowed, and only then is
   * `generating_images` written. Two presses that arrive together both pass the gate and both walk every scene
   * finding no image yet — two paid images per scene for one asked-for run.
   */
  async generate(projectId: string, number: number, request: StartLongEpisodeImageGenerationRequest): Promise<StartLongEpisodeImageGenerationResponse> {
    const locked = projectId.trim();
    try {
      return await withProjectLock(resolveSafeProjectDirectory(this.projectsRoot, locked), `${locked}:episode-${number}:images`, () => this.generateCore(projectId, number, request), { timeoutMs: 0 });
    } catch (error) {
      if (error instanceof ProjectLockTimeoutError) throw longLocked("Episode image generation");
      throw error;
    }
  }

  private async generateCore(projectId: string, number: number, request: StartLongEpisodeImageGenerationRequest): Promise<StartLongEpisodeImageGenerationResponse> {
    const id = projectId.trim(); this.approval(request); const episode = await this.episode(id, number);
    if (episode.state !== "asset_mapping_approved" || !episode.approved) throw longEpisodeImagesNotAllowed(); await this.mappingCurrent(id, number, episode);
    const scenes = this.scenes(episode);
    episode.state = "generating_images"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode);
    const generated: SceneNumber[] = []; const reused: SceneNumber[] = [];
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    const owner = apiKey && this.budget ? await this.mappingOwners.get({ projectId: id, episodeNumber: number }) : null;
    const mappings = owner ? await this.mappingStore.load(owner) : [];
    const referenceOmissions = new Map<SceneNumber, { references_used_count: number; references_omitted_count: number }>();
    const referenceSources = new Map<SceneNumber, string[]>();
    // What each scene's image was actually generated from, so a later script edit can be seen rather than guessed at.
    const generatedPrompts = new Map<SceneNumber, string>();
    /** Scenes whose paid call landed but whose cost could not be written down — providers/budget-ledger.ts. */
    const unrecordedScenes: SceneNumber[] = [];
    const noteUnrecorded = async () => { if (unrecordedScenes.length > 0) await persistEpisodeWarning(this.files(id, number), number, episode, spendUnrecordedWarning(`${unrecordedScenes.join(", ")}번 장면 이미지 생성`, OPENAI_LEDGER_FILE)); };
    try {
      await fs.mkdir(this.files(id, number).images, { recursive: true });
      await this.saveContinuityMetadata(id, number);
      const continuityPath = apiKey && this.budget ? await this.continuityImagePath(id, number) : null;
      for (const scene of sceneNumbersFor(this.sceneCount(episode))) {
        const file = this.image(id, number, scene);
        if (await this.validImage(file)) { reused.push(scene); continue; }
        let bytes: Buffer = PNG;
        if (apiKey && this.budget) {
          // The same block the short project has folded in since references were added (image-prompt.ts's
          // referenceNotes doc): the photos below go up as bytes, and without this the model is never told whose
          // photo it is, what role the person mapped them as, or anything a picture cannot carry. Measured: an
          // Episode's paid request named nobody.
          const referenceNotes = await describeReferenceMappingsForScene(this.assets, mappings, scene);
          const prompt = imagePromptFor(scenes[scene - 1], "", referenceNotes);
          // The plain scene prompt is what gets recorded, for the same reason the one-off direction below is
          // left out of it: staleness must measure the script, and folding the References block in would make a
          // scene read as behind its own script the moment somebody edits an Asset's description. Which
          // references were used is measured separately and by name, in `reference_sources` below.
          generatedPrompts.set(scene, imagePromptFor(scenes[scene - 1], ""));
          const references = await collectReferenceImages(this.assets, mappings, owner!.directory, scene, continuityPath);
          referenceSources.set(scene, references.sources);
          if (references.omittedCount > 0) referenceOmissions.set(scene, { references_used_count: references.images.length, references_omitted_count: references.omittedCount });
          const size = await this.imageSize(id, number);
          await this.budget.preflight(IMAGE_ESTIMATED_COST_USD);
          let succeeded = false;
          try {
            const result = references.images.length > 0 ? await callOpenAiImageEditApi(apiKey, prompt, references.images, { size }) : await callOpenAiImageApi(apiKey, prompt, { size });
            bytes = result.bytes; succeeded = true;
          } finally {
          // `recordSpend`, not a bare await: this is a `finally` around a paid call, so a throw here discards
          // what OpenAI was already paid for and, on the failure path, replaces the provider's real error
          // (providers/budget-ledger.ts, docs/06_DECISIONS.md D-037).
            if (await recordSpend(() => this.budget!.record(id, "image", succeeded, IMAGE_ESTIMATED_COST_USD))) unrecordedScenes.push(scene);
          }
        }
        await this.writeImage(file, bytes); if (!await this.validImage(file)) throw new Error("invalid image"); generated.push(scene);
      }
      if (referenceOmissions.size > 0 || generatedPrompts.size > 0 || referenceSources.size > 0) {
        const reviews = await this.loadReviews(id, number);
        for (const scene of new Set([...referenceOmissions.keys(), ...generatedPrompts.keys(), ...referenceSources.keys()])) {
          const index = reviews.findIndex((item) => item.scene_number === scene);
          const now = new Date().toISOString();
          const base: StoredReview = index < 0 ? { scene_number: scene, status: "pending", updated_at: now, regeneration_count: 0, history: [] } : reviews[index]!;
          const prompt = generatedPrompts.get(scene);
          const sources = referenceSources.get(scene);
          const updatedReview: StoredReview = { ...base, ...(referenceOmissions.get(scene) ?? {}), ...(prompt !== undefined ? { prompt } : {}), ...(sources !== undefined ? { reference_sources: sources } : {}) };
          if (index < 0) reviews.push(updatedReview); else reviews[index] = updatedReview;
        }
        await this.saveReviews(id, number, reviews);
      }
      await this.indexAssets(id, number, episode);
    // Said once for the whole run, not once per scene, and on both ways out: a ledger that breaks mid-run stops
    // the next scene at its own preflight, so the run leaves through the catch above and the happy path never
    // runs. Without it, everything bought before the break goes unmentioned.
      await noteUnrecorded();
      episode.state = "images_ready"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode);
      episode.state = "images_review"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode);
    } catch (error) {
      await noteUnrecorded();
      episode.state = "asset_mapping_approved"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode).catch(() => undefined);
      if (isBudgetLedgerUnreadable(error)) throw longBudgetLedgerUnreadable(); if (error instanceof OpenAiBudgetExceededError) throw longEpisodeImagesBudgetExceeded(error.message);
      if (error instanceof OpenAiAdapterError) throw longEpisodeImagesProviderError(error.category, error.message);
      if (error instanceof Error && error.message === "invalid image") throw longEpisodeImagesInvalid();
      throw longStorageError();
    }
    // Read-only, same as a preview's budget field — never reserves anything, just reports the ledger's current state.
    const budget = apiKey && this.budget && unrecordedScenes.length === 0 ? await budgetPreviewFor(this.budget, generated.length * IMAGE_ESTIMATED_COST_USD) : undefined;
    return { episode: this.detail(episode), generatedSceneNumbers: generated, reusedSceneNumbers: reused, ...(budget ? { budget } : {}) };
  }
  /**
   * Which images were paid for against a script that has since changed.
   *
   * Same method as the video side and the short project's: rebuild the prompt from the scene as it stands and
   * compare it to the one recorded at generation. Never a stored flag — a flag has to be cleared by whoever
   * edits the scene, and someone will forget.
   *
   * Only scenes with a recorded prompt can appear. That covers images a provider actually made from this
   * change onward; a placeholder records nothing, and images generated before this was recorded record nothing
   * either. The list therefore says "these are known to be behind" and never "the rest are current" — the
   * screen must not turn its silence into a reassurance.
   */
  private async imageStaleness(projectId: string, number: number, episode: StoredEpisode, reviews: StoredReview[]): Promise<LongEpisodeImageStaleness> {
    const scenes = this.scenes(episode);
    const imageStale: SceneNumber[] = [];
    const referenceStale: SceneNumber[] = [];
    // Resolved once for the whole Episode rather than per scene: the mappings and the continuity link are the
    // same for every scene, and the per-scene part (which mappings are in scope) is inside the recompute.
    const context = await this.referenceContext(projectId, number);
    for (const scene of sceneNumbersFor(this.sceneCount(episode))) {
      const review = reviews.find((item) => item.scene_number === scene);
      const current = scenes[scene - 1];
      if (review?.prompt !== undefined && current && imagePromptFor(current, "") !== review.prompt) imageStale.push(scene);

      const recordedSources = review?.reference_sources;
      if (recordedSources === undefined || !context) continue;
      const now = await referenceSourcesForScene(this.assets, context.mappings, context.directory, scene, context.continuityPath);
      // Order matters as much as membership: the model is shown the images in this order, and a different order
      // is a different request. Comparing as sets would call a reordered reference list unchanged.
      if (now.length !== recordedSources.length || now.some((source, index) => source !== recordedSources[index])) referenceStale.push(scene);
    }
    return { imageStale, referenceStale };
  }

  /**
   * What this Episode's references currently resolve from, or null if that cannot be determined.
   *
   * Null rather than an empty mapping list on failure. An Episode whose mappings cannot be read would otherwise
   * recompute as "no references at all", and every scene that recorded some would be reported behind — a screen
   * full of staleness markers caused by a read error, which is the worst possible way to say "I do not know".
   */
  /** Empty when the mappings cannot be read: the same "not knowing looks like not knowing" rule as staleness. */
  private async linkDrift(projectId: string, number: number): Promise<LongEpisodeStoryBibleLinkDrift[]> {
    const context = await this.referenceContext(projectId, number);
    return context ? storyBibleLinkDrift(this.projectsRoot, this.assets, projectId, context.mappings) : [];
  }

  private async referenceContext(projectId: string, number: number): Promise<{ mappings: readonly StoredAssetMapping[]; directory: string; continuityPath: string | null } | null> {
    try {
      const owner = await this.mappingOwners.get({ projectId, episodeNumber: number });
      return { mappings: await this.mappingStore.load(owner), directory: owner.directory, continuityPath: await this.continuityImagePath(projectId, number) };
    } catch { return null; }
  }

  /**
   * The review listing, readable for as long as the pictures exist.
   *
   * This used to require the Episode to still be sitting in `images_review`, so the moment it moved on — to
   * video confirmation, or all the way to a finished cut — the list refused and the screen had nothing to draw.
   * The pictures were still on disk and the content route still served them one by one; there was simply no
   * longer anything telling the screen they were there. Paid work you cannot look at again is the same defect
   * as paid work overwritten, only quieter, and this repository has now met it three times.
   *
   * Reading is not reviewing: `approve` and `regenerate` keep their state gate, because those act. This one
   * only requires that the pictures are actually present — the same rule `content()` applies for the same
   * stated reason.
   */
  async get(projectId: string, number: number): Promise<GetLongEpisodeImageReviewResponse> {
    const id = projectId.trim(); const episode = await this.episode(id, number);
    // Refused only while the Episode has not reached image generation — before that there is nothing to list,
    // and saying "not at this stage" is the honest answer. Everything after stays readable.
    if (!longEpisodeHasImages(episode.state)) throw longEpisodeImagesNotAllowed();
    await this.assertImagesOnDisk(id, number, episode);
    // Repair on the way past, never at the cost of the read.
    //
    // The seeding this calls existed only on approve and regenerate — two things a finished Episode never does
    // again — so an Episode that predates indexing stayed missing from the Library forever, which is exactly
    // what a real project turned out to be (12/Episode01). Opening the review screen now fixes it.
    //
    // 🔴 Deliberately swallowed. Indexing reads every scene file and refuses if one is gone, and a GET whose job
    // is to show the review must not start failing because a repair it was doing on the side could not finish.
    await this.indexAssetsIfMissing(id, number, episode).catch(() => undefined);
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    const budget = apiKey && this.budget ? await budgetPreviewFor(this.budget, IMAGE_ESTIMATED_COST_USD) : undefined;
    const stored = await this.loadReviews(id, number);
    return { episode: this.detail(episode), reviews: this.apiReviews(stored, episode.updated_at, this.sceneCount(episode)), staleness: await this.imageStaleness(id, number, episode, stored), storyBibleLinkDrift: await this.linkDrift(id, number), ...(budget ? { budget } : {}) };
  }
  async approve(projectId: string, number: number, rawScene: string, request: ApproveLongEpisodeImageReviewRequest): Promise<ApproveLongEpisodeImageReviewResponse> {
    const id = projectId.trim(); this.approval(request); const scene = sceneNumber(Number(rawScene)); if (!scene || String(scene) !== rawScene) throw longInvalidRequest("Episode image scene number is invalid."); const episode = await this.episode(id, number); await this.assertReviewable(id, number, episode);
    if (scene > this.sceneCount(episode)) throw longInvalidRequest("Episode image scene number is invalid.");
    const reviews = await this.loadReviews(id, number); const now = new Date().toISOString(); const index = reviews.findIndex((review) => review.scene_number === scene); const old = index < 0 ? undefined : reviews[index]; const review: StoredReview = { scene_number: scene, status: "approved", updated_at: now, regeneration_count: old?.regeneration_count ?? 0, history: [...(old?.history ?? []), { event: "approved", timestamp: now }], ...(old?.references_used_count !== undefined && old.references_omitted_count !== undefined ? { references_used_count: old.references_used_count, references_omitted_count: old.references_omitted_count } : {}), ...(old?.prompt !== undefined ? { prompt: old.prompt } : {}), ...(old?.reference_sources !== undefined ? { reference_sources: old.reference_sources } : {}) }; if (index < 0) reviews.push(review); else reviews[index] = review;
    const all = sceneNumbersFor(this.sceneCount(episode)).every((current) => reviews.some((item) => item.scene_number === current && item.status === "approved")); if (all) episode.state = "waiting_for_video_confirmation"; episode.updated_at = now; await this.saveReviews(id, number, reviews);
    await this.indexAssetsIfMissing(id, number, episode);
    try { await this.assets.approveGeneratedProjectImage(this.assetSource(id, number).sourceProjectId, scene, all); }
    catch { throw longStorageError(); }
    await this.saveEpisode(id, number, episode); return { episode: this.detail(episode), reviews: this.apiReviews(reviews, now, this.sceneCount(episode)), staleness: await this.imageStaleness(id, number, episode, reviews), storyBibleLinkDrift: await this.linkDrift(id, number) };
  }
  async regenerate(projectId: string, number: number, rawScene: string, request: RegenerateLongEpisodeImageReviewRequest): Promise<RegenerateLongEpisodeImageReviewResponse> {
    const id = projectId.trim(); const additionalInstruction = this.regenerationRequest(request); const scene = sceneNumber(Number(rawScene)); if (!scene || String(scene) !== rawScene) throw longInvalidRequest("Episode image scene number is invalid."); const episode = await this.episode(id, number); await this.assertReviewable(id, number, episode, true);
    if (scene > this.sceneCount(episode)) throw longInvalidRequest("Episode image scene number is invalid.");
    const reviews = await this.loadReviews(id, number);
    const current = this.image(id, number, scene); let bytes: Buffer; try { bytes = await fs.readFile(current); if (!await this.validImage(current)) throw new Error(); } catch { throw longEpisodeImagesInvalid(); }

    // Resolve the real-vs-fake regenerated bytes BEFORE touching any file: a failed real request must never
    // archive or overwrite the still-valid current image.
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    let regenerated: Buffer = PNG;
    let retryEstimate: RegenerateLongEpisodeImageReviewResponse["retryEstimate"];
    /** The money is gone and the ledger does not know — carried to the warning and past the estimate below. */
    let spendUnrecorded = false;
    let referenceOmission: { references_used_count: number; references_omitted_count: number } | undefined;
    let generatedPrompt: string | undefined;
    let generatedSources: string[] | undefined;
    if (apiKey && this.budget) {
      const scenes = this.scenes(episode);
      // The plain scene prompt is what gets recorded; the instruction rides only on this one request. Record
      // the instructed text instead and this scene reads as permanently behind its own script — staleness
      // would then be measuring the instruction rather than the thing it exists to measure.
      const owner = await this.mappingOwners.get({ projectId: id, episodeNumber: number });
      const mappings = await this.mappingStore.load(owner);
      const recordedPrompt = imagePromptFor(scenes[scene - 1], "");
      const basePrompt = imagePromptFor(scenes[scene - 1], "", await describeReferenceMappingsForScene(this.assets, mappings, scene));
      const prompt = additionalInstruction ? `${basePrompt}
${additionalInstruction}` : basePrompt;
      generatedPrompt = recordedPrompt;
      const continuityPath = await this.continuityImagePath(id, number);
      const references = await collectReferenceImages(this.assets, mappings, owner.directory, scene, continuityPath);
      generatedSources = references.sources;
      if (references.omittedCount > 0) referenceOmission = { references_used_count: references.images.length, references_omitted_count: references.omittedCount };
      try {
        const size = await this.imageSize(id, number);
        await this.budget.preflight(IMAGE_ESTIMATED_COST_USD);
        let succeeded = false;
        try {
          const result = references.images.length > 0 ? await callOpenAiImageEditApi(apiKey, prompt, references.images, { size }) : await callOpenAiImageApi(apiKey, prompt, { size });
          regenerated = result.bytes; succeeded = true;
        } finally {
          // `recordSpend`, not a bare await: this is a `finally` around a paid call, so a throw here discards
          // what OpenAI was already paid for and, on the failure path, replaces the provider's real error
          // (providers/budget-ledger.ts, docs/06_DECISIONS.md D-037).
          spendUnrecorded = await recordSpend(() => this.budget!.record(id, "image", succeeded, IMAGE_ESTIMATED_COST_USD));
        }
      } catch (error) {
        if (isBudgetLedgerUnreadable(error)) throw longBudgetLedgerUnreadable(); if (error instanceof OpenAiBudgetExceededError) throw longEpisodeImagesBudgetExceeded(error.message);
        if (error instanceof OpenAiAdapterError) throw longEpisodeImagesProviderError(error.category, error.message);
        throw longEpisodeImagesProviderError("unknown", OPENAI_KOREAN_MESSAGES.unknown);
      }
      // Read-only, computed after the fact. Skipped when the record could not be written: it reads the same
      // file that just refused a write, and letting it throw would take the response — and the image just paid
      // for — with it. The field is already optional.
      if (!spendUnrecorded) retryEstimate = { perSceneCostUsd: IMAGE_ESTIMATED_COST_USD, budget: await budgetPreviewFor(this.budget, IMAGE_ESTIMATED_COST_USD) };
      if (spendUnrecorded) await persistEpisodeWarning(this.files(id, number), number, episode, spendUnrecordedWarning(`${scene}번 장면 이미지 재생성`, OPENAI_LEDGER_FILE));
    }

    const originals = path.join(this.files(id, number).images, "originals"); let archive = "";
    try { await fs.mkdir(originals, { recursive: true }); const entries = await fs.readdir(originals); const versions = entries.map((name) => new RegExp(`^scene${scene}_v(\\d{3})\\.png$`).exec(name)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1])); archive = path.join(originals, `scene${scene}_v${String((versions.length ? Math.max(...versions) : 0) + 1).padStart(3, "0")}.png`); await this.writeImage(archive, bytes); await this.writeImage(current, regenerated); if (!await this.validImage(current)) throw new Error("invalid image"); } catch { if (archive) await fs.unlink(archive).catch(() => undefined); throw longStorageError(); }
    const now = new Date().toISOString(); const index = reviews.findIndex((review) => review.scene_number === scene); const old = index < 0 ? undefined : reviews[index]; const review: StoredReview = { scene_number: scene, status: "pending", updated_at: now, regeneration_count: (old?.regeneration_count ?? 0) + 1, history: [...(old?.history ?? []), { event: "regenerated", timestamp: now, archive: path.basename(archive) }], ...(referenceOmission ?? {}), ...(generatedPrompt !== undefined ? { prompt: generatedPrompt } : old?.prompt !== undefined ? { prompt: old.prompt } : {}), ...(generatedSources !== undefined ? { reference_sources: generatedSources } : old?.reference_sources !== undefined ? { reference_sources: old.reference_sources } : {}) }; if (index < 0) reviews.push(review); else reviews[index] = review; episode.state = "images_review"; episode.updated_at = now;
    await this.indexAssetsIfMissing(id, number, episode);
    try { await this.assets.replaceGeneratedProjectSceneImage(this.assetSource(id, number).sourceProjectId, scene, current, archive); }
    catch { throw longStorageError(); }
    await this.saveReviews(id, number, reviews); await this.saveEpisode(id, number, episode); return { episode: this.detail(episode), reviews: this.apiReviews(reviews, now, this.sceneCount(episode)), staleness: await this.imageStaleness(id, number, episode, reviews), storyBibleLinkDrift: await this.linkDrift(id, number), sceneNumber: scene, ...(retryEstimate ? { retryEstimate } : {}) };
  }
}
