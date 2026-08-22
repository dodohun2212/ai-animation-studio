import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LongProjectsService } from "./long-projects.service.js";
import { StoryBibleService } from "./story-bible.service.js";

let root: string | undefined;
const settings = { title: "Long project", logline: "A local story", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, episodeDurationSeconds: 30, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "" };
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }); root = undefined; });
async function services(): Promise<{ long: LongProjectsService; bible: StoryBibleService }> { root = await fs.mkdtemp(path.join(os.tmpdir(), "story-bible-")); const projectsRoot = path.join(root, "projects"); const long = new LongProjectsService(projectsRoot); await long.create({ projectId: "long_bible", settings }); return { long, bible: new StoryBibleService(projectsRoot) }; }

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

  it("reports malformed and unknown stored JSON without leaking its content", async () => {
    const { bible } = await services(); const file = path.join(root!, "projects", "long_bible", "long_story", "story_bible.json");
    await fs.writeFile(file, "{ secret: 'raw-key'", "utf8");
    await expect(bible.get("long_bible")).rejects.toMatchObject({ response: { code: "LONG_PROJECT_JSON_MALFORMED", message: expect.not.stringContaining("raw-key") } });
    await fs.writeFile(file, JSON.stringify({ basic: {}, world: {}, characters: [], locations: [], props: [], secrets: [], foreshadowing: [], summaries: {}, updated_at: new Date().toISOString(), unknown: true }), "utf8");
    await expect(bible.get("long_bible")).rejects.toMatchObject({ response: { code: "LONG_PROJECT_DATA_INVALID" } });
  });
});
