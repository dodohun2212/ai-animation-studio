import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import type { ForgetInstagramPostResponse, ForgetLongEpisodeInstagramPostResponse, PublishLongEpisodeToInstagramResponse, PublishToInstagramResponse } from "@ai-animation-studio/shared";

import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { withProjectLock } from "../videos/project-lock.js";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { episodeDirectoryName, longStoryRoot } from "../long-projects/long-project-paths.js";
import { toEpisodeDetail, toEpisodeInstagramPost, type StoredEpisodeForDetail } from "../long-projects/episode-detail.js";
import { InstagramConnectionStore } from "./instagram-connection.store.js";
import {
  createInstagramResumableContainer, getInstagramContainerStatus,
  publishInstagramContainer, uploadInstagramResumableVideo,
} from "./instagram-graph-adapter.js";
import { resolveInstagramPublishTargets } from "./instagram-publish-targets.js";
import { InstagramAdapterError, type RetryOptions } from "./instagram-request.js";
import {
  instagramAlreadyPublished, instagramNotConnected, instagramPostNotRecorded, instagramProviderError, instagramPublishFailed,
  instagramTargetNotFound, instagramVideoUnavailable, invalidInstagramRequest,
} from "./instagram-api.error.js";

const FINAL_VIDEO_PATH = "videos/final/instagram_reel.mp4";
/** Instagram's own caption ceiling — checked here as well as on the screen, so a caller that skips the screen cannot get a post rejected after the upload already happened. */
const CAPTION_MAX = 2200;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

export interface PublishPollOptions {
  /** How long to wait for Meta to finish processing the upload before giving up on this attempt. */
  processingTimeoutMs?: number;
  intervalMs?: number;
}

/**
 * Publishing a finished video to Instagram: container, upload, wait for processing, publish.
 *
 * Everything here is arranged around one fact — `media_publish` cannot be undone, and unlike a duplicate paid
 * request (D-005) a duplicate post has already been seen by whoever saw it. So the same publish can never run
 * twice: a project that already has a recorded post is refused outright, and the whole sequence holds the
 * cross-process lock so two windows cannot both be mid-publish for one project.
 */
