import { describe, expect, it } from "vitest";

import type { ProjectSummary } from "./domain.js";
import { WorkflowState } from "./workflow.js";
import {
  API_ROUTES,
  type CreateProjectRequest,
  type GetProjectResponse,
  type GetProjectSettingsResponse,
  type ListProjectsResponse,
  type UpdateProjectSettingsRequest,
  type ApproveStoryPromptRequest,
  type CreateStoryPromptPreviewResponse,
  type StartImageGenerationRequest,
  type ApproveImageReviewRequest,
} from "./api.js";

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

  it("keeps the short-project Wizard settings explicit and separate from asset mappings", () => {
    const settings: UpdateProjectSettingsRequest = {
      settings: {
        projectName: "별의 지도",
        topic: "별을 찾는 아이",
        genre: "판타지",
        mood: "따뜻함",
        character: "아이",
        lore: "별이 사라진 세계",
        fullStory: "아이가 별을 되찾는다.",
        sceneCount: 6,
        clipDurationSeconds: 5,
        additionalNotes: "무서운 장면 제외",
        styleNotes: { aspect: "16:9", lighting: "달빛" },
      },
    };
    // durationSeconds is derived server-side (sceneCount * clipDurationSeconds), so the response's full
    // ShortProjectSettings adds it back rather than reusing the request's narrower ShortProjectSettingsInput.
    const response: GetProjectSettingsResponse = { settings: { ...settings.settings, durationSeconds: 30 } };

    expect(API_ROUTES.projectSettings("한글 id")).toBe(
      "/projects/%ED%95%9C%EA%B8%80%20id/settings",
    );
    expect(response.settings.sceneCount).toBe(6);
    expect("assetIds" in response.settings).toBe(false);
  });

  it("requires an explicit approval payload for a provider-free Story prompt preview", () => {
    const preview: CreateStoryPromptPreviewResponse = {
      preview: { projectId: "sample_project", originalPrompt: "exact prompt", originalPromptSha256: "a".repeat(64), characterCount: 12, sceneCount: 6 },
    };
    const approval: ApproveStoryPromptRequest = { originalPromptSha256: preview.preview.originalPromptSha256, prompt: "edited exact prompt", approved: true };
    expect(API_ROUTES.storyPromptPreview("sample project")).toBe("/projects/sample%20project/story/preview");
    expect(API_ROUTES.storyPromptApproval("sample project")).toBe("/projects/sample%20project/story/approval");
    expect(API_ROUTES.storyPromptDraftPreview("sample project")).toBe("/projects/sample%20project/story/draft-preview");
    expect(approval.approved).toBe(true);
  });

  it("requires explicit approval for local image generation", () => {
    const request: StartImageGenerationRequest = { approved: true };
    expect(request.approved).toBe(true);
    expect(API_ROUTES.imageGeneration("sample project")).toBe("/projects/sample%20project/images/generations");
  });

  it("keeps generated-image review decisions explicit and scene-scoped", () => {
    const request: ApproveImageReviewRequest = { approved: true };
    expect(request.approved).toBe(true);
    expect(API_ROUTES.imageReview("sample project")).toBe("/projects/sample%20project/images/review");
    expect(API_ROUTES.imageReviewApproval("sample project", 6)).toBe("/projects/sample%20project/images/review/6/approve");
  });
});
