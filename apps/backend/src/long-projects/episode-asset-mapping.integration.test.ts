import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import { EpisodeMappingOwners, type EpisodeMappingKey } from "./episode-mapping-owner.js";

/**
 * The claim this whole refactor rests on, driven end to end: an Episode goes through the short project's asset
 * mapping flow, unmodified, and gets the three things its own implementation refused.
 *
 * Written before the old Episode implementation is removed, on purpose. "The new path can do everything the old
 * one did, plus the things it could not" is the only basis on which deleting the old one is safe, and asserting
 * it afterwards would be asserting it too late.
 */

let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

const EPISODE: EpisodeMappingKey = { projectId: "long-1", episodeNumber: 1 };

async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-mapping-flow-"));
  const projectsRoot = path.join(root, "projects");
  const longStory = path.join(projectsRoot, "long-1", "long_story");
  const episodeDirectory = path.join(longStory, "Episode01");
  await fs.mkdir(episodeDirectory, { recursive: true });
  await fs.writeFile(path.join(longStory, "episode_outlines.json"), JSON.stringify([{ episode_number: 1 }]), "utf8");
  await fs.writeFile(path.join(episodeDirectory, "project.json"), JSON.stringify({
    number: 1,
    state: "waiting_for_asset_mapping_review",
    approved: false,
    script: { scenes: Array.from({ length: 6 }, (_, index) => ({ number: index + 1, description: `scene ${index + 1}` })) },
    script_revision: 3,
    scene_count: 6,
    updated_at: "2026-08-28T00:00:00.000Z",
  }), "utf8");

  const assets = new LocalAssetsRepository(root);
  // A Folder, which is what the person's real character assets are — and precisely what the Episode
  // implementation rejected outright while its own screen offered nothing else.
  const folder = await assets.createFolder({ assetType: "character", displayName: "이배드" });
  const repository = new LocalProjectAssetMappingsRepository(projectsRoot);
  const service = new ProjectAssetMappingsService<EpisodeMappingKey>(repository, assets, new EpisodeMappingOwners(projectsRoot));
  return { service, repository, folder, episodeDirectory, assets };
}

const readJson = async (file: string) => JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>;

