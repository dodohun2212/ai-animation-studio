import {
  API_ROUTES,
  WorkflowState,
  type Asset,
  type LongEpisodeOutline,
  type LongProject,
  type LongProjectSettings,
  type LongProjectSummary,
  type Project,
  type ProjectAssetMapping,
  type ProjectAssetMappingReview,
  type ProviderCredentialStatus,
} from "@ai-animation-studio/shared";

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
    aspectRatio: "9:16",
    narrationAvailable: false,
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

export function makeAsset(overrides: Partial<Asset> = {}): Asset {
  const assetId = overrides.assetId ?? "ASSET-GENERAL-000000000001";
  const imageAvailable = overrides.imageAvailable ?? true;
  return {
    assetId,
    assetType: "general_reference",
    displayName: "샘플 에셋",
    description: "설명",
    originalFilename: "sample.png",
    contentSha256: "a".repeat(64),
    imageAvailable,
    contentUrl: imageAvailable ? API_ROUTES.assetContent(assetId) : null,
    tags: [],
    aliases: [],
    enabled: true,
    approved: false,
    faceBaseline: false,
    characterKey: null,
    version: 1,
    versions: [],
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    notes: "",
    legacyAssetIds: [],
    status: "manual",
    sourceProjectId: "_asset_library_manual",
    sourceSceneNumber: null,
    referenceImages: [],
    referenceRoles: [],
    isFolder: false,
    parentFolderId: "",
    childAssetIds: [],
    thumbnailAssetId: "",
    role: "",
    sortOrder: 0,
    ...overrides,
  };
}

/**
 * A Folder Asset that satisfies the frontend's own `isAsset()` folder invariant (assetsApi.ts): no digest, no
 * image, no versions, no reference images. `makeAsset({ isFolder: true })` alone does NOT — it keeps the
 * non-folder defaults (a real digest, `imageAvailable: true`), producing an Asset the response validator
 * rejects as malformed, which surfaces in a test as a confusing CLIENT_MALFORMED_RESPONSE banner instead of
 * the data you thought you stubbed. Use this whenever a fixture needs to be a Folder.
 */
export function makeAssetFolder(overrides: Partial<Asset> = {}): Asset {
  return makeAsset({
    isFolder: true,
    imageAvailable: false,
    contentSha256: "",
    contentUrl: null,
    versions: [],
    referenceImages: [],
    ...overrides,
  });
}

export function makeMapping(overrides: Partial<ProjectAssetMapping> = {}): ProjectAssetMapping {
  return {
    mappingId: "MAP-000000000001",
    projectId: "sample_project",
    assetId: "ASSET-GENERAL-000000000001",
    enabled: true,
    usageRole: "character",
    sceneScope: { kind: "all" },
    assignmentSource: "manual",
    confidence: null,
    matchReason: "manual_assignment",
    status: "confirmed",
    userConfirmed: true,
    versionPolicy: "pinned_version",
    pinnedVersion: 1,
    candidateOnly: false,
    createdAt: "2026-08-22T00:00:00.000Z",
    updatedAt: "2026-08-22T00:00:00.000Z",
    snapshot: null,
    selectedChildAssetIds: [],
    ...overrides,
  };
}

export function makeLongProjectSettings(overrides: Partial<LongProjectSettings> = {}): LongProjectSettings {
  return {
    title: "우주 방랑자",
    logline: "떠도는 항해사가 고향 별을 되찾는다.",
    overview: "",
    genre: "SF",
    tone: "진지함",
    theme: "귀환",
    episodeCount: 3,
    episodeDurationSeconds: 30,
    sceneCount: 6,
    clipDurationSeconds: 5,
    aspectRatio: "9:16",
    audience: "",
    notes: "",
    startingState: "",
    midpoint: "",
    endingDirection: "",
    storyFlowSummary: "",
    narrationEnabled: false,
    subtitlesEnabled: false,
    ...overrides,
  };
}

export function makeLongProjectSummary(overrides: Partial<LongProjectSummary> = {}): LongProjectSummary {
  return {
    id: "long_sample",
    title: "우주 방랑자",
    logline: "떠도는 항해사가 고향 별을 되찾는다.",
    episodeCount: 3,
    outlineStatus: "planned",
    createdAt: "2026-08-21T00:00:00.000Z",
    updatedAt: "2026-08-21T00:00:00.000Z",
    ...overrides,
  };
}

export function makeLongEpisodeOutline(overrides: Partial<LongEpisodeOutline> = {}): LongEpisodeOutline {
  const episodeNumber = overrides.episodeNumber ?? 1;
  return {
    episodeNumber,
    title: `Episode ${episodeNumber}`,
    summary: "",
    mainEvent: "",
    conflict: "",
    cliffhanger: "",
    nextEpisodeHook: "",
    status: "planned",
    ...overrides,
  };
}

export function makeLongProject(overrides: Partial<LongProject> = {}): LongProject {
  const summary = makeLongProjectSummary(overrides);
  return {
    ...summary,
    settings: makeLongProjectSettings({
      title: summary.title,
      logline: summary.logline,
      episodeCount: summary.episodeCount,
    }),
    storyBible: { basic: {}, world: {} },
    episodes: Array.from({ length: summary.episodeCount }, (_, index) => makeLongEpisodeOutline({ episodeNumber: index + 1 })),
    ...overrides,
  };
}

export function makeReview(overrides: Partial<ProjectAssetMappingReview> = {}): ProjectAssetMappingReview {
  return {
    projectId: "sample_project",
    mappingRevision: 0,
    scriptRevision: 0,
    scriptFingerprint: "",
    status: "waiting",
    approvedAt: null,
    approvedBy: null,
    textOnlyConfirmed: false,
    legacyConfirmed: false,
    reviewedScenes: [],
    ...overrides,
  };
}
