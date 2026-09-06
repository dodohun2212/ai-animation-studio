import { HttpException, Injectable, Logger, type LoggerService } from "@nestjs/common";
import {
  FLOWER_CARD_CAPTION_MAX_LENGTH,
  FLOWER_CARD_DESCRIPTION_MAX_LENGTH,
  FLOWER_CARD_MEANING_MAX_LENGTH,
  FLOWER_CARD_NAME_MAX_LENGTH,
  MAX_SCENE_COUNT,
  MIN_SCENE_COUNT,
  RUNWAY_CLIP_DURATIONS,
  WorkflowState,
  type CreateFlowerCardRequest,
  type CreateFlowerCardResponse,
  type FlowerCardSceneInput,
} from "@ai-animation-studio/shared";

import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import { isSafeProjectId } from "./project-id.js";
import { createStoredProject, toApiProject } from "./project.mapper.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { flowerCardInvalidRequest, flowerCardStorageError } from "./flower-card-api.error.js";

/**
 * Makes a flower reel: a short project whose script was written by a person instead of generated.
 *
 * 🔴 Nothing else about it is special, and that is the design. Images, videos, merge, subtitles, music and
 * publishing are the short-project pipeline exactly as it stands, and this project walks every one of those
 * steps — so unlike a photo card it is **not** marked, does not skip stages, and belongs in the 단기 프로젝트
 * list where its progress bar tells the truth (Cowork Round 599; the same test that made photo cards leave that
 * list is what says a flower reel stays in it).
 *
 * The one thing that differs is where the script comes from. Captain D writes these by hand because what they
 * narrate is a fact — where a flower's meaning came from — and a story model asked for a fact returns something
 * shaped like one. So this route exists to put authored scenes into a project without a story call.
 *
 * 🔴 No provider is called here and none can be. The first paid step is image generation, behind its own
 * confirmation. That is also why the request carries no narration flag: storing the caption as the scene's
 * narration text leaves the decision to speak it to the narration screen, which has its own confirmation, where
 * a flag here would hide a paid call behind a 만들기 button.
 */
@Injectable()
export class FlowerCardService {
  constructor(
    private readonly projects: LocalProjectRepository,
    /**
     * 🔴 Required, not optional.
     *
     * Approving an Asset Mapping review compares the script fingerprint against a baseline, and a project whose
     * review was never begun reads back `""` — which approval answers with `no_baseline`, the refusal Captain D
     * hit and stopped at (Cowork Round 533). Story generation sets that baseline as the last thing it does; a
     * flower reel has no story call, so if this were optional a construction that omitted it would produce
     * projects that reach the mapping screen and cannot leave it, and nothing would say so until a person was
     * standing in front of it.
     */
    private readonly mappings: ProjectAssetMappingsService,
    private readonly logger: Pick<LoggerService, "warn"> = new Logger("FlowerCard"),
  ) {}

  /** Keeps "that name is taken" separate from "the disk refused" — opposite situations, and only one of them is the person's to fix. */
  private storageFailure(stage: string, error: unknown): HttpException {
    if (error instanceof HttpException) {
      const body = error.getResponse();
      if (typeof body === "object" && body !== null && (body as { code?: unknown }).code === "PROJECT_ALREADY_EXISTS") return error;
    }
    this.logger.warn(`Flower card ${stage} failed: ${error instanceof Error ? error.message : String(error)}`);
    return flowerCardStorageError();
  }

