import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { INestApplication } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";

/**
 * The Episode mapping routes over a real running app.
 *
 * The unit tests prove the flow works when handed an Episode owner; this proves the wiring hands it one. Those
 * are different claims, and the gap between them is a whole binding: ProjectAssetMappingsService is provided
 * twice — once bound to short projects, once to Episodes — so "the right one arrives here" is exactly the sort
 * of thing that is true until someone moves a file and then is silently false.
 */

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");

let root: string | undefined;
let app: INestApplication | undefined;
let previousLearningData: string | undefined;
let previousSettingsRoot: string | undefined;

afterEach(async () => {
  await app?.close(); app = undefined;
  if (previousLearningData === undefined) delete process.env.LEARNING_DATA_ROOT; else process.env.LEARNING_DATA_ROOT = previousLearningData;
  previousLearningData = undefined;
  if (previousSettingsRoot === undefined) delete process.env.PROVIDER_SETTINGS_ROOT; else process.env.PROVIDER_SETTINGS_ROOT = previousSettingsRoot;
  previousSettingsRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

async function bootWithEpisode(): Promise<{ base: string; episodeDirectory: string }> {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-mapping-http-"));
  const longStory = path.join(root, "projects", "long_http", "long_story");
  const episodeDirectory = path.join(longStory, "Episode01");
  await fs.mkdir(episodeDirectory, { recursive: true });
  await fs.writeFile(path.join(longStory, "episode_outlines.json"), JSON.stringify([{ episode_number: 1 }]), "utf8");
  await fs.writeFile(path.join(episodeDirectory, "project.json"), JSON.stringify({
    number: 1,
    state: "waiting_for_asset_mapping_review",
    approved: false,
    script: { scenes: Array.from({ length: 6 }, (_, index) => ({ number: index + 1, description: String(index + 1) })) },
    script_revision: 1,
    scene_count: 6,
    updated_at: "2026-08-28T00:00:00.000Z",
  }), "utf8");

  previousLearningData = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root;
  previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
  app = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0, "127.0.0.1");
  return { base: `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`, episodeDirectory };
}

async function createFolderAsset(base: string): Promise<string> {
  const response = await fetch(`${base}/assets/folders`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assetType: "character", displayName: "이배드" }),
  });
  expect(response.status).toBe(201);
  return (await response.json() as { asset: { assetId: string } }).asset.assetId;
}

