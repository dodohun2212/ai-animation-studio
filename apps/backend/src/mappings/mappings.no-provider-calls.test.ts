import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

describe("project Asset Mapping implementation", () => {
  it("does not import or invoke providers, network clients, FFmpeg, or subprocesses", () => {
    const directory = path.dirname(fileURLToPath(import.meta.url));
    const source = fs.readdirSync(directory).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
      .map((file) => fs.readFileSync(path.join(directory, file), "utf8")).join("\n");
    expect(source).not.toMatch(/openai|runway|ffmpeg|child_process|spawn\(|exec\(|fetch\(|axios|https?:\/\//iu);
  });
});
