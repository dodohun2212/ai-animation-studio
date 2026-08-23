import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { WorkflowState } from "@ai-animation-studio/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { applyContinuityCandidate, listContinuityOptions, previousSceneContext, resolveContinuityCandidate, toShortProjectContinuityLink } from "./project-continuity.js";
import { createStoredProject } from "./project.mapper.js";
import { LocalProjectRepository } from "./projects.repository.js";
import type { StoredProject } from "./project-storage.schema.js";

function scenes(): Record<string, unknown>[] {
  return Array.from({ length: 6 }, (_, index) => ({ number: index + 1, description: `Scene ${index + 1} description` }));
}

describe("project-continuity", () => {
  let root: string;
  let repository: LocalProjectRepository;

  beforeEach(async () => {
    root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "project-continuity-test-"));
    repository = new LocalProjectRepository(root);
  });

  afterEach(async () => {
    await fsPromises.rm(root, { recursive: true, force: true });
  });

  async function createEligibleCandidate(projectId: string, overrides: Partial<StoredProject> = {}): Promise<StoredProject> {
    const imagesDir = path.join(root, projectId, "images");
    const stored: StoredProject = {
      ...createStoredProject(projectId, "topic", "2026-08-23T00:00:00.000Z"),
      workflow_state: WorkflowState.VideosReady,
      scenes: scenes(),
      story: { title: "Story Title", synopsis: "s", ending: "A hopeful ending" },
      generated_images: [
        path.join(imagesDir, "scene1.png"), path.join(imagesDir, "scene2.png"), path.join(imagesDir, "scene3.png"),
        path.join(imagesDir, "scene4.png"), path.join(imagesDir, "scene5.png"), path.join(imagesDir, "scene6.png"),
      ],
      ...overrides,
    };
    await repository.create(stored);
    await fsPromises.mkdir(imagesDir, { recursive: true });
    await fsPromises.writeFile(path.join(imagesDir, "scene6.png"), "fake-png-bytes");
    return stored;
  }

  describe("listContinuityOptions", () => {
    it("returns an empty list when there are no other projects", async () => {
      await repository.create(createStoredProject("current", "topic", "2026-08-23T00:00:00.000Z"));
      expect(await listContinuityOptions(repository, "current")).toEqual([]);
    });

    it("excludes the current project itself even if it would otherwise be eligible", async () => {
      await createEligibleCandidate("current");
      expect(await listContinuityOptions(repository, "current")).toEqual([]);
    });

    it("excludes a project whose workflow state has not reached video approval", async () => {
      await repository.create(createStoredProject("candidate", "topic", "2026-08-23T00:00:00.000Z"));
      expect(await listContinuityOptions(repository, "current")).toEqual([]);
    });

    it("excludes a project missing 6 scenes or 6 generated images", async () => {
      await createEligibleCandidate("candidate", { scenes: scenes().slice(0, 5) });
      expect(await listContinuityOptions(repository, "current")).toEqual([]);
    });

    it("excludes a project whose Scene 6 image file does not exist on disk", async () => {
      const stored = createStoredProject("candidate", "topic", "2026-08-23T00:00:00.000Z");
      await repository.create({
        ...stored, workflow_state: WorkflowState.VideosReady, scenes: scenes(),
        generated_images: Array.from({ length: 6 }, (_, i) => path.join(root, "candidate", "images", `scene${i + 1}.png`)),
      });
      expect(await listContinuityOptions(repository, "current")).toEqual([]);
    });

    it("excludes a project whose Scene 6 image path escapes its own project directory", async () => {
      const outside = path.join(root, "outside.png");
      await fsPromises.writeFile(outside, "fake-png-bytes");
      await createEligibleCandidate("candidate", {
        generated_images: [outside, outside, outside, outside, outside, outside],
      });
      expect(await listContinuityOptions(repository, "current")).toEqual([]);
    });

    it("includes an eligible project and derives its label from lore_context.project_name, falling back to story title then topic", async () => {
      await createEligibleCandidate("candidate_named", { lore_context: { project_name: "별의 지도" } });
      await createEligibleCandidate("candidate_title_only");
      await createEligibleCandidate("candidate_topic_only", { story: { title: "", synopsis: "", ending: "" } });

      const options = await listContinuityOptions(repository, "current");
      expect(options).toContainEqual({ projectId: "candidate_named", projectName: "별의 지도", label: "별의 지도 · Scene 6" });
      expect(options).toContainEqual({ projectId: "candidate_title_only", projectName: "Story Title", label: "Story Title · Scene 6" });
      expect(options).toContainEqual({ projectId: "candidate_topic_only", projectName: "topic", label: "topic · Scene 6" });
    });
  });

  describe("resolveContinuityCandidate", () => {
    it("returns null for a self-reference", async () => {
      await createEligibleCandidate("current");
      expect(await resolveContinuityCandidate(repository, "current", "current")).toBeNull();
    });

    it("returns null for a project that does not exist", async () => {
      expect(await resolveContinuityCandidate(repository, "current", "missing")).toBeNull();
    });

    it("resolves an eligible candidate with its derived story context", async () => {
      await createEligibleCandidate("candidate", { lore_context: { project_name: "별의 지도" } });
      const resolved = await resolveContinuityCandidate(repository, "current", "candidate");
      expect(resolved?.projectId).toBe("candidate");
      expect(resolved?.storyContext).toContain("별의 지도");
      expect(resolved?.storyContext).toContain("Scene 6 description");
    });
  });

  describe("toShortProjectContinuityLink / previousSceneContext", () => {
    it("returns null/empty when no link is set", () => {
      const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
      expect(toShortProjectContinuityLink(stored)).toBeNull();
      expect(previousSceneContext(stored)).toBe("");
    });

    it("ignores a link missing the opt-in user_selected/source_kind markers", () => {
      const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
      stored.lore_context = { previous_scene_link: { source_kind: "short_project", project_id: "x", project_name: "x", label: "x", story_context: "ctx" } };
      expect(toShortProjectContinuityLink(stored)).toBeNull();
      expect(previousSceneContext(stored)).toBe("");
    });

    it("reads a properly opted-in link", () => {
      const stored = createStoredProject("p", "topic", "2026-08-23T00:00:00.000Z");
      stored.lore_context = {
        previous_scene_link: {
          source_kind: "short_project", user_selected: true, project_id: "candidate", project_name: "별의 지도",
          label: "별의 지도 · Scene 6", scene_number: 6, story_context: "이전 이야기 맥락", image_path: "/x/scene6.png",
        },
      };
      expect(toShortProjectContinuityLink(stored)).toEqual({ projectId: "candidate", projectName: "별의 지도", label: "별의 지도 · Scene 6" });
      expect(previousSceneContext(stored)).toBe("이전 이야기 맥락");
    });
  });

  describe("applyContinuityCandidate", () => {
    it("writes a full snake_case link while preserving other lore_context fields", async () => {
      const stored = createStoredProject("current", "topic", "2026-08-23T00:00:00.000Z");
      stored.lore_context = { atmosphere_asset_ids: ["ASSET-A"] };
      const candidate = await resolveContinuityCandidate(repository, "current", (await createEligibleCandidate("candidate")).project_id);
      const updated = applyContinuityCandidate(stored, candidate, "2026-08-23T01:00:00.000Z");
      expect(updated.lore_context.atmosphere_asset_ids).toEqual(["ASSET-A"]);
      expect(updated.lore_context.previous_scene_link).toMatchObject({ source_kind: "short_project", user_selected: true, project_id: "candidate", scene_number: 6 });
      expect(updated.updated_at).toBe("2026-08-23T01:00:00.000Z");
    });

    it("clears the link to an empty object when given null", () => {
      const stored = createStoredProject("current", "topic", "2026-08-23T00:00:00.000Z");
      stored.lore_context = { previous_scene_link: { source_kind: "short_project", user_selected: true, project_id: "x", project_name: "x", label: "x" } };
      const updated = applyContinuityCandidate(stored, null, "2026-08-23T01:00:00.000Z");
      expect(updated.lore_context.previous_scene_link).toEqual({});
    });
  });
});
