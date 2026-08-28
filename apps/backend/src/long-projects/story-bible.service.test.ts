import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LongProjectsService } from "./long-projects.service.js";
import { StoryBibleService } from "./story-bible.service.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";

let root: string | undefined;
const settings = { title: "Long project", logline: "A local story", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }); root = undefined; });
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
async function services(): Promise<{ long: LongProjectsService; bible: StoryBibleService; assets: LocalAssetsRepository }> { root = await fs.mkdtemp(path.join(os.tmpdir(), "story-bible-")); const projectsRoot = path.join(root, "projects"); const long = new LongProjectsService(projectsRoot); await long.create({ projectId: "long_bible", settings }); const assets = new LocalAssetsRepository(root); return { long, bible: new StoryBibleService(projectsRoot, assets), assets }; }

describe("StoryBibleService", () => {
  it("creates both collections with snake_case storage and camelCase API", async () => {
    const { bible } = await services();
    const secret = await bible.create("long_bible", "secrets", { item: { id: "SECRET-1", name: "출생의 비밀", status: "hidden", description: "이배드는 사실 시장의 아들이다", revealAvailableEpisode: 4 } });
    expect(secret.item).toMatchObject({ id: "SECRET-1", description: "이배드는 사실 시장의 아들이다", revealAvailableEpisode: 4 });
    await bible.create("long_bible", "foreshadowing", { item: { name: "깨진 시계", status: "open" } });
    expect((await bible.get("long_bible")).storyBible.foreshadowing).toHaveLength(1);
    const raw = JSON.parse(await fs.readFile(path.join(root!, "projects", "long_bible", "long_story", "story_bible.json"), "utf8"));
    expect(raw.secrets[0]).toMatchObject({ secret_id: "SECRET-1", reveal_available_episode: 4 });
    expect(raw.secrets[0]).not.toHaveProperty("revealAvailableEpisode");
  });

  it("updates and deletes an item without changing its ID", async () => {
    const { bible } = await services(); await bible.create("long_bible", "foreshadowing", { item: { id: "FORESHADOW-1", name: "깨진 시계", status: "open" } });
    const updated = await bible.update("long_bible", "foreshadowing", "FORESHADOW-1", { item: { status: "resolved", description: "3화에서 회수" } });
    expect(updated.item).toMatchObject({ id: "FORESHADOW-1", status: "resolved", description: "3화에서 회수" });
    await expect(bible.update("long_bible", "foreshadowing", "FORESHADOW-1", { item: { id: "FORESHADOW-2" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    expect((await bible.delete("long_bible", "foreshadowing", "FORESHADOW-1")).storyBible.foreshadowing).toEqual([]);
    await expect(bible.delete("long_bible", "foreshadowing", "FORESHADOW-1")).rejects.toMatchObject({ response: { code: "STORY_BIBLE_ITEM_NOT_FOUND" } });
  });

  it("rejects duplicate, unsafe, unknown, invalid typed, and removed-collection requests", async () => {
    const { bible } = await services(); await bible.create("long_bible", "secrets", { item: { id: "SECRET-1", name: "Truth" } });
    await expect(bible.create("long_bible", "secrets", { item: { id: "SECRET-1", name: "Copy" } })).rejects.toMatchObject({ response: { code: "STORY_BIBLE_ITEM_ALREADY_EXISTS" } });
    await expect(bible.create("long_bible", "secrets", { item: { id: "../escape", name: "Bad" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(bible.create("long_bible", "secrets", { item: { name: "Bad", unknown: "no" } as never })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(bible.create("long_bible", "secrets", { item: { name: "Bad", revealAvailableEpisode: 0 } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    // The three collections that went with the screen are refused by name, not silently accepted into nothing.
    for (const gone of ["characters", "locations", "props"]) {
      await expect(bible.create("long_bible", gone, { item: { name: "Bad" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
    await expect(bible.create("long_bible", "bad", { item: { name: "Bad" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("reopens persisted items with a fresh backend service", async () => {
    const { bible } = await services(); await bible.create("long_bible", "secrets", { item: { id: "SECRET-1", name: "Truth", status: "hidden", revealAvailableEpisode: 2 } });
    const reloaded = new StoryBibleService(path.join(root!, "projects"));
    expect((await reloaded.get("long_bible")).storyBible.secrets).toEqual([expect.objectContaining({ id: "SECRET-1", revealAvailableEpisode: 2 })]);
  });

  it("still opens a Story Bible written by the version that had five collections", async () => {
    // Everything those collections stored is still on disk in older projects — relationship ids, alive/injured,
    // truth, content, an Asset link. Refusing an unknown key would make each of those projects unopenable, so
    // they are read and dropped. New writes carry only what a secret is made of.
    const { bible } = await services();
    await bible.create("long_bible", "secrets", { item: { id: "SECRET-1", name: "출생의 비밀" } });
    const file = path.join(root!, "projects", "long_bible", "long_story", "story_bible.json");
    const legacy = JSON.parse(await fs.readFile(file, "utf8")) as { secrets: Record<string, unknown>[] };
    legacy.secrets[0] = {
      ...legacy.secrets[0]!,
      truth: "시장의 아들", content: "본문", planned_reveal_episode: 8, actual_reveal_episode: null,
      character_ids: ["CHAR-GONE"], location_ids: ["LOC-GONE"], event_ids: [],
      asset_link: { asset_id: "ASSET-1", version_policy: "follow_latest", pinned_version: null, episode_scope: { mode: "all" } },
    };
    await fs.writeFile(file, JSON.stringify(legacy), "utf8");

    const reopened = (await bible.get("long_bible")).storyBible.secrets[0]!;
    expect(reopened).toMatchObject({ id: "SECRET-1", name: "출생의 비밀" });
    for (const gone of ["truth", "content", "plannedRevealEpisode", "characterIds", "assetLink"]) {
      expect(reopened).not.toHaveProperty(gone);
    }
  });

  it("saves world notes without touching the links stored beside them", async () => {
    // The request has no `basic` any more, so a caller saving world notes cannot clear the style or protagonist
    // link by leaving it out — which is what the old shape made possible, and what the screen had to work
    // around by reading `basic` back and handing it in unchanged.
    const { bible, assets } = await services();
    const style = await assets.create({ buffer: image, originalname: "style.png", mimetype: "image/png" }, { assetType: "style", displayName: "Noir", approved: true });
    await bible.updateStyleAssetLink("long_bible", { assetLink: { assetId: style.asset_id, versionPolicy: "snapshot", pinnedVersion: 1 } });

    const saved = await bible.updateWorld("long_bible", { world: { rules: ["no magic"] } });
    expect(saved.storyBible).toMatchObject({ world: { rules: ["no magic"] }, styleAssetLink: { assetId: style.asset_id, versionPolicy: "snapshot", pinnedVersion: 1 } });
    const raw = JSON.parse(await fs.readFile(path.join(root!, "projects", "long_bible", "long_story", "story_bible.json"), "utf8"));
    expect(raw.basic.style_asset_link).toEqual({ asset_id: style.asset_id, version_policy: "snapshot", pinned_version: 1 });
    await expect(bible.updateWorld("long_bible", { world: {}, basic: {} } as never)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    expect((await bible.updateStyleAssetLink("long_bible", { assetLink: null })).storyBible.styleAssetLink).toBeUndefined();
  });

  it("rejects wrong, unavailable, unapproved, and nonexistent global style Asset versions", async () => {
    const { bible, assets } = await services();
    const character = await assets.create({ buffer: image, originalname: "character.png", mimetype: "image/png" }, { assetType: "character", displayName: "Character", approved: true });
    const style = await assets.create({ buffer: image, originalname: "style.png", mimetype: "image/png" }, { assetType: "style", displayName: "Style", approved: true });
    await expect(bible.updateStyleAssetLink("long_bible", { assetLink: { assetId: character.asset_id, versionPolicy: "pinned_version", pinnedVersion: 1 } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(bible.updateStyleAssetLink("long_bible", { assetLink: { assetId: style.asset_id, versionPolicy: "follow_latest", pinnedVersion: 9 } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await assets.update(style.asset_id, { approved: false });
    await expect(bible.updateStyleAssetLink("long_bible", { assetLink: { assetId: style.asset_id, versionPolicy: "pinned_version", pinnedVersion: 1 } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("reports malformed and unknown stored JSON without leaking its content", async () => {
    const { bible } = await services(); const file = path.join(root!, "projects", "long_bible", "long_story", "story_bible.json");
    await fs.writeFile(file, "{ secret: 'raw-key'", "utf8");
    await expect(bible.get("long_bible")).rejects.toMatchObject({ response: { code: "LONG_PROJECT_JSON_MALFORMED", message: expect.not.stringContaining("raw-key") } });
    await fs.writeFile(file, JSON.stringify({ basic: {}, world: {}, characters: [], locations: [], props: [], secrets: [], foreshadowing: [], summaries: {}, updated_at: new Date().toISOString(), unknown: true }), "utf8");
    await expect(bible.get("long_bible")).rejects.toMatchObject({ response: { code: "LONG_PROJECT_DATA_INVALID" } });
  });

  it("searches name and description in stored order, including unicode and a blank query", async () => {
    const { bible } = await services();
    await bible.create("long_bible", "secrets", { item: { id: "SECRET-1", name: "민재", description: "밤의 도서관" } });
    await bible.create("long_bible", "secrets", { item: { id: "SECRET-2", name: "Mina", description: "A Korean detective" } });
    await bible.create("long_bible", "secrets", { item: { id: "SECRET-3", name: "Other", description: "unrelated" } });
    expect(await bible.search("long_bible", "secrets", "  민재 ")).toEqual({ items: [expect.objectContaining({ id: "SECRET-1" })] });
    expect(await bible.search("long_bible", "secrets", "KOREAN")).toEqual({ items: [expect.objectContaining({ id: "SECRET-2" })] });
    expect((await bible.search("long_bible", "secrets", "   ")).items.map((item) => item.id)).toEqual(["SECRET-1", "SECRET-2", "SECRET-3"]);
    await expect(bible.search("long_bible", "unknown", "x")).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(bible.search("long_bible", "secrets", undefined)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("duplicates one item deeply with a safe fresh ID", async () => {
    const { bible } = await services();
    await bible.create("long_bible", "secrets", { item: { id: "SECRET-1", name: "민재", description: "original", revealAvailableEpisode: 3 } });
    const duplicated = await bible.duplicate("long_bible", "secrets", "SECRET-1");
    expect(duplicated.item).toMatchObject({ id: expect.stringMatching(/^SECRET-[A-F0-9]{8}$/), name: "민재 복사본", description: "original", revealAvailableEpisode: 3 });
    expect(duplicated.item.id).not.toBe("SECRET-1");
    const source = (await bible.get("long_bible")).storyBible.secrets.find((item) => item.id === "SECRET-1");
    expect(source).toMatchObject({ name: "민재", revealAvailableEpisode: 3 });
    await expect(bible.duplicate("long_bible", "secrets", "SECRET-MISSING")).rejects.toMatchObject({ response: { code: "STORY_BIBLE_ITEM_NOT_FOUND" } });
    await expect(bible.duplicate("long_bible", "secrets", "../unsafe")).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(bible.duplicate("long_bible", "unknown", "SECRET-1")).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("links a protagonist Folder for the whole project, and refuses a single drawing", async () => {
    // Inverted on purpose: an item's link refused Folders, this one requires one. A character is a set of
    // angles of one person, and a single drawing is a pose — the name on the Folder is what a script prompt
    // is given, and the per-child descriptions are what an image prompt can read.
    const { bible, assets } = await services();
    const folder = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    const drawing = await assets.create({ buffer: image, originalname: "front.png", mimetype: "image/png" }, { assetType: "character", displayName: "정면", approved: true });

    const linked = await bible.updateProtagonistAssetLink("long_bible", { assetLink: { assetId: folder.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    expect(linked.storyBible.protagonistAssetLink).toEqual({ assetId: folder.asset_id, versionPolicy: "follow_latest", pinnedVersion: null });
    const file = path.join(root!, "projects", "long_bible", "long_story", "story_bible.json");
    expect(JSON.parse(await fs.readFile(file, "utf8")).basic.protagonist_asset_link).toEqual({ asset_id: folder.asset_id, version_policy: "follow_latest", pinned_version: null });

    await expect(bible.updateProtagonistAssetLink("long_bible", { assetLink: { assetId: drawing.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(bible.updateProtagonistAssetLink("long_bible", { assetLink: { assetId: "ASSET-MISSING", versionPolicy: "follow_latest", pinnedVersion: null } }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    // The refused attempts left the good link alone.
    expect((await bible.get("long_bible")).storyBible.protagonistAssetLink?.assetId).toBe(folder.asset_id);

    expect((await bible.updateProtagonistAssetLink("long_bible", { assetLink: null })).storyBible.protagonistAssetLink).toBeUndefined();
  });

  it("keeps the protagonist link when world notes are saved", async () => {
    // Saving world notes is the ordinary edit that used to travel through `basic` and could take the link with
    // it. Now it cannot reach `basic` at all.
    const { bible, assets } = await services();
    const folder = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    await bible.updateProtagonistAssetLink("long_bible", { assetLink: { assetId: folder.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    const after = await bible.updateWorld("long_bible", { world: { 시대: "20년 뒤" } });
    expect(after.storyBible.protagonistAssetLink?.assetId).toBe(folder.asset_id);
    expect(after.storyBible.world).toEqual({ 시대: "20년 뒤" });
  });
});