describe.sequential("Episode Asset Mapping HTTP routes", () => {
  it("links a Folder to an Episode by hand and moves the Episode on once the review is approved", async () => {
    const { base, episodeDirectory } = await bootWithEpisode();
    const assetId = await createFolderAsset(base);
    const mappings = `${base}/long-projects/long_http/episodes/1/assets/mappings`;
    const review = `${base}/long-projects/long_http/episodes/1/assets/mapping-review`;

    const created = await fetch(mappings, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId, usageRole: "character", sceneScope: { kind: "list", sceneNumbers: [2, 4] } }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ mapping: { assignmentSource: "manual", versionPolicy: "follow_latest" } });

    const begun = await fetch(review, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scriptRevision: 1, legacyConfirmed: true }) });
    expect(begun.status).toBe(201);
    const { review: begunReview } = await begun.json() as { review: { scriptFingerprint: string } };

    const approved = await fetch(`${review}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scriptFingerprint: begunReview.scriptFingerprint }) });
    expect(approved.status).toBe(201);

    const episode = JSON.parse(await fs.readFile(path.join(episodeDirectory, "project.json"), "utf8")) as Record<string, unknown>;
    expect(episode.state).toBe("asset_mapping_approved");
  });

  /**
   * The path Captain D actually took, over HTTP, end to end.
   *
   * His Episode had one mapping he never made: the Story Bible seeds an `auto_protagonist` when a script is
   * saved. So the screen opened showing a connected reference and a review record that says nothing, he pressed
   * 「연결 다 했음 · 다음 단계로」 first, and got 입력 내용을 확인해 주세요 — about a value the server had just
   * handed him. Every piece of this was covered somewhere; the walk a person actually takes was not, and that
   * is the difference between a green suite and a working app.
   *
   * Pinned as three facts: a seeded mapping is not a begun review, the refusal names `no_baseline` rather than
   * blaming the request, and 「지금 대본 기준으로 다시 맞추기」 is what gets through — with the mapping intact.
   */
  it("refuses approval on a Story-Bible-seeded mapping until a baseline exists, then takes it", async () => {
    const { base, episodeDirectory } = await bootWithEpisode();
    const assetId = await createFolderAsset(base);
    const mappings = `${base}/long-projects/long_http/episodes/1/assets/mappings`;
    const review = `${base}/long-projects/long_http/episodes/1/assets/mapping-review`;

    // Written the way the Story Bible sync writes one: automatic, confirmed, nobody asked for it.
    await fs.writeFile(path.join(episodeDirectory, "asset_mappings.json"), JSON.stringify([{
      // The id shape and the Episode-scoped project_id are both what the sync really writes — copied off
      // Captain D's Episode 5 file, because a fixture that only looks right proves nothing about his data.
      mapping_id: "MAP-09A033276AACDC37", project_id: "long_http/Episode01", asset_id: assetId, enabled: true,
      usage_role: "character", scene_scope: { mode: "all" }, assignment_source: "auto", confidence: null,
      match_reason: "auto_protagonist", status: "confirmed", user_confirmed: true, version_policy: "follow_latest",
      pinned_version: null, candidate_only: false, created_at: "2026-09-01T00:00:00.000Z",
      updated_at: "2026-09-01T00:00:00.000Z", snapshot_path: null, snapshot_sha256: null,
      snapshot_source_version: null, selected_child_asset_ids: [],
    }]), "utf8");

    const opened = await fetch(review);
    expect(opened.status).toBe(200);
    const { review: asOpened } = await opened.json() as { review: { scriptFingerprint: string; status: string } };
    expect(asOpened.scriptFingerprint, "a seeded mapping is not somebody checking their references").toBe("");
    expect(asOpened.status).toBe("waiting");

    // What the screen sends back is exactly what it was just given.
    const refused = await fetch(`${review}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scriptFingerprint: asOpened.scriptFingerprint }) });
    expect(refused.status).toBe(400);
    expect(await refused.json()).toMatchObject({ code: "INVALID_REQUEST", details: { reason: "no_baseline" } });

    const begun = await fetch(review, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scriptRevision: 1 }) });
    expect(begun.status).toBe(201);
    const { review: begunReview } = await begun.json() as { review: { scriptFingerprint: string } };
    expect(begunReview.scriptFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const approved = await fetch(`${review}/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scriptFingerprint: begunReview.scriptFingerprint }) });
    expect(approved.status).toBe(201);

    const episode = JSON.parse(await fs.readFile(path.join(episodeDirectory, "project.json"), "utf8")) as Record<string, unknown>;
    expect(episode.state).toBe("asset_mapping_approved");
    const listed = await (await fetch(mappings)).json() as { mappings: { mappingId: string }[] };
    expect(listed.mappings.map((item) => item.mappingId), "the seeded connection survived the button we told him to press").toEqual(["MAP-09A033276AACDC37"]);
  });

  it("reads and writes the Episode's own files, not the Long Project's", async () => {
    // The binding is the thing under test: the short one would have resolved a directory one level up, and every
    // assertion above would still have passed while the mappings landed somewhere nobody looks.
    const { base, episodeDirectory } = await bootWithEpisode();
    const assetId = await createFolderAsset(base);

    await fetch(`${base}/long-projects/long_http/episodes/1/assets/mappings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetId, usageRole: "character", sceneScope: { kind: "all" } }),
    });

    const stored = JSON.parse(await fs.readFile(path.join(episodeDirectory, "asset_mappings.json"), "utf8")) as Array<Record<string, unknown>>;
    expect(stored).toHaveLength(1);
    expect(stored[0]?.project_id).toBe("long_http/Episode01");
  });

  it("answers about an Episode that does not exist rather than inventing one", async () => {
    const { base } = await bootWithEpisode();
    const response = await fetch(`${base}/long-projects/long_http/episodes/9/assets/mappings`);
    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
