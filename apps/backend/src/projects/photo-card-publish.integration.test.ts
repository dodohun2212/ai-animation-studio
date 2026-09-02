import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { InstagramConnectionStore } from "../instagram/instagram-connection.store.js";
import { InstagramPublishService } from "../instagram/instagram-publish.service.js";
import { LocalVideoMergeService } from "../videos/video-merge.service.js";
import { VideoLibraryService } from "../videos/video-library.service.js";
import type { MediaCommandRunner } from "../videos/ffmpeg-merge.service.js";
import { PhotoCardService } from "./photo-card.service.js";
import { LocalProjectRepository } from "./projects.repository.js";

/**
 * A photo card all the way out: made, merged, listed for publishing, published.
 *
 * Every step of this has its own tests and none of them stand where the card actually travels. The card is a
 * short project wearing one extra fact, so each stage was written believing the stage before it handles cards
 * — and the one stage that turned out not to (the merge screen's gate) was found by a person pressing a button,
 * not by a suite (Cowork Round 432). Cowork tried to walk the publish screen for a card in Rounds 452 and 454
 * and could not: their browser tooling cannot click the app's sidebar. They said so rather than claiming it,
 * and this is the half of that check a test can actually make — the routes, not the screen.
 *
 * No provider is reached: the Graph calls are answered by a stub, and the merge runs a fake FFmpeg.
 */
const TOKEN = "EAAtoken_value_1234567890";
const IG_USER_ID = "178000001";
const PAGE_ID = "1328208640370353";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");

const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response;
}

/** The publish sequence, answered by URL. Anything not part of that sequence throws, so a stray call is a failure rather than a silent pass. */
function graphFetch() {
  return vi.fn(async (input: URL | RequestInfo) => {
    const url = String(input);
    if (url.includes("/me/accounts")) return jsonResponse(200, { data: [{ name: "스튜디오", instagram_business_account: { id: IG_USER_ID, username: "studio" } }] });
    if (url.includes("/debug_token")) return jsonResponse(200, { data: { granular_scopes: [{ scope: "pages_show_list", target_ids: [PAGE_ID] }] } });
    if (url.includes(`/${PAGE_ID}?fields=`)) return jsonResponse(200, { name: "스튜디오", instagram_business_account: { id: IG_USER_ID, username: "studio" } });
    if (url.includes("rupload.facebook.com")) return jsonResponse(200, { success: true });
    if (url.includes("/media_publish")) return jsonResponse(200, { id: "media-card-1" });
    if (url.includes("/media")) return jsonResponse(200, { id: "container-card-1" });
    if (url.includes("fields=status_code")) return jsonResponse(200, { status_code: "FINISHED" });
    throw new Error(`unexpected fetch: ${url}`);
  });
}

const mergeRunner = (): MediaCommandRunner => async (args) => {
  const list = [...args];
  if (list[0] === "ffprobe") return { stdout: JSON.stringify({ streams: [{ codec_type: "video" }], format: { duration: "5" } }), stderr: "" };
  await fs.writeFile(list.at(-1)!, Buffer.from("rendered card video bytes"));
  return { stdout: "", stderr: "" };
};

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "card-publish-")); roots.push(root);
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const assets = new LocalAssetsRepository(root);
  const asset = await assets.create({ buffer: PNG, originalname: "quote.png", mimetype: "image/png" }, { assetType: "general_reference", displayName: "배경" });
  const connection = new InstagramConnectionStore(root);
  await connection.saveAppCredentials({ appId: "app-1", appSecret: "secret-1" });
  await connection.saveToken({ accessToken: TOKEN, expiresAt: null });
  return {
    root, projectsRoot, projects, connection,
    cards: new PhotoCardService(projects, assets, projectsRoot),
    assetId: asset.asset_id,
  };
}

describe("a photo card, from made to published", () => {
  it("reaches Instagram through the same routes an ordinary project uses", async () => {
    const { root, projectsRoot, projects, connection, cards, assetId } = await setup();
    // Nothing on this path may reach a provider except the Graph stub below.
    vi.stubGlobal("fetch", () => { throw new Error("a photo card must not reach a provider"); });
    await cards.create({ projectId: "card_one", assetId, quote: "불광불급\n미치지 않으면 미치지 못한다", clipDurationSeconds: 5, aspectRatio: "9:16" });

    const merged = await new LocalVideoMergeService(projects, projectsRoot, mergeRunner()).merge("card_one");
    expect(merged.finalVideoPath).toBe("videos/final/instagram_reel.mp4");

    // The publish screen builds its list from here, and a card that is missing from it cannot be published at all.
    const library = await new VideoLibraryService(projects, projectsRoot).list();
    expect(library.projects.find((row) => row.projectId === "card_one")).toMatchObject({ finalVideoAvailable: true });

    const fetchImpl = graphFetch();
    const publish = new InstagramPublishService(projects, projectsRoot, connection, { fetchImpl, sleep: async () => {} }, { processingTimeoutMs: 60_000, intervalMs: 0 }, async () => {});
    const result = await publish.publish("card_one", { approved: true, caption: "불광불급", igUserId: IG_USER_ID });

    expect(result.mediaId).toBe("media-card-1");
    // The bytes that went up are the card's own render, not a placeholder or an empty file.
    const upload = (fetchImpl as unknown as { mock: { calls: [unknown, RequestInit][] } }).mock.calls.find((call) => String(call[0]).includes("rupload.facebook.com"))!;
    expect(Buffer.from(upload[1].body as ArrayBuffer)).toEqual(await fs.readFile(path.join(projectsRoot, "card_one", "videos", "final", "instagram_reel.mp4")));
    // And the record is on the project, which is what stops a second press and what the screen reads back.
    expect((await projects.findById("card_one")).instagram_post).toMatchObject({ media_id: "media-card-1", ig_user_id: IG_USER_ID });
    void root;
  });

  // The other half of the rule that let a card be merged again: once it is published, it may not be.
  it("stops being remakeable the moment it is published", async () => {
    const { projectsRoot, projects, connection, cards, assetId } = await setup();
    vi.stubGlobal("fetch", () => { throw new Error("a photo card must not reach a provider"); });
    await cards.create({ projectId: "card_one", assetId, quote: "불광불급", clipDurationSeconds: 5, aspectRatio: "9:16" });
    await new LocalVideoMergeService(projects, projectsRoot, mergeRunner()).merge("card_one");
    // Remakeable while unpublished — this is what 캡틴D can do with the card sitting on their machine today.
    await new LocalVideoMergeService(projects, projectsRoot, mergeRunner()).merge("card_one", { subtitleLayout: { scale: 0.03 } });

    const publish = new InstagramPublishService(projects, projectsRoot, connection, { fetchImpl: graphFetch(), sleep: async () => {} }, { processingTimeoutMs: 60_000, intervalMs: 0 }, async () => {});
    await publish.publish("card_one", { approved: true, caption: "불광불급", igUserId: IG_USER_ID });

    await expect(new LocalVideoMergeService(projects, projectsRoot, mergeRunner()).merge("card_one"))
      .rejects.toMatchObject({ response: { code: "VIDEO_MERGE_ALREADY_PUBLISHED" } });
  });
});
