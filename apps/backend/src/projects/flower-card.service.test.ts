import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { API_ROUTES, FLOWER_CARD_CAPTION_MAX_LENGTH, FLOWER_CARD_DESCRIPTION_MAX_LENGTH, MIN_SCENE_COUNT, WorkflowState } from "@ai-animation-studio/shared";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import { ShortProjectMappingOwners } from "../mappings/short-project-mapping-owner.js";
import { FlowerCardController } from "./flower-card.controller.js";
import { FlowerCardService } from "./flower-card.service.js";
import { LocalProjectRepository } from "./projects.repository.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function service() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "flower-card-"));
  roots.push(root);
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const mappingsRepository = new LocalProjectAssetMappingsRepository(projectsRoot);
  const assets = new LocalAssetsRepository(path.join(root, "assets"));
  const mappings = new ProjectAssetMappingsService(mappingsRepository, assets, new ShortProjectMappingOwners(mappingsRepository, projects));
  return { service: new FlowerCardService(projects, mappings, { warn: () => undefined }), projects, mappings, projectsRoot };
}

const request = (over: Record<string, unknown> = {}) => ({
  projectId: "꽃말_수국",
  flowerName: "수국",
  meaning: "진심",
  scenes: [
    { description: "씨앗이 흙에 심긴다", caption: "모든 진심은 보이지 않는 곳에서 시작한다" },
    { description: "수국이 활짝 핀다", caption: "그리고 때가 되면 반드시 드러난다" },
  ],
  clipDurationSeconds: 10,
  aspectRatio: "9:16",
  ...over,
});

