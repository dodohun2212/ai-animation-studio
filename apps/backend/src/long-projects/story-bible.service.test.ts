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
  it("creates all five collections with snake_case storage and camelCase API", async () => {
    const { bible } = await services();
    const character = await bible.create("long_bible", "characters", { item: { id: "CHAR-1", name: "Mina", status: "active", alive: true, emotionalState: "worried", ownedItemIds: ["PROP-1"] } });
    expect(character.item).toMatchObject({ id: "CHAR-1", emotionalState: "worried", ownedItemIds: ["PROP-1"] });
    for (const collection of ["locations", "props", "secrets", "foreshadowing"] as const) await bible.create("long_bible", collection, { item: { name: collection, status: "planned" } });
    expect((await bible.get("long_bible")).storyBible.foreshadowing).toHaveLength(1);
    const raw = JSON.parse(await fs.readFile(path.join(root!, "projects", "long_bible", "long_story", "story_bible.json"), "utf8"));
    expect(raw.characters[0]).toMatchObject({ character_id: "CHAR-1", emotional_state: "worried", owned_item_ids: ["PROP-1"] });
    expect(raw.characters[0]).not.toHaveProperty("emotionalState");
  });

  it("updates and deletes an item without changing its ID", async () => {
    const { bible } = await services(); await bible.create("long_bible", "props", { item: { id: "PROP-1", name: "Key", status: "lost", ownerId: "CHAR-1" } });
    const updated = await bible.update("long_bible", "props", "PROP-1", { item: { status: "found", ownerId: "CHAR-2" } });
    expect(updated.item).toMatchObject({ id: "PROP-1", status: "found", ownerId: "CHAR-2" });
    await expect(bible.update("long_bible", "props", "PROP-1", { item: { id: "PROP-2" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    expect((await bible.delete("long_bible", "props", "PROP-1")).storyBible.props).toEqual([]);
    await expect(bible.delete("long_bible", "props", "PROP-1")).rejects.toMatchObject({ response: { code: "STORY_BIBLE_ITEM_NOT_FOUND" } });
  });

  it("rejects duplicate, unsafe, unknown, and invalid typed fields", async () => {
    const { bible } = await services(); await bible.create("long_bible", "characters", { item: { id: "CHAR-1", name: "Mina" } });
    await expect(bible.create("long_bible", "characters", { item: { id: "CHAR-1", name: "Copy" } })).rejects.toMatchObject({ response: { code: "STORY_BIBLE_ITEM_ALREADY_EXISTS" } });
    await expect(bible.create("long_bible", "characters", { item: { id: "../escape", name: "Bad" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(bible.create("long_bible", "characters", { item: { name: "Bad", unknown: "no" } as never })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(bible.create("long_bible", "characters", { item: { name: "Bad", alive: "yes" } as never })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(bible.create("long_bible", "bad", { item: { name: "Bad" } })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("reopens persisted items with a fresh backend service", async () => {
    const { bible } = await services(); await bible.create("long_bible", "secrets", { item: { id: "SECRET-1", name: "Truth", status: "hidden", plannedRevealEpisode: 2 } });
    const reloaded = new StoryBibleService(path.join(root!, "projects"));
    expect((await reloaded.get("long_bible")).storyBible.secrets).toEqual([expect.objectContaining({ id: "SECRET-1", plannedRevealEpisode: 2 })]);
  });

  it("ignores an Asset link on the way in, and drops one already on disk", async () => {
    // The link was stored and validated but read by nothing — no image generation, no Episode mapping, no
    // prompt assembly. Removing it has two halves and this covers both: a request carrying `assetLink` is
    // accepted and the field is not persisted, and an item written before the removal still loads.
    const { bible } = await services();
    const created = await bible.create("long_bible", "characters", { item: { id: "CHAR-1", name: "Mina", assetLink: { assetId: "ASSET-CHAR-1", versionPolicy: "pinned_version", pinnedVersion: 1, episodeScope: { mode: "episode", episode: 2 } } } });
    expect(created.item).not.toHaveProperty("assetLink");
    const file = path.join(root!, "projects", "long_bible", "long_story", "story_bible.json");
    expect(JSON.parse(await fs.readFile(file, "utf8")).characters[0]).not.toHaveProperty("asset_link");

    // A Story Bible saved by the previous version. Refusing the unknown key here would make it unopenable.
    const legacy = JSON.parse(await fs.readFile(file, "utf8"));
    legacy.characters[0].asset_link = { asset_id: "ASSET-CHAR-1", version_policy: "follow_latest", pinned_version: null, episode_scope: { mode: "all" } };
    await fs.writeFile(file, JSON.stringify(legacy), "utf8");
    const reopened = (await bible.get("long_bible")).storyBible.characters[0];
    expect(reopened).toMatchObject({ id: "CHAR-1", name: "Mina" });
    expect(reopened).not.toHaveProperty("assetLink");
  });

  it("updates basic and world content atomically while preserving a validated global style Asset link", async () => {
    const { bible, assets } = await services();
    const style = await assets.create({ buffer: image, originalname: "style.png", mimetype: "image/png" }, { assetType: "style", displayName: "Noir", approved: true });
    const linked = await bible.updateStyleAssetLink("long_bible", { assetLink: { assetId: style.asset_id, versionPolicy: "snapshot", pinnedVersion: 1 } });
    expect(linked.storyBible.styleAssetLink).toEqual({ assetId: style.asset_id, versionPolicy: "snapshot", pinnedVersion: 1 });
    const saved = await bible.updateContent("long_bible", { basic: { title: "Changed", nested: { mood: "dark" } }, world: { rules: ["no magic"] } });
    expect(saved.storyBible).toMatchObject({ basic: { title: "Changed", nested: { mood: "dark" } }, world: { rules: ["no magic"] }, styleAssetLink: { assetId: style.asset_id, versionPolicy: "snapshot", pinnedVersion: 1 } });
    const raw = JSON.parse(await fs.readFile(path.join(root!, "projects", "long_bible", "long_story", "story_bible.json"), "utf8"));
    expect(raw.basic.style_asset_link).toEqual({ asset_id: style.asset_id, version_policy: "snapshot", pinned_version: 1 });
    await expect(bible.updateContent("long_bible", { basic: { style_asset_link: {} }, world: {} })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
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

  it("audits every supported dangling relationship deterministically without changing valid data", async () => {
    const { bible } = await services();
    await bible.create("long_bible", "characters", { item: { id: "CHAR-VALID", locationId: "LOC-VALID", ownedItemIds: ["PROP-VALID"] } });
    await bible.create("long_bible", "locations", { item: { id: "LOC-VALID", characterIds: ["CHAR-VALID"] } });
    await bible.create("long_bible", "props", { item: { id: "PROP-VALID", ownerId: "CHAR-VALID", locationId: "LOC-VALID" } });
    expect(await bible.relationshipAudit("long_bible")).toEqual({ issues: [] });
    const file = path.join(root!, "projects", "long_bible", "long_story", "story_bible.json"); const raw = JSON.parse(await fs.readFile(file, "utf8"));
    raw.characters.push({ character_id: "CHAR-BROKEN", location_id: "LOC-MISSING", owned_item_ids: ["PROP-Z", "PROP-A", "PROP-Z"] });
    raw.locations.push({ location_id: "LOC-BROKEN", character_ids: ["CHAR-MISSING"] });
    raw.props.push({ prop_id: "PROP-BROKEN", owner_id: "CHAR-MISSING", location_id: "LOC-MISSING" });
    raw.secrets.push({ secret_id: "SECRET-BROKEN", character_ids: ["CHAR-MISSING"], location_ids: ["LOC-MISSING"] });
    raw.foreshadowing.push({ foreshadowing_id: "FORESHADOW-BROKEN", character_ids: ["CHAR-MISSING"], location_ids: ["LOC-MISSING"] });
    await fs.writeFile(file, JSON.stringify(raw), "utf8"); const before = await fs.readFile(file, "utf8");
    expect(await bible.relationshipAudit("long_bible")).toEqual({ issues: [
      { collection: "characters", itemId: "CHAR-BROKEN", field: "locationId", missingIds: ["LOC-MISSING"] },
      { collection: "characters", itemId: "CHAR-BROKEN", field: "ownedItemIds", missingIds: ["PROP-A", "PROP-Z"] },
      { collection: "locations", itemId: "LOC-BROKEN", field: "characterIds", missingIds: ["CHAR-MISSING"] },
      { collection: "props", itemId: "PROP-BROKEN", field: "locationId", missingIds: ["LOC-MISSING"] },
      { collection: "props", itemId: "PROP-BROKEN", field: "ownerId", missingIds: ["CHAR-MISSING"] },
      { collection: "secrets", itemId: "SECRET-BROKEN", field: "characterIds", missingIds: ["CHAR-MISSING"] },
      { collection: "secrets", itemId: "SECRET-BROKEN", field: "locationIds", missingIds: ["LOC-MISSING"] },
      { collection: "foreshadowing", itemId: "FORESHADOW-BROKEN", field: "characterIds", missingIds: ["CHAR-MISSING"] },
      { collection: "foreshadowing", itemId: "FORESHADOW-BROKEN", field: "locationIds", missingIds: ["LOC-MISSING"] },
    ] });
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("rejects malformed stored relationships safely without writing legacy data", async () => {
    const { bible } = await services(); const file = path.join(root!, "projects", "long_bible", "long_story", "story_bible.json");
    const raw = JSON.parse(await fs.readFile(file, "utf8")); raw.characters = [{ character_id: "CHAR-1", owned_item_ids: "PROP-1" }]; await fs.writeFile(file, JSON.stringify(raw), "utf8"); const before = await fs.readFile(file, "utf8");
    await expect(bible.relationshipAudit("long_bible")).rejects.toMatchObject({ response: { code: "LONG_PROJECT_DATA_INVALID" } });
    expect(await fs.readFile(file, "utf8")).toBe(before);
  });

  it("searches name and description in stored order, including unicode and a blank query", async () => {
    const { bible } = await services();
    await bible.create("long_bible", "characters", { item: { id: "CHAR-1", name: "민재", description: "밤의 도서관" } });
    await bible.create("long_bible", "characters", { item: { id: "CHAR-2", name: "Mina", description: "A Korean detective" } });
    await bible.create("long_bible", "characters", { item: { id: "CHAR-3", name: "Other", description: "unrelated" } });
    expect(await bible.search("long_bible", "characters", "  민재 ")).toEqual({ items: [expect.objectContaining({ id: "CHAR-1" })] });
    expect(await bible.search("long_bible", "characters", "KOREAN")).toEqual({ items: [expect.objectContaining({ id: "CHAR-2" })] });
    expect((await bible.search("long_bible", "characters", "   ")).items.map((item) => item.id)).toEqual(["CHAR-1", "CHAR-2", "CHAR-3"]);
    await expect(bible.search("long_bible", "unknown", "x")).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(bible.search("long_bible", "characters", undefined)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("duplicates one item deeply with a safe fresh ID", async () => {
    const { bible } = await services();
    await bible.create("long_bible", "characters", { item: {
      id: "CHAR-1", name: "민재", description: "original", ownedItemIds: ["PROP-1"],
    } });
    const duplicated = await bible.duplicate("long_bible", "characters", "CHAR-1");
    expect(duplicated.item).toMatchObject({ id: expect.stringMatching(/^CHAR-[A-F0-9]{8}$/), name: "민재 복사본", description: "original", ownedItemIds: ["PROP-1"] });
    expect(duplicated.item.id).not.toBe("CHAR-1");
    const source = (await bible.get("long_bible")).storyBible.characters.find((item) => item.id === "CHAR-1");
    expect(source).toMatchObject({ name: "민재", ownedItemIds: ["PROP-1"] });
    await expect(bible.duplicate("long_bible", "characters", "CHAR-MISSING")).rejects.toMatchObject({ response: { code: "STORY_BIBLE_ITEM_NOT_FOUND" } });
    await expect(bible.duplicate("long_bible", "characters", "../unsafe")).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(bible.duplicate("long_bible", "unknown", "CHAR-1")).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });
});
