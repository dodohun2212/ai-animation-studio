import { HttpException, Injectable, Logger, type LoggerService } from "@nestjs/common";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
  PHOTO_CARD_DURATIONS,
  PHOTO_CARD_MAX_PICTURES,
  WorkflowState,
  checkNewsReelCardText,
  isAspectRatio,
  type CreateNewsReelRequest,
  type CreateNewsReelResponse,
  type NewsReelCard,
} from "@ai-animation-studio/shared";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { cardImagePath } from "./card-image-path.js";
import { newsReelCardUnusable, newsReelInvalidRequest, newsReelStorageError } from "./news-reel-api.error.js";
import { isSafeProjectId } from "./project-id.js";
import { createStoredProject, toApiProject } from "./project.mapper.js";
import { LocalProjectRepository } from "./projects.repository.js";

/**
 * Makes a news reel: pictures already in the Library, one card over them, ready to merge.
 *
 * A short project with a card written on it, exactly as a photo card is. Publishing, the publish history, the
 * audio library and the licence credit all hang off a project, and a third kind of owner would mean
 * re-attaching every one of them. The merge branches on the one fact written here.
 *
 * A different service from PhotoCardService rather than a flag on it. A photo card holds one quote that
 * becomes the scene narration and is drawn by the photo card layout; a news reel holds four boxes in two
 * colours inside two bands, and none of it is narration. Folding them would put an optional quote and an
 * optional card on one request and leave the merge asking which one it got (docs/06_DECISIONS.md D-052).
 *
 * No provider is called here and nothing on this path can call one. The pictures are copied from the Library
 * and recorded in generated_images, which is the part that actually costs nothing: image generation reuses a
 * scene only when the record already points at that exact file, so bytes without a record would be a free
 * feature that pays for an image the first time somebody opens generation.
 */
@Injectable()
export class NewsReelService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly assets: LocalAssetsRepository,
    private readonly projectsRoot: string,
    private readonly logger: Pick<LoggerService, "warn"> = new Logger("NewsReel"),
  ) {}

  /** Same split as the photo card: a name that exists and a disk that refused are opposite situations. */
  private storageFailure(stage: string, error: unknown): HttpException {
    if (error instanceof HttpException) {
      const body = error.getResponse();
      if (typeof body === "object" && body !== null && (body as { code?: unknown }).code === "PROJECT_ALREADY_EXISTS") return error;
    }
    this.logger.warn(`News reel ${stage} failed: ${error instanceof Error ? error.message : String(error)}`);
    return newsReelStorageError();
  }

  async create(body: unknown): Promise<CreateNewsReelResponse> {
    const request = this.parse(body);

    // Every picture resolved before anything is written: a half-copied reel is a record pointing at files that
    // are not there, and the record is what makes generation skip a scene.
    const sources: string[] = [];
    for (const assetId of request.assetIds) {
      const asset = await this.assets.get(assetId).catch(() => { throw newsReelCardUnusable(); });
      const source = this.assets.resolveContentPath(asset);
      if (!source) throw newsReelCardUnusable();
      sources.push(source);
    }

    const now = new Date().toISOString();
    /**
     * The headline, joined, is what the project is called. It is the one line of this card a person would
     * recognise in a list, and it is not what gets drawn: the card below carries every line and the merge
     * reads that, so the two can never disagree about what is burned.
     */
    const title = `${request.card.headline.line1} ${request.card.headline.line2}`;
    const project = createStoredProject(request.projectId, title, now);
    project.project_type = "short_project";
    project.workflow_state = WorkflowState.VideosApproved;
    /**
     * No narration, and the scene description is not the card text. A photo card puts its quote in narration
     * because the merge burns narration as the subtitle; a news reel draws its own overlay, so putting the
     * lines in narration would burn them a second time underneath their own band.
     */
    project.scenes = sources.map((_, index) => ({ number: index + 1, description: title, narration: "" }));
    project.lore_context = {
      news_reel_card: request.card,
      scene_count: sources.length,
      clip_duration_seconds: request.clipDurationSeconds,
      narration_enabled: false,
      subtitles_enabled: false,
      source_asset_ids: request.assetIds,
      style_notes: { aspect: request.aspectRatio },
    };

    try { await this.projects.create(project); } catch (error) { throw this.storageFailure("project creation", error); }
    const destinations = sources.map((_, index) => cardImagePath(this.projectsRoot, project.project_id, index + 1));
    try {
      await fs.mkdir(path.dirname(destinations[0]!), { recursive: true });
      for (const [index, source] of sources.entries()) await fs.copyFile(source, destinations[index]!);
    } catch (error) { throw this.storageFailure("picture copy", error); }

    const stored = { ...project, generated_images: destinations };
    try { await this.projects.save(stored); } catch (error) { throw this.storageFailure("record save", error); }
    return { project: toApiProject(stored) };
  }

  /**
   * The card is measured against the contract here, not trusted. The screen counts as somebody types and
   * keeps the button shut, which is the half a person sees; this is the half a person cannot get around. Both
   * call checkNewsReelCardText, so there is one answer about what fits.
   */
  private parse(body: unknown): CreateNewsReelRequest {
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw newsReelInvalidRequest();
    const data = body as Record<string, unknown>;
    const allowed = new Set(["projectId", "assetIds", "card", "clipDurationSeconds", "aspectRatio"]);
    if (Object.keys(data).some((key) => !allowed.has(key))) throw newsReelInvalidRequest();

    const projectId = typeof data.projectId === "string" ? data.projectId.trim() : "";
    const assetIds = Array.isArray(data.assetIds)
      ? data.assetIds.map((value) => (typeof value === "string" ? value.trim() : ""))
      : [];
    if (assetIds.length === 0 || assetIds.length > PHOTO_CARD_MAX_PICTURES || assetIds.some((id) => !id)) throw newsReelInvalidRequest();
    if (!isSafeProjectId(projectId)) throw newsReelInvalidRequest();
    if (!(PHOTO_CARD_DURATIONS as readonly number[]).includes(data.clipDurationSeconds as number)) throw newsReelInvalidRequest();
    if (!isAspectRatio(data.aspectRatio)) throw newsReelInvalidRequest();

    return { projectId, assetIds, card: validCard(data.card), clipDurationSeconds: data.clipDurationSeconds as CreateNewsReelRequest["clipDurationSeconds"], aspectRatio: data.aspectRatio };
  }
}

