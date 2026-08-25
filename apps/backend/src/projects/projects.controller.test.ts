import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { HttpStatus } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiError } from "@ai-animation-studio/shared";

import { ProjectApiException } from "./project-api.error.js";
import { ProjectsController } from "./projects.controller.js";
import { LocalProjectRepository } from "./projects.repository.js";
import { ProjectsService } from "./projects.service.js";

async function expectApiError(
  action: Promise<unknown>,
  status: HttpStatus,
  code: string,
): Promise<void> {
  try {
    await action;
    throw new Error("Expected the action to reject.");
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectApiException);
    const exception = error as ProjectApiException;
    expect(exception.getStatus()).toBe(status);
    expect((exception.getResponse() as ApiError).code).toBe(code);
  }
}

describe("ProjectsController", () => {
  let root: string;
  let controller: ProjectsController;

  beforeEach(async () => {
    root = await fsPromises.mkdtemp(path.join(os.tmpdir(), "projects-controller-test-"));
    controller = new ProjectsController(new ProjectsService(new LocalProjectRepository(root)));
  });

  afterEach(async () => {
    await fsPromises.rm(root, { recursive: true, force: true });
  });

  it("POST /projects creates a project and returns it", async () => {
    const response = await controller.create({ projectId: "sample_project", topic: "우주를 여행하는 고양이" });
    expect(response.project.id).toBe("sample_project");
    expect(response.project.topic).toBe("우주를 여행하는 고양이");
  });

  it("GET /projects returns an empty array for an empty store", async () => {
    expect(await controller.list()).toEqual({ projects: [] });
  });

  it("GET /projects/:projectId reopens a created project", async () => {
    await controller.create({ projectId: "sample_project", topic: "topic" });
    const response = await controller.getOne("sample_project");
    expect(response.project.id).toBe("sample_project");
  });

  it("maps a missing project to 404 PROJECT_NOT_FOUND", async () => {
    await expectApiError(controller.getOne("missing_project"), HttpStatus.NOT_FOUND, "PROJECT_NOT_FOUND");
  });

  it("maps a duplicate project to 409 PROJECT_ALREADY_EXISTS", async () => {
    await controller.create({ projectId: "dup_project", topic: "topic" });
    await expectApiError(
      controller.create({ projectId: "dup_project", topic: "topic again" }),
      HttpStatus.CONFLICT,
      "PROJECT_ALREADY_EXISTS",
    );
  });

  it("maps an unsafe project ID to 400 UNSAFE_PROJECT_ID", async () => {
    await expectApiError(
      controller.create({ projectId: "../escape", topic: "topic" }),
      HttpStatus.BAD_REQUEST,
      "UNSAFE_PROJECT_ID",
    );
    await expectApiError(controller.getOne("../escape"), HttpStatus.BAD_REQUEST, "UNSAFE_PROJECT_ID");
  });

  it("maps an empty request field to 400 INVALID_REQUEST", async () => {
    await expectApiError(
      controller.create({ projectId: "", topic: "topic" }),
      HttpStatus.BAD_REQUEST,
      "INVALID_REQUEST",
    );
  });

  it("gets and updates the short-project Wizard settings", async () => {
    await controller.create({ projectId: "wizard_project", topic: "topic" });
    expect((await controller.getSettings("wizard_project")).settings.durationSeconds).toBe(30);

    const response = await controller.updateSettings("wizard_project", {
      settings: {
        projectName: "별의 지도", topic: "별을 찾는 아이", genre: "판타지", mood: "따뜻함",
        character: "아이", lore: "별의 세계", fullStory: "별을 찾는다.",
        sceneCount: 6, clipDurationSeconds: 5, additionalNotes: "", styleNotes: { aspect: "16:9" },
        narrationEnabled: false,
      },
    });
    expect(response.project.topic).toBe("별을 찾는 아이");
    expect(response.settings.projectName).toBe("별의 지도");
  });

  it("maps invalid Wizard settings to 400 INVALID_REQUEST", async () => {
    await controller.create({ projectId: "wizard_project", topic: "topic" });
    await expectApiError(
      controller.updateSettings("wizard_project", { settings: { unexpected: true } } as never),
      HttpStatus.BAD_REQUEST,
      "INVALID_REQUEST",
    );
  });

  it("maps corrupt JSON to a 500 PROJECT_JSON_MALFORMED API error", async () => {
    await fsPromises.mkdir(path.join(root, "broken"), { recursive: true });
    await fsPromises.writeFile(path.join(root, "broken", "project.json"), "{not valid", "utf8");
    await expectApiError(
      controller.getOne("broken"),
      HttpStatus.INTERNAL_SERVER_ERROR,
      "PROJECT_JSON_MALFORMED",
    );
  });

  it("maps an unknown stored field to a 500 PROJECT_DATA_INVALID API error", async () => {
    await controller.create({ projectId: "has_unknown", topic: "topic" });
    const file = path.join(root, "has_unknown", "project.json");
    const stored = JSON.parse(await fsPromises.readFile(file, "utf8")) as Record<string, unknown>;
    stored.totally_unexpected_field = true;
    await fsPromises.writeFile(file, JSON.stringify(stored, null, 2), "utf8");

    await expectApiError(
      controller.getOne("has_unknown"),
      HttpStatus.INTERNAL_SERVER_ERROR,
      "PROJECT_DATA_INVALID",
    );
  });
});
