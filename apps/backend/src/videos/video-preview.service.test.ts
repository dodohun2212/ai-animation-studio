import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import { WorkflowState } from "@ai-animation-studio/shared";

import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import { LocalVideoPreviewService, utf16Length } from "./video-preview.service.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

function scenes() {
  return [1, 2, 3, 4, 5, 6].map((number) => ({
    number,
    description: `description ${number}`,
    visual_action: `action ${number}`,
    start_motion: `start ${number}`,
    main_motion: `main ${number}`,
    end_motion: `end ${number}`,
    shot_size: "medium shot",
    camera_angle: "eye level",
    composition: "centered",
    lens_feel: "natural",
    focus_subject: "subject",
    camera_motion: `camera ${number}`,
    environment_motion: `environment ${number}`,
    motion_speed: "normal",
    motion_intensity: "moderate",
    expression_change: `expression ${number}`,
    continuity_hint: number === 1 ? "opening state" : `continue ${number - 1}`,
  }));
}

async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "video-preview-")); roots.push(root);
  const learningDataRoot = path.join(root, "learning_data");
  const projectsRoot = path.join(learningDataRoot, "projects");
  const budget = new RunwayBudget(learningDataRoot);
  const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("video_preview", "topic", "2026-08-22T00:00:00.000Z");
  project.workflow_state = WorkflowState.WaitingForVideoConfirmation;
  project.scenes = scenes();
  project.style_profile = { aspect: "16:9" };
  const images = path.join(projectsRoot, project.project_id, "images");
  await projects.create(project);
  await fs.mkdir(images, { recursive: true });
  project.generated_images = await Promise.all([1, 2, 3, 4, 5, 6].map(async (number) => {
    const file = path.join(images, `scene${number}.png`); await fs.writeFile(file, PNG); return file;
  }));
  await projects.save(project);
  return { projectsRoot, learningDataRoot, budget, projects, service: new LocalVideoPreviewService(projects, projectsRoot, budget) };
}

describe("provider-free video prompt preview", () => {
  it("returns six Python-shaped prompts, continuity, default metadata, and does not persist", async () => {
    const { projectsRoot, service } = await setup();
    const before = await fs.readFile(path.join(projectsRoot, "video_preview", "project.json"), "utf8");
    const result = await service.preview("video_preview", undefined);
    expect(result.previews).toHaveLength(6);
    expect(result.previews[0]).toMatchObject({ sceneNumber: 1, model: "gen4_turbo", ratio: "1280:720", durationSeconds: 5, estimatedCostUsd: 0.25 });
    expect(result.previews[1]?.prompt).toContain("Continuity cue: end 1 opening state");
    expect(result.previews[1]?.prompt).toContain("Opening movement: start 2");
    expect(result.previews[1]?.prompt).toContain("Main action: main 2");
    expect(result.previews.every((item) => utf16Length(item.prompt) <= 1_000)).toBe(true);
    expect(result.maximumProviderCalls).toBe(6);
    expect(result.budget).toEqual({ monthlyLimitUsd: 10, spentUsd: 0, remainingUsd: 10, estimatedRequestCostUsd: 1.5, canSpend: true });
    await expect(fs.readFile(path.join(projectsRoot, "video_preview", "project.json"), "utf8")).resolves.toBe(before);
  });

  it("uses portrait as the Python fallback and counts non-BMP characters as two UTF-16 units", async () => {
    const { projects, projectsRoot, learningDataRoot } = await setup();
    const project = await projects.findById("video_preview"); project.style_profile = {}; await projects.save(project);
    const result = await new LocalVideoPreviewService(new LocalProjectRepository(projectsRoot), projectsRoot, new RunwayBudget(learningDataRoot)).preview("video_preview", {});
    expect(result.previews.every((item) => item.ratio === "720:1280")).toBe(true);
    expect(utf16Length("A😀B")).toBe(4);
  });

  it("reflects real recorded spend from the shared RunwayBudget ledger instead of a hardcoded value", async () => {
    const { budget, service } = await setup();
    await budget.record("some_other_project", 1, "video", true, 4);
    const result = await service.preview("video_preview", undefined);
    expect(result.budget).toEqual({ monthlyLimitUsd: 10, spentUsd: 4, remainingUsd: 6, estimatedRequestCostUsd: 1.5, canSpend: true });
  });

  it("reports canSpend: false and the true remaining budget once spend nearly exhausts the monthly limit", async () => {
    const { budget, service } = await setup();
    await budget.record("some_other_project", 1, "video", true, 9);
    const result = await service.preview("video_preview", undefined);
    expect(result.budget).toEqual({ monthlyLimitUsd: 10, spentUsd: 9, remainingUsd: 1, estimatedRequestCostUsd: 1.5, canSpend: false });
  });

  it("rejects unknown request fields, wrong state, bad image paths, and corrupt scenes safely", async () => {
    const { projects, projectsRoot, service } = await setup();
    await expect(service.preview("video_preview", { prompt: "not accepted" })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const project = await projects.findById("video_preview");
    project.workflow_state = WorkflowState.ImagesReview; await projects.save(project);
    await expect(service.preview("video_preview", undefined)).rejects.toMatchObject({ response: { code: "VIDEO_PREVIEW_NOT_ALLOWED" } });
    project.workflow_state = WorkflowState.WaitingForVideoConfirmation;
    project.generated_images[0] = "C:/outside/scene1.png"; await projects.save(project);
    await expect(service.preview("video_preview", undefined)).rejects.toMatchObject({ response: { code: "VIDEO_PREVIEW_IMAGES_INVALID" } });
    project.generated_images[0] = path.join(projectsRoot, "video_preview", "images", "scene1.png");
    project.scenes = [{ number: 1 }]; await projects.save(project);
    await expect(service.preview("video_preview", undefined)).rejects.toMatchObject({ response: { code: "VIDEO_PREVIEW_DATA_INVALID" } });
  });

  it("accepts newer scenes that carry a narration field, never lets it leak into the video prompt, and still rejects a non-string narration", async () => {
    const { projects, service } = await setup();
    const project = await projects.findById("video_preview");
    project.scenes = project.scenes.map((scene, index) => ({ ...(scene as Record<string, unknown>), narration: `narration line ${index + 1}` }));
    await projects.save(project);
    const result = await service.preview("video_preview", undefined);
    expect(result.previews).toHaveLength(6);
    expect(result.previews.every((item) => !item.prompt.includes("narration"))).toBe(true);

    project.scenes[0] = { ...(project.scenes[0] as Record<string, unknown>), narration: 42 };
    await projects.save(project);
    await expect(service.preview("video_preview", undefined)).rejects.toMatchObject({ response: { code: "VIDEO_PREVIEW_DATA_INVALID" } });
  });
});
