import type { Project, ProjectSummary, SceneNumber } from "./domain.js";
import type { Asset, AssetOwnership, AssetType } from "./asset.js";
import type {
  ApproveProjectAssetMappingReviewRequest,
  BeginProjectAssetMappingReviewRequest,
  CreateProjectAssetMappingRequest,
  UpdateProjectAssetMappingRequest,
} from "./mapping.js";

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface CreateProjectRequest { projectId: string; topic: string; }
export interface CreateProjectResponse { project: Project; }
export interface ListProjectsResponse { projects: ProjectSummary[]; }
export interface GetProjectResponse { project: Project; }

/**
 * The editable, non-provider portion of Python's short-project Wizard.
 * Asset selections remain in the project asset-mapping contract.
 */
export interface ShortProjectStyleNotes {
  visualStyle?: string;
  color?: string;
  lighting?: string;
  camera?: string;
  dialogue?: string;
  avoid?: string;
  aspect?: string;
}

export interface ShortProjectSettings {
  projectName: string;
  topic: string;
  genre: string;
  mood: string;
  character: string;
  lore: string;
  fullStory: string;
  durationSeconds: number;
  sceneCount: 6;
  additionalNotes: string;
  styleNotes: ShortProjectStyleNotes;
}

export interface GetProjectSettingsResponse { settings: ShortProjectSettings; }
export interface UpdateProjectSettingsRequest { settings: ShortProjectSettings; }
export interface UpdateProjectSettingsResponse { project: Project; settings: ShortProjectSettings; }

/** Exact local Story request text shown before any provider submission. */
export interface StoryPromptPreview {
  projectId: string;
  originalPrompt: string;
  originalPromptSha256: string;
  characterCount: number;
  sceneCount: 6;
}

export interface CreateStoryPromptPreviewResponse { preview: StoryPromptPreview; }

/** The user-authored final text must be explicitly approved before fake submission. */
export interface ApproveStoryPromptRequest {
  originalPromptSha256: string;
  prompt: string;
  approved: true;
}

export interface ApproveStoryPromptResponse {
  project: Project;
  originalPrompt: string;
  prompt: string;
  promptSha256: string;
  modified: boolean;
  approvedAt: string;
}

/** Explicit approval for the provider-free local image-generation adapter. */
export interface StartImageGenerationRequest { approved: true; }

export interface StartImageGenerationResponse {
  project: Project;
  generatedSceneNumbers: SceneNumber[];
  reusedSceneNumbers: SceneNumber[];
}

/** Provider-free persisted decision for one generated short-project image. */
export interface ImageReview {
  sceneNumber: SceneNumber;
  status: "pending" | "approved";
  updatedAt: string;
}

export interface GetImageReviewResponse {
  project: Project;
  reviews: ImageReview[];
}

/** A review action is deliberately explicit and cannot be inferred from navigation. */
export interface ApproveImageReviewRequest { approved: true; }

export interface ApproveImageReviewResponse {
  project: Project;
  reviews: ImageReview[];
}

/** Explicit, provider-free replacement of one already generated image. */
export interface RegenerateImageReviewRequest { approved: true; }

export interface RegenerateImageReviewResponse {
  project: Project;
  reviews: ImageReview[];
  sceneNumber: SceneNumber;
}

/** A local, non-submitting Runway preflight row for one approved image. */
export interface VideoPromptPreview {
  sceneNumber: SceneNumber;
  prompt: string;
  model: "gen4_turbo";
  ratio: "720:1280" | "1280:720";
  durationSeconds: 5;
  estimatedCostUsd: number;
}

/** Previewing prompts and cost never creates a provider task or writes project data. */
export interface GetVideoPromptPreviewResponse {
  previews: VideoPromptPreview[];
  /** Opaque preflight fingerprint required by a later explicit submission. */
  confirmationId?: string;
  /** Local guard information only; previewing never reserves budget or calls a provider. */
  maximumProviderCalls?: number;
  budget?: BudgetPreview;
}

export interface ListAssetsQuery {
  query?: string;
  assetType?: AssetType;
}

export interface ListAssetsResponse { assets: Asset[]; }

export interface GetAssetResponse {
  asset: Asset;
  usageProjectIds: string[];
  ownership: AssetOwnership;
  canDeleteOwnedFile: boolean;
}

/** Metadata part submitted alongside the image file in multipart/form-data. */
export interface CreateAssetMetadata {
  assetType: AssetType;
  displayName: string;
  description?: string;
  tags?: string[];
  aliases?: string[];
  approved?: boolean;
  faceBaseline?: boolean;
  characterKey?: string | null;
  notes?: string;
}

export interface CreateAssetResponse { asset: Asset; }

/** Fields supported by Python's update_metadata operation. */
export interface UpdateAssetMetadataRequest {
  assetType?: AssetType;
  displayName?: string;
  description?: string;
  tags?: string[];
  aliases?: string[];
  approved?: boolean;
  faceBaseline?: boolean;
  characterKey?: string | null;
  notes?: string;
  role?: string;
}

export interface UpdateAssetResponse { asset: Asset; }

export interface DeleteAssetResponse {
  assetId: string;
  deletedOwnedFile: boolean;
}

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
  projectSettings: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/settings`,
  storyPromptPreview: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/story/preview`,
  storyPromptApproval: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/story/approval`,
  imageGeneration: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/images/generations`,
  imageReview: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/images/review`,
  imageReviewApproval: (projectId: string, sceneNumber: SceneNumber) =>
    `/projects/${encodeURIComponent(projectId)}/images/review/${sceneNumber}/approve`,
  imageReviewRegeneration: (projectId: string, sceneNumber: SceneNumber) =>
    `/projects/${encodeURIComponent(projectId)}/images/review/${sceneNumber}/regenerate`,
  assets: "/assets",
  asset: (assetId: string) => `/assets/${encodeURIComponent(assetId)}`,
  assetContent: (assetId: string) => `/assets/${encodeURIComponent(assetId)}/content`,
  providerSettings: "/settings/providers",
  providerCredential: (provider: ProviderCredentialKind) =>
    `/settings/providers/${provider}/credential`,
  providerDisconnect: (provider: ProviderCredentialKind) =>
    `/settings/providers/${provider}/disconnect`,
  providerReconnect: (provider: ProviderCredentialKind) =>
    `/settings/providers/${provider}/reconnect`,
  videoPreview: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/videos/preview`,
  videoGeneration: (projectId: string) => `/projects/${projectId}/videos/generations`,
  videoProgress: (projectId: string, jobId: string) => `/projects/${projectId}/videos/generations/${jobId}`,
  projectAssetMappings: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/assets/mappings`,
  projectAssetMapping: (projectId: string, mappingId: string) =>
    `/projects/${encodeURIComponent(projectId)}/assets/mappings/${encodeURIComponent(mappingId)}`,
  projectAssetMappingReview: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/assets/mapping-review`,
  projectAssetMappingReviewApprove: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/assets/mapping-review/approve`,
  projectAssetMappingSnapshot: (projectId: string, mappingId: string) =>
    `/projects/${encodeURIComponent(projectId)}/assets/mappings/${encodeURIComponent(mappingId)}/snapshot`,
} as const;

export type {
  ApproveProjectAssetMappingReviewRequest,
  BeginProjectAssetMappingReviewRequest,
  CreateProjectAssetMappingRequest,
  UpdateProjectAssetMappingRequest,
};

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
