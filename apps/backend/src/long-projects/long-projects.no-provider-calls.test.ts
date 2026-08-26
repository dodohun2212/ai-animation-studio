import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
afterEach(async () => { vi.unstubAllGlobals(); if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("LongProjectsService outline generation", () => {
  it("never calls fetch across preview and approve when no OpenAI credential/budget is wired in", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    root = await fs.mkdtemp(path.join(os.tmpdir(), "long-projects-no-provider-"));
    const subject = new LongProjectsService(path.join(root, "projects"));
    await subject.create({ projectId: "long", settings });
    const preview = await subject.preview("long");
    await subject.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
