import type { Project, ProjectSummary, SceneNumber } from "./domain.js";

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CreateProjectRequest { projectId: string; topic: string; }
export interface CreateProjectResponse { project: Project; }
export interface ListProjectsResponse { projects: ProjectSummary[]; }
export interface GetProjectResponse { project: Project; }

export type ProviderCredentialKind = "openai" | "runway";

export interface ProviderCredentialStatus {
  provider: ProviderCredentialKind;
  configured: boolean;
  connected: boolean;
  maskedValue: string | null;
}

export interface GetProviderSettingsResponse { providers: ProviderCredentialStatus[]; }
export interface SaveProviderCredentialRequest { value: string; }
export interface SaveProviderCredentialResponse { provider: ProviderCredentialStatus; }
export interface SetProviderConnectionResponse { provider: ProviderCredentialStatus; }

export interface VideoScenePreview {
  sceneNumber: SceneNumber;
  prompt: string;
  imagePath: string;
  estimatedCostUsd: number;
}

export interface BudgetPreview {
  monthlyLimitUsd: number;
  spentUsd: number;
  remainingUsd: number;
  estimatedRequestCostUsd: number;
  canSpend: boolean;
}

export interface VideoGenerationPreviewResponse {
  confirmationId: string;
  model: "gen4_turbo";
  ratio: "720:1280" | "1280:720";
  sceneCount: 6;
  durationSecondsPerScene: 5;
  executionMode: "sequential";
  audioEnabled: false;
  continuityStrength: "low" | "normal" | "high";
  maximumProviderCalls: number;
  scenes: VideoScenePreview[];
  budget: BudgetPreview;
}

export interface StartVideoGenerationRequest {
  confirmationId: string;
  userRequestId: string;
  approved: true;
  prompts: Array<{ sceneNumber: SceneNumber; prompt: string }>;
}

export interface StartVideoGenerationResponse {
  jobId: string;
  acceptedSceneNumbers: SceneNumber[];
}

export interface GenerationProgressResponse {
  jobId: string;
  status: "created" | "running" | "succeeded" | "failed" | "interrupted";
  currentSceneNumber?: SceneNumber;
  completedSceneNumbers: SceneNumber[];
  failedSceneNumbers: SceneNumber[];
}

export const API_ROUTES = {
  health: "/health",
  projects: "/projects",
  project: (projectId: string) => `/projects/${projectId}`,
  providerSettings: "/settings/providers",
  providerCredential: (provider: ProviderCredentialKind) =>
    `/settings/providers/${provider}/credential`,
  providerDisconnect: (provider: ProviderCredentialKind) =>
    `/settings/providers/${provider}/disconnect`,
  providerReconnect: (provider: ProviderCredentialKind) =>
    `/settings/providers/${provider}/reconnect`,
  videoPreview: (projectId: string) => `/projects/${projectId}/videos/preview`,
  videoGeneration: (projectId: string) => `/projects/${projectId}/videos/generations`,
  videoProgress: (projectId: string, jobId: string) => `/projects/${projectId}/videos/generations/${jobId}`,
} as const;

export function assertVideoGenerationApproval(request: StartVideoGenerationRequest): void {
  if (request.approved !== true) {
    throw new Error("Explicit video-generation approval is required.");
  }
  if (!request.confirmationId.trim() || !request.userRequestId.trim()) {
    throw new Error("Confirmation and unique user request IDs are required.");
  }
  if (request.prompts.length !== 6) {
    throw new Error("Six approved Runway prompts are required.");
  }
  request.prompts.forEach((item, index) => {
    if (item.sceneNumber !== index + 1 || !item.prompt.trim()) {
      throw new Error("Approved prompts must cover scenes 1 through 6 in order.");
    }
  });
}
