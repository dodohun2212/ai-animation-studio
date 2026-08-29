import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { EpisodeScriptsService } from "../long-projects/episode-scripts.service.js";
import { InstagramConnectionStore } from "./instagram-connection.store.js";
import { InstagramPublishService } from "./instagram-publish.service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const TOKEN = "EAAtoken_value_1234567890";
const IG_USER_ID = "178000001";
const VIDEO = Buffer.from("fake final video bytes");

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}

/**
 * Answers the whole publish sequence by URL, so a test can change one step without re-stating the rest.
 * `statuses` is consumed one per status poll, letting a test hold the container in IN_PROGRESS first.
 */
function graphFetch(options: { statuses?: string[]; failAt?: "container" | "upload" | "publish" } = {}) {
  const statuses = [...(options.statuses ?? ["FINISHED"])];
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    void init;
    const url = String(input);
    const target = String(url);
    if (target.includes("/me/accounts")) {
      return jsonResponse(200, { data: [{ name: "이배드 스튜디오", instagram_business_account: { id: IG_USER_ID, username: "ibad_studio" } }] });
    }
    if (target.includes("rupload.facebook.com")) {
      if (options.failAt === "upload") return jsonResponse(400, { error: { message: "bad upload", code: 100 } });
      return jsonResponse(200, { success: true });
    }
    if (target.includes("/media_publish")) {
      if (options.failAt === "publish") return jsonResponse(400, { error: { message: "rejected", code: 100 } });
      return jsonResponse(200, { id: "media-1" });
    }
    if (target.includes("/media")) {
      if (options.failAt === "container") return jsonResponse(400, { error: { message: "no", code: 100 } });
      return jsonResponse(200, { id: "container-1" });
    }
    if (target.includes("fields=status_code")) {
      return jsonResponse(200, { status_code: statuses.length > 1 ? statuses.shift() : statuses[0] });
    }
    throw new Error(`unexpected fetch: ${target}`);
  });
}

async function setup(options: {
  connected?: boolean; withVideo?: boolean; alreadyPublished?: boolean;
  fetchImpl?: typeof fetch; now?: () => number;
} = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "instagram-publish-")); roots.push(root);
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("post_project", "topic", "2026-08-23T00:00:00.000Z");
  if (options.alreadyPublished) {
    project.instagram_post = { media_id: "media-old", ig_user_id: IG_USER_ID, published_at: "2026-08-26T00:00:00.000Z", caption: "before" };
  }
  await projects.create(project);
  if (options.withVideo !== false) {
    const finalDir = path.join(projectsRoot, "post_project", "videos", "final");
    await fs.mkdir(finalDir, { recursive: true });
    await fs.writeFile(path.join(finalDir, "instagram_reel.mp4"), VIDEO);
  }
  const connection = new InstagramConnectionStore(root);
  await connection.saveAppCredentials({ appId: "app-1", appSecret: "secret-1" });
  if (options.connected !== false) await connection.saveToken({ accessToken: TOKEN, expiresAt: null });

  const fetchImpl = options.fetchImpl ?? graphFetch();
  const service = new InstagramPublishService(
    projects, projectsRoot, connection,
    { fetchImpl, sleep: async () => {} },
    { processingTimeoutMs: 60_000, intervalMs: 0 },
    async () => {},
    options.now ?? (() => Date.parse("2026-08-27T12:00:00.000Z")),
  );
  return { root, projectsRoot, projects, service, fetchImpl };
}

const approved = { approved: true as const, caption: "오늘의 영상", igUserId: IG_USER_ID };