/**
 * The empty string is refused wherever the contract says null or nothing at all. An empty second caption line
 * is the one ambiguity this contract was shaped to remove, and this is the last place the two can still be
 * told apart: there is no second line, and nobody has written it yet.
 */
function validCard(value: unknown): NewsReelCard {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw newsReelInvalidRequest();
  const data = value as Record<string, unknown>;
  const headline = data.headline as Record<string, unknown> | undefined;
  const caption = data.caption as Record<string, unknown> | undefined;
  if (typeof data.publisher !== "string" || !data.publisher.trim()) throw newsReelInvalidRequest();
  if (!headline || typeof headline.line1 !== "string" || typeof headline.line2 !== "string") throw newsReelInvalidRequest();
  if (!caption || typeof caption.line1 !== "string") throw newsReelInvalidRequest();
  if (caption.line2 !== null && typeof caption.line2 !== "string") throw newsReelInvalidRequest();
  if (typeof data.creditRequired !== "boolean") throw newsReelInvalidRequest();
  if (data.creditText !== undefined && (typeof data.creditText !== "string" || !data.creditText.trim())) throw newsReelInvalidRequest();
  /**
   * A credit that is required and not written cannot be burned. The two fields exist precisely so those are
   * different values, and this is the moment the difference matters: everything after here puts the picture
   * into a file somebody may publish.
   */
  if (data.creditRequired === true && (data.creditText === undefined || !String(data.creditText).trim())) {
    throw newsReelInvalidRequest("이 그림은 출처를 적어야 하는데 출처 문구가 비어 있습니다.");
  }

  const card: NewsReelCard = {
    publisher: data.publisher.trim(),
    headline: { line1: headline.line1, line2: headline.line2 },
    caption: { line1: caption.line1, line2: caption.line2 as string | null },
    creditRequired: data.creditRequired,
    ...(data.creditText === undefined ? {} : { creditText: data.creditText as string }),
  };

  const refused = checkNewsReelCardText(card).refused[0];
  if (refused !== undefined) {
    throw newsReelInvalidRequest(
      refused.refusal === "too_long"
        ? `${refused.field} 이 ${refused.limit}자를 ${-refused.remaining}자 넘었습니다.`
        : `${refused.field} 이 비어 있습니다.`,
    );
  }
  return card;
}
