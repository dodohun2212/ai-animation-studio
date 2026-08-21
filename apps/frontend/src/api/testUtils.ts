import { WorkflowState, type Project, type ProviderCredentialStatus } from "@ai-animation-studio/shared";

/** Minimal fake `Response` for mocking `fetch` in tests — no real network involved. */
export function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

/** Simulates a response whose body is not valid JSON. */
export function nonJsonResponse(status: number): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async (): Promise<unknown> => {
      throw new SyntaxError("Unexpected token in JSON");
    },
  } as Response;
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "sample_project",
    topic: "우주를 여행하는 고양이",
    projectType: "short_project",
    workflowState: WorkflowState.Ready,
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    scenes: [],
    warnings: [],
    errors: [],
    ...overrides,
  };
}

export function makeProviderStatus(overrides: Partial<ProviderCredentialStatus> = {}): ProviderCredentialStatus {
  return {
    provider: "openai",
    configured: false,
    connected: false,
    maskedValue: null,
    ...overrides,
  };
}
