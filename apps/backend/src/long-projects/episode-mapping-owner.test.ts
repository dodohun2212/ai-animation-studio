import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { scriptFingerprint } from "../mappings/mappings.repository.js";
import { EpisodeMappingOwners } from "./episode-mapping-owner.js";

let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

const scenes = (count: number) => Array.from({ length: count }, (_, index) => ({ number: index + 1, description: `scene ${index + 1}` }));

async function setup(episode: Record<string, unknown> = {}, outlineCount = 1) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-owner-"));
  const projectsRoot = path.join(root, "projects");
  const longStory = path.join(projectsRoot, "long-1", "long_story");
  const directory = path.join(longStory, "Episode01");
  await fs.mkdir(directory, { recursive: true });
  await fs.writeFile(
    path.join(longStory, "episode_outlines.json"),
    JSON.stringify(Array.from({ length: outlineCount }, (_, index) => ({ episode_number: index + 1 }))),
    "utf8",
  );
  await fs.writeFile(path.join(directory, "project.json"), JSON.stringify({
    number: 1,
    state: "waiting_for_asset_mapping_review",
    approved: false,
    script: { scenes: scenes(6) },
    script_revision: 3,
    scene_count: 6,
    updated_at: "2026-08-28T00:00:00.000Z",
    ...episode,
  }), "utf8");
  return { owners: new EpisodeMappingOwners(projectsRoot), directory, projectFile: path.join(directory, "project.json") };
}

const read = async (file: string) => JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;