describe("InstagramPublishService.publish", () => {
  it("uploads, waits for processing, publishes, and records the post on the project", async () => {
    const { service, projects } = await setup({ fetchImpl: graphFetch({ statuses: ["IN_PROGRESS", "FINISHED"] }) });

    const result = await service.publish("post_project", approved);

    expect(result.mediaId).toBe("media-1");
    expect(result.project.instagramPost).toEqual({
      mediaId: "media-1", igUserId: IG_USER_ID, publishedAt: "2026-08-27T12:00:00.000Z",
    });
    const stored = await projects.findById("post_project");
    expect(stored.instagram_post).toMatchObject({ media_id: "media-1", caption: "오늘의 영상" });
  });

  it("refuses to publish a second time, without reaching Meta at all", async () => {
    // A duplicate charge can be argued with; a duplicate post has already been seen.
    const fetchImpl = graphFetch();
    const { service } = await setup({ alreadyPublished: true, fetchImpl });
    await expect(service.publish("post_project", approved))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_ALREADY_PUBLISHED" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an account this login cannot actually publish to, before creating a container", async () => {
    const fetchImpl = graphFetch();
    const { service } = await setup({ fetchImpl });
    await expect(service.publish("post_project", { ...approved, igUserId: "178000999" }))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_TARGET_NOT_FOUND" } });
    expect(fetchImpl.mock.calls.every(([url]) => String(url).includes("/me/accounts"))).toBe(true);
  });

  it("reports not-connected when there is no stored token", async () => {
    const { service } = await setup({ connected: false });
    await expect(service.publish("post_project", approved))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_NOT_CONNECTED" } });
  });

  it("reports a missing final video rather than uploading nothing", async () => {
    const { service } = await setup({ withVideo: false });
    await expect(service.publish("post_project", approved))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_VIDEO_UNAVAILABLE" } });
  });

  it("gives up on a container Instagram reports as ERROR, leaving no post recorded", async () => {
    const { service, projects } = await setup({ fetchImpl: graphFetch({ statuses: ["ERROR"] }) });
    await expect(service.publish("post_project", approved))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_PUBLISH_FAILED" } });
    expect((await projects.findById("post_project")).instagram_post).toBeNull();
  });

  it("gives up once processing outlasts the deadline, rather than waiting forever", async () => {
    let clock = Date.parse("2026-08-27T12:00:00.000Z");
    const { service } = await setup({
      fetchImpl: graphFetch({ statuses: ["IN_PROGRESS"] }),
      now: () => { clock += 30_000; return clock; },
    });
    await expect(service.publish("post_project", approved))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_PUBLISH_FAILED" } });
  });

  it("records nothing when the publish call itself is rejected", async () => {
    const { service, projects } = await setup({ fetchImpl: graphFetch({ failAt: "publish" }) });
    await expect(service.publish("post_project", approved))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_PROVIDER_ERROR" } });
    expect((await projects.findById("post_project")).instagram_post).toBeNull();
  });

  it("reports an expired login as not-connected rather than a generic provider failure", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: { message: "Session expired", code: 190 } }));
    const { service } = await setup({ fetchImpl });
    await expect(service.publish("post_project", approved))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_NOT_CONNECTED" } });
  });

  it("requires explicit approval and rejects a malformed body", async () => {
    const fetchImpl = graphFetch();
    const { service } = await setup({ fetchImpl });
    for (const body of [
      undefined,
      { caption: "x", igUserId: IG_USER_ID },
      { approved: false, caption: "x", igUserId: IG_USER_ID },
      { approved: true, caption: "x" },
      { approved: true, caption: "x", igUserId: "" },
      { approved: true, caption: "x", igUserId: IG_USER_ID, extra: 1 },
    ]) {
      await expect(service.publish("post_project", body)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a caption past Instagram's limit before uploading anything", async () => {
    const fetchImpl = graphFetch();
    const { service } = await setup({ fetchImpl });
    await expect(service.publish("post_project", { ...approved, caption: "가".repeat(2201) }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lets a second attempt succeed after a failed one, since nothing was published", async () => {
    const { root, projectsRoot, projects, service: failing } = await setup({ fetchImpl: graphFetch({ failAt: "publish" }) });
    await expect(failing.publish("post_project", approved)).rejects.toMatchObject({ response: { code: "INSTAGRAM_PROVIDER_ERROR" } });

    const connection = new InstagramConnectionStore(root);
    const retry = new InstagramPublishService(
      projects, projectsRoot, connection,
      { fetchImpl: graphFetch(), sleep: async () => {} },
      { processingTimeoutMs: 60_000, intervalMs: 0 },
      async () => {},
      () => Date.parse("2026-08-27T12:00:00.000Z"),
    );
    await expect(retry.publish("post_project", approved)).resolves.toMatchObject({ mediaId: "media-1" });
  });
});

/**
 * The same fake Graph, pointed at one Episode's merged final video.
 *
 * Deliberately reusing `setup`'s service: everything that reaches Meta is one shared path, and a second
 * harness would let the Episode route diverge from the short one without any test noticing.
 */
async function withEpisode(options: Parameters<typeof setup>[0] & { withVideo?: boolean; alreadyPublished?: boolean } = {}) {
  const context = await setup({ ...options, withVideo: false });
  const storyRoot = path.join(context.projectsRoot, "long", "long_story");
  const directory = path.join(storyRoot, "Episode01");
  await fs.mkdir(path.join(directory, "videos", "final"), { recursive: true });
  // The Episode read-back goes through the scripts service, which reads the outline first.
  await fs.writeFile(path.join(storyRoot, "episode_outlines.json"), JSON.stringify([{
    episode_number: 1, title: "첫 번째 밤", summary: "s", main_event: "e", conflict: "c",
    cliffhanger: "h", next_episode_hook: "n", status: "completed",
  }]));
  await fs.writeFile(path.join(directory, "project.json"), JSON.stringify({
    episode_id: "long-episode-1", number: 1, state: "completed", approved: true, script: {}, script_revision: 1, script_history: [], duration_seconds: 30, scene_count: 6, outline: {},
    title: "첫 번째 밤", summary: "s", core_event: "e", conflict: "c", cliffhanger: "h",
    next_connection: "n", updated_at: "2026-08-26T00:00:00.000Z",
    ...(options.alreadyPublished ? { instagram_post: { media_id: "media-old", ig_user_id: IG_USER_ID, published_at: "2026-08-26T00:00:00.000Z", caption: "before" } } : {}),
  }));
  if (options.withVideo !== false) {
    await fs.writeFile(path.join(directory, "videos", "final", "instagram_reel.mp4"), VIDEO);
  }
  return { ...context, directory, episodeFile: path.join(directory, "project.json") };
}

describe("InstagramPublishService.publishEpisode", () => {
  it("publishes an Episode's final video and records the post on the Episode itself", async () => {
    const { service, episodeFile } = await withEpisode({ fetchImpl: graphFetch({ statuses: ["IN_PROGRESS", "FINISHED"] }) });

    const result = await service.publishEpisode("long", 1, approved);

    expect(result.mediaId).toBe("media-1");
    // On the Episode, not only in the answer: a reload after publishing has to still know.
    expect(result.episode.instagramPost).toMatchObject({ mediaId: "media-1", igUserId: IG_USER_ID, caption: "오늘의 영상" });
    const stored = JSON.parse(await fs.readFile(episodeFile, "utf8")) as { instagram_post: Record<string, unknown> };
    expect(stored.instagram_post).toMatchObject({ media_id: "media-1", ig_user_id: IG_USER_ID });
  });

  it("leaves the published record where the screen actually reads it back", async () => {
    // The lock against publishing twice lives on the Episode, and the screen learns it from
    // GET /long-projects/:id/episodes/:n. That endpoint is served by a different mapper, which did not carry
    // the field — so publishing worked, the response said so, and a refresh offered to publish again.
    // Written here because this is the guarantee the publish path is making, not the scripts service.
    const { service, projectsRoot } = await withEpisode({ fetchImpl: graphFetch({ statuses: ["FINISHED"] }) });

    await service.publishEpisode("long", 1, approved);

    const scripts = new EpisodeScriptsService(projectsRoot);
    const { episode } = await scripts.get("long", 1);
    expect(episode.instagramPost).toMatchObject({ mediaId: "media-1", igUserId: IG_USER_ID });
  });

  it("refuses a second publish of the same Episode, which is the one mistake that cannot be walked back", async () => {
    const { service, fetchImpl } = await withEpisode({ alreadyPublished: true });

    await expect(service.publishEpisode("long", 1, approved)).rejects.toMatchObject({ response: { code: "INSTAGRAM_ALREADY_PUBLISHED" } });
    // Refused before anything reached Meta.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses when the Episode has not been merged yet, rather than uploading nothing", async () => {
    const { service, fetchImpl } = await withEpisode({ withVideo: false });

    await expect(service.publishEpisode("long", 1, approved)).rejects.toMatchObject({ response: { code: "INSTAGRAM_VIDEO_UNAVAILABLE" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an Episode that does not exist", async () => {
    const { service } = await withEpisode();

    await expect(service.publishEpisode("long", 9, approved)).rejects.toMatchObject({ response: { code: "INSTAGRAM_VIDEO_UNAVAILABLE" } });
  });

  it("demands the same explicit approval the short project's publish does", async () => {
    const { service, fetchImpl } = await withEpisode();

    await expect(service.publishEpisode("long", 1, { caption: "c", igUserId: IG_USER_ID })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an account this login can no longer publish to, before uploading anything", async () => {
    // D-006: a remembered id that has since been revoked must not silently become somebody else's account.
    const { service } = await withEpisode();

    await expect(service.publishEpisode("long", 1, { ...approved, igUserId: "17800000000000999" }))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_TARGET_NOT_FOUND" } });
  });
});