  async create(body: unknown): Promise<CreateFlowerCardResponse> {
    const request = this.parse(body);
    const now = new Date().toISOString();

    // Both lines, because the topic is what every later screen shows as the project's subject and the meaning
    // without its flower reads as someone else's project.
    const project = createStoredProject(request.projectId, `${request.flowerName}\n${request.meaning}`, now);
    project.project_type = "short_project";
    project.workflow_state = WorkflowState.WaitingForAssetMappingReview;
    project.scenes = request.scenes.map((scene, index) => ({
      number: index + 1,
      description: scene.description,
      narration: scene.caption,
    }));
    /**
     * The revision a fingerprint will be taken against.
     *
     * `createStoredProject` starts at 0, which is "no script yet"; a hand-written script is a script, so this
     * project is at revision 1 for the same reason a generated one is — story generation increments it as part
     * of finishing. Leaving it at 0 would make the review's recorded revision disagree with the project's on
     * the very first approval.
     */
    project.script_revision = 1;
    project.lore_context = {
      scene_count: request.scenes.length,
      clip_duration_seconds: request.clipDurationSeconds,
      // Subtitles yes, narration no — the caption is already on screen, and speaking it is a paid call the
      // narration screen asks about separately.
      narration_enabled: false,
      subtitles_enabled: true,
      style_notes: { aspect: request.aspectRatio },
    };

    try { await this.projects.create(project); } catch (error) { throw this.storageFailure("project creation", error); }

    // Only after the project exists: the baseline is taken from the scenes as stored, so beginning the review
    // against a project that is not written yet would fingerprint nothing.
    let review;
    try {
      ({ review } = await this.mappings.beginReview(project.project_id, { scriptRevision: project.script_revision }));
    } catch (error) { throw this.storageFailure("mapping review baseline", error); }

    const stored = { ...project, mapping_revision: review.mappingRevision, updated_at: new Date().toISOString() };
    try { await this.projects.save(stored); } catch (error) { throw this.storageFailure("record save", error); }
    return { project: toApiProject(stored), review };
  }

  private parseScene(value: unknown): FlowerCardSceneInput {
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw flowerCardInvalidRequest();
    const scene = value as Record<string, unknown>;
    if (Object.keys(scene).some((key) => key !== "description" && key !== "caption")) throw flowerCardInvalidRequest();
    const description = typeof scene.description === "string" ? scene.description.trim() : "";
    const caption = typeof scene.caption === "string" ? scene.caption.trim() : "";
    if (!description || description.length > FLOWER_CARD_DESCRIPTION_MAX_LENGTH) throw flowerCardInvalidRequest();
    if (!caption || caption.length > FLOWER_CARD_CAPTION_MAX_LENGTH) throw flowerCardInvalidRequest();
    return { description, caption };
  }

  private parse(body: unknown): CreateFlowerCardRequest {
    if (typeof body !== "object" || body === null || Array.isArray(body)) throw flowerCardInvalidRequest();
    const data = body as Record<string, unknown>;
    const allowed = new Set(["projectId", "flowerName", "meaning", "scenes", "clipDurationSeconds", "aspectRatio"]);
    if (Object.keys(data).some((key) => !allowed.has(key))) throw flowerCardInvalidRequest();
    const projectId = typeof data.projectId === "string" ? data.projectId.trim() : "";
    const flowerName = typeof data.flowerName === "string" ? data.flowerName.trim() : "";
    const meaning = typeof data.meaning === "string" ? data.meaning.trim() : "";
    if (!isSafeProjectId(projectId)) throw flowerCardInvalidRequest();
    if (!flowerName || flowerName.length > FLOWER_CARD_NAME_MAX_LENGTH) throw flowerCardInvalidRequest();
    if (!meaning || meaning.length > FLOWER_CARD_MEANING_MAX_LENGTH) throw flowerCardInvalidRequest();
    // The same floor every other short project has. A one-scene reel is a single clip with a caption, which is
    // the photo card, and it has its own door.
    if (!Array.isArray(data.scenes) || data.scenes.length < MIN_SCENE_COUNT || data.scenes.length > MAX_SCENE_COUNT) throw flowerCardInvalidRequest();
    if (!(RUNWAY_CLIP_DURATIONS as readonly number[]).includes(data.clipDurationSeconds as number)) throw flowerCardInvalidRequest();
    if (data.aspectRatio !== "9:16" && data.aspectRatio !== "16:9") throw flowerCardInvalidRequest();
    return {
      projectId,
      flowerName,
      meaning,
      scenes: data.scenes.map((scene) => this.parseScene(scene)),
      clipDurationSeconds: data.clipDurationSeconds as CreateFlowerCardRequest["clipDurationSeconds"],
      aspectRatio: data.aspectRatio,
    };
  }
}
