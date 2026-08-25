import type { Project, ProjectSummary, SceneNumber } from "./domain.js";
import { MAX_SCENE_COUNT, MIN_SCENE_COUNT } from "./domain.js";
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

/** Provider-free, outline-first long-story project contract. */
export interface LongProjectSettings {
  title: string;
  logline: string;
  overview: string;
  genre: string;
  tone: string;
  theme: string;
  episodeCount: number;
  episodeDurationSeconds: number;
  platform: "YouTube Shorts" | "YouTube";
  aspectRatio: "9:16" | "16:9";
  audience: string;
  notes: string;
  startingState: string;
  midpoint: string;
  endingDirection: string;
  storyFlowSummary: string;
}

export interface LongEpisodeOutline {
  episodeNumber: number;
  title: string;
  summary: string;
  mainEvent: string;
  conflict: string;
  cliffhanger: string;
  nextEpisodeHook: string;
  status: LongEpisodeStatus;
}

export type LongEpisodeStatus = "planned" | "outline_ready" | "script_review" | "script_approved" | "waiting_for_asset_mapping_review" | "asset_mapping_approved" | "generating_images" | "images_ready" | "images_review" | "waiting_for_video_confirmation" | "videos_generating" | "videos_ready" | "videos_review" | "videos_approved" | "interrupted" | "rendering" | "completed" | "failed";

export interface LongEpisodeScene {
  number: SceneNumber;
  description: string;
  visualAction: string;
  startMotion: string;
  mainMotion: string;
  endMotion: string;
  shotSize: string;
  cameraAngle: string;
  composition: string;
  lensFeel: string;
  focusSubject: string;
  cameraMotion: string;
  environmentMotion: string;
  motionSpeed: string;
  motionIntensity: string;
  expressionChange: string;
  continuityHint: string;
}

export interface LongEpisodeScript {
  title: string;
  synopsis: string;
  ending: string;
  scenes: LongEpisodeScene[];
}

export interface LongEpisodeDetail extends LongEpisodeOutline {
  approved: boolean;
  scriptRevision: number;
  script?: LongEpisodeScript;
  scriptHistoryCount: number;
}

export interface GetLongEpisodeResponse { episode: LongEpisodeDetail; }
export interface GenerateLongEpisodeScriptRequest { regenerate?: true; }
export interface GenerateLongEpisodeScriptResponse { episode: LongEpisodeDetail; }
export interface UpdateLongEpisodeScriptRequest { script: LongEpisodeScript; }
export interface UpdateLongEpisodeScriptResponse { episode: LongEpisodeDetail; }
export interface ApproveLongEpisodeScriptRequest { approved: true; }
export interface ApproveLongEpisodeScriptResponse { episode: LongEpisodeDetail; }

export interface LongEpisodeAssetMappingCandidate {
  mappingId: string;
  sourceCollection: "basic" | "characters" | "locations" | "props";
  sourceItemId: string;
  assetId: string;
  usageRole: "character" | "background" | "object" | "style";
  versionPolicy: "pinned_version" | "follow_latest" | "snapshot";
  pinnedVersion: number | null;
  episodeScope: { mode: "all" } | { mode: "episode"; episode: number };
  status: "suggested" | "confirmed" | "excluded";
  userConfirmed: boolean;
}

export interface LongEpisodeAssetMappingReview {
  projectId: string;
  episodeNumber: number;
  mappingRevision: number;
  scriptRevision: number;
  scriptFingerprint: string;
  status: "waiting" | "approved";
  textOnlyConfirmed: boolean;
  candidates: LongEpisodeAssetMappingCandidate[];
}

export interface GetLongEpisodeAssetMappingReviewResponse { review: LongEpisodeAssetMappingReview; }
export interface BeginLongEpisodeAssetMappingReviewRequest { textOnlyConfirmed?: boolean; }
export interface BeginLongEpisodeAssetMappingReviewResponse { review: LongEpisodeAssetMappingReview; }
export interface UpdateLongEpisodeAssetMappingRequest { decision: "confirm" | "exclude"; }
export interface UpdateLongEpisodeAssetMappingResponse { mapping: LongEpisodeAssetMappingCandidate; review: LongEpisodeAssetMappingReview; }
export interface ApproveLongEpisodeAssetMappingReviewRequest { approved: true; scriptFingerprint: string; }
export interface ApproveLongEpisodeAssetMappingReviewResponse { review: LongEpisodeAssetMappingReview; episode: LongEpisodeDetail; }

/** Provider-free preview of the Asset IDs automatically selected per Episode scene. */
export interface LongEpisodeAutomaticReferenceSummary {
  candidateAssetIds: string[];
  /** Long Episode is still fixed at exactly six scenes, so this stays a literal-keyed map independent of the now-widened SceneNumber. */
  selectedAssetIdsByScene: Record<1 | 2 | 3 | 4 | 5 | 6, string[]>;
  estimatedImageApiCalls: 6;
}
export interface GetLongEpisodeAutomaticReferenceSummaryResponse { summary: LongEpisodeAutomaticReferenceSummary; }
/** Rebuilds only deterministic automatic scene selections and returns to mapping review. */
export interface RerunLongEpisodeAssetMatchingResponse { review: LongEpisodeAssetMappingReview; episode: LongEpisodeDetail; }

/** Provider-free persisted review decision for one long-story Episode image. */
export interface LongEpisodeImageReview {
  sceneNumber: SceneNumber;
  status: "pending" | "approved";
  updatedAt: string;
}

