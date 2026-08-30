import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { parseShortProjectSettings, applyShortProjectSettings } from "../projects/project-settings.js";
import { LocalNarrationGenerationService } from "./local-narration-generation.service.js";
import { withProjectLock } from "../videos/project-lock.js";
import { NarrationReviewService } from "./narration-review.service.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import type { probeAudioDurationSeconds } from "./audio-duration.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })));
});

const SETTINGS_REQUEST = {
  projectName: "narration review test", topic: "topic", genre: "", mood: "", character: "", lore: "", fullStory: "",
  sceneCount: 2, clipDurationSeconds: 5, additionalNotes: "", styleNotes: {}, narrationEnabled: true, subtitlesEnabled: false,
};

async function setup(narrationEnabled = true, probeDuration: typeof probeAudioDurationSeconds = async () => undefined) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "narration-review-")); roots.push(root);
  const projectsRoot = path.join(root, "learning_data", "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("narr", "topic", "2026-08-22T00:00:00.000Z");
  const settings = parseShortProjectSettings({ ...SETTINGS_REQUEST, narrationEnabled });
  const withSettings = applyShortProjectSettings(project, settings, "2026-08-22T00:00:00.000Z");
  withSettings.scenes = [1, 2].map((number) => ({
    number, description: `scene ${number}`, narration: number === 2 ? "" : "narration line 1",
  }));
  await projects.create(withSettings);
  const generation = new LocalNarrationGenerationService(projects, projectsRoot);
  const reviews = new NarrationReviewService(projects, generation, undefined, undefined, probeDuration);
  return { root, projectsRoot, projects, generation, reviews };
}

