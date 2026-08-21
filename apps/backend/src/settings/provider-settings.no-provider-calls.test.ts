import * as fs from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

describe("provider settings production source", () => {
  it("does not import or invoke provider, network, or media integrations", async () => {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const files = (await fs.readdir(directory)).filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"));
    const source = (await Promise.all(files.map((name) => fs.readFile(path.join(directory, name), "utf8")))).join("\n");
    expect(source).not.toMatch(/from\s+["'](?:openai|runway|axios|node:child_process)["']/i);
    expect(source).not.toMatch(/\b(fetch|exec|spawn|ffmpeg)\s*\(/i);
  });
});
