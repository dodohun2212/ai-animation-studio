import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { HttpStatus } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { LongProjectsService } from "./long-projects.service.js";
import { StoryBibleController } from "./story-bible.controller.js";
import { StoryBibleService } from "./story-bible.service.js";

let root: string | undefined;
const settings = { title: "Long project", logline: "A local story", overview: "", genre: "", tone: "", theme: "", episodeCount: 1, episodeDurationSeconds: 30, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "" };
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("StoryBibleController", () => {
  it("exposes local CRUD and maps a missing item to its safe 404 error", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-bible-controller-")); const projectsRoot = path.join(root, "projects");
    await new LongProjectsService(projectsRoot).create({ projectId: "long_bible", settings });
    const controller = new StoryBibleController(new StoryBibleService(projectsRoot));
    expect((await controller.create("long_bible", "locations", { item: { id: "LOC-1", name: "Library" } })).item.id).toBe("LOC-1");
    expect((await controller.get("long_bible")).storyBible.locations).toHaveLength(1);
    try { await controller.delete("long_bible", "locations", "LOC-2"); throw new Error("Expected missing item error"); }
    catch (error) { expect((error as { getStatus(): number }).getStatus()).toBe(HttpStatus.NOT_FOUND); expect((error as { getResponse(): { code: string } }).getResponse().code).toBe("STORY_BIBLE_ITEM_NOT_FOUND"); }
  });
});
