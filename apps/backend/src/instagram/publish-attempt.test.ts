import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { clearPublishAttempt, readPublishAttempt, recordPublishAttempt } from "./publish-attempt.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function directory(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "publish-attempt-")); roots.push(root);
  return path.join(root, "post_project");
}

/** The name is on disk, so it is part of the behaviour: renaming it makes every trace a crash already left invisible. */
const ATTEMPT_FILE = ".instagram-publish-attempt";

describe("the publish attempt trace", () => {
  it("is nothing at all until an attempt writes one", async () => {
    expect(await readPublishAttempt(await directory())).toBeUndefined();
  });

  it("round-trips what the attempt knew about itself", async () => {
    const dir = await directory();
    await recordPublishAttempt(dir, { startedAt: "2026-09-08T01:00:00.000Z", igUserId: "178000001" });

    expect(await readPublishAttempt(dir)).toEqual({ startedAt: "2026-09-08T01:00:00.000Z", igUserId: "178000001" });
    // On disk beside the lock file, under a name a reader can recognise — this is crash state, not project data.
    expect(await fs.readFile(path.join(dir, ATTEMPT_FILE), "utf8")).toContain("178000001");
  });

  it("creates the project directory if the attempt is the first thing to write there", async () => {
    const dir = await directory();
    await recordPublishAttempt(dir, { startedAt: "2026-09-08T01:00:00.000Z", igUserId: "178000001" });
    expect(await readPublishAttempt(dir)).toBeDefined();
  });

  /**
   * The direction this file must fail in.
   *
   * A trace that cannot be parsed still proves an attempt happened — that is the entire finding, and the
   * details are decoration on it. Reading it as "no attempt" would answer the one question this file exists to
   * answer with a guess, in the direction that publishes a second copy of a video that is already public.
   */
  it("is still an attempt when the file survived but its contents did not", async () => {
    const dir = await directory();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, ATTEMPT_FILE), "{ half a wri");

    expect(await readPublishAttempt(dir)).toEqual({});
  });

  it("keeps only the fields it can vouch for", async () => {
    const dir = await directory();
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, ATTEMPT_FILE), JSON.stringify({ startedAt: 17, igUserId: "178000001" }));

    expect(await readPublishAttempt(dir)).toEqual({ igUserId: "178000001" });
  });

  it("is gone once cleared, and clearing one that is not there is not an error", async () => {
    const dir = await directory();
    await recordPublishAttempt(dir, { startedAt: "2026-09-08T01:00:00.000Z", igUserId: "178000001" });

    await clearPublishAttempt(dir);
    expect(await readPublishAttempt(dir)).toBeUndefined();
    await expect(clearPublishAttempt(dir)).resolves.toBeUndefined();
  });
});
