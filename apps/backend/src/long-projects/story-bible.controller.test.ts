import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HttpStatus } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { LongProjectsService } from "./long-projects.service.js";
import { StoryBibleController } from "./story-bible.controller.js";
import { StoryBibleService } from "./story-bible.service.js";

let root: string | undefined;
const settings = { title: "Long project", logline: "A local story", overview: "", genre: "", tone: "", theme: "", episodeCount: 1, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("StoryBibleController", () => {
  it("exposes local CRUD and maps a missing item to its safe 404 error", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-bible-controller-")); const projectsRoot = path.join(root, "projects");
    await new LongProjectsService(projectsRoot).create({ projectId: "long_bible", settings });
    const controller = new StoryBibleController(new StoryBibleService(projectsRoot));
    expect((await controller.create("long_bible", "secrets", { item: { id: "SECRET-1", name: "출생의 비밀" } })).item.id).toBe("SECRET-1");
    expect((await controller.get("long_bible")).storyBible.secrets).toHaveLength(1);
    try { await controller.delete("long_bible", "secrets", "SECRET-2"); throw new Error("Expected missing item error"); }
    catch (error) { expect((error as { getStatus(): number }).getStatus()).toBe(HttpStatus.NOT_FOUND); expect((error as { getResponse(): { code: string } }).getResponse().code).toBe("STORY_BIBLE_ITEM_NOT_FOUND"); }
  });

  it("exposes separate Story Bible world and global style-link mutations", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-bible-controller-")); const projectsRoot = path.join(root, "projects");
    await new LongProjectsService(projectsRoot).create({ projectId: "long_bible", settings }); const controller = new StoryBibleController(new StoryBibleService(projectsRoot));
    await expect(controller.updateWorld("long_bible", { world: { era: "future" } })).resolves.toMatchObject({ storyBible: { world: { era: "future" } } });
    // The world save above left `basic` alone, and clearing the style link leaves the world notes alone.
    await expect(controller.updateStyleAssetLink("long_bible", { assetLink: null })).resolves.toMatchObject({ storyBible: { world: { era: "future" } } });
    await expect(controller.updateWorld("long_bible", { world: {}, extra: true } as never)).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  it("exposes the Story Bible search and duplicate routes", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-bible-controller-")); const projectsRoot = path.join(root, "projects");
    await new LongProjectsService(projectsRoot).create({ projectId: "long_bible", settings }); const controller = new StoryBibleController(new StoryBibleService(projectsRoot));
    await controller.create("long_bible", "foreshadowing", { item: { id: "FORESHADOW-1", name: "도서관", description: "비밀 장소" } });
    expect(await controller.search("long_bible", "foreshadowing", " 장소 ")).toEqual({ items: [expect.objectContaining({ id: "FORESHADOW-1", name: "도서관" })] });
    const copy = await controller.duplicate("long_bible", "foreshadowing", "FORESHADOW-1");
    expect(copy.item).toMatchObject({ id: expect.stringMatching(/^FORESHADOW-[A-F0-9]{8}$/), name: "도서관 복사본", description: "비밀 장소" });
    await expect(controller.search("long_bible", "bad", "x")).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(controller.duplicate("long_bible", "foreshadowing", "FORESHADOW-MISSING")).rejects.toMatchObject({ response: { code: "STORY_BIBLE_ITEM_NOT_FOUND" } });
  });
});
