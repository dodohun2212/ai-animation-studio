import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import type { ApiError } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { atomicWriteUtf8File } from "./atomic-file.js";
import { ProjectApiException } from "./project-api.error.js";
import { createStoredProject } from "./project.mapper.js";
import { LocalProjectRepository } from "./projects.repository.js";

describe("LocalProjectRepository", () => {
  let root: string;
  let repository: LocalProjectRepository;

  beforeEach(async () => {
    root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "projects-repo-test-"));
    repository = new LocalProjectRepository(root);
  });

  afterEach(async () => {
    await fsPromises.rm(root, { recursive: true, force: true });
  });

  async function readRawJson(projectId: string): Promise<Record<string, unknown>> {
    const raw = await fsPromises.readFile(path.join(root, projectId, "project.json"), "utf8");
    return JSON.parse(raw) as Record<string, unknown>;
  }

  it("saves a new project as an indented, UTF-8, snake_case JSON file", async () => {
    const stored = createStoredProject("sample_project", "우주를 여행하는 고양이", "2026-08-21T00:00:00.000Z");
    await repository.create(stored);

    const raw = await fsPromises.readFile(path.join(root, "sample_project", "project.json"), "utf8");
    expect(raw).toContain("\n  ");
    const json = JSON.parse(raw) as Record<string, unknown>;
    expect(json.project_id).toBe("sample_project");
    expect(json.topic).toBe("우주를 여행하는 고양이");
    expect(json.workflow_state).toBe("READY");
    expect("id" in json).toBe(false);
  });

  it("round-trips a Korean UTF-8 topic through save and load", async () => {
    const stored = createStoredProject("sample_project", "우주를 여행하는 고양이", "2026-08-21T00:00:00.000Z");
    await repository.create(stored);

    const loaded = await repository.findById("sample_project");
    expect(loaded.topic).toBe("우주를 여행하는 고양이");
  });

  it("rejects an unsafe project ID before touching the filesystem", async () => {
    const stored = createStoredProject("../escape", "topic", "2026-08-21T00:00:00.000Z");
    await expect(repository.create(stored)).rejects.toThrow();
    expect(await fsPromises.readdir(root)).toEqual([]);
  });

  it("rejects path traversal on read", async () => {
    await expect(repository.findById("../outside")).rejects.toThrow();
  });

  it("rejects creating a duplicate project ID without modifying the existing file", async () => {
    const first = createStoredProject("sample_project", "first topic", "2026-08-21T00:00:00.000Z");
    await repository.create(first);
    const before = await readRawJson("sample_project");

    const duplicate = createStoredProject("sample_project", "second topic", "2026-08-21T01:00:00.000Z");
    await expect(repository.create(duplicate)).rejects.toThrow();

    const after = await readRawJson("sample_project");
    expect(after).toEqual(before);
    expect(after.topic).toBe("first topic");
  });

  it("maps an EEXIST project directory to PROJECT_ALREADY_EXISTS", async () => {
    await fsPromises.mkdir(path.join(root, "pre_existing"), { recursive: true });
    const stored = createStoredProject("pre_existing", "topic", "2026-08-21T00:00:00.000Z");

    try {
      await repository.create(stored);
      throw new Error("expected create to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(ProjectApiException);
      expect(((error as ProjectApiException).getResponse() as ApiError).code).toBe(
        "PROJECT_ALREADY_EXISTS",
      );
    }
  });

  it("cleans up the directory it created when saving project.json fails", async () => {
    const failing = new LocalProjectRepository(root, async () => {
      throw new Error("simulated disk failure");
    });
    const stored = createStoredProject("failed_save", "topic", "2026-08-21T00:00:00.000Z");

    await expect(failing.create(stored)).rejects.toThrow();

    await expect(fsPromises.access(path.join(root, "failed_save"))).rejects.toThrow();
    expect(await fsPromises.readdir(root)).toEqual([]);
  });

  it("allows retrying the same project ID after a save failure", async () => {
    let attempt = 0;
    const flaky = new LocalProjectRepository(root, async (file, content) => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error("simulated disk failure");
      }
      await atomicWriteUtf8File(file, content);
    });
    const stored = createStoredProject("retry_project", "topic", "2026-08-21T00:00:00.000Z");

    await expect(flaky.create(stored)).rejects.toThrow();
    await expect(flaky.create(stored)).resolves.toBeUndefined();

    const loaded = await flaky.findById("retry_project");
    expect(loaded.topic).toBe("topic");
  });

  it("never cleans up a directory it did not create itself (non-empty, foreign directory)", async () => {
    const directory = path.join(root, "foreign_project");
    await fsPromises.mkdir(directory, { recursive: true });
    await fsPromises.writeFile(path.join(directory, "some_other_file.txt"), "not ours", "utf8");

    const stored = createStoredProject("foreign_project", "topic", "2026-08-21T00:00:00.000Z");
    await expect(repository.create(stored)).rejects.toThrow();

    // The pre-existing, non-empty directory and its contents must be untouched.
    expect(await fsPromises.readdir(directory)).toEqual(["some_other_file.txt"]);
  });

  it("lets only one of two concurrent creates for the same ID succeed", async () => {
    const first = createStoredProject("concurrent_project", "topic A", "2026-08-21T00:00:00.000Z");
    const second = createStoredProject("concurrent_project", "topic B", "2026-08-21T00:00:01.000Z");

    const results = await Promise.allSettled([repository.create(first), repository.create(second)]);

    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    const rejection = (rejected[0] as PromiseRejectedResult).reason;
    expect(rejection).toBeInstanceOf(ProjectApiException);
    expect((rejection.getResponse() as ApiError).code).toBe("PROJECT_ALREADY_EXISTS");

    const loaded = await repository.findById("concurrent_project");
    expect(["topic A", "topic B"]).toContain(loaded.topic);
  });

  it("throws a not-found error for a missing project", async () => {
    await expect(repository.findById("missing_project")).rejects.toThrow();
  });

  it("rejects syntactically corrupt JSON", async () => {
    await fsPromises.mkdir(path.join(root, "broken"), { recursive: true });
    await fsPromises.writeFile(path.join(root, "broken", "project.json"), "{not valid json", "utf8");
    await expect(repository.findById("broken")).rejects.toThrow();
  });

  it("rejects a JSON root that is not an object", async () => {
    await fsPromises.mkdir(path.join(root, "array_root"), { recursive: true });
    await fsPromises.writeFile(path.join(root, "array_root", "project.json"), "[1,2,3]", "utf8");
    await expect(repository.findById("array_root")).rejects.toThrow();
  });

  it("rejects an unknown stored field", async () => {
    const stored = createStoredProject("has_unknown", "topic", "2026-08-21T00:00:00.000Z");
    await repository.create(stored);
    const raw = await readRawJson("has_unknown");
    raw.totally_unexpected_field = true;
    await fsPromises.writeFile(
      path.join(root, "has_unknown", "project.json"),
      JSON.stringify(raw, null, 2),
      "utf8",
    );
    await expect(repository.findById("has_unknown")).rejects.toThrow();
  });

  it("rejects an invalid project_type, workflow_state, or timestamp", async () => {
    for (const [field, value] of [
      ["project_type", "long_story_project"],
      ["workflow_state", "NOT_A_STATE"],
      ["created_at", "not-a-timestamp"],
    ] as const) {
      const stored = createStoredProject(`invalid_${field}`, "topic", "2026-08-21T00:00:00.000Z");
      await repository.create(stored);
      const raw = await readRawJson(`invalid_${field}`);
      raw[field] = value;
      await fsPromises.writeFile(
        path.join(root, `invalid_${field}`, "project.json"),
        JSON.stringify(raw, null, 2),
        "utf8",
      );
      await expect(repository.findById(`invalid_${field}`)).rejects.toThrow();
    }
  });

  it("loads an existing Python-style project.json that includes every known compatibility field", async () => {
    const directory = path.join(root, "python_project");
    await fsPromises.mkdir(directory, { recursive: true });
    const pythonJson = {
      project_id: "python_project",
      topic: "Python에서 만든 프로젝트",
      workflow_state: "IMAGES_READY",
      created_at: "2026-08-20T10:00:00.123456+00:00",
      updated_at: "2026-08-20T11:30:00.654321+00:00",
      character_profile: { name: "대표 캐릭터", cast: [] },
      lore_context: { lore: "자율" },
      style_profile: { genre: "sci-fi", mood: "밝음" },
      references: [],
      story: { title: "제목", scenes: 6 },
      scenes: [{ number: 1, description: "장면 1" }],
      image_prompts: ["prompt1"],
      motion_prompts: ["motion1"],
      generated_images: ["scene1.png"],
      image_generation_records: [],
      generated_image_reviews: [],
      face_consistency_results: [],
      generated_video_paths: [],
      video_generation_records: [],
      video_reviews: [],
      capcut_clip_paths: [],
      final_video_path: null,
      api_usage: [],
      warnings: [],
      errors: [],
      project_type: "short_project",
      script_revision: 1,
      mapping_revision: 0,
    };
    await fsPromises.writeFile(
      path.join(directory, "project.json"),
      JSON.stringify(pythonJson, null, 4),
      "utf8",
    );

    const loaded = await repository.findById("python_project");
    expect(loaded.topic).toBe("Python에서 만든 프로젝트");
    expect(loaded.workflow_state).toBe("IMAGES_READY");
    expect(loaded.character_profile).toEqual({ name: "대표 캐릭터", cast: [] });
    expect(loaded.image_prompts).toEqual(["prompt1"]);
  });

  it("reads legacy WAITING_FOR_CAPCUT/CAPCUT_CLIPS_READY states and capcut_clip_paths", async () => {
    const directory = path.join(root, "legacy_project");
    await fsPromises.mkdir(directory, { recursive: true });
    const legacyJson = {
      project_id: "legacy_project",
      topic: "legacy topic",
      workflow_state: "CAPCUT_CLIPS_READY",
      created_at: "2026-08-20T10:00:00+00:00",
      updated_at: "2026-08-20T10:00:00+00:00",
      capcut_clip_paths: ["scene1.mp4", "scene2.mp4"],
      project_type: "short_project",
    };
    await fsPromises.writeFile(
      path.join(directory, "project.json"),
      JSON.stringify(legacyJson, null, 2),
      "utf8",
    );

    const loaded = await repository.findById("legacy_project");
    expect(loaded.workflow_state).toBe(WorkflowState.VideosReady);
    expect(loaded.generated_video_paths).toEqual(["scene1.mp4", "scene2.mp4"]);
  });

  it("does not modify the stored file when reading it", async () => {
    const stored = createStoredProject("read_only", "topic", "2026-08-21T00:00:00.000Z");
    await repository.create(stored);
    const file = path.join(root, "read_only", "project.json");
    const before = await fsPromises.readFile(file, "utf8");

    await repository.findById("read_only");

    const after = await fsPromises.readFile(file, "utf8");
    expect(after).toBe(before);
  });

  it("returns an empty list when the projects directory does not exist yet", async () => {
    const emptyRepository = new LocalProjectRepository(path.join(root, "does-not-exist"));
    expect(await emptyRepository.list()).toEqual([]);
  });

  it("skips corrupt or invalid entries instead of failing the whole list", async () => {
    const good = createStoredProject("good_project", "topic", "2026-08-21T00:00:00.000Z");
    await repository.create(good);
    await fsPromises.mkdir(path.join(root, "broken_project"), { recursive: true });
    await fsPromises.writeFile(path.join(root, "broken_project", "project.json"), "{broken", "utf8");

    const listed = await repository.list();
    expect(listed.map((project) => project.project_id)).toEqual(["good_project"]);
  });
});
