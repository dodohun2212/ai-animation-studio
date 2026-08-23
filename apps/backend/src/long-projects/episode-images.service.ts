import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import type { ApproveLongEpisodeImageReviewRequest, ApproveLongEpisodeImageReviewResponse, GetLongEpisodeImageReviewResponse, LongEpisodeDetail, LongEpisodeImageReview, LongEpisodeStatus, RegenerateLongEpisodeImageReviewRequest, RegenerateLongEpisodeImageReviewResponse, SceneNumber, StartLongEpisodeImageGenerationRequest, StartLongEpisodeImageGenerationResponse } from "@ai-animation-studio/shared";
import { validateImage } from "../assets/image-validation.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isSafeProjectId, resolveSafeProjectDirectory } from "../projects/project-id.js";
import { longEpisodeImagesInvalid, longEpisodeImagesNotAllowed, longEpisodeNotFound, longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId } from "./long-project-api.error.js";
import { EpisodeContinuityReferenceService } from "./episode-continuity-reference.service.js";

const SCENES = [1, 2, 3, 4, 5, 6] as const;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const statuses: readonly LongEpisodeStatus[] = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted"];
type StoredEpisode = Record<string, unknown> & { number: number; state: LongEpisodeStatus; approved: boolean; script: Record<string, unknown>; script_revision: number; updated_at: string };
type StoredReview = { scene_number: SceneNumber; status: "pending" | "approved"; updated_at: string; regeneration_count: number; history: Record<string, unknown>[] };
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : object(value) ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])])) : value;
const fingerprint = (scenes: unknown[]) => crypto.createHash("sha256").update(JSON.stringify(stable(scenes)), "utf8").digest("hex");
const sceneNumber = (value: unknown): SceneNumber | undefined => Number.isInteger(value) && SCENES.includes(value as SceneNumber) ? value as SceneNumber : undefined;

@Injectable()
export class EpisodeImagesService {
  constructor(private readonly projectsRoot: string) {}

