import { HttpException, Injectable, Logger, type LoggerService } from "@nestjs/common";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { isAspectRatio, PHOTO_CARD_DURATIONS, PHOTO_CARD_MAX_PICTURES, PHOTO_CARD_QUOTE_MAX_LENGTH, WorkflowState, type CreatePhotoCardRequest, type CreatePhotoCardResponse } from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { atomicWriteUtf8File } from "./atomic-file.js";
import { isSafeProjectId } from "./project-id.js";
import { createStoredProject, toApiProject } from "./project.mapper.js";
import { cardImagePath } from "./card-image-path.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { photoCardInvalidRequest, photoCardAssetUnusable, photoCardStorageError } from "./photo-card-api.error.js";

/**
 * Makes a photo card: one picture already in the Library, one line of text, ready to merge.
 *
 * Deliberately not a new kind of owner. Publishing, the publish history, the audio library, subtitles and the
 * licence credit all hang off a project, and a third owner would mean re-attaching every one of them. So this
 * creates an ordinary short project and marks it — `lore_context.photo_card` — and the merge branches on that
 * one fact.
 *
 * 🔴 No provider is ever called on this path, and that is not an accident of what happens to be wired: nothing
 * here asks for a script, an image or a video. The picture is copied from the Library and **recorded in
 * `generated_images`**, which is the part that actually costs nothing — image generation reuses a scene only
 * when the project's own record already points at that exact file, so putting bytes in place without writing
 * the record would leave a "free" feature that pays for an image the first time anyone opens generation.
 *
 * `MIN_SCENE_COUNT` is untouched. It says a story needs more than one scene, which is true, and a photo card is
 * not a story; loosening it for this would let every short project be made with a single scene.
 */
