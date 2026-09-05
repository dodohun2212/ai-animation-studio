import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { assertEpisodeListed, readLongProjectJson } from "./long-project-json.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function tempRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "long-json-"));
  roots.push(root);
  return root;
}

/**
 * Which of three sentences a person is shown when a long project's file cannot be read.
 *
 * Eleven services carried this same try/catch. The branches are not plumbing — each is a different thing to
 * tell somebody, and each sends them somewhere else. Eleven copies agreed; what they could not survive was one
 * being adjusted, because a single service reporting a missing Episode as a storage failure would look on that
 * one screen exactly like a disk going bad, while every other screen said the project was fine.
 */
describe("reading a long project's JSON", () => {
  it("calls a file that was never written not-found, not a storage failure", async () => {
    // An Episode with no script yet has no per-episode project.json at all. That is an ordinary state in this
    // app, and it has to arrive as one — the code callers key their better sentences off.
    const root = await tempRoot();
    await expect(readLongProjectJson(path.join(root, "missing.json")))
      .rejects.toMatchObject({ response: { code: "LONG_PROJECT_NOT_FOUND" } });
  });

  it("blames the file, not the disk, when the contents will not parse", async () => {
    // Reporting this as storage sends someone to check permissions and free space for a file that is right
    // there and perfectly readable.
    const root = await tempRoot();
    const file = path.join(root, "broken.json");
    await fs.writeFile(file, "{ not json");
    await expect(readLongProjectJson(file)).rejects.toMatchObject({ response: { code: "LONG_PROJECT_JSON_MALFORMED" } });
  });

  it("files anything else under storage rather than one of the two specific answers", async () => {
    // A directory read as a file is EISDIR, not ENOENT and not a SyntaxError. The unknown case must land last:
    // guessing it into "not found" would tell somebody their project is gone.
    const root = await tempRoot();
    await expect(readLongProjectJson(root)).rejects.toMatchObject({ response: { code: "LONG_PROJECT_STORAGE_ERROR" } });
  });

  it("returns the parsed contents when the file is there", async () => {
    const root = await tempRoot();
    const file = path.join(root, "episode_outlines.json");
    await fs.writeFile(file, JSON.stringify([{ episode_number: 1 }]));
    expect(await readLongProjectJson(file)).toEqual([{ episode_number: 1 }]);
  });
});

/**
 * Whether a project's outline lists the Episode being asked about.
 *
 * Six services each wrote out the same four conditions. It is the answer to "does Episode 7 exist", and a copy
 * that softens one of them does not fail — it opens an Episode the other five refuse, or refuses one they open,
 * on one screen only.
 */
describe("whether an Episode is listed at all", () => {
  async function outline(entries: unknown): Promise<string> {
    const root = await tempRoot();
    const file = path.join(root, "episode_outlines.json");
    await fs.writeFile(file, JSON.stringify(entries));
    return file;
  }
  const notFound = { response: { code: "LONG_EPISODE_NOT_FOUND" } };

  it("accepts a number the outline lists at that position", async () => {
    const file = await outline([{ episode_number: 1 }, { episode_number: 2 }]);
    await expect(assertEpisodeListed(file, 2)).resolves.toBeUndefined();
  });

  it("refuses a number past the end, and a number that is not one", async () => {
    const file = await outline([{ episode_number: 1 }]);
    await expect(assertEpisodeListed(file, 2)).rejects.toMatchObject(notFound);
    await expect(assertEpisodeListed(file, 0)).rejects.toMatchObject(notFound);
    await expect(assertEpisodeListed(file, -1)).rejects.toMatchObject(notFound);
    await expect(assertEpisodeListed(file, 1.5)).rejects.toMatchObject(notFound);
  });

  it("refuses an entry whose stored number does not match its position", async () => {
    // The condition that looks redundant and is not. The outline is a list, and position agreeing with the
    // stored number is what makes "the second entry" and "Episode 2" the same Episode — without it, an outline
    // written with a gap hands back a neighbour's Episode under the number that was asked for.
    const file = await outline([{ episode_number: 1 }, { episode_number: 3 }]);
    await expect(assertEpisodeListed(file, 2)).rejects.toMatchObject(notFound);
  });

  it("refuses an outline that is not a list of records", async () => {
    await expect(assertEpisodeListed(await outline({ episode_number: 1 }), 1)).rejects.toMatchObject(notFound);
    await expect(assertEpisodeListed(await outline([null]), 1)).rejects.toMatchObject(notFound);
    await expect(assertEpisodeListed(await outline([[]]), 1)).rejects.toMatchObject(notFound);
  });
});