/** Explicit approval; calls the real OpenAI image adapter when a credential and budget ledger are connected, the same as the short-project path, and falls back to the local fake adapter otherwise. */
export interface StartLongEpisodeImageGenerationRequest { approved: true; }
export interface StartLongEpisodeImageGenerationResponse {
  episode: LongEpisodeDetail;
  generatedSceneNumbers: SceneNumber[];
  reusedSceneNumbers: SceneNumber[];
  /** Same meaning and scope as StartImageGenerationResponse.budget (see that field's doc comment). */
  budget?: BudgetPreview;
}
export interface GetLongEpisodeImageReviewResponse {
  episode: LongEpisodeDetail;
  reviews: LongEpisodeImageReview[];
  /** Same meaning and scope as StartImageGenerationResponse.budget (see that field's doc comment). */
  budget?: BudgetPreview;
}
export interface ApproveLongEpisodeImageReviewRequest { approved: true; }
export interface ApproveLongEpisodeImageReviewResponse extends GetLongEpisodeImageReviewResponse {}
export interface RegenerateLongEpisodeImageReviewRequest { approved: true; }
export interface RegenerateLongEpisodeImageReviewResponse extends GetLongEpisodeImageReviewResponse {
  sceneNumber: SceneNumber;
  /** Same meaning as RegenerateImageReviewResponse.retryEstimate (see that field's doc comment). */
  retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview };
}

/** A provider-free Episode video preflight; internal image paths are never exposed. */
export interface LongEpisodeVideoPreview {
  sceneNumber: SceneNumber;
  prompt: string;
  estimatedCostUsd: number;
}
export interface GetLongEpisodeVideoPreviewResponse {
  confirmationId: string;
  model: "gen4_turbo";
  ratio: "720:1280" | "1280:720";
  durationSecondsPerScene: 5;
  executionMode: "sequential";
  scenes: LongEpisodeVideoPreview[];
  estimatedCostUsd: number;
  /** Local guard information only; previewing never reserves budget or calls a provider. */
  maximumProviderCalls?: number;
  budget?: BudgetPreview;
}
export interface StartLongEpisodeVideoGenerationRequest {
  confirmationId: string;
  userRequestId: string;
  approved: true;
  prompts: Array<{ sceneNumber: SceneNumber; prompt: string }>;
}
export interface StartLongEpisodeVideoGenerationResponse { jobId: string; acceptedSceneNumbers: SceneNumber[]; episode: LongEpisodeDetail; }
export interface LongEpisodeVideoProgress {
  jobId: string;
  status: "created" | "running" | "succeeded" | "failed" | "interrupted";
  currentSceneNumber?: SceneNumber;
  completedSceneNumbers: SceneNumber[];
  failedSceneNumbers: SceneNumber[];
  episode: LongEpisodeDetail;
  /** Same meaning and scope as GenerationProgressResponse.sceneErrors (see that field's doc comment). */
  sceneErrors?: Record<SceneNumber, string>;
  /** Same meaning and scope as GenerationProgressResponse.retryEstimate (see that field's doc comment). */
  retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview };
}
/** costUsd: actual cost recorded for this scene's video across every attempt, including past regenerations; absent when nothing has been recorded. */
export interface LongEpisodeVideoReview { sceneNumber: SceneNumber; status: "pending" | "approved"; updatedAt: string; costUsd?: number; }
export interface GetLongEpisodeVideoReviewResponse { episode: LongEpisodeDetail; reviews: LongEpisodeVideoReview[]; }
export interface ApproveLongEpisodeVideoReviewRequest { approved: true; }
export interface ApproveLongEpisodeVideoReviewResponse extends GetLongEpisodeVideoReviewResponse {}
export interface RegenerateLongEpisodeVideoResponse extends LongEpisodeVideoProgress { regeneratedSceneNumbers: SceneNumber[]; }

/** Final Episode render has a fixed relative output and never exposes an absolute path. */
export interface MergeLongEpisodeVideosResponse {
  episode: LongEpisodeDetail;
  finalVideoPath: "videos/final/instagram_reel.mp4";
}

/** User-reviewed facts from a completed Episode, persisted before the next Episode is drafted. */
export interface LongEpisodeContinuityMemory {
  episodeNumber: number;
  episodeSummary: string;
  events: string[];
  appearedCharacterIds: string[];
  characterChanges: Array<Record<string, unknown>>;
  appearedLocationIds: string[];
  itemChanges: Array<Record<string, unknown>>;
  resolvedConflicts: string[];
  newConflicts: string[];
  revealedSecretIds: string[];
  remainingSecretIds: string[];
  newForeshadowingIds: string[];
  resolvedForeshadowingIds: string[];
  nextActions: string[];
  timeElapsed: string;
  worldChanges: string[];
  userEdits: string;
  updatedAt: string;
}
export interface GetLongEpisodeContinuityResponse { memory: LongEpisodeContinuityMemory | null; }
export interface SaveLongEpisodeContinuityRequest { memory: Omit<LongEpisodeContinuityMemory, "episodeNumber" | "updatedAt">; }
export interface SaveLongEpisodeContinuityResponse { memory: LongEpisodeContinuityMemory; nextEpisode: LongEpisodeDetail | null; }

