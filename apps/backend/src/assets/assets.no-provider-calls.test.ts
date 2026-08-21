import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("Asset Library isolation", () => {
  it("contains no provider, network, subprocess or FFmpeg integration", () => {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readdirSync(directory).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
      .map((name) => fs.readFileSync(path.join(directory, name), "utf8")).join("\n").toLowerCase();
    for (const forbidden of ["openai", "runway", "ffmpeg", "child_process", "fetch(", "http://", "https://"]) expect(source).not.toContain(forbidden);
  });
});
