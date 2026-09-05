import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { PLACEHOLDER_ADAPTER, PLACEHOLDER_MP3 } from "./placeholder-narration.js";

const backendSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOME = path.join("narration", "placeholder-narration.ts");

function sourceFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return entry.isFile() && entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [full] : [];
  });
}

function offendersFor(literal: string): string[] {
  return sourceFiles(backendSource)
    .filter((file) => !file.endsWith(HOME))
    .filter((file) => fs.readFileSync(file, "utf8").includes(literal))
    .map((file) => path.relative(backendSource, file));
}

/**
 * What a placeholder narration is, said in one place.
 *
 * It was said in five: the four bytes in three services, and the adapter name in four — one of them in a file
 * that already imported the constant and then wrote the bare string next to it. That one is the shape that
 * matters: change the constant and that service writes one value while the same file compares another, so a
 * stub it just produced reads back as real narration. Nothing would have failed.
 *
 * The clip and image placeholders were each collapsed after the number of places that knew what a placeholder
 * looks like turned out to be the number of places that could disagree. Narration was the third and the last.
 *
 * Production sources only — a test naming the bytes is stating what it is testing.
 */
describe("what a placeholder narration is, written down once", () => {
  /**
   * Both checks below report emptiness as success. If the walk ever stopped finding sources — a moved file, a
   * renamed directory — they would pass while watching nothing, which is the failure this repository has
   * written about twice already. Deliberately under the real count, so deleting a few files is not a red build.
   */
  it("is still walking the server's sources at all", () => {
    expect(sourceFiles(backendSource).length).toBeGreaterThan(140);
  });

  it("has no server source but its own repeating the adapter name", () => {
    expect(offendersFor(`"${PLACEHOLDER_ADAPTER}"`), "these write the adapter name instead of importing PLACEHOLDER_ADAPTER").toEqual([]);
  });

  it("has no server source but its own repeating the bytes", () => {
    const bytes = `[${[...PLACEHOLDER_MP3].map((byte) => `0x${byte.toString(16).padStart(2, "0")}`).join(", ")}]`;
    expect(offendersFor(bytes), "these write the placeholder bytes instead of importing PLACEHOLDER_MP3").toEqual([]);
  });
});
