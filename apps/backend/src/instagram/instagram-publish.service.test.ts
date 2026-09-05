import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";
import { INSTAGRAM_CAPTION_MAX, INSTAGRAM_HASHTAG_MAX } from "@ai-animation-studio/shared";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { EpisodeScriptsService } from "../long-projects/episode-scripts.service.js";
import { WorkflowState } from "@ai-animation-studio/shared";
import { FINAL_VIDEO_LOCK_KEY, withProjectLock } from "../videos/project-lock.js";
import { InstagramConnectionStore } from "./instagram-connection.store.js";
import { InstagramPublishService } from "./instagram-publish.service.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

const TOKEN = "EAAtoken_value_1234567890";
const IG_USER_ID = "178000001";
const PAGE_ID = "1328208640370353";
const VIDEO = Buffer.from("fake final video bytes");

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}

/**
 * Answers the whole publish sequence by URL, so a test can change one step without re-stating the rest.
 * `statuses` is consumed one per status poll, letting a test hold the container in IN_PROGRESS first.
 */
function graphFetch(options: { statuses?: string[]; failAt?: "container" | "upload" | "publish"; granularOnly?: boolean } = {}) {
  const statuses = [...(options.statuses ?? ["FINISHED"])];
  return vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
    void init;
    const url = String(input);
    const target = String(url);
    if (target.includes("/me/accounts")) {
      if (options.granularOnly) return jsonResponse(200, { data: [] });
      return jsonResponse(200, { data: [{ name: "이배드 스튜디오", instagram_business_account: { id: IG_USER_ID, username: "ibad_studio" } }] });
    }
    if (target.includes("/debug_token")) {
      return jsonResponse(200, { data: { granular_scopes: [{ scope: "pages_show_list", target_ids: [PAGE_ID] }] } });
    }
    if (target.includes(`/${PAGE_ID}?fields=`)) {
      return jsonResponse(200, { name: "이배드 스튜디오", instagram_business_account: { id: IG_USER_ID, username: "ibad_studio" } });
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
/** The body of the container-creation call — the one request a caption can ride on. */
function containerBody(fetchImpl: ReturnType<typeof graphFetch>): Record<string, unknown> {
  const call = fetchImpl.mock.calls.find(([url]) => String(url).endsWith("/media"));
  if (!call) throw new Error("no container was created");
  return JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
}

describe("InstagramPublishService.publish", () => {
  it("uploads, waits for processing, publishes, and records the post on the project", async () => {
    const { service, projects } = await setup({ fetchImpl: graphFetch({ statuses: ["IN_PROGRESS", "FINISHED"] }) });

    const result = await service.publish("post_project", approved);

    expect(result.mediaId).toBe("media-1");
    // Exact, and it used to be exact around a record with no caption in it — the same shape of assertion that
    // held the caption out of the container body. What a post said belongs on the record of that post.
    expect(result.project.instagramPost).toEqual({
      mediaId: "media-1", igUserId: IG_USER_ID, publishedAt: "2026-08-27T12:00:00.000Z", caption: "오늘의 영상",
      // null, because this publish asked for no cover frame. Recorded rather than left out: a Reel whose cover
      // is the first frame looks the same whether nobody chose one or somebody chose 0, and the difference is
      // the whole question when the cover turns out wrong.
      thumbOffsetMs: null,
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

  /**
   * Both of Instagram's caption ceilings, refused before anything is uploaded.
   *
   * The character limit was checked here already, with the comment that says why: a caller that skips the
   * screen must not get a post rejected after the upload happened. The hashtag limit was on the screen alone,
   * so that exact case was open — and it is the worse half, because the container is created first and the
   * refusal only arrives at the publish call.
   */
  it("refuses a caption past either of Instagram's limits, before creating a container", async () => {
    const fetchImpl = graphFetch();
    const { service } = await setup({ fetchImpl });

    const tooLong = { ...approved, caption: "가".repeat(INSTAGRAM_CAPTION_MAX + 1) };
    await expect(service.publish("post_project", tooLong)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });

    // One over, and one of them written into the body rather than the hashtag field — which is where the
    // screen's own count used to miss it.
    const tags = Array.from({ length: INSTAGRAM_HASHTAG_MAX }, (_, index) => `#tag${index}`).join(" ");
    const tooMany = { ...approved, caption: `#본문태그 오늘의 영상 ${tags}` };
    await expect(service.publish("post_project", tooMany)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });

    // Nothing reached Meta beyond the account check, so no media was uploaded for a post that cannot go out.
    expect(fetchImpl.mock.calls.every(([url]) => String(url).includes("/me/accounts"))).toBe(true);

    // And exactly at the limit still goes.
    await expect(service.publish("post_project", { ...approved, caption: tags })).resolves.toMatchObject({ mediaId: "media-1" });
  });

  it("refuses an account this login cannot actually publish to, before creating a container", async () => {
    const fetchImpl = graphFetch();
    const { service } = await setup({ fetchImpl });
    await expect(service.publish("post_project", { ...approved, igUserId: "178000999" }))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_TARGET_NOT_FOUND" } });
    expect(fetchImpl.mock.calls.every(([url]) => String(url).includes("/me/accounts"))).toBe(true);
  });

  /**
   * The account list and this check must never disagree about what "can publish" means.
   *
   * They did. A token whose `/me/accounts` is empty — the real state of an account holding `pages_show_list`
   * for one page under granular permissions — had the granular fallback added to the listing alone, so the
   * screen offered the account and then this check refused the very same one as unknown. Both sides called the
   * same adapter function and looked correct beside each other; only asking the question twice showed it.
   *
   * Pointing this check back at the raw list turns it red again.
   */
  it("publishes to an account only the granular grant can see, the same one the account list offers", async () => {
    const fetchImpl = graphFetch({ granularOnly: true });
    const { service, projects } = await setup({ fetchImpl });

    const result = await service.publish("post_project", approved);

    expect(result.mediaId).toBe("media-1");
    expect((await projects.findById("post_project")).instagram_post).toMatchObject({ ig_user_id: IG_USER_ID });
  });

  it("still refuses an account no path can reach, rather than publishing to the first one it found", async () => {
    // The fallback widens what counts as reachable; it must not turn the check itself off (D-006).
    const { service } = await setup({ fetchImpl: graphFetch({ granularOnly: true }) });
    await expect(service.publish("post_project", { ...approved, igUserId: "178000999" }))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_TARGET_NOT_FOUND" } });
  });

  /**
   * A Reel went out with an empty caption while this project's own record said it had one.
   *
   * Everything up to the disk was right — the screen composed the caption, the request carried it, the stored
   * post kept it — and `sendToInstagram` simply never took it as an argument, so it stopped there. Two tests
   * checked that the caption was stored and none checked that it was sent, which is the difference between
   * the app believing something and Instagram doing it.
   *
   * What rode on that caption is why this is worse than a missing sentence: the CC BY credit the screen
   * promises is inserted automatically (D-003) and the AI disclosure that is on by default both live in it.
   */
  it("sends the caption to Meta, not only to the record it keeps of the post", async () => {
    const fetchImpl = graphFetch();
    const { service, projects } = await setup({ fetchImpl });

    const caption = "오늘의 영상 · Music by Jane Doe · AI로 만든 영상입니다 #ai";
    const result = await service.publish("post_project", { ...approved, caption });

    expect(containerBody(fetchImpl).caption).toBe(caption);
    // And the record still matches what was actually sent, rather than the two drifting apart again.
    expect((await projects.findById("post_project")).instagram_post).toMatchObject({ caption });
    // Out to the screen as well. The Episode's record has always carried its caption and the short project's
    // stopped at the disk, so "what did this post actually say" — the question that matters exactly when the
    // credit line does — had an answer on one kind only.
    expect(result.project.instagramPost).toMatchObject({ caption });
  });

  it("refuses a container Instagram reports as already published, rather than publishing it a second time", async () => {
    // The comment here used to say a re-publish was "refused below"; nothing below refused it. On the one path
    // that cannot be undone, the guard has to be real or the promise has to go.
    const fetchImpl = graphFetch({ statuses: ["PUBLISHED"] });
    const { service, projects } = await setup({ fetchImpl });

    await expect(service.publish("post_project", approved))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_PUBLISH_FAILED" } });

    expect(fetchImpl.mock.calls.some(([url]) => String(url).includes("/media_publish"))).toBe(false);
    // No record either: a post we cannot name is not a post we can claim.
    expect((await projects.findById("post_project")).instagram_post).toBeNull();
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

  it("rejects a cover frame that is not a whole, non-negative millisecond count, before anything is sent", async () => {
    // Refused rather than rounded or clamped. This is the last call before something public that cannot be
    // taken back, and a cover frame the person did not choose looks exactly like the feature not working.
    const fetchImpl = graphFetch();
    const { service } = await setup({ fetchImpl });
    for (const thumbOffsetMs of [-1, 1.5, Number.NaN, "1000", null]) {
      await expect(service.publish("post_project", { ...approved, thumbOffsetMs })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("carries the chosen cover frame all the way into Meta's container request", async () => {
    // The two ends of this were verified separately — the screen sends it, the adapter puts it in the body —
    // and neither says it survives the service between them. The Episode's own version is beside its caption
    // test: two entry points into one upload, and a field threaded through only one of them is the shape this
    // repository keeps finding (D-031).
    const fetchImpl = graphFetch();
    const { service } = await setup({ fetchImpl });
    await service.publish("post_project", { ...approved, thumbOffsetMs: 3500 });
    expect(containerBody(fetchImpl).thumb_offset).toBe(3500);
  });

  /**
   * What cover this publish asked for survives on the record, including when the answer is 0.
   *
   * 캡틴D said a Reel's cover was not the frame they picked. The path from the screen to Meta's body turned out
   * to be unbroken, and there the investigation stopped: nothing on disk said what the request carried, so
   * "nobody chose a cover", "somebody chose the first frame" and "a real offset was ignored" were three stories
   * with one piece of evidence between them (Cowork Round 476). Publishing cannot be undone; being unable to say
   * afterwards what was sent is the part worth fixing first.
   *
   * 0 is the case that made it necessary. It produces the same Reel as sending nothing, so only the record can
   * ever tell those two apart — and it is exactly what a player that cannot seek would hand the screen while the
   * person believed they had chosen.
   */
  it("records the cover frame it asked for, and tells 0 apart from none", async () => {
    for (const [thumbOffsetMs, recorded] of [[3500, 3500], [0, 0], [undefined, null]] as const) {
      const { service, projects } = await setup({ fetchImpl: graphFetch() });
      const result = await service.publish("post_project", { ...approved, ...(thumbOffsetMs === undefined ? {} : { thumbOffsetMs }) });

      expect(result.project.instagramPost?.thumbOffsetMs, `sent ${String(thumbOffsetMs)}`).toBe(recorded);
      expect((await projects.findById("post_project")).instagram_post).toMatchObject({ thumb_offset_ms: recorded });
    }
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

  it("sends the Episode's caption and chosen cover frame to Meta too, since both kinds share the one upload path", async () => {
    const fetchImpl = graphFetch();
    const { service } = await withEpisode({ fetchImpl });

    await service.publishEpisode("long", 1, { ...approved, caption: "1화 · #장편", thumbOffsetMs: 8000 });

    const body = containerBody(fetchImpl);
    expect(body.caption).toBe("1화 · #장편");
    // The shared path is only shared if both fields arrive by it. The caption assertion alone would pass a
    // version that threads the cover through the short project's entry point and not this one.
    expect(body.thumb_offset).toBe(8000);
  });

  /**
   * The same record on the Episode, which is the path 캡틴D actually published through.
   *
   * Two entry points into one upload, and a field threaded through only one of them is the shape this repository
   * keeps finding (D-031) — the caption test above this file exists for the same reason.
   */
  it("records the Episode's cover frame on the Episode itself", async () => {
    const { service, episodeFile } = await withEpisode({ fetchImpl: graphFetch({ statuses: ["FINISHED"] }) });

    const result = await service.publishEpisode("long", 1, { ...approved, thumbOffsetMs: 8000 });

    expect(result.episode.instagramPost?.thumbOffsetMs).toBe(8000);
    // Read back off disk: an answer that only the response knows is lost the moment the screen reloads.
    const stored = JSON.parse(await fs.readFile(episodeFile, "utf8")) as { instagram_post: { thumb_offset_ms: number } };
    expect(stored.instagram_post.thumb_offset_ms).toBe(8000);
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


/**
 * What the post is built from, when the file underneath is moving.
 *
 * A photo card can be merged again now, so the file this reads is no longer written once and left alone. The
 * bytes used to be read before any lock was taken, which means the post could carry the cut a re-merge had
 * already replaced: Instagram holding one video, the person's disk holding another, and the record calling
 * both of them published — on the one action in this app that cannot be undone (CLI Round 449).
 */
describe("publishing while the final video is being replaced", () => {
  it("sends the video as it stands when the lock is free, not as it stood when the call arrived", async () => {
    const { projectsRoot, service, fetchImpl } = await setup({ fetchImpl: graphFetch() });
    const file = path.join(projectsRoot, "post_project", "videos", "final", "instagram_reel.mp4");
    const remade = Buffer.concat([VIDEO, Buffer.from("-remade")]);
    let publishing: Promise<{ mediaId: string }> | undefined;

    // Whoever holds this key is writing that file — a merge does exactly this. The publish starts while it is
    // held, so it has to wait, and what it must not do is carry bytes it read before waiting.
    await withProjectLock(path.join(projectsRoot, "post_project"), FINAL_VIDEO_LOCK_KEY, async () => {
      publishing = service.publish("post_project", approved);
      // Long enough that a publish reading the file before taking the lock has certainly already read it —
      // everything it does before that point is local disk and JSON. Without this the two race and the test
      // passes for the wrong reason: measured, an implementation that reads before the lock still went green.
      await new Promise((resolve) => setTimeout(resolve, 50));
      await fs.writeFile(file, remade);
    });

    expect(await publishing!).toMatchObject({ mediaId: "media-1" });
    const calls = (fetchImpl as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls;
    const upload = calls.find((call) => String(call[0]).includes("rupload.facebook.com"))!;
    expect(Buffer.from(upload[1].body as ArrayBuffer)).toEqual(remade);
  });

  // A render that died leaves the project saying Rendering, and the bytes it left are not a video anyone chose.
  it("refuses while a render is in flight, in its own words", async () => {
    const { projects, service } = await setup();
    const project = await projects.findById("post_project");
    await projects.save({ ...project, workflow_state: WorkflowState.Rendering });

    await expect(service.publish("post_project", approved))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_VIDEO_RENDERING" } });
  });
});

describe("InstagramPublishService.forgetPost", () => {
  /**
   * The lock had no key. A published project refuses a second publish forever, which is right while the post
   * is up and wrong the moment the video is re-cut — there was no way to say "that one is gone".
   */
  it("clears the record so the same project can be published again", async () => {
    const fetchImpl = graphFetch();
    const { service, projects } = await setup({ alreadyPublished: true, fetchImpl });

    const result = await service.forgetPost("post_project", { acknowledged: true });

    expect(result.project.instagramPost).toBeUndefined();
    expect((await projects.findById("post_project")).instagram_post).toBeNull();
    // And the refusal is actually gone, rather than the record merely looking cleared.
    await expect(service.publish("post_project", approved)).resolves.toMatchObject({ mediaId: "media-1" });
  });

  it("keeps the post it forgot, because the one on Instagram may still be up", async () => {
    // A person can answer "yes, I deleted it" without having deleted it. This list is then the only trace the
    // app has of a post of this video that is still public — and the next publish would otherwise overwrite
    // the last thing that knew about it.
    const { service, projects } = await setup({ alreadyPublished: true });

    const result = await service.forgetPost("post_project", { acknowledged: true });

    expect(result.project.previousInstagramPosts).toEqual([
      { mediaId: "media-old", igUserId: IG_USER_ID, publishedAt: "2026-08-26T00:00:00.000Z", caption: "before" },
    ]);
    expect((await projects.findById("post_project")).previous_instagram_posts).toHaveLength(1);
  });

  it("reaches Instagram not at all — the post there is not this app's to remove", async () => {
    const fetchImpl = graphFetch();
    const { service } = await setup({ alreadyPublished: true, fetchImpl });

    await service.forgetPost("post_project", { acknowledged: true });

    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses without the acknowledgement, which is the whole point of asking", async () => {
    const { service, projects } = await setup({ alreadyPublished: true });

    await expect(service.forgetPost("post_project", {})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.forgetPost("post_project", { acknowledged: false })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.forgetPost("post_project", { acknowledged: true, extra: 1 })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    expect((await projects.findById("post_project")).instagram_post).not.toBeNull();
  });

  it("says so when there is no record to clear, rather than reporting a success that changed nothing", async () => {
    const { service } = await setup();
    await expect(service.forgetPost("post_project", { acknowledged: true }))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_POST_NOT_RECORDED" } });
  });

  it("does the same for an Episode, and the Episode carries what it forgot", async () => {
    const { service } = await withEpisode({ alreadyPublished: true });

    const result = await service.forgetEpisodePost("long", 1, { acknowledged: true });

    expect(result.episode.instagramPost).toBeUndefined();
    expect(result.episode.previousInstagramPosts).toHaveLength(1);
    expect(result.episode.previousInstagramPosts?.[0]?.mediaId).toBe("media-old");
    await expect(service.publishEpisode("long", 1, approved)).resolves.toMatchObject({ mediaId: "media-1" });
  });

  it("refuses an Episode with no record, and one that does not exist", async () => {
    const { service } = await withEpisode();
    await expect(service.forgetEpisodePost("long", 1, { acknowledged: true }))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_POST_NOT_RECORDED" } });
    await expect(service.forgetEpisodePost("long", 9, { acknowledged: true }))
      .rejects.toMatchObject({ response: { code: "INSTAGRAM_POST_NOT_RECORDED" } });
  });
});