/** Read-only integrity report for advanced Story Bible links; it never alters stored data. */
export interface LongStoryBibleRelationshipIssue {
  collection: LongStoryBibleCollection;
  itemId: string;
  field: "locationId" | "ownerId" | "ownedItemIds" | "characterIds" | "locationIds";
  missingIds: string[];
}
export interface GetLongStoryBibleRelationshipAuditResponse { issues: LongStoryBibleRelationshipIssue[]; }
export interface SearchLongStoryBibleItemsResponse { items: LongStoryBibleItem[]; }
export interface DuplicateLongStoryBibleItemResponse { item: LongStoryBibleItem; storyBible: LongStoryBible; }
export interface LongEpisodeContinuityReference {
  previousEpisodeNumber: number;
  sourceSceneNumber: 6;
  available: boolean;
}
export interface GetLongEpisodeContinuityReferenceResponse { reference: LongEpisodeContinuityReference | null; }
/** Archive is a recoverable local lifecycle action and requires the exact project confirmation text. */
export interface ArchiveProjectRequest { confirmation: string; }
export interface ArchiveProjectResponse { archivedProjectId: string; }
/** A short project currently sitting in the recoverable archive, listed on the "보관함" (Archive) screen. */
export interface ArchivedProjectSummary extends ProjectSummary { archivedAt: string; }
export interface ListArchivedProjectsResponse { projects: ArchivedProjectSummary[]; }
export interface RestoreProjectResponse { restoredProjectId: string; }
/** Permanently and irreversibly deletes an archived project's data from disk; only ever operates on a project already in the recoverable archive, never an active one. Requires the exact confirmation text, same convention as {@link ArchiveProjectRequest}. */
export interface DeleteArchivedProjectRequest { confirmation: string; }
export interface DeleteArchivedProjectResponse { deletedProjectId: string; }
/**
 * Reorders a Folder's already-linked children and selects its representative image. Despite the name, this
 * works for a Folder of any `AssetType`, not only `"character"` — kept as-is to avoid an unrelated rename.
 */
export interface CharacterFolderReferenceSetRequest { childAssetIds: string[]; thumbnailAssetId: string; }
export interface CharacterFolderReferenceSetResponse { folder: Asset; children: Asset[]; }

export interface LongProjectSummary {
  id: string;
  title: string;
  logline: string;
  episodeCount: number;
  outlineStatus: "planned" | "outline_ready";
  createdAt: string;
  updatedAt: string;
}

export interface LongProject extends LongProjectSummary {
  settings: LongProjectSettings;
  storyBible: { basic: Record<string, unknown>; world: Record<string, unknown> };
  episodes: LongEpisodeOutline[];
}

export interface CreateLongProjectRequest { projectId: string; settings: LongProjectSettings; }
export interface CreateLongProjectResponse { project: LongProject; }
export interface ListLongProjectsResponse { projects: LongProjectSummary[]; }
/** A long project currently sitting in the recoverable archive, listed on the "보관함" (Archive) screen. */
export interface ArchivedLongProjectSummary extends LongProjectSummary { archivedAt: string; }
export interface ListArchivedLongProjectsResponse { projects: ArchivedLongProjectSummary[]; }
export interface GetLongProjectResponse { project: LongProject; }
export interface GetLongProjectSettingsResponse { settings: LongProjectSettings; }
export interface UpdateLongProjectSettingsRequest { settings: LongProjectSettings; }
export interface UpdateLongProjectSettingsResponse { project: LongProject; }
export interface LongProjectOutlinePromptPreview { projectId: string; prompt: string; promptSha256: string; episodeCount: number; }
export interface CreateLongProjectOutlinePreviewResponse { preview: LongProjectOutlinePromptPreview; }
export interface ApproveLongProjectOutlineRequest { promptSha256: string; prompt: string; approved: true; }
export interface ApproveLongProjectOutlineResponse { project: LongProject; approvedAt: string; promptSha256: string; modified: boolean; }

/**
 * Timeline edits are limited to draft-only Episodes.  A removed Episode is
 * recoverably archived on disk rather than deleted in place.
 */
export interface AddLongEpisodeRequest { title?: string; }
export interface AddLongEpisodeResponse { project: LongProject; episode: LongEpisodeOutline; }
export interface DuplicateLongEpisodeResponse { project: LongProject; episode: LongEpisodeOutline; }
export interface ArchiveLongEpisodeRequest { approved: true; }
export interface ArchiveLongEpisodeResponse { project: LongProject; archivedEpisodeNumber: number; archiveId: string; }

/** Provider-free editable records stored in a long project's Story Bible. */
export type LongStoryBibleCollection = "characters" | "locations" | "props" | "secrets" | "foreshadowing";

export interface LongStoryBibleItem {
  id: string;
  name?: string;
  status?: string;
  description?: string;
  alive?: boolean;
  injured?: boolean;
  referenceId?: string;
  lastAppearance?: string;
  emotionalState?: string;
  locationId?: string;
  ownerId?: string;
  ownedItemIds?: string[];
  characterIds?: string[];
  locationIds?: string[];
  episodeIds?: string[];
  eventIds?: string[];
  plannedRevealEpisode?: number;
  actualRevealEpisode?: number;
  truth?: string;
  revealAvailableEpisode?: number;
  content?: string;
  /** null explicitly removes an existing link in an update request. */
  assetLink?: LongStoryBibleAssetLink | null;
}

