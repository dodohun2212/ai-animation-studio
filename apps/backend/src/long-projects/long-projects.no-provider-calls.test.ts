import * as fs from "node:fs/promises";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

describe("long-project outline storage", () => {
  it("does not import a provider, network client, FFmpeg, or subprocess", async () => {
    const raw = await fs.readFile(path.join(process.cwd(), "src", "long-projects", "long-projects.service.ts"), "utf8");
    // RUNWAY_CLIP_DURATIONS/RunwayClipDurationSeconds are plain domain constants ([5, 10] seconds) describing a
    // real-world Runway constraint used for clipDurationSeconds validation — not a provider import or API call.
    // Stripped before matching so this guard stays meaningful for an actual provider dependency.
    const source = raw.replaceAll(/RUNWAY_CLIP_DURATIONS|RunwayClipDurationSeconds/g, "");
    expect(source).not.toMatch(/openai|runway|ffmpeg|child_process|fetch\s*\(/i);
  });
});