describe("an Episode going through the short project's asset mapping flow", () => {
  it("links a Folder to a character by hand, reviews it, and moves the Episode on", async () => {
    const { service, folder, episodeDirectory } = await setup();

    // 1. Manual linking. The Episode implementation had no endpoint for this at all: candidates could only be
    //    produced by matching an asset's name against the scene text.
    const created = await service.create(EPISODE, {
      assetId: folder.asset_id,
      usageRole: "character",
      sceneScope: { kind: "all" },
    });
    expect(created.mapping.assignmentSource).toBe("manual");
    expect(created.mapping.status).toBe("confirmed");
    // A Folder has no versions of its own, so follow_latest is the only policy that means anything — chosen for
    // the caller rather than refused, which is the difference that made the feature unreachable before.
    expect(created.mapping.versionPolicy).toBe("follow_latest");

    // 2. Review, against the Episode's own script revision.
    const begun = await service.beginReview(EPISODE, { scriptRevision: 3 });
    expect(begun.review.status).toBe("waiting");

    // 3. Approval, which is what tells the Episode to move.
    const approved = await service.approveReview(EPISODE, { scriptFingerprint: begun.review.scriptFingerprint });
    expect(approved.review.status).toBe("approved");

    const episode = await readJson(path.join(episodeDirectory, "project.json"));
    expect(episode.state).toBe("asset_mapping_approved");
    expect(episode.mapping_revision).toBe(approved.review.mappingRevision);
  });

  it("writes into the Episode's own directory, not the Long Project's", async () => {
    const { service, folder, episodeDirectory } = await setup();

    await service.create(EPISODE, { assetId: folder.asset_id, usageRole: "character", sceneScope: { kind: "all" } });

    const stored = JSON.parse(await fs.readFile(path.join(episodeDirectory, "asset_mappings.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    // Named for the Episode, so a file copied into a sibling Episode does not read back as valid.
    expect(stored[0]?.project_id).toBe("long-1/Episode01");
  });

  it("scopes a mapping to particular scenes, which the Episode implementation could not express", async () => {
    // Its scope was per-Episode only; its own comment said so. Scene-level scope arrives here for free, because
    // it is the short project's and nothing about it was Episode-specific.
    const { service, folder } = await setup();

    const created = await service.create(EPISODE, {
      assetId: folder.asset_id,
      usageRole: "character",
      sceneScope: { kind: "list", sceneNumbers: [2, 4] },
    });

    expect(created.mapping.sceneScope).toEqual({ kind: "list", sceneNumbers: [2, 4] });
  });

  it("refuses a scene number the Episode does not have", async () => {
    // The bound is the Episode's own scene_count, not the Long Project's — each Episode is asked for its own.
    const { service, folder } = await setup();

    await expect(service.create(EPISODE, {
      assetId: folder.asset_id,
      usageRole: "character",
      sceneScope: { kind: "scene", sceneNumber: 7 },
    })).rejects.toMatchObject({});
  });

  /**
   * The state a real cycle got stuck in, reproduced exactly: this Episode's script is at revision 3, and
   * linking an Asset writes the review record before any review has been begun — so that record carries the
   * default `script_revision: 0` and an empty fingerprint. The screen sends the number it can read, which is
   * that 0.
   *
   * `beginReview` used to require it to equal the owner's, and there was no way back: begin refused, so the
   * record kept its 0, so the next press sent 0 again. Approve refused too, because the fingerprint it
   * compares is only ever written by a successful begin. "지금 대본 기준으로 다시 맞추기" — the one button
   * that exists for this situation — sent the same stale number as everything else.
   *
   * This test replaces one that pinned the old check. It was pinning the deadlock.
   */
  it("recovers a review whose record still carries the script revision it never had", async () => {
    const { service, folder } = await setup();
    await service.create(EPISODE, { assetId: folder.asset_id, usageRole: "character", sceneScope: { kind: "all" } });
    const stuck = await service.review(EPISODE);
    expect(stuck.review).toMatchObject({ scriptRevision: 0, scriptFingerprint: "", status: "waiting" });

    const begun = await service.beginReview(EPISODE, { scriptRevision: stuck.review.scriptRevision });

    expect(begun.review).toMatchObject({ scriptRevision: 3, scriptFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) });
    await expect(service.approveReview(EPISODE, { scriptFingerprint: begun.review.scriptFingerprint }))
      .resolves.toMatchObject({ review: { status: "approved" } });
  });

  /**
   * The counterpart. Dropping the begin-time check must not drop the one that matters: approve still compares
   * a fingerprint the caller actually holds, and still refuses when the script moved underneath it. Without
   * this, an implementation that checked nothing at all would pass the test above.
   */
  it("still refuses an approval whose fingerprint is not the script as it stands now", async () => {
    const { service, folder, episodeDirectory } = await setup();
    await service.create(EPISODE, { assetId: folder.asset_id, usageRole: "character", sceneScope: { kind: "all" } });
    const begun = await service.beginReview(EPISODE, {});
    const stored = await readJson(path.join(episodeDirectory, "project.json"));
    const script = stored.script as { scenes: Array<Record<string, unknown>> };
    script.scenes[5] = { number: 6, description: "changed after the review was begun" };
    await fs.writeFile(path.join(episodeDirectory, "project.json"), JSON.stringify(stored), "utf8");

    await expect(service.approveReview(EPISODE, { scriptFingerprint: begun.review.scriptFingerprint }))
      .rejects.toMatchObject({ response: { code: "ASSET_MAPPING_FINGERPRINT_MISMATCH" } });
  });
});