/** Optional Asset Library reference for a character, location, or prop. */
export interface LongStoryBibleAssetLink {
  assetId: string;
  versionPolicy: "pinned_version" | "follow_latest";
  pinnedVersion: number | null;
  episodeScope: { mode: "all" } | { mode: "episode"; episode: number };
}

/** Project-wide visual style reference stored as `basic.style_asset_link`. */
export interface LongStoryBibleStyleAssetLink {
  assetId: string;
  versionPolicy: "pinned_version" | "follow_latest" | "snapshot";
  pinnedVersion: number;
}

export type LongStoryBibleItemInput = Omit<LongStoryBibleItem, "id"> & { id?: string };

export interface LongStoryBible {
  basic: Record<string, unknown>;
  world: Record<string, unknown>;
  styleAssetLink?: LongStoryBibleStyleAssetLink;
  characters: LongStoryBibleItem[];
  locations: LongStoryBibleItem[];
  props: LongStoryBibleItem[];
  secrets: LongStoryBibleItem[];
  foreshadowing: LongStoryBibleItem[];
  updatedAt: string;
}

export interface GetLongProjectStoryBibleResponse { storyBible: LongStoryBible; }
export interface UpdateLongStoryBibleContentRequest { basic: Record<string, unknown>; world: Record<string, unknown>; }
export interface UpdateLongStoryBibleContentResponse { storyBible: LongStoryBible; }
/** `null` explicitly removes the global style Asset link. */
export interface UpdateLongStoryBibleStyleAssetLinkRequest { assetLink: LongStoryBibleStyleAssetLink | null; }
export interface UpdateLongStoryBibleStyleAssetLinkResponse { storyBible: LongStoryBible; }
export interface CreateLongStoryBibleItemRequest { item: LongStoryBibleItemInput; }
export interface CreateLongStoryBibleItemResponse { item: LongStoryBibleItem; storyBible: LongStoryBible; }
export interface UpdateLongStoryBibleItemRequest { item: LongStoryBibleItemInput; }
export interface UpdateLongStoryBibleItemResponse { item: LongStoryBibleItem; storyBible: LongStoryBible; }
export interface DeleteLongStoryBibleItemResponse { storyBible: LongStoryBible; }

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
  /** Derived, not user-set directly: sceneCount * clipDurationSeconds. The server recomputes this from those two fields on every save; a request's own durationSeconds value (if any) is ignored. */
  durationSeconds: number;
  /** No longer fixed at 6 — see MIN_SCENE_COUNT/MAX_SCENE_COUNT in domain.ts. */
  sceneCount: number;
  /** One of RUNWAY_CLIP_DURATIONS (domain.ts) — Runway is the only supported video Provider today, so this is not yet keyed by provider. */
  clipDurationSeconds: number;
  additionalNotes: string;
  styleNotes: ShortProjectStyleNotes;
  /** Off by default for existing projects. When on, the Story schema's `narration` field is used to generate per-scene TTS audio during Video merge instead of silence. */
  narrationEnabled: boolean;
}

/** What a client actually sends: durationSeconds is derived server-side (sceneCount * clipDurationSeconds) and is rejected as an unsupported field if included. */
export type ShortProjectSettingsInput = Omit<ShortProjectSettings, "durationSeconds">;

export interface GetProjectSettingsResponse { settings: ShortProjectSettings; }
export interface UpdateProjectSettingsRequest { settings: ShortProjectSettingsInput; }
export interface UpdateProjectSettingsResponse { project: Project; settings: ShortProjectSettings; }

/**
 * One Wizard-selected supporting or representative Character Asset and its narrative role, matching Python's
 * `character_profile.cast`. This feeds the Story prompt's `character_cast_metadata` placeholder — it does not
 * create a project Asset Mapping (that stays owned by the separate Asset Mapping review feature).
 */
export interface ShortProjectCastMember {
  assetId: string;
  /** Free text, e.g. "protagonist" or "supporting" — Python has no fixed enum here. */
  castRole: string;
  /** Free text describing the character's role in the story, e.g. "서브 캐릭터". */
  storyRole: string;
}
export interface GetShortProjectCastResponse { cast: ShortProjectCastMember[]; }
export interface UpdateShortProjectCastRequest { cast: ShortProjectCastMember[]; }
export interface UpdateShortProjectCastResponse { cast: ShortProjectCastMember[]; }

/**
 * One Wizard-selected scene reference Asset (background/object/style/general_reference) and why it matters to
 * this project, matching Python's `lore_context["scene_reference_assets"]`. Feeds the Story and image prompts'
 * `scene_reference_asset_metadata` placeholder alongside the separate `atmosphere_asset_metadata` list below.
 */
export interface ShortProjectSceneReferenceAsset {
  assetId: string;
  /** Free text describing project-local use, e.g. "주인공이 항상 들고 다니는 열쇠". Required, unlike cast roles. */
  purpose: string;
}
/**
 * Wizard-selected overall mood/color/lighting reference Assets (style/general_reference/background), matching
 * Python's `lore_context["atmosphere_asset_ids"]`. An Asset here may not also appear in `sceneReferenceAssets` —
 * Python enforces the same mutual exclusion so one Asset has one declared purpose in a project.
 */
export interface GetShortProjectAssetReferencesResponse {
  atmosphereAssetIds: string[];
  sceneReferenceAssets: ShortProjectSceneReferenceAsset[];
}
export type UpdateShortProjectAssetReferencesRequest = GetShortProjectAssetReferencesResponse;
export type UpdateShortProjectAssetReferencesResponse = GetShortProjectAssetReferencesResponse;