@Injectable()
export class PhotoCardService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly assets: LocalAssetsRepository,
    private readonly projectsRoot: string,
    /** Optional so existing constructions keep working, and so a test can read what was written down — same shape as projects.repository.ts's own logger parameter. */
    private readonly logger: Pick<LoggerService, "warn"> = new Logger("PhotoCard"),
  ) {}

  /**
   * Turns a failed write into this route's error, without erasing what it was.
   *
   * "이름이 이미 있다" and "디스크에 못 썼다" are opposite situations: one is the person's to fix in the name
   * field, the other is not theirs at all. Both used to arrive as *"사진 카드를 저장하지 못했습니다"*, and the
   * first one arrived on a card that had been made perfectly a moment earlier — so the person read "it failed"
   * about work that was already sitting on disk, and pressed again (Cowork Round 432).
   *
   * `PROJECT_ALREADY_EXISTS` passes through: the screen already has the right sentence for it and could never
   * receive it. Everything else still becomes PHOTO_CARD_STORAGE_ERROR — but the reason is written down, so the
   * server is no longer the only party that cannot say whether the picture or the record was what failed.
   */
  private storageFailure(stage: string, error: unknown): HttpException {
    if (error instanceof HttpException) {
      const body = error.getResponse();
      if (typeof body === "object" && body !== null && (body as { code?: unknown }).code === "PROJECT_ALREADY_EXISTS") return error;
    }
    this.logger.warn(`Photo card ${stage} failed: ${error instanceof Error ? error.message : String(error)}`);
    return photoCardStorageError();
  }

  async create(body: unknown): Promise<CreatePhotoCardResponse> {
    const request = this.parse(body);
    /*
     * Every picture is resolved before anything is written. A card that is half copied is a project on disk
     * whose record points at files that are not there — and the record is what makes generation skip a scene,
     * so a missing file becomes a scene nobody will ever fill.
     */
    const sources: string[] = [];
    for (const assetId of request.assetIds) {
      const asset = await this.assets.get(assetId).catch(() => { throw photoCardAssetUnusable(); });
      const source = this.assets.resolveContentPath(asset);
      if (!source) throw photoCardAssetUnusable();
      sources.push(source);
    }

    const now = new Date().toISOString();
    const project = createStoredProject(request.projectId, request.quote, now);
    project.project_type = "short_project";
    project.workflow_state = WorkflowState.VideosApproved;
    /*
     * 🔴 **The same quote on every scene, and the reveal happens only on the first.**
     *
     * The text is the card's content, so it cannot vanish when the picture changes — somebody watching a news
     * reel would lose the summary halfway. But subtitles are burned per scene, so leaving it at that would
     * make the line-by-line reveal (subtitle-file.ts) start over on every picture: read three lines, watch
     * them disappear, read them again. The reveal exists to track somebody reading; restarting it takes their
     * place away.
     *
     * So scene 1 reveals and the rest open with the text already up. `revealSubtitle` on the merge input is
     * what carries that, and it is false for scenes 2..N rather than a rule the merge infers, because "is
     * this the first picture" is a fact about the card that only this service knows.
     */
    project.scenes = sources.map((_, index) => ({ number: index + 1, description: request.quote, narration: request.quote }));
    project.lore_context = {
      photo_card: true,
      scene_count: sources.length,
      clip_duration_seconds: request.clipDurationSeconds,
      // Subtitles on, narration off: the quote is the picture's text, and speaking it would be a paid call
      // nobody asked for.
      narration_enabled: false,
      subtitles_enabled: true,
      source_asset_ids: request.assetIds,
    };
    // `lore_context.style_notes.aspect`, not `style_profile.aspect`. projects/project-aspect.ts exists because
    // five readers all read the second one — a field nothing has ever written — so a project set to landscape
    // was generated, merged and displayed vertical anyway. Writing the choice there again would have been the
    // same defect from the other end, and it was: measured end to end, a 16:9 card merged to 1080x1920.
    project.lore_context = { ...project.lore_context, style_notes: { aspect: request.aspectRatio } };

    try { await this.projects.create(project); } catch (error) { throw this.storageFailure("project creation", error); }
    const destinations = sources.map((_, index) => cardImagePath(this.projectsRoot, project.project_id, index + 1));
    try {
      await fs.mkdir(path.dirname(destinations[0]!), { recursive: true });
      for (const [index, source] of sources.entries()) await fs.copyFile(source, destinations[index]!);
    } catch (error) { throw this.storageFailure("picture copy", error); }

    // Written after the bytes are in place, never before: the record is what makes generation skip these
    // scenes, and a record pointing at a file that is not there yet is the same lie in the other direction.
    const stored = { ...project, generated_images: destinations };
    try { await this.projects.save(stored); } catch (error) { throw this.storageFailure("record save", error); }
    await this.writeReviewPlaceholderless(project.project_id);
    return { project: toApiProject(stored) };
  }

  /**
   * A photo card has no scene reviews and none are written.
   *
   * The merge asks a card for its picture instead of an approved reviews file, so there is nothing to record
   * here — and writing one saying a scene was reviewed would be the exact dressing-up this design exists to
   * avoid. Kept as a named no-op so the absence reads as a decision rather than an oversight.
   */
  private async writeReviewPlaceholderless(_projectId: string): Promise<void> {}

  private parse(body: unknown): CreatePhotoCardRequest {
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw photoCardInvalidRequest();
    const data = body as Record<string, unknown>;
    const allowed = new Set(["projectId", "assetIds", "quote", "clipDurationSeconds", "aspectRatio"]);
    if (Object.keys(data).some((key) => !allowed.has(key))) throw photoCardInvalidRequest();
    const projectId = typeof data.projectId === "string" ? data.projectId.trim() : "";
    const quote = typeof data.quote === "string" ? data.quote.trim() : "";
    /*
     * 🔴 At least one and at most PHOTO_CARD_MAX_PICTURES, and no empty ids among them. An empty list would
     * create a project with no scenes at all — a card that cannot be merged and does not say why — and a
     * blank id would pass `assets.get` straight into a lookup for nothing.
     */
    const assetIds = Array.isArray(data.assetIds)
      ? data.assetIds.map((value) => (typeof value === "string" ? value.trim() : ""))
      : [];
    if (assetIds.length === 0 || assetIds.length > PHOTO_CARD_MAX_PICTURES || assetIds.some((id) => !id)) throw photoCardInvalidRequest();
    if (!isSafeProjectId(projectId) || !quote || quote.length > PHOTO_CARD_QUOTE_MAX_LENGTH) throw photoCardInvalidRequest();
    if (!(PHOTO_CARD_DURATIONS as readonly number[]).includes(data.clipDurationSeconds as number)) throw photoCardInvalidRequest();
    if (!isAspectRatio(data.aspectRatio)) throw photoCardInvalidRequest();
    return { projectId, assetIds, quote, clipDurationSeconds: data.clipDurationSeconds as CreatePhotoCardRequest["clipDurationSeconds"], aspectRatio: data.aspectRatio };
  }
}