describe("making a flower reel", () => {
  it("writes the authored scenes as the project's script, in the order they were given", async () => {
    const { service: subject } = await service();

    const { project } = await subject.create(request());

    expect(project.scenes.map((scene) => [scene.number, scene.description, scene.narration])).toEqual([
      [1, "씨앗이 흙에 심긴다", "모든 진심은 보이지 않는 곳에서 시작한다"],
      [2, "수국이 활짝 핀다", "그리고 때가 되면 반드시 드러난다"],
    ]);
  });

  /**
   * 🔴 The reason this route exists at all.
   *
   * A story call is $0.05 and, for a flower's origin, returns something shaped like a fact rather than a fact.
   * If anything here ever reached a provider, the free front door would be paying for a script nobody asked it
   * to write — so this holds the shape of the request rather than a mock's call count: nothing in what is
   * stored can have come from a model.
   */
  it("asks nothing of any provider — the script is what the person typed, unchanged", async () => {
    const { service: subject, projects } = await service();

    const { project } = await subject.create(request());
    const stored = await projects.findById(project.id);

    // `story` is the model's own output and stays as `createStoredProject` left it — empty. A generated project
    // has scenes in here as well as in `scenes`; a written one never does.
    expect(stored.story).toEqual({});
    expect(stored.scenes.map((scene) => (scene as { description?: string }).description)).toEqual(["씨앗이 흙에 심긴다", "수국이 활짝 핀다"]);
    // No spend was recorded, so no ledger warning could have been raised — the shape a paid call leaves behind.
    expect(stored.warnings).toEqual([]);
  });

  /**
   * 🔴 The half that is invisible from the screen and is the whole difference between a usable project and a
   * dead end.
   *
   * Approving a mapping review compares the script fingerprint against a baseline. Story generation sets that
   * baseline as the last thing it does; this route has no story call, so if it did not do the same, every
   * flower reel would reach the mapping screen and be refused with `no_baseline` — the refusal Captain D hit
   * and stopped at (Cowork Round 533). A project that cannot leave its second screen is not a feature.
   */
  it("opens the mapping review with a real baseline, so the project can actually be approved", async () => {
    const { service: subject, mappings } = await service();

    const { project, review } = await subject.create(request());
    const opened = await mappings.review(project.id);

    expect(review.scriptFingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(opened.review.scriptFingerprint).toBe(review.scriptFingerprint);
    expect(review.status).toBe("waiting");
  });

  /** The review's recorded revision has to be the project's, or the first approval invalidates itself. */
  it("agrees with the project about which script revision was fingerprinted", async () => {
    const { service: subject, projects } = await service();

    const { project, review } = await subject.create(request());
    const stored = await projects.findById(project.id);

    expect(stored.script_revision).toBe(1);
    expect(review.scriptRevision).toBe(stored.script_revision);
    expect(stored.mapping_revision).toBe(review.mappingRevision);
  });

  /**
   * 🟠 Not a photo card, deliberately.
   *
   * A photo card is marked because it skips five pipeline steps and its progress bar would otherwise count
   * stages it never takes. A flower reel takes every one of them, so marking it would move it out of 단기
   * 프로젝트 for no reason and make the list lie in the other direction (Cowork Round 599).
   */
  it("is an ordinary short project, carrying no mark that would hide it from the project list", async () => {
    const { service: subject, projects } = await service();

    const { project } = await subject.create(request());
    const stored = await projects.findById(project.id);

    expect(project.photoCard).not.toBe(true);
    expect(stored.lore_context?.photo_card).toBeUndefined();
    expect(stored.project_type).toBe("short_project");
    expect(stored.workflow_state).toBe(WorkflowState.WaitingForAssetMappingReview);
  });

  /**
   * The aspect goes to `lore_context.style_notes.aspect`, which is the field five readers actually read.
   * Writing it to `style_profile.aspect` instead is a measured bug: a 16:9 card merged to 1080x1920.
   */
  it("records the aspect where the pipeline reads it", async () => {
    const { service: subject, projects } = await service();

    const { project } = await subject.create(request({ aspectRatio: "16:9" }));

    const notes = (await projects.findById(project.id)).lore_context?.style_notes as { aspect?: string } | undefined;
    expect(notes?.aspect).toBe("16:9");
  });

  it("keeps the flower and its meaning together as the subject", async () => {
    const { service: subject } = await service();

    expect((await subject.create(request())).project.topic).toBe("수국\n진심");
  });

  /**
   * The ceilings the screen shows a counter for are the ceilings the server enforces.
   *
   * 🔴 One number in two places is how a form says "fine" and the server then refuses — and a flower reel is
   * several scenes typed in one sitting, so that costs the whole form rather than one sentence. These read from
   * the contract on both sides; this holds that the server is really using them and not a copy that drifted.
   */
  it("refuses exactly at the ceilings the contract publishes", async () => {
    const { service: subject } = await service();

    const long = (length: number) => "가".repeat(length);
    await expect(subject.create(request({
      scenes: [{ description: long(FLOWER_CARD_DESCRIPTION_MAX_LENGTH + 1), caption: "하나" }, { description: "핀다", caption: "둘" }],
    }))).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(subject.create(request({
      scenes: [{ description: "씨앗", caption: long(FLOWER_CARD_CAPTION_MAX_LENGTH + 1) }, { description: "핀다", caption: "둘" }],
    }))).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });

    // And the value right at the ceiling is accepted, so the counter's last character is usable rather than a
    // number the person can reach and not spend.
    const { project } = await subject.create(request({
      projectId: "꽃말_경계",
      scenes: [{ description: long(FLOWER_CARD_DESCRIPTION_MAX_LENGTH), caption: long(FLOWER_CARD_CAPTION_MAX_LENGTH) }, { description: "핀다", caption: "둘" }],
    }));
    expect(project.scenes).toHaveLength(2);
  });

  /**
   * 🟠 The route the client calls and the route the server answers on, from one place.
   *
   * Cowork kept the path out of their module as a literal for this reason: a path that lives in two files is
   * the next drift, and this one fails as a 404 on a button that looks wired.
   */
  it("answers on the path the contract publishes", () => {
    expect(Reflect.getMetadata("path", FlowerCardController)).toBe(API_ROUTES.flowerCards.replace(/^\//, ""));
  });

  it("refuses a one-scene reel, since that is a photo card and has its own door", async () => {
    const { service: subject } = await service();

    await expect(subject.create(request({ scenes: [{ description: "씨앗", caption: "하나" }] })))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    expect(MIN_SCENE_COUNT).toBe(2);
  });

  it("refuses a scene missing either half — a description with no caption is a picture nobody can read", async () => {
    const { service: subject } = await service();

    for (const scenes of [
      [{ description: "씨앗이 흙에 심긴다" }, { description: "핀다", caption: "둘" }],
      [{ description: "씨앗이 흙에 심긴다", caption: "" }, { description: "핀다", caption: "둘" }],
      [{ caption: "설명이 없다" }, { description: "핀다", caption: "둘" }],
    ]) {
      await expect(subject.create(request({ scenes }))).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    }
  });

  it("refuses a project id that would escape the projects directory", async () => {
    const { service: subject } = await service();

    await expect(subject.create(request({ projectId: "../바깥" }))).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  /** A duplicate name is the person's to fix in the name field; folding it into a storage error sends them nowhere. */
  it("passes a name collision through as itself rather than as a storage failure", async () => {
    const { service: subject } = await service();

    await subject.create(request());

    await expect(subject.create(request())).rejects.toMatchObject({ response: { code: "PROJECT_ALREADY_EXISTS" } });
  });
});