/**
 * One other short project eligible to link as this project's Scene 1 continuity source, matching Python's
 * `short_scene_continuity_option`: its images must be approved (workflow state at video stage or later) and it
 * must have a full 6-scene script and 6 generated images. `storyContext` and the source image path are computed
 * and stored server-side only — never trusted from the client — so this option list carries no editable fields.
 */
export interface ShortProjectContinuityOption {
  projectId: string;
  projectName: string;
  label: string;
}
export interface ListShortProjectContinuityOptionsResponse { options: ShortProjectContinuityOption[]; }

/** The currently linked continuity source, or null when this project starts an independent new story. */
export interface GetShortProjectContinuityResponse { link: ShortProjectContinuityOption | null; }
/** `projectId: null` disconnects the current link (Python's "연결 해제"). */
export interface SetShortProjectContinuityRequest { projectId: string | null; }
export type SetShortProjectContinuityResponse = GetShortProjectContinuityResponse;

/** Exact local Story request text shown before any provider submission. */
export interface StoryPromptPreview {
  projectId: string;
  originalPrompt: string;
  originalPromptSha256: string;
  characterCount: number;
  sceneCount: number;
}

export interface CreateStoryPromptPreviewResponse { preview: StoryPromptPreview; }

/** Renders the exact Story prompt from not-yet-saved settings — never persists anything, never calls a paid provider. */
export interface CreateStoryPromptDraftPreviewRequest { settings: ShortProjectSettingsInput; }
export interface CreateStoryPromptDraftPreviewResponse { prompt: string; }

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
  /** Local guard information only; present only when a real OpenAI credential and budget ledger are wired in — absent in the local fake execution mode, where nothing is charged. Same read-only, never-reserving principle as {@link GetVideoPromptPreviewResponse.budget}. */
  budget?: BudgetPreview;
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
  /** Same meaning and scope as StartImageGenerationResponse.budget (see that field's doc comment). */
  budget?: BudgetPreview;
  /**
   * Which scenes' images/videos/narration no longer match this project's current scene field values — see
   * UpdateSceneResponse.staleness's doc comment for how this is computed. Present on every image/video/narration
   * review GET (not only UpdateSceneResponse's own), so a user opening a review screen sees staleness from an
   * edit made earlier in a different screen, not only right after editing.
   */
  staleness?: SceneStaleness;
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
  /** Same meaning as GenerationProgressResponse.retryEstimate (see that field's doc comment) — the cost of this one regeneration, and the budget headroom at the time of the response. Absent in the local fake execution mode. */
  retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview };
}

/** Explicit approval for narration TTS generation. Requires ShortProjectSettings.narrationEnabled to be on. */
export interface StartNarrationGenerationRequest { approved: true; }

export interface StartNarrationGenerationResponse {
  project: Project;
  /** Scenes that had narration text and were newly synthesized this call. */
  generatedSceneNumbers: SceneNumber[];
  /** Scenes that already had valid audio from a prior call and were left untouched (no cost incurred this call) — same reuse semantics as StartImageGenerationResponse.reusedSceneNumbers. */
  reusedSceneNumbers: SceneNumber[];
  /** Scenes with no narration text (e.g. narration was enabled after the Story was already generated) — not an error, simply nothing to synthesize. */
  skippedSceneNumbers: SceneNumber[];
  /** Same meaning and scope as StartImageGenerationResponse.budget (see that field's doc comment). */
  budget?: BudgetPreview;
}

/** One scene's narration text and whether audio has been synthesized for it yet — provider-free to read (no TTS call happens from a GET). */
export interface NarrationReview {
  sceneNumber: SceneNumber;
  narration: string;
  hasAudio: boolean;
}

export interface GetNarrationReviewResponse {
  project: Project;
  narrations: NarrationReview[];
  /** Same meaning and scope as StartImageGenerationResponse.budget (see that field's doc comment). */
  budget?: BudgetPreview;
  /** Same meaning and scope as GetImageReviewResponse.staleness (see that field's doc comment). */
  staleness?: SceneStaleness;
}

/** Explicit, replacement synthesis of one scene's narration audio. Rejected (NARRATION_MISSING_TEXT) if that scene has no narration text. */
export interface RegenerateNarrationRequest { approved: true; }

export interface RegenerateNarrationResponse {
  project: Project;
  narrations: NarrationReview[];
  sceneNumber: SceneNumber;
  /** Same meaning as RegenerateImageReviewResponse.retryEstimate (see that field's doc comment). */
  retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview };
}

