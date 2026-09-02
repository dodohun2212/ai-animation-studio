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

  // Skipping is right — one damaged project must not take the rest off the screen. Doing it silently is not:
  // a schema disagreement dropped a finished project out of this list with no error anywhere, and what the
  // person saw was their completed work having vanished (Cowork Round 436).
  it("says which entries it skipped and why, instead of dropping them silently", async () => {
    const warnings: string[] = [];
    const quiet = new LocalProjectRepository(root, undefined, undefined, undefined, undefined, { warn: (message: unknown) => { warnings.push(String(message)); } });
    await quiet.create(createStoredProject("good_project", "topic", "2026-08-21T00:00:00.000Z"));
    await fsPromises.mkdir(path.join(root, "broken_project"), { recursive: true });
    await fsPromises.writeFile(path.join(root, "broken_project", "project.json"), "{broken", "utf8");

    expect((await quiet.list()).map((project) => project.project_id)).toEqual(["good_project"]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("broken_project");
    // Nothing is logged when every project reads, so the line means something when it appears.
    warnings.length = 0;
    await fsPromises.rm(path.join(root, "broken_project"), { recursive: true, force: true });
    await quiet.list();
    expect(warnings).toEqual([]);

    // And a directory that is not a project at all stays silent. The projects root holds a few of those by
    // design (the asset library keeps one), and a warning that fires on every listing stops being read —
    // measured: it showed up in an unrelated test run the first time this logging shipped.
    await fsPromises.mkdir(path.join(root, "_asset_library_manual"), { recursive: true });
    // `.archive` is the same case from the other direction: a name that could never be a project id.
    await fsPromises.mkdir(path.join(root, ".archive"), { recursive: true });
    await quiet.list();
    expect(warnings).toEqual([]);
  });

  it("reads the paths a project recorded as places under the root it is being read from", async () => {
    // The learning-data root moves: the desktop shell keeps it in apps/backend during development and under
    // userData once packaged, migrating the whole directory across on the first packaged launch. These paths are
    // stored absolute, so every one of them then names a location that no longer exists.
    //
    // Measured on a real project at a vanished old root: 0 of 6 images and 0 of 6 clips resolved. That does not
    // read as an error anywhere — `generated_images` is what "this scene is already made" is decided from, so
    // six images would simply have been bought again, and the merge would have found no clips to join.
    //
    // Both roots are laid out the way the app lays them out, `<learning data>/projects`, because that is what
    // makes the relocation possible: the migration renames the directory above, and the shape below it is what
    // the stored path can still be recognised by.
    const oldProjects = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), "old-install-")), "learning_data", "projects");
    const newProjects = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), "new-install-")), "learning_data", "projects");
    const moved = new LocalProjectRepository(newProjects);

    const stored = createStoredProject("moved", "topic", "2026-08-21T00:00:00.000Z");
    stored.generated_images = [1, 2].map((scene) => path.join(oldProjects, "moved", "images", `scene${scene}.png`));
    stored.generated_video_paths = [path.join(oldProjects, "moved", "videos", "runway", "scene1.mp4")];
    stored.final_video_path = path.join(oldProjects, "moved", "videos", "final", "final.mp4");
    stored.video_generation_records = [{ scene_number: 1, status: "succeeded", output_path: path.join(oldProjects, "moved", "videos", "runway", "scene1.mp4") }];
    await moved.create(stored);
    // Put the bytes where the move would have left them — same relative place, new root.
    await fsPromises.mkdir(path.join(newProjects, "moved", "images"), { recursive: true });
    for (const scene of [1, 2]) await fsPromises.writeFile(path.join(newProjects, "moved", "images", `scene${scene}.png`), "png");

    const read = await moved.findById("moved");

    for (const image of read.generated_images) {
      expect(image.startsWith(newProjects)).toBe(true);
      expect(await fsPromises.readFile(image, "utf8")).toBe("png");
    }
    expect(read.generated_video_paths[0]).toBe(path.join(newProjects, "moved", "videos", "runway", "scene1.mp4"));
    expect(read.final_video_path).toBe(path.join(newProjects, "moved", "videos", "final", "final.mp4"));
    expect((read.video_generation_records[0] as { output_path: string }).output_path).toBe(path.join(newProjects, "moved", "videos", "runway", "scene1.mp4"));

    // Written back on the next save, so the file heals once instead of being re-derived on every read forever.
    await moved.save(read);
    const raw = JSON.parse(await fsPromises.readFile(path.join(newProjects, "moved", "project.json"), "utf8")) as { generated_images: string[] };
    expect(raw.generated_images[0]!.startsWith(newProjects)).toBe(true);
  });

  it("leaves a recorded path that never named a project root exactly as it was", async () => {
    // The counterpart that keeps the relocation from inventing a location. Only a path that names somewhere
    // inside a learning-data root is moved, and only from its own `projects/` segment onward — anything else has
    // to come back untouched, so a caller can still tell "this file is gone" from "this file moved with the root".
    const projectsRoot = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), "untouched-")), "learning_data", "projects");
    const repositoryHere = new LocalProjectRepository(projectsRoot);
    const outside = path.join(os.tmpdir(), "somewhere-else", "a-person-put-this-here.png");
    const stored = createStoredProject("elsewhere", "topic", "2026-08-21T00:00:00.000Z");
    stored.generated_images = [outside];
    await repositoryHere.create(stored);

    expect((await repositoryHere.findById("elsewhere")).generated_images[0]).toBe(outside);
  });


  it("relocates from the innermost matching segment when the old install itself lived inside a folder called projects", async () => {
    // Not contrived: people keep their work under a folder named `projects`, and the app's own root then ends in
    // a second one — `.../projects/ai-studio/learning_data/projects/<id>/...`. Anchoring on the first match
    // rebuilds everything from the outer one and produces a path that names nothing, silently, because the
    // relocation deliberately does not check that the file exists.
    //
    // Measured: without this case, an injection that scanned front-to-back stayed green — the rule was a claim
    // in a comment and nothing held it.
    const oldProjects = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), "nested-")), "projects", "ai-studio", "learning_data", "projects");
    const newProjects = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), "new-nested-")), "learning_data", "projects");
    const moved = new LocalProjectRepository(newProjects);

    const stored = createStoredProject("nested", "topic", "2026-08-21T00:00:00.000Z");
    stored.generated_images = [path.join(oldProjects, "nested", "images", "scene1.png")];
    await moved.create(stored);

    expect((await moved.findById("nested")).generated_images[0]).toBe(path.join(newProjects, "nested", "images", "scene1.png"));
  });


  it("relocates the linked previous scene's image, which a paid Scene 1 generation reads back as a Reference", async () => {
    // The one field of this kind that does not live in a top-level array, and the reason it was missed when this
    // relocation was first written. A stale value is dropped by a `stat` that simply fails — it is not counted as
    // an omitted reference either, because a reference that never resolves was never going to be sent — so the
    // scene is bought without the continuity image the person deliberately chose, and nothing says so.
    const oldProjects = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), "old-link-")), "learning_data", "projects");
    const newProjects = path.join(await fsPromises.mkdtemp(path.join(os.tmpdir(), "new-link-")), "learning_data", "projects");
    const moved = new LocalProjectRepository(newProjects);

    const stored = createStoredProject("linked", "topic", "2026-08-21T00:00:00.000Z");
    stored.lore_context = {
      ...stored.lore_context,
      previous_scene_link: {
        source_kind: "short_project", user_selected: true, project_id: "earlier", project_name: "앞 이야기",
        label: "6번 장면", scene_number: 6, story_context: "이어지는 장면",
        image_path: path.join(oldProjects, "earlier", "images", "scene6.png"),
      },
    };
    await moved.create(stored);

    const link = (await moved.findById("linked")).lore_context.previous_scene_link as { image_path: string; project_name: string };
    expect(link.image_path).toBe(path.join(newProjects, "earlier", "images", "scene6.png"));
    expect(link.project_name).toBe("앞 이야기"); // the rest of the link is carried across untouched
  });

});