@Injectable()
export class InstagramPublishService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly projectsRoot: string,
    private readonly connection: InstagramConnectionStore,
    private readonly requestOptions: RetryOptions = {},
    private readonly poll: PublishPollOptions = {},
    private readonly sleep: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    private readonly now: () => number = Date.now,
  ) {}

  private finalVideo(projectId: string): string {
    return path.join(this.projectsRoot, projectId, FINAL_VIDEO_PATH);
  }

  private parseRequest(request: unknown): { caption: string; igUserId: string } {
    if (!isObject(request) || Object.keys(request).length !== 3
      || request.approved !== true
      || typeof request.caption !== "string"
      || typeof request.igUserId !== "string" || !request.igUserId.trim()) {
      throw invalidInstagramRequest("Publishing requires explicit approval, a caption, and the account to publish to.");
    }
    if (request.caption.length > CAPTION_MAX) throw invalidInstagramRequest(`Caption exceeds Instagram's ${CAPTION_MAX} character limit.`);
    return { caption: request.caption, igUserId: request.igUserId.trim() };
  }

  /**
   * Waits for Meta to finish processing the uploaded video. `ERROR`/`EXPIRED` end the attempt rather than being
   * retried — the upload would have to start over anyway, and guessing otherwise risks a second container.
   *
   * `PUBLISHED` ends it too. This used to return, under a comment saying a re-publish was "refused below" —
   * and nothing below refused anything. On the one path in this app whose last step cannot be undone, a
   * comment claiming a guard that is not there is worse than no comment: it is what a reader checks instead of
   * the code. The refusal is real now, and it is a refusal rather than a success because a container Meta has
   * already published carries no media id we could record, and reporting a post we cannot name would put a
   * made-up record where the screen reads the real one.
   */
  private async waitUntilPublishable(accessToken: string, containerId: string): Promise<void> {
    const deadline = this.now() + (this.poll.processingTimeoutMs ?? 3 * 60 * 1000);
    const interval = this.poll.intervalMs ?? 3000;
    for (;;) {
      const { statusCode } = await getInstagramContainerStatus(accessToken, containerId, this.requestOptions);
      if (statusCode === "FINISHED") return;
      if (statusCode === "ERROR" || statusCode === "EXPIRED") {
        throw instagramPublishFailed("Instagram could not process this video.");
      }
      if (statusCode === "PUBLISHED") throw instagramPublishFailed("This video is already published on Instagram. Check the account before trying again.");
      if (this.now() >= deadline) throw instagramPublishFailed("Instagram is still processing this video. Try again in a few minutes.");
      await this.sleep(interval);
    }
  }

  async publish(projectId: string, request: unknown): Promise<PublishToInstagramResponse> {
    const { caption, igUserId } = this.parseRequest(request);
    const id = projectId.trim();
    const project = await this.projects.findById(id);
    // Checked before anything reaches Meta: re-publishing is the one mistake that cannot be walked back.
    if (project.instagram_post) throw instagramAlreadyPublished();

    const token = await this.connection.token();
    if (!token) throw instagramNotConnected();

    const videoPath = this.finalVideo(id);
    const bytes = await fs.readFile(videoPath).catch(() => undefined);
    if (!bytes || bytes.length === 0) throw instagramVideoUnavailable();

    return withProjectLock(path.join(this.projectsRoot, id), `${id}:instagram-publish`, async () => {
      // Re-read inside the lock: another window may have published while this call queued for it.
      const current = await this.projects.findById(id);
      if (current.instagram_post) throw instagramAlreadyPublished();

      const { mediaId, publishedAt } = await this.sendToInstagram(token.accessToken, igUserId, caption, bytes);
      const updated = {
        ...current,
        updated_at: publishedAt,
        instagram_post: { media_id: mediaId, ig_user_id: igUserId, published_at: publishedAt, caption },
      };
      // Written after Instagram accepted it, so the record means "this post exists", not "we tried".
      await this.projects.save(updated);
      return { mediaId, publishedAt, project: toApiProject(updated) };
    });
  }

  /**
   * Clears the stored post so the same project can be published again.
   *
   * Nothing here reaches Instagram, and that is the whole shape of it: the post stays up, and a person who
   * publishes again ends up with two. The app cannot check whether the old one was taken down — it can read
   * the account's list of pages, not undo a Reel — so `acknowledged` is the person answering the one question
   * that decides the outcome. It is not the archive routes' confirm-by-typing-the-topic gate: the screen holds
   * the topic, so requiring it would be a check the caller always passes (docs/06_DECISIONS.md D-023).
   *
   * The cleared record is pushed onto `previous_instagram_posts` rather than dropped. Someone can answer "yes,
   * I deleted it" without having deleted it, and then this list is the only trace left that a post of this
   * video may still be public. It is the one memory this app keeps of an action it can neither undo nor
   * re-check.
   */
  async forgetPost(projectId: string, request: unknown): Promise<ForgetInstagramPostResponse> {
    this.parseForgetRequest(request);
    const id = projectId.trim();
    await this.projects.findById(id);

    return withProjectLock(path.join(this.projectsRoot, id), `${id}:instagram-publish`, async () => {
      // The same lock the publish takes, so this cannot clear a record a publish is midway through writing.
      const current = await this.projects.findById(id);
      if (!current.instagram_post) throw instagramPostNotRecorded();
      const updated = {
        ...current,
        updated_at: new Date(this.now()).toISOString(),
        instagram_post: null,
        previous_instagram_posts: [...current.previous_instagram_posts, current.instagram_post],
      };
      await this.projects.save(updated);
      return { project: toApiProject(updated) };
    });
  }

  /** The same for one Episode — the two publish paths share everything, and so do the two ways of undoing one. */
  async forgetEpisodePost(projectId: string, episodeNumber: number, request: unknown): Promise<ForgetLongEpisodeInstagramPostResponse> {
    this.parseForgetRequest(request);
    const id = projectId.trim();
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1) throw instagramPostNotRecorded();
    const directory = path.join(longStoryRoot(this.projectsRoot, id), episodeDirectoryName(episodeNumber));
    const episodeFile = path.join(directory, "project.json");
    if (!await readEpisode(episodeFile)) throw instagramPostNotRecorded();

    return withProjectLock(directory, `${id}_${episodeNumber}_instagram_publish`, async () => {
      const current = await readEpisode(episodeFile);
      if (!current) throw instagramPostNotRecorded();
      const post = toEpisodeInstagramPost(current.instagram_post);
      if (!post) throw instagramPostNotRecorded();
      const previous = Array.isArray(current.previous_instagram_posts) ? current.previous_instagram_posts : [];
      const updated = {
        ...current,
        updated_at: new Date(this.now()).toISOString(),
        instagram_post: null,
        previous_instagram_posts: [...previous, current.instagram_post],
      };
      await atomicWriteUtf8File(episodeFile, JSON.stringify(updated, null, 2));
      return { episode: toEpisodeDetail(updated) };
    });
  }

  /**
   * The one field, checked exactly. `acknowledged` must be literally true and alone, the same shape the publish
   * request's `approved` uses — a defaulted or coerced value would turn a person's answer into the app's guess.
   */
  private parseForgetRequest(request: unknown): void {
    if (!isObject(request) || Object.keys(request).length !== 1 || request.acknowledged !== true) {
      throw invalidInstagramRequest("Clearing a published record requires acknowledging that the post on Instagram is not removed.");
    }
  }

  /**
   * The upload itself, shared by both project kinds.
   *
   * One copy on purpose. This is the sequence that ends in something public and irreversible, and a second
   * copy of it is a second place for the container-then-publish order, the processing wait, or the target
   * check to be got wrong — while looking correct beside its twin.
   */
  private async sendToInstagram(accessToken: string, igUserId: string, caption: string, bytes: Buffer): Promise<{ mediaId: string; publishedAt: string }> {
    let targets;
    try {
      // The same resolver the account list uses, on purpose: this check refuses what that list offered the
      // moment the two ask the question differently.
      targets = await resolveInstagramPublishTargets(this.connection, accessToken, this.requestOptions);
    } catch (error) {
      throw this.asApiError(error);
    }
    // The account the confirmation named must still be one this login can publish to — a remembered id that
    // has since been revoked must not silently become somebody else's account (D-006).
    if (!targets.some((target) => target.igUserId === igUserId)) throw instagramTargetNotFound();
    try {
      const { containerId } = await createInstagramResumableContainer(accessToken, igUserId, caption, this.requestOptions);
      await uploadInstagramResumableVideo(accessToken, containerId, bytes, this.requestOptions);
      await this.waitUntilPublishable(accessToken, containerId);
      const { mediaId } = await publishInstagramContainer(accessToken, igUserId, containerId, this.requestOptions);
      return { mediaId, publishedAt: new Date(this.now()).toISOString() };
    } catch (error) {
      throw this.asApiError(error);
    }
  }

  /**
   * The same for one Episode's merged final video.
   *
   * Everything that touches Meta is the shared path above; what differs is only which record says "already
   * published" and where the file is. The Episode keeps its own record, so a reload after publishing still
   * knows — publishing is the one action in this app that cannot be walked back, and a screen that forgot it
   * would offer to do it twice.
   */
  async publishEpisode(projectId: string, episodeNumber: number, request: unknown): Promise<PublishLongEpisodeToInstagramResponse> {
    const { caption, igUserId } = this.parseRequest(request);
    const id = projectId.trim();
    if (!Number.isInteger(episodeNumber) || episodeNumber < 1) throw instagramVideoUnavailable();
    const directory = path.join(longStoryRoot(this.projectsRoot, id), episodeDirectoryName(episodeNumber));
    const episodeFile = path.join(directory, "project.json");

    const stored = await readEpisode(episodeFile);
    if (!stored) throw instagramVideoUnavailable();
    if (stored.instagram_post) throw instagramAlreadyPublished();

    const token = await this.connection.token();
    if (!token) throw instagramNotConnected();

    const bytes = await fs.readFile(path.join(directory, FINAL_VIDEO_PATH)).catch(() => undefined);
    if (!bytes || bytes.length === 0) throw instagramVideoUnavailable();

    return withProjectLock(directory, `${id}_${episodeNumber}_instagram_publish`, async () => {
      // Re-read inside the lock: another window may have published while this call queued for it.
      const current = await readEpisode(episodeFile);
      if (!current) throw instagramVideoUnavailable();
      if (current.instagram_post) throw instagramAlreadyPublished();

      const { mediaId, publishedAt } = await this.sendToInstagram(token.accessToken, igUserId, caption, bytes);
      const updated = {
        ...current,
        updated_at: publishedAt,
        instagram_post: { media_id: mediaId, ig_user_id: igUserId, published_at: publishedAt, caption },
      };
      await atomicWriteUtf8File(episodeFile, JSON.stringify(updated, null, 2));
      return { mediaId, publishedAt, episode: toEpisodeDetail(updated) };
    });
  }

  /** Meta's own wording never reaches the user; the category travels in details so the screen can tell an expired login from a rejected video. */
  private asApiError(error: unknown): unknown {
    if (error instanceof InstagramAdapterError) {
      if (error.category === "authentication") return instagramNotConnected();
      return instagramProviderError(error.category, error.message);
    }
    return error;
  }
}

/** The Episode's stored record, or nothing — unreadable is "no Episode here", never "not published yet". */
async function readEpisode(file: string): Promise<(StoredEpisodeForDetail & { instagram_post?: unknown }) | undefined> {
  try {
    const parsed: unknown = JSON.parse(await fs.readFile(file, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
    const stored = parsed as Record<string, unknown>;
    if (!Number.isInteger(stored.number) || typeof stored.state !== "string") return undefined;
    return stored as unknown as StoredEpisodeForDetail & { instagram_post?: unknown };
  } catch {
    return undefined;
  }
}
