import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";

import { AppModule } from "../app.module.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { StoryBibleService } from "./story-bible.service.js";

/**
 * The Story Bible seeding, reached the way the running app reaches it.
 *
 * Every other test of this feature builds the service by hand — `new StoryBibleService(root, assets, mappings)`
 * — and hands it the mapping store the module is supposed to inject. So the feature's behaviour was covered and
 * its wiring was not, and the two of us spent two rounds arguing from git about whether the wiring had ever
 * been right (Cowork Rounds 463/465; it had, since the feature landed on 2026-08-30, and their working copy
 * predated it). The argument is the case for this test: an optional dependency that silently turns a feature
 * off is exactly the shape a hand-built test cannot see (D-023 — green, guarding nothing).
 *
 * Resolves the service out of the real AppModule, so dropping an inject here turns red instead of turning the
 * feature off.
 */
let app: INestApplication | undefined;
let root: string | undefined;
let previousRoot: string | undefined;
let previousSettingsRoot: string | undefined;

afterEach(async () => {
  await app?.close(); app = undefined;
  if (previousRoot === undefined) delete process.env.LEARNING_DATA_ROOT; else process.env.LEARNING_DATA_ROOT = previousRoot;
  previousRoot = undefined;
  if (previousSettingsRoot === undefined) delete process.env.PROVIDER_SETTINGS_ROOT; else process.env.PROVIDER_SETTINGS_ROOT = previousSettingsRoot;
  previousSettingsRoot = undefined;
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

const settings = { title: "Long project", logline: "A local story", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
const scenes = Array.from({ length: 6 }, (_, index) => ({ number: index + 1, description: `scene ${index + 1}` }));

describe.sequential("Story Bible seeding through the real module", () => {
  it("pushes the protagonist into an Episode when the service comes from DI, not from a test's own hand", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bible-wiring-"));
    previousRoot = process.env.LEARNING_DATA_ROOT;
    process.env.LEARNING_DATA_ROOT = root;
    previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT;
    process.env.PROVIDER_SETTINGS_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    await fetch(`${base}/long-projects`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ projectId: "long_wiring", settings }) });
    // One Episode that has a script but no pictures — the state the seeding is written for.
    const projectsRoot = path.join(root, "projects");
    const longStory = path.join(projectsRoot, "long_wiring", "long_story");
    const episode = path.join(longStory, "Episode01");
    await fs.mkdir(episode, { recursive: true });
    await fs.writeFile(path.join(episode, "project.json"), JSON.stringify({ number: 1, state: "script_approved", approved: false, script: { scenes }, script_revision: 1, scene_count: 6, updated_at: "2026-09-03T00:00:00.000Z" }), "utf8");
    const imported = await (await fetch(`${base}/assets/folders`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ assetType: "character", displayName: "이배드" }),
    })).json() as { asset: { assetId: string } };

    // Through the service the module built, exactly as the controller gets it.
    await app.get(StoryBibleService).updateProtagonistAssetLink("long_wiring", {
      assetLink: { assetId: imported.asset.assetId, versionPolicy: "follow_latest", pinnedVersion: null },
    });

    const stored = await new LocalProjectAssetMappingsRepository(projectsRoot).load({
      id: "long_wiring/Episode01", directory: episode, ensureExists: async () => {},
    });
    expect(stored.map((mapping) => [mapping.match_reason, mapping.asset_id]))
      .toEqual([["auto_protagonist", imported.asset.assetId]]);
  }, 60000);
});