/** A local, non-submitting Runway preflight row for one approved image. */
export interface VideoPromptPreview {
  sceneNumber: SceneNumber;
  prompt: string;
  model: "gen4_turbo";
  ratio: "720:1280" | "1280:720";
  durationSeconds: number;
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

/**
 * Creates an empty Folder (no image, no file upload) of the given type that other same-library Assets can then
 * be linked into via `SetAssetParentFolderRequest`. Any `AssetType` is supported — a Folder is not limited to
 * characters. `description` is the folder's own shared/common description; each child keeps its own independent
 * `description` (set via `UpdateAssetMetadataRequest`) — when a Folder itself is referenced (Story cast, an
 * atmosphere/scene-reference Asset, or an Asset Mapping), both the Folder's description and every child's
 * description are combined into the generated prompt (see `describeCharacterCast`-style helpers on the backend).
 */
export interface CreateAssetFolderRequest {
  assetType: AssetType;
  displayName: string;
  description?: string;
  notes?: string;
}
export interface CreateAssetFolderResponse { asset: Asset; }

/**
 * Links (or unlinks, with `parentFolderId: null`) one existing Asset as a child of a Folder of any `AssetType` —
 * the add/remove counterpart to `characterFolderReferenceSet`, which only reorders a folder's already-linked
 * children. Linking converts the child's `assetType` to match its new parent folder's. Returns both the updated
 * child and its new (or former) parent folder so a client can refresh both without a second round trip.
 */
export interface SetAssetParentFolderRequest { parentFolderId: string | null; }
export interface SetAssetParentFolderResponse { asset: Asset; folder: Asset | null; }

export interface DeleteAssetResponse {
  assetId: string;
  deletedOwnedFile: boolean;
}

/**
 * `deleteManualFiles: true` implies removing child indexes too. Never deletes a project-owned image; a manual
 * child whose file cannot be safely identified as Library-owned blocks the whole request.
 */
export interface DeleteAssetFolderRequest {
  removeChildIndexes?: boolean;
  deleteManualFiles?: boolean;
}
export interface DeleteAssetFolderResponse {
  assetId: string;
  removedChildAssetIds: string[];
  deletedFiles: number;
}

/** Multipart field alongside the new version's image bytes. */
export interface AddAssetVersionMetadata { notes?: string; }
export interface AddAssetVersionResponse { asset: Asset; }

/** Repoints an Asset's current version at replacement bytes while preserving its stable identity. */
export interface RelinkAssetResponse { asset: Asset; }

export type AssetFileAuditClassification = "healthy" | "missing" | "damaged";
export interface AssetFileAuditEntry {
  assetId: string;
  displayName: string;
  classification: AssetFileAuditClassification;
  sourceKind: "manual" | "project";
  message: string;
}
export interface ListAssetFileAuditResponse { entries: AssetFileAuditEntry[]; }

/** Deletes a Library-manual Asset's index entry and, unless another Asset still references the same bytes, its owned file. */
export interface DeleteAssetOwnedFileResponse {
  assetId: string;
  deletedOwnedFile: true;
}

/**
 * Idempotently imports every project's legacy `reference_assets/references.json` entries (from the preserved
 * Python baseline) into the Asset Library and a confirmed, migrated project Asset Mapping. Never calls a Provider
 * or FFmpeg, and never modifies or deletes the legacy files it reads.
 */
export interface RunLegacyReferenceMigrationResponse {
  projectsScanned: number;
  migratedAssets: number;
  deduplicatedAssets: number;
  failedAssets: number;
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
  sceneCount: number;
  durationSecondsPerScene: number;
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
  /** Every scene number belonging to this job, 1..N in order — lets a caller render the full scene set without assuming a fixed count. */
  sceneNumbers: SceneNumber[];
  /**
   * A short, stable failure code per currently-failed scene (present only for scenes in `failedSceneNumbers`).
   * For a Runway execution, this is one of RunwayErrorCategory ("authentication" | "permission" | "rate_limit" |
   * "invalid_request" | "server" | "network" | "unknown") when the failure happened submitting or checking the
   * task, or one of our own synthesized codes ("timeout" | "no_output" | "invalid_state" | "budget_exceeded")
   * for a failure this app detected itself. When Runway itself reports the task FAILED/CANCELLED, this is
   * Runway's own free-text failure reason instead of a fixed code — treat any code not in the known set above
   * as opaque and fall back to a generic message. Never present for the local fake execution mode, which never
   * fails.
   */
  sceneErrors?: Record<SceneNumber, string>;
  /**
   * Local guard information for a paid retry/regenerate action on this job — the same read-only, never-reserving
   * principle as {@link GetVideoPromptPreviewResponse.budget}. `perSceneCostUsd` is the cost of retrying exactly
   * one scene; regenerating N scenes at once costs `perSceneCostUsd * N`, which the caller computes itself rather
   * than receiving a pre-multiplied total, since the number of scenes being retried is a UI choice this response
   * has no way to know in advance. `budget` is the current ledger snapshot (`estimatedRequestCostUsd`/`canSpend`
   * describe a single-scene retry specifically); comparing `perSceneCostUsd * N` against `budget.remainingUsd`
   * covers the "regenerate all" case. Absent in the local fake execution mode, where nothing is charged.
   */
  retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview };
}

export interface VideoReview {
  sceneNumber: SceneNumber;
  status: "pending" | "approved";
  updatedAt: string;
  /** Actual cost recorded for this scene's video across every attempt, including past regenerations; absent when nothing has been recorded (e.g. the local fake execution mode). */
  costUsd?: number;
}

export interface GetVideoReviewResponse {
  project: Project;
  reviews: VideoReview[];
  /** Same meaning and scope as GetImageReviewResponse.staleness (see that field's doc comment). */
  staleness?: SceneStaleness;
}

export interface ApproveVideoReviewResponse extends GetVideoReviewResponse {}

export interface RegenerateVideoResponse extends GenerationProgressResponse {
  regeneratedSceneNumbers: SceneNumber[];
}

/** The local FFmpeg render result never exposes an absolute filesystem path. */
export interface MergeVideosResponse {
  project: Project;
  finalVideoPath: "videos/final/instagram_reel.mp4";
}

