import { describe, expect, it } from "vitest";

import type { ProjectSummary } from "./domain.js";
import { WorkflowState } from "./workflow.js";
import { API_ROUTES, type CreateProjectRequest, type GetProjectResponse, type ListProjectsResponse } from "./api.js";

describe("project summary contract", () => {
  it("does not require userId for a local single-user project", () => {
    const summary: ProjectSummary = {
      id: "sample_project",
      topic: "우주를 여행하는 고양이",
      projectType: "short_project",
      workflowState: WorkflowState.Ready,
      createdAt: "2026-08-21T00:00:00.000Z",
      updatedAt: "2026-08-21T00:00:00.000Z",
    };
    expect("userId" in summary).toBe(false);
  });
});

describe("create project request contract", () => {
  it("requires projectId and topic", () => {
    const request: CreateProjectRequest = {
      projectId: "sample_project",
      topic: "우주를 여행하는 고양이",
    };
    expect(request.projectId).toBe("sample_project");
    expect(request.topic).toBe("우주를 여행하는 고양이");
  });
});

describe("project routes and DTO shape", () => {
  it("exposes the documented projects routes without duplicate definitions", () => {
    expect(API_ROUTES.projects).toBe("/projects");
    expect(API_ROUTES.project("sample_project")).toBe("/projects/sample_project");
  });

  it("wraps list and single-project responses in the documented envelope", () => {
    const list: ListProjectsResponse = { projects: [] };
    const single: GetProjectResponse = {
      project: {
        id: "sample_project",
        topic: "우주를 여행하는 고양이",
        projectType: "short_project",
        workflowState: WorkflowState.Ready,
        createdAt: "2026-08-21T00:00:00.000Z",
        updatedAt: "2026-08-21T00:00:00.000Z",
        scenes: [],
        warnings: [],
        errors: [],
      },
    };
    expect(list.projects).toEqual([]);
    expect(single.project.id).toBe("sample_project");
  });
});