describe("NarrationReviewService", () => {
  it("refuses a second regeneration of the same scene at once, while leaving other scenes free", async () => {
    // Keyed on the scene: two presses on one scene are one intent and were billed twice, but regenerating a
    // different scene without waiting is ordinary in a review screen and must still go through. Both halves are
    // asserted, because a guard that refuses everything would satisfy the first on its own.
    const { projects, reviews } = await setup();
    const startedAt = Date.now();
    let sameScene: unknown;
    let otherScene: unknown;
    await withProjectLock(projects.projectDirectory("narr"), "narr:narration-scene-1", async () => {
      sameScene = await reviews.regenerate("narr", "1", { approved: true }).catch((error: unknown) => error);
      otherScene = await reviews.regenerate("narr", "2", { approved: true }).catch((error: unknown) => error);
    });

    expect(sameScene).toMatchObject({ response: { code: "PROJECT_LOCKED" } });
    expect(otherScene).not.toMatchObject({ response: { code: "PROJECT_LOCKED" } });
    expect(Date.now() - startedAt).toBeLessThan(2_000);
  });


  it("reports each scene's narration text and audio status without generating anything", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { reviews, generation } = await setup();
    const status = await reviews.getStatus("narr");
    expect(status.narrations).toEqual([
      { sceneNumber: 1, narration: "narration line 1", audio: "none" },
      { sceneNumber: 2, narration: "", audio: "none" },
    ]);
    expect(fetchMock).not.toHaveBeenCalled();

    await generation.generate("narr", { approved: true });
    const after = await reviews.getStatus("narr");
    expect(after.narrations[0]).toMatchObject({ audio: "placeholder" });
    expect(after.narrations[1]).toMatchObject({ audio: "none" });
    expect(after.staleness).toEqual({ imageStale: [], videoStale: [], narrationStale: [], referenceStale: [] });
  });

  it("reads its own mappings when nobody handed it any, so imageStale is right in every construction", async () => {
    // Constructed here the way every test and every future caller constructs it: five arguments, no Asset
    // Library, no mappings. Left as optional-with-no-default those two would be undefined, this response would
    // recompute the image prompt without a References block, and every generated scene of a project with a
    // confirmed mapping would come back stale — the same wrong list the scene-edit response used to return, and
    // for the same reason: a dependency nobody was asked about.
    const { reviews, projects, root } = await setup();
    const assets = new (await import("../assets/assets.repository.js")).LocalAssetsRepository(path.join(root, "learning_data"));
    const character = await assets.create({ buffer: PNG, originalname: "hero.png", mimetype: "image/png" }, { assetType: "character", displayName: "Hero", approved: true });
    const mappings = new LocalProjectAssetMappingsRepository(path.join(root, "learning_data", "projects"));
    const now = "2026-08-30T00:00:00.000Z";
    await mappings.save(mappings.projectLocation("narr"), [{
      mapping_id: "MAP-NARR0001", project_id: "narr", asset_id: character.asset_id, enabled: true, usage_role: "character",
      scene_scope: { mode: "all" }, assignment_source: "manual", confidence: null, match_reason: "manual_assignment",
      status: "confirmed", user_confirmed: true, version_policy: "follow_latest", pinned_version: null, candidate_only: false,
      created_at: now, updated_at: now, snapshot_path: null, snapshot_sha256: null, snapshot_source_version: null, selected_child_asset_ids: [],
    }]);

    const project = await projects.findById("narr");
    const { imagePromptFor, styleLineFor } = await import("../images/image-prompt.js");
    const { describeReferenceMappingsForScene } = await import("../images/image-reference-selection.js");
    const stored = await mappings.load(mappings.projectLocation("narr"));
    project.image_generation_records = [{ scene_number: 1, prompt: imagePromptFor(project.scenes[0], styleLineFor(project), await describeReferenceMappingsForScene(assets, stored, 1)) }];
    await projects.save(project);

    expect((await reviews.getStatus("narr")).staleness?.imageStale).toEqual([]);
  });

  it("flags narrationStale once the scene's narration text is edited after audio was generated", async () => {
    const { reviews, generation, projects } = await setup();
    await generation.generate("narr", { approved: true });
    const project = await projects.findById("narr");
    project.scenes[0] = { ...(project.scenes[0] as Record<string, unknown>), narration: "고친 내레이션" };
    await projects.save(project);
    const status = await reviews.getStatus("narr");
    expect(status.staleness?.narrationStale).toEqual([1]);
  });

  it("regenerates one scene's fake audio and bumps its record", async () => {
    const { reviews, generation } = await setup();
    await generation.generate("narr", { approved: true });
    const result = await reviews.regenerate("narr", "1", { approved: true });
    expect(result.sceneNumber).toBe(1);
    expect(result.narrations[0]).toMatchObject({ audio: "placeholder" });
    expect(result.retryEstimate).toBeUndefined();
  });

  it("rejects regenerating a scene with no narration text", async () => {
    const { reviews } = await setup();
    await expect(reviews.regenerate("narr", "2", { approved: true })).rejects.toMatchObject({ response: { code: "NARRATION_MISSING_TEXT" } });
  });

  it("includes the measured audio length only for scenes that actually have audio", async () => {
    const probeDuration = vi.fn(async (file: string) => (file.endsWith("scene1.mp3") ? 4.2 : undefined));
    const { reviews, generation } = await setup(true, probeDuration);
    await generation.generate("narr", { approved: true });
    const status = await reviews.getStatus("narr");
    expect(status.narrations[0]).toMatchObject({ audio: "placeholder", audioDurationSeconds: 4.2 });
    expect(status.narrations[1]!.audioDurationSeconds).toBeUndefined();
    expect(probeDuration).toHaveBeenCalledTimes(1);
  });

  it("omits audioDurationSeconds when the file exists but its length can't be measured (e.g. ffprobe unavailable)", async () => {
    const { reviews, generation } = await setup();
    await generation.generate("narr", { approved: true });
    const status = await reviews.getStatus("narr");
    expect(status.narrations[0]).toMatchObject({ audio: "placeholder" });
    expect(status.narrations[0]!.audioDurationSeconds).toBeUndefined();
  });

  it("rejects regenerating when narrationEnabled is off", async () => {
    const { reviews } = await setup(false);
    await expect(reviews.regenerate("narr", "1", { approved: true })).rejects.toMatchObject({ response: { code: "NARRATION_NOT_ENABLED" } });
  });

  it("rejects a scene number outside the project's range and a missing approval body", async () => {
    const { reviews } = await setup();
    await expect(reviews.regenerate("narr", "99", { approved: true })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(reviews.regenerate("narr", "1", {})).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });
});
