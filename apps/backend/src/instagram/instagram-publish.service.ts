import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import type { PublishToInstagramResponse } from "@ai-animation-studio/shared";

import { toApiProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { withProjectLock } from "../videos/project-lock.js";
import { InstagramConnectionStore } from "./instagram-connection.store.js";
import {
  createInstagramResumableContainer, getInstagramContainerStatus, listInstagramPublishTargets,
  publishInstagramContainer, uploadInstagramResumableVideo,
} from "./instagram-graph-adapter.js";
import { InstagramAdapterError, type RetryOptions } from "./instagram-request.js";
import {
  instagramAlreadyPublished, instagramNotConnected, instagramProviderError, instagramPublishFailed,
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
      if (statusCode === "PUBLISHED") return; // already out; publishing again is refused below
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

      let targets;
      try {
        targets = await listInstagramPublishTargets(token.accessToken, this.requestOptions);
      } catch (error) {
        throw this.asApiError(error);
      }
      // The account the confirmation named must still be one this login can publish to — a remembered id that
      // has since been revoked must not silently become somebody else's account (D-006).
      if (!targets.some((target) => target.igUserId === igUserId)) throw instagramTargetNotFound();

      try {
        const { containerId } = await createInstagramResumableContainer(token.accessToken, igUserId, this.requestOptions);
        await uploadInstagramResumableVideo(token.accessToken, containerId, bytes, this.requestOptions);
        await this.waitUntilPublishable(token.accessToken, containerId);
        const { mediaId } = await publishInstagramContainer(token.accessToken, igUserId, containerId, this.requestOptions);
        const publishedAt = new Date(this.now()).toISOString();
        const updated = {
          ...current,
          updated_at: publishedAt,
          instagram_post: { media_id: mediaId, ig_user_id: igUserId, published_at: publishedAt, caption },
        };
        // Written after Instagram accepted it, so the record means "this post exists", not "we tried".
        await this.projects.save(updated);
        return { mediaId, publishedAt, project: toApiProject(updated) };
      } catch (error) {
        throw this.asApiError(error);
      }
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