/**
 * Editing one scene's fields in place, instead of regenerating the whole Story. The server enforces its own
 * whitelist of editable field names (unknown keys are rejected) — this type is deliberately a loose string map
 * rather than naming every field, since the whitelist is a backend implementation detail (which scene-schema
 * fields exist can already be seen in the Story response's raw scene objects).
 */
export interface UpdateSceneRequest {
  scene: Record<string, string>;
}

/**
 * Which already-generated artifacts no longer match this scene's current field values, computed by comparing
 * the field values a fresh prompt/narration would use against what's recorded in that artifact's own generation
 * record — never a separately stored flag, so there is nothing to keep in sync and nothing that can go stale on
 * its own. A scene with no image/video/narration generated yet is never "stale" (there is nothing to be behind);
 * it simply doesn't appear in these lists. `videoStale`/`imageStale` can include a scene whose own fields were
 * not edited, when the edited scene is the *previous* one and its `end_motion`/`continuity_hint` feed the next
 * scene's video prompt.
 */
export interface SceneStaleness {
  imageStale: SceneNumber[];
  videoStale: SceneNumber[];
  narrationStale: SceneNumber[];
}

export interface UpdateSceneResponse {
  project: Project;
  staleness: SceneStaleness;
}

export const API_ROUTES = {
  health: "/health",
  projects: "/projects",
  longProjects: "/long-projects",
  longProjectStoryBible: (projectId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/story-bible`,
  longProjectStoryBibleContent: (projectId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/story-bible/content`,
  longProjectStoryBibleStyleAssetLink: (projectId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/story-bible/style-asset-link`,
  longProjectStoryBibleCollection: (projectId: string, collection: LongStoryBibleCollection) =>
    `/long-projects/${encodeURIComponent(projectId)}/story-bible/${collection}`,
  longProjectStoryBibleItem: (projectId: string, collection: LongStoryBibleCollection, itemId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/story-bible/${collection}/${encodeURIComponent(itemId)}`,
  longProject: (projectId: string) => `/long-projects/${encodeURIComponent(projectId)}`,
  longProjectSettings: (projectId: string) => `/long-projects/${encodeURIComponent(projectId)}/settings`,
  longProjectOutlinePreview: (projectId: string) => `/long-projects/${encodeURIComponent(projectId)}/outline/preview`,
  longProjectOutlineApproval: (projectId: string) => `/long-projects/${encodeURIComponent(projectId)}/outline/approval`,
  longProjectEpisodes: (projectId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes`,
  longProjectEpisodeDuplicate: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/duplicate`,
  longProjectEpisodeArchive: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}`,
  longEpisode: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}`,
  longEpisodeScriptGeneration: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/script/generations`,
  longEpisodeScript: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/script`,
  longEpisodeScriptApproval: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/script/approval`,
  longEpisodeAssetMappingReview: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/asset-mapping-review`,
  longEpisodeAssetMappingReviewApproval: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/asset-mapping-review/approval`,
  longEpisodeAutomaticReferenceSummary: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/asset-mapping-review/automatic-selection`,
  longEpisodeAssetMatchingRerun: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/asset-mapping-review/rerun`,
  longEpisodeAssetMapping: (projectId: string, episodeNumber: number, mappingId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/asset-mapping-review/mappings/${encodeURIComponent(mappingId)}`,
  longEpisodeImageGeneration: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/images/generations`,
  longEpisodeImageReview: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/images/review`,
  longEpisodeImageReviewApproval: (projectId: string, episodeNumber: number, sceneNumber: SceneNumber) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/images/review/${sceneNumber}/approve`,
  longEpisodeImageReviewRegeneration: (projectId: string, episodeNumber: number, sceneNumber: SceneNumber) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/images/review/${sceneNumber}/regenerate`,
  longEpisodeVideoPreview: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/preview`,
  longEpisodeVideoGeneration: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations`,
  longEpisodeVideoProgress: (projectId: string, episodeNumber: number, jobId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations/${encodeURIComponent(jobId)}`,
  longEpisodeVideoStop: (projectId: string, episodeNumber: number, jobId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations/${encodeURIComponent(jobId)}/stop`,
  longEpisodeVideoRestart: (projectId: string, episodeNumber: number, jobId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations/${encodeURIComponent(jobId)}/restart`,
  longEpisodeVideoRegenerate: (projectId: string, episodeNumber: number, jobId: string, sceneNumber: SceneNumber) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations/${encodeURIComponent(jobId)}/scenes/${sceneNumber}/regenerate`,
  longEpisodeVideoReview: (projectId: string, episodeNumber: number, jobId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations/${encodeURIComponent(jobId)}/review`,
  longEpisodeVideoReviewApproval: (projectId: string, episodeNumber: number, jobId: string, sceneNumber: SceneNumber) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations/${encodeURIComponent(jobId)}/review/${sceneNumber}/approve`,
  longEpisodeVideoMerge: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/merge`,
  longEpisodeContinuity: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/continuity`,
  longProjectStoryBibleRelationshipAudit: (projectId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/story-bible/relationship-audit`,
  longProjectStoryBibleSearch: (projectId: string, collection: LongStoryBibleCollection, query: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/story-bible/${collection}/search?query=${encodeURIComponent(query)}`,
  longProjectStoryBibleDuplicate: (projectId: string, collection: LongStoryBibleCollection, itemId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/story-bible/${collection}/${encodeURIComponent(itemId)}/duplicate`,
  longEpisodeContinuityReference: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/continuity-reference`,
  projectArchive: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/archive`,
  longProjectArchive: (projectId: string) => `/long-projects/${encodeURIComponent(projectId)}/archive`,
  /** `projectArchive`/`longProjectArchive` above double as the hard-delete route (POST archives, DELETE permanently deletes); these list what's in the archive, and restore has its own path below. */
  projectsArchived: "/projects/archived",
  longProjectsArchived: "/long-projects/archived",
  projectRestore: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/restore`,
  longProjectRestore: (projectId: string) => `/long-projects/${encodeURIComponent(projectId)}/restore`,
  project: (projectId: string) => `/projects/${projectId}`,
  projectSettings: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/settings`,
  projectCast: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/settings/cast`,
  projectAssetReferences: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/settings/asset-references`,
  projectContinuityOptions: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/settings/continuity-options`,
  projectContinuity: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/settings/continuity`,
  storyPromptPreview: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/story/preview`,
  storyPromptApproval: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/story/approval`,
  storyPromptDraftPreview: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/story/draft-preview`,
  imageGeneration: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/images/generations`,
  imageReview: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/images/review`,
  imageReviewApproval: (projectId: string, sceneNumber: SceneNumber) =>
    `/projects/${encodeURIComponent(projectId)}/images/review/${sceneNumber}/approve`,
  imageReviewRegeneration: (projectId: string, sceneNumber: SceneNumber) =>
    `/projects/${encodeURIComponent(projectId)}/images/review/${sceneNumber}/regenerate`,
  imageContent: (projectId: string, sceneNumber: SceneNumber) =>
    `/projects/${encodeURIComponent(projectId)}/images/${sceneNumber}/content`,
  narrationGenerations: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/narration/generations`,
  narrationReview: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/narration/review`,
  narrationRegeneration: (projectId: string, sceneNumber: SceneNumber) =>
    `/projects/${encodeURIComponent(projectId)}/narration/review/${sceneNumber}/regenerate`,
  narrationContent: (projectId: string, sceneNumber: SceneNumber) =>
    `/projects/${encodeURIComponent(projectId)}/narration/${sceneNumber}/content`,
  sceneEdit: (projectId: string, sceneNumber: SceneNumber) =>
    `/projects/${encodeURIComponent(projectId)}/scenes/${sceneNumber}`,
  assets: "/assets",
  asset: (assetId: string) => `/assets/${encodeURIComponent(assetId)}`,
  assetContent: (assetId: string) => `/assets/${encodeURIComponent(assetId)}/content`,
  characterFolderReferenceSet: (assetId: string) => `/assets/${encodeURIComponent(assetId)}/character-reference-set`,
  createAssetFolder: "/assets/folders",
  assetParentFolder: (assetId: string) => `/assets/${encodeURIComponent(assetId)}/parent-folder`,
  assetsAudit: "/assets/audit",
  assetVersions: (assetId: string) => `/assets/${encodeURIComponent(assetId)}/versions`,
  assetRelink: (assetId: string) => `/assets/${encodeURIComponent(assetId)}/relink`,
  assetOwnedFile: (assetId: string) => `/assets/${encodeURIComponent(assetId)}/owned-file`,
  assetFolder: (assetId: string) => `/assets/${encodeURIComponent(assetId)}/folder`,
  legacyReferenceMigration: "/assets/legacy-migration",
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
  videoStop: (projectId: string, jobId: string) => `/projects/${encodeURIComponent(projectId)}/videos/generations/${encodeURIComponent(jobId)}/stop`,
  videoRestart: (projectId: string, jobId: string) => `/projects/${encodeURIComponent(projectId)}/videos/generations/${encodeURIComponent(jobId)}/restart`,
  videoRegenerate: (projectId: string, jobId: string, sceneNumber: SceneNumber) => `/projects/${encodeURIComponent(projectId)}/videos/generations/${encodeURIComponent(jobId)}/scenes/${sceneNumber}/regenerate`,
  videoRegenerateAll: (projectId: string, jobId: string) => `/projects/${encodeURIComponent(projectId)}/videos/generations/${encodeURIComponent(jobId)}/regenerate-all`,
  videoReview: (projectId: string, jobId: string) => `/projects/${encodeURIComponent(projectId)}/videos/generations/${encodeURIComponent(jobId)}/review`,
  videoReviewApproval: (projectId: string, jobId: string, sceneNumber: SceneNumber) => `/projects/${encodeURIComponent(projectId)}/videos/generations/${encodeURIComponent(jobId)}/review/${sceneNumber}/approve`,
  videoMerge: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/videos/merge`,
  videoContent: (projectId: string, sceneNumber: SceneNumber) => `/projects/${encodeURIComponent(projectId)}/videos/${sceneNumber}/content`,
  videoFinalContent: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/videos/final/content`,
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
  if (request.prompts.length < MIN_SCENE_COUNT || request.prompts.length > MAX_SCENE_COUNT) {
    throw new Error(`Between ${MIN_SCENE_COUNT} and ${MAX_SCENE_COUNT} approved Runway prompts are required.`);
  }
  request.prompts.forEach((item, index) => {
    if (item.sceneNumber !== index + 1 || !item.prompt.trim()) {
      throw new Error("Approved prompts must cover every scene, 1 through N, in order.");
    }
  });
}