  private files(projectId: string, number: number) {
    if (!isSafeProjectId(projectId)) throw longUnsafeId();
    const root = path.join(resolveSafeProjectDirectory(this.projectsRoot, projectId), "long_story");
    const episode = path.join(root, `Episode${String(number).padStart(2, "0")}`);
    const images = path.join(episode, "images");
    return { root, outlines: path.join(root, "episode_outlines.json"), episode, project: path.join(episode, "project.json"), mapping: path.join(episode, "asset_mapping_review.json"), images, reviews: path.join(episode, "generated_image_reviews.json"), continuityMetadata: path.join(episode, "image_generation_metadata.json") };
  }
  private async json(file: string): Promise<unknown> { try { return JSON.parse(await fs.readFile(file, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); } }
  private async episode(projectId: string, number: number): Promise<StoredEpisode> {
    if (!Number.isInteger(number) || number < 1) throw longEpisodeNotFound();
    const files = this.files(projectId, number); const outlines = await this.json(files.outlines);
    if (!Array.isArray(outlines) || number > outlines.length || !object(outlines[number - 1]) || outlines[number - 1].episode_number !== number) throw longEpisodeNotFound();
    const raw = await this.json(files.project);
    if (!object(raw) || raw.number !== number || !statuses.includes(raw.state as LongEpisodeStatus) || typeof raw.approved !== "boolean" || !object(raw.script) || !Number.isInteger(raw.script_revision) || Number(raw.script_revision) < 1 || typeof raw.updated_at !== "string") throw longInvalidData();
    return raw as StoredEpisode;
  }
  private scenes(episode: StoredEpisode): unknown[] { const scenes = episode.script.scenes; if (!Array.isArray(scenes) || scenes.length !== 6 || scenes.some((scene, index) => !object(scene) || scene.number !== index + 1 || typeof scene.description !== "string" || !scene.description.trim())) throw longInvalidData(); return scenes; }
  private detail(episode: StoredEpisode): LongEpisodeDetail { return { episodeNumber: episode.number, title: String(episode.title), summary: String(episode.summary), mainEvent: String(episode.core_event), conflict: String(episode.conflict), cliffhanger: String(episode.cliffhanger), nextEpisodeHook: String(episode.next_connection), status: episode.state, approved: episode.approved, scriptRevision: episode.script_revision, script: episode.script as never, scriptHistoryCount: Array.isArray(episode.script_history) ? episode.script_history.length : 0 }; }
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
      if (!object(item) || Object.keys(item).some((key) => !["scene_number", "status", "updated_at", "regeneration_count", "history"].includes(key)) || !sceneNumber(item.scene_number) || !["pending", "approved"].includes(item.status as string) || typeof item.updated_at !== "string" || !Number.isInteger(item.regeneration_count) || Number(item.regeneration_count) < 0 || !Array.isArray(item.history) || !item.history.every(object)) throw longInvalidData();
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
  private apiReviews(reviews: StoredReview[], timestamp: string): LongEpisodeImageReview[] { const index = new Map(reviews.map((review) => [review.scene_number, review])); return SCENES.map((sceneNumber) => { const review = index.get(sceneNumber); return { sceneNumber, status: review?.status === "approved" ? "approved" : "pending", updatedAt: review?.updated_at || timestamp }; }); }
  private async assertReviewable(projectId: string, number: number, episode: StoredEpisode, allowWaiting = false) {
    if (episode.state !== "images_review" && (!allowWaiting || episode.state !== "waiting_for_video_confirmation")) throw longEpisodeImagesNotAllowed();
    if (!(await Promise.all(SCENES.map((scene) => this.validImage(this.image(projectId, number, scene))))).every(Boolean)) throw longEpisodeImagesInvalid();
  }
  private approval(request: unknown): asserts request is { approved: true } { if (!object(request) || Object.keys(request).length !== 1 || request.approved !== true) throw longInvalidRequest("Episode image approval request is invalid."); }

  async generate(projectId: string, number: number, request: StartLongEpisodeImageGenerationRequest): Promise<StartLongEpisodeImageGenerationResponse> {
    const id = projectId.trim(); this.approval(request); const episode = await this.episode(id, number);
    if (episode.state !== "asset_mapping_approved" || !episode.approved) throw longEpisodeImagesNotAllowed(); await this.mappingCurrent(id, number, episode);
    episode.state = "generating_images"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode);
    const generated: SceneNumber[] = []; const reused: SceneNumber[] = [];
    try {
      await fs.mkdir(this.files(id, number).images, { recursive: true });
      await this.saveContinuityMetadata(id, number);
      for (const scene of SCENES) { const file = this.image(id, number, scene); if (await this.validImage(file)) { reused.push(scene); } else { await this.writeImage(file, PNG); if (!await this.validImage(file)) throw new Error("invalid image"); generated.push(scene); } }
      episode.state = "images_ready"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode);
      episode.state = "images_review"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode);
    } catch (error) { episode.state = "asset_mapping_approved"; episode.updated_at = new Date().toISOString(); await this.saveEpisode(id, number, episode).catch(() => undefined); if (error instanceof Error && error.message === "invalid image") throw longEpisodeImagesInvalid(); throw longStorageError(); }
    return { episode: this.detail(episode), generatedSceneNumbers: generated, reusedSceneNumbers: reused };
  }
  async get(projectId: string, number: number): Promise<GetLongEpisodeImageReviewResponse> { const id = projectId.trim(); const episode = await this.episode(id, number); await this.assertReviewable(id, number, episode); return { episode: this.detail(episode), reviews: this.apiReviews(await this.loadReviews(id, number), episode.updated_at) }; }
  async approve(projectId: string, number: number, rawScene: string, request: ApproveLongEpisodeImageReviewRequest): Promise<ApproveLongEpisodeImageReviewResponse> {
    const id = projectId.trim(); this.approval(request); const scene = sceneNumber(Number(rawScene)); if (!scene || String(scene) !== rawScene) throw longInvalidRequest("Episode image scene number is invalid."); const episode = await this.episode(id, number); await this.assertReviewable(id, number, episode);
    const reviews = await this.loadReviews(id, number); const now = new Date().toISOString(); const index = reviews.findIndex((review) => review.scene_number === scene); const old = index < 0 ? undefined : reviews[index]; const review: StoredReview = { scene_number: scene, status: "approved", updated_at: now, regeneration_count: old?.regeneration_count ?? 0, history: [...(old?.history ?? []), { event: "approved", timestamp: now }] }; if (index < 0) reviews.push(review); else reviews[index] = review;
    const all = SCENES.every((current) => reviews.some((item) => item.scene_number === current && item.status === "approved")); if (all) episode.state = "waiting_for_video_confirmation"; episode.updated_at = now; await this.saveReviews(id, number, reviews); await this.saveEpisode(id, number, episode); return { episode: this.detail(episode), reviews: this.apiReviews(reviews, now) };
  }
  async regenerate(projectId: string, number: number, rawScene: string, request: RegenerateLongEpisodeImageReviewRequest): Promise<RegenerateLongEpisodeImageReviewResponse> {
    const id = projectId.trim(); this.approval(request); const scene = sceneNumber(Number(rawScene)); if (!scene || String(scene) !== rawScene) throw longInvalidRequest("Episode image scene number is invalid."); const episode = await this.episode(id, number); await this.assertReviewable(id, number, episode, true); const reviews = await this.loadReviews(id, number);
    const current = this.image(id, number, scene); let bytes: Buffer; try { bytes = await fs.readFile(current); if (!await this.validImage(current)) throw new Error(); } catch { throw longEpisodeImagesInvalid(); }
    const originals = path.join(this.files(id, number).images, "originals"); let archive = "";
    try { await fs.mkdir(originals, { recursive: true }); const entries = await fs.readdir(originals); const versions = entries.map((name) => new RegExp(`^scene${scene}_v(\\d{3})\\.png$`).exec(name)).filter((match): match is RegExpExecArray => Boolean(match)).map((match) => Number(match[1])); archive = path.join(originals, `scene${scene}_v${String((versions.length ? Math.max(...versions) : 0) + 1).padStart(3, "0")}.png`); await this.writeImage(archive, bytes); await this.writeImage(current, PNG); if (!await this.validImage(current)) throw new Error("invalid image"); } catch { if (archive) await fs.unlink(archive).catch(() => undefined); throw longStorageError(); }
    const now = new Date().toISOString(); const index = reviews.findIndex((review) => review.scene_number === scene); const old = index < 0 ? undefined : reviews[index]; const review: StoredReview = { scene_number: scene, status: "pending", updated_at: now, regeneration_count: (old?.regeneration_count ?? 0) + 1, history: [...(old?.history ?? []), { event: "regenerated", timestamp: now, archive: path.basename(archive) }] }; if (index < 0) reviews.push(review); else reviews[index] = review; episode.state = "images_review"; episode.updated_at = now; await this.saveReviews(id, number, reviews); await this.saveEpisode(id, number, episode); return { episode: this.detail(episode), reviews: this.apiReviews(reviews, now), sceneNumber: scene };
  }
}
