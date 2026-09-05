import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { VIDEO_MODELS } from "@ai-animation-studio/shared";
import { RUNWAY_MODEL } from "./runway-video-adapter.js";

const backendSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

describe("the video model is written down once", () => {
  /**
   * It was written out as the bare string in eight places, and nothing tied any of them to the one that goes
   * on the wire. Two of them were client response guards comparing against it, so a swap made in the adapter
   * alone would have had the server answering correctly while both video screens called it malformed — with a
   * model swap already queued as a task here.
   *
   * The scan is over production sources only: a test fixture naming a model is stating what it is testing.
   */
  it("appears in no server source but the adapter that sends it", () => {
    const offenders = sourceFiles(backendSource)
      .filter((file) => !file.endsWith(path.join("videos", "runway-video-adapter.ts")))
      .filter((file) => VIDEO_MODELS.some((model) => fs.readFileSync(file, "utf8").includes(`"${model}"`)))
      .map((file) => path.relative(backendSource, file));

    expect(offenders, "these name a model instead of taking RUNWAY_MODEL").toEqual([]);
  });

  /** And the one place that does name it is the contract's, so a swap cannot happen without listing it. */
  it("sends a model the contract knows about", () => {
    expect(VIDEO_MODELS).toContain(RUNWAY_MODEL);
  });
});