describe("EpisodeMappingOwners", () => {
  it("leaves narration out of the scenes it reports, so rewording a line does not invalidate a mapping", async () => {
    // The pipeline hashes these to ask "does this review still describe the current script". Narration is the
    // one part of a scene that says nothing about which assets appear in it, and the Episode pipeline already
    // stripped it before hashing — in two copies of the same helper, neither of which this flow knew about.
    const { owners } = await setup({
      script: { scenes: Array.from({ length: 6 }, (_, index) => ({ number: index + 1, description: `scene ${index + 1}`, narration: "spoken words" })) },
    });
    const owner = await owners.get({ projectId: "long-1", episodeNumber: 1 });

    for (const scene of owner.scenes) {
      expect(scene).not.toHaveProperty("narration");
      expect(scene).toHaveProperty("description");
    }
  });

  it("hashes to the same value whatever the narration says", async () => {
    // 🔴 The whole reason this lives on the owner. When the two sides computed it separately they agreed only
    // because two functions happened to match; the moment this flow started writing the review they stopped,
    // and an approved mapping would have left image generation refusing forever with nothing to point at.
    const scenesWith = (narration: string) => ({ scenes: Array.from({ length: 6 }, (_, index) => ({ number: index + 1, description: `scene ${index + 1}`, narration })) });
    const first = await (await setup({ script: scenesWith("one wording") })).owners.get({ projectId: "long-1", episodeNumber: 1 });
    const firstHash = scriptFingerprint([...first.scenes]);
    const second = await (await setup({ script: scenesWith("a completely different wording") })).owners.get({ projectId: "long-1", episodeNumber: 1 });

    expect(scriptFingerprint([...second.scenes])).toBe(firstHash);
  });


  it("answers the same four questions a short project does, from where an Episode keeps them", async () => {
    // The point of the whole change: the facts exist on both sides, under different names, in differently
    // shaped files. Once they are asked for separately, an Episode can use the short project's flow unchanged.
    const { owners, directory } = await setup();
    const owner = await owners.get({ projectId: "long-1", episodeNumber: 1 });

    expect(owner.sceneCount).toBe(6);
    expect(owner.scenes).toHaveLength(6);
    expect(owner.scriptRevision).toBe(3);
    expect(owner.directory).toBe(directory);
  });

  it("names the Episode, not just the Long Project it belongs to", async () => {
    // Stored mappings are checked against this when read back. A Long Project's id alone would let a file copied
    // from one Episode into another pass, which the short project's equivalent check does catch.
    const { owners } = await setup();
    const owner = await owners.get({ projectId: "long-1", episodeNumber: 1 });

    expect(owner.id).toBe("long-1/Episode01");
  });

  it("falls back to six scenes for an Episode stored before scene_count existed", async () => {
    const { owners } = await setup({ scene_count: undefined });
    expect((await owners.get({ projectId: "long-1", episodeNumber: 1 })).sceneCount).toBe(6);
  });

  it("does not read the file again to confirm what reading it already proved", async () => {
    const { owners, projectFile } = await setup();
    const owner = await owners.get({ projectId: "long-1", episodeNumber: 1 });
    await fs.rm(projectFile);

    // Nothing to re-read, and nothing that needs re-reading.
    await expect(owner.ensureExists()).resolves.toBeUndefined();
  });

  it("moves the Episode into waiting when a review is begun", async () => {
    // The step the flow used to skip. Without it an approved review sat on an Episode still in script_approved,
    // which image generation reads as not ready — the mapping looked done and generation refused, with the two
    // facts in different files and nothing connecting them.
    const { owners, projectFile } = await setup({ state: "script_approved", approved: true });
    const owner = await owners.get({ projectId: "long-1", episodeNumber: 1 });

    await owner.markMappingReviewBegun();

    expect((await read(projectFile)).state).toBe("waiting_for_asset_mapping_review");
  });

  it("lets a review be begun again once it is already waiting, and changes nothing", async () => {
    const { owners, projectFile } = await setup();
    const owner = await owners.get({ projectId: "long-1", episodeNumber: 1 });

    await owner.markMappingReviewBegun();

    expect((await read(projectFile)).state).toBe("waiting_for_asset_mapping_review");
  });

  it("refuses to begin a review on an Episode whose script is not approved", async () => {
    for (const episode of [{ state: "script_review", approved: false }, { state: "planned", approved: false }, { state: "script_approved", approved: false }]) {
      const { owners } = await setup(episode);
      const owner = await owners.get({ projectId: "long-1", episodeNumber: 1 });
      await expect(owner.markMappingReviewBegun()).rejects.toMatchObject({});
    }
  });

  it("moves the Episode on when the approval is what it was waiting for", async () => {
    const { owners, projectFile } = await setup();
    const owner = await owners.get({ projectId: "long-1", episodeNumber: 1 });

    await owner.markMappingApproved(2);

    const saved = await read(projectFile);
    expect(saved.state).toBe("asset_mapping_approved");
    expect(saved.mapping_revision).toBe(2);
  });

  it("does not drag an Episode backwards when a later approval arrives", async () => {
    // Same rule as the short project's, for the same reason: re-approving is allowed, so the state is what has
    // to refuse. The state names are a different set entirely — which is why this judgement is not in the flow.
    const { owners, projectFile } = await setup({ state: "generating_images" });
    const owner = await owners.get({ projectId: "long-1", episodeNumber: 1 });

    await owner.markMappingApproved(9);

    expect((await read(projectFile)).state).toBe("generating_images");
  });

  it("refuses an Episode the Long Project's outline does not list", async () => {
    // Its own file can outlive the outline entry, and answering from that file would describe something nobody
    // can navigate to.
    const { owners } = await setup({}, 1);
    await expect(owners.get({ projectId: "long-1", episodeNumber: 2 })).rejects.toMatchObject({});
  });

  it("refuses an episode number that is not one", async () => {
    const { owners } = await setup();
    for (const episodeNumber of [0, -1, 1.5]) {
      await expect(owners.get({ projectId: "long-1", episodeNumber })).rejects.toMatchObject({});
    }
  });

  it("refuses a project id that would climb out of the projects root", async () => {
    const { owners } = await setup();
    await expect(owners.get({ projectId: "../elsewhere", episodeNumber: 1 })).rejects.toMatchObject({});
  });
});
