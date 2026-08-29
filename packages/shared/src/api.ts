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
  /** Derived, not user-set directly: sceneCount * clipDurationSeconds. The server recomputes this from those two fields on every save; a request's own episodeDurationSeconds value (if any) is ignored — see LongProjectSettingsInput. */
  episodeDurationSeconds: number;
  /** Per-Episode scene count — no longer fixed at 6. See MIN_SCENE_COUNT/MAX_SCENE_COUNT in domain.ts. */
  sceneCount: number;
  /** One of RUNWAY_CLIP_DURATIONS (domain.ts) — Runway is the only supported video Provider today, so this is not yet keyed by provider. Same constraint as ShortProjectSettings.clipDurationSeconds. */
  clipDurationSeconds: number;
  aspectRatio: "9:16" | "16:9";
  audience: string;
  notes: string;
  startingState: string;
  midpoint: string;
  endingDirection: string;
  storyFlowSummary: string;
  /** Same meaning as ShortProjectSettings.narrationEnabled: off by default for existing projects. When on, each Episode scene's narration text is used to generate per-scene TTS audio during final Episode merge instead of silence. */
  narrationEnabled: boolean;
  /**
   * Same meaning and independence from narrationEnabled as ShortProjectSettings.subtitlesEnabled — a scene only
   * gets a subtitle when this is on AND that scene has narration text, regardless of whether narration audio was
   * actually generated. For a project stored before this field existed, the server falls back to
   * narrationEnabled's value (see long-projects.service.ts), matching ShortProjectSettings.subtitlesEnabled's
   * identical legacy fallback.
   */
  subtitlesEnabled: boolean;
}

/** What a client actually sends: episodeDurationSeconds is derived server-side (sceneCount * clipDurationSeconds) and is rejected as an unsupported field if included — same shape as ShortProjectSettingsInput. */
export type LongProjectSettingsInput = Omit<LongProjectSettings, "episodeDurationSeconds">;

export interface LongEpisodeOutline {
  episodeNumber: number;
  title: string;
  summary: string;
  mainEvent: string;
  conflict: string;
  cliffhanger: string;
  nextEpisodeHook: string;
  status: LongEpisodeStatus;
  /**
   * Plain-language notes about this Episode's own state that the user could not otherwise learn from `status`
   * alone — e.g. a crash-recovery message after the backend reverted a stuck generating state on restart (see
   * orphaned-episode-generation-recovery.service.ts). Optional and absent when empty (unlike the short-project
   * Project.warnings, which is always present) — most Episodes never have one. Never contains a raw
   * LongEpisodeStatus value (see the short-project OrphanedGenerationRecoveryService's own doc comment for why:
   * a user was once shown "GENERATING_IMAGES" literally). A message disappears on its own once the condition it
   * described no longer applies, the same self-clearing principle as the short-project's
   * withoutStaleRecoveryWarnings.
   */
  warnings?: string[];
}

/**
 * Every state an Episode can be stored in, as a list — and the type is derived from the list, not written
 * beside it.
 *
 * Five backend services each kept their own copy of this to validate stored data, and three of them stopped at
 * `interrupted`: a merged Episode read as corrupt, so its scene clips, its images and its script all answered
 * 500 once the final video existed. The number of places that know the list is the number of places that can
 * disagree about it, and they did. Adding a state is now one edit.
 */
export const LONG_EPISODE_STATUSES = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted", "rendering", "completed", "failed"] as const;
export type LongEpisodeStatus = (typeof LONG_EPISODE_STATUSES)[number];

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
  /**
   * Same meaning as Scene.narration (domain.ts), scoped to Long Episodes: present regardless of
   * LongProjectSettings.narrationEnabled — only actually turned into TTS audio, or burned in as a subtitle, when
   * that flag (or subtitlesEnabled) is on. Optional because every Episode script stored before this field
   * existed has none. Long Episode script generation is local-fake only (episode-scripts.service.ts never calls
   * a real Provider), so this text is a template sentence for now, not AI-written — the same as every other
   * field on this type.
   */
  narration?: string;
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
  /** Present once this Episode has been published to Instagram, so a reload still knows. */
  instagramPost?: LongEpisodeInstagramPost;
}

export interface GetLongEpisodeResponse { episode: LongEpisodeDetail; }
/**
 * What one Episode was told to make: how many scenes, and how long each clip runs.
 *
 * A Long Project's own settings are the defaults every new Episode starts from — they are not the value the
 * Episode uses. An Episode has always kept its own copy (`scene_count`, `duration_seconds` are snapshotted at
 * creation and every later step reads the Episode's, not the project's); what was missing was any way to change
 * that copy. This is that.
 *
 * Aspect ratio is deliberately not here. It stays a project-wide value because three screens once each guessed
 * it independently and all three guessed wrong, and because a continuity reference image crosses from one
 * Episode into the next — a per-Episode ratio would make those two disagree with nothing to reconcile them.
 */
export interface LongEpisodeSettings {
  sceneCount: number;
  clipDurationSeconds: number;
  /** Derived, never sent: sceneCount * clipDurationSeconds. Same rule as the project's own settings. */
  episodeDurationSeconds: number;
}

export interface GetLongEpisodeSettingsResponse {
  settings: LongEpisodeSettings;
  /** What a new Episode of this project starts from, so a screen can show which values were changed. */
  projectDefaults: LongEpisodeSettings;
  /**
   * Whether these can still be changed, so the screen can say why not instead of failing on save.
   *
   * False once a script exists: the script is written *for* a scene count and a clip length — both go into the
   * prompt — so changing them afterwards would leave a script that was written for something else. Regenerating
   * the script is the way to change them, and that is a paid step the person chooses on purpose.
   */
  changeable: boolean;
}

export interface UpdateLongEpisodeSettingsRequest {
  sceneCount: number;
  clipDurationSeconds: number;
}

export interface UpdateLongEpisodeSettingsResponse { settings: LongEpisodeSettings; }

/**
 * `userRequestId` identifies the person's intent, not the click.
 *
 * The lock stops two presses that overlap. It cannot stop the one that arrives after the first has finished,
 * and that is the shape this step is exposed to: a regeneration is a legal repeat, so the state gate lets it
 * through, and a person who waited half a minute with nothing on screen and pressed again paid twice. The same
 * id sent again returns what the first press produced instead of generating anything.
 *
 * The screen must mint it when the intent forms and keep it until the request succeeds — one per press produces
 * a new id every time and protects nothing (see LongEpisodeVideoWorkflowScreen, which does exactly that;
 * VideoPromptPreviewScreen holds one in state, which is the pattern to copy).
 */
export interface GenerateLongEpisodeScriptRequest { regenerate?: true; userRequestId: string; }
export interface GenerateLongEpisodeScriptResponse { episode: LongEpisodeDetail; }
export interface UpdateLongEpisodeScriptRequest { script: LongEpisodeScript; }
export interface UpdateLongEpisodeScriptResponse { episode: LongEpisodeDetail; }
export interface ApproveLongEpisodeScriptRequest { approved: true; }
export interface ApproveLongEpisodeScriptResponse { episode: LongEpisodeDetail; }



/** Provider-free persisted review decision for one long-story Episode image. */
/**
 * Which video generation this Episode is currently on, if any.
 *
 * Every other video route needs a job id, and the id only ever existed in the browser's memory — a refresh, a
 * closed tab, or opening the Episode on another day left paid work running with no way to watch it or stop it.
 * The records on disk have always known; nothing asked them.
 *
 * `null` means there is no job to return to, which is different from "the Episode is idle": a finished job stays
 * reportable so a reload during review does not lose the thing being reviewed.
 */
export interface GetLongEpisodeCurrentVideoJobResponse { jobId: string | null; }

export interface LongEpisodeImageReview {
  sceneNumber: SceneNumber;
  status: "pending" | "approved";
  updatedAt: string;
  /**
   * Present only when this scene's confirmed Reference images (plus, for scene 1, a linked previous project's
   * continuity image) exceeded MAX_REFERENCE_IMAGES (16) and some had to be left out of the actual generation
   * request — absent whenever nothing was left out, same "quiet unless it happened" principle as
   * VideoPromptPreview.omittedSections. referencesUsedCount is the number actually sent (always 16 when
   * referencesOmittedCount is present); reported explicitly rather than left for the frontend to hardcode the cap
   * itself, so a future change to the backend's own limit cannot silently make this text wrong (see the image
   * aspect-ratio size mismatch this app already shipped once from two places independently assuming the same
   * constant).
   */
  referencesUsedCount?: number;
  referencesOmittedCount?: number;
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
  /** Derived from the Episode's own LongProjectSettings.episodeDurationSeconds ÷ 6 (30 -> 5, 60 -> 10). */
  durationSecondsPerScene: 5 | 10;
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
  /** Same meaning and scope as GenerationProgressResponse.sceneNumbers (see that field's doc comment) — lets the Frontend render the full scene set without a local scene-count constant. */
  sceneNumbers: SceneNumber[];
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

/**
 * Fetches clips that Runway already made and already charged for, and writes them where they should have gone.
 *
 * A finished Episode whose files are placeholders is not a generation problem: the tasks exist on Runway's side
 * and were paid for, and their ids are in the records. This asks for those outputs again — a status read and a
 * download, never a new generation — so nothing is added to the ledger. It exists because the bug that lost
 * those bytes cost $1.50 per Episode, and regenerating would cost it a second time.
 *
 * A scene whose output can no longer be fetched (the task is gone, or its URL has expired) is reported here and
 * left failed rather than quietly regenerated: spending money is a decision for the person, not a fallback.
 */
export interface RecoverLongEpisodeVideosRequest { approved: true; }
export interface RecoverLongEpisodeVideosResponse extends LongEpisodeVideoProgress {
  recoveredSceneNumbers: SceneNumber[];
  unrecoverableScenes: { sceneNumber: SceneNumber; reason: string }[];
}

/** Final Episode render has a fixed relative output and never exposes an absolute path. */
export interface MergeLongEpisodeVideosResponse {
  episode: LongEpisodeDetail;
  finalVideoPath: "videos/final/instagram_reel.mp4";
}

/**
 * Long Episode narration: same shape and behavior as the short-project narration contract
 * (StartNarrationGenerationRequest/Response, NarrationReview, GetNarrationReviewResponse,
 * RegenerateNarrationRequest/Response), scoped to one Episode. Entry condition matches the short-project
 * screen — "this scene has narration text" — never gated by LongEpisodeStatus; the only state-shaped gate is
 * that the Episode must already have a script (nothing to narrate before then).
 */
export interface StartLongEpisodeNarrationGenerationRequest { approved: true; }
export interface StartLongEpisodeNarrationGenerationResponse {
  episode: LongEpisodeDetail;
  /** Scenes that had narration text and were newly synthesized this call. */
  generatedSceneNumbers: SceneNumber[];
  /** Scenes that already had valid audio from a prior call and were left untouched (no cost incurred this call). */
  reusedSceneNumbers: SceneNumber[];
  /** Scenes with no narration text — not an error, simply nothing to synthesize. */
  skippedSceneNumbers: SceneNumber[];
  /** Same meaning and scope as StartLongEpisodeImageGenerationResponse.budget (see that field's doc comment). */
  budget?: BudgetPreview;
}
/**
 * What a scene's narration audio actually is.
 *
 * One field rather than a boolean plus a placeholder flag, because two fields can say things that cannot be
 * true — "no audio, and it is a placeholder" typechecks and means nothing — and every reader would have to
 * remember to consult both. Forgetting once is how a screen ends up saying something the data does not support.
 *
 * `placeholder` is real on disk and playable, and that matters: it is four bytes of MP3 header written when
 * there is no TTS credential, so the pipeline can still be walked. It is not something to hide — a person has
 * to be able to press play and hear that there is nothing there. What it must not do is pass as narration,
 * which is what "음성 있음" beside it used to do, and what a merge treating it as audio still does.
 */
export type NarrationAudioState = "none" | "placeholder" | "generated";

/** One scene's narration text and whether audio has been synthesized for it yet — provider-free to read (no TTS call happens from a GET). */
export interface LongEpisodeNarrationReview {
  sceneNumber: SceneNumber;
  narration: string;
  /** Whether this scene has audio, and what kind — see NarrationAudioState. */
  audio: NarrationAudioState;
  /**
   * That scene's synthesized audio length, measured from the file. Omitted when there is no audio, or when the
   * length could not be measured.
   *
   * Not a placeholder signal. It used to be read as one — a missing length meant either a placeholder or a
   * failed probe, and nothing could tell those apart — which is exactly the pair of facts `audio` exists to
   * stop deriving from each other.
   */
  audioDurationSeconds?: number;
}
export interface GetLongEpisodeNarrationReviewResponse {
  episode: LongEpisodeDetail;
  narrations: LongEpisodeNarrationReview[];
  /** Same meaning and scope as StartLongEpisodeImageGenerationResponse.budget (see that field's doc comment). */
  budget?: BudgetPreview;
}
/** Explicit, replacement synthesis of one scene's narration audio. Rejected (LONG_EPISODE_NARRATION_MISSING_TEXT) if that scene has no narration text. */
export interface RegenerateLongEpisodeNarrationRequest {
  approved: true;
  /** One-off delivery direction for this single synthesis only — same meaning as RegenerateNarrationRequest.additionalInstruction. Trimmed; empty/whitespace-only is treated as absent. Ignored in the local fake execution mode. */
  additionalInstruction?: string;
}
export interface RegenerateLongEpisodeNarrationResponse {
  episode: LongEpisodeDetail;
  narrations: LongEpisodeNarrationReview[];
  sceneNumber: SceneNumber;
  /** Same meaning as RegenerateImageReviewResponse.retryEstimate (see that field's doc comment). Absent in the local fake execution mode. */
  retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview };
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
export interface GetLongEpisodeContinuityResponse {
  memory: LongEpisodeContinuityMemory | null;
  /**
   * Whether saving is possible right now.
   *
   * Reading these notes is allowed at any point and saving them is not — they describe what an Episode ended up
   * being, so they are only meaningful once its video work has started. Nothing said so: the screen opened, took
   * everything the person typed, and refused at the end. Being told after writing is the worst moment to be
   * told, and the refusal is the same either way, so the only thing that can change is when it arrives.
   *
   * Computed from the same list the save path checks, so the answer and the refusal cannot drift apart.
   */
  canSave: boolean;
}
export interface SaveLongEpisodeContinuityRequest { memory: Omit<LongEpisodeContinuityMemory, "episodeNumber" | "updatedAt">; }
export interface SaveLongEpisodeContinuityResponse { memory: LongEpisodeContinuityMemory; nextEpisode: LongEpisodeDetail | null; }

export interface SearchLongStoryBibleItemsResponse { items: LongStoryBibleItem[]; }
export interface DuplicateLongStoryBibleItemResponse { item: LongStoryBibleItem; storyBible: LongStoryBible; }
export interface LongEpisodeContinuityReference {
  previousEpisodeNumber: number;
  /** The previous Episode's actual last scene number (its own sceneCount) — no longer always 6. */
  sourceSceneNumber: SceneNumber;
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

export interface CreateLongProjectRequest { projectId: string; settings: LongProjectSettingsInput; }
export interface CreateLongProjectResponse { project: LongProject; }
export interface ListLongProjectsResponse { projects: LongProjectSummary[]; }
/** A long project currently sitting in the recoverable archive, listed on the "보관함" (Archive) screen. */
export interface ArchivedLongProjectSummary extends LongProjectSummary { archivedAt: string; }
export interface ListArchivedLongProjectsResponse { projects: ArchivedLongProjectSummary[]; }
export interface GetLongProjectResponse { project: LongProject; }
export interface GetLongProjectSettingsResponse { settings: LongProjectSettings; }
export interface UpdateLongProjectSettingsRequest { settings: LongProjectSettingsInput; }
export interface UpdateLongProjectSettingsResponse { project: LongProject; }
export interface LongProjectOutlinePromptPreview { projectId: string; prompt: string; promptSha256: string; episodeCount: number; }
export interface CreateLongProjectOutlinePreviewResponse {
  preview: LongProjectOutlinePromptPreview;
  /** Same meaning and scope as CreateStoryPromptPreviewResponse.budget (see that field's doc comment). */
  budget?: BudgetPreview;
}
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

/**
 * Editing one Episode's own outline fields (the per-Episode plan the whole-project outline approval assigned —
 * title/summary/mainEvent/conflict/cliffhanger/nextEpisodeHook) in place, without regenerating anything. Only
 * allowed while that Episode's own status is still "planned" or "outline_ready" — the same window
 * EpisodeTimelineService already uses for add/duplicate/archive, i.e. before script generation has consumed the
 * outline as a prompt input. A loose partial string map for the same reason as UpdateSceneRequest.scene: the
 * server enforces its own field whitelist, and unknown keys are rejected.
 */
export interface UpdateLongEpisodeOutlineRequest { outline: Record<string, string>; }
export interface UpdateLongEpisodeOutlineResponse { project: LongProject; episode: LongEpisodeOutline; }

/** Provider-free editable records stored in a long project's Story Bible. */
/**
 * The two collections whose text reaches the script prompt. Characters, locations and props were removed with
 * the screen that edited them: `buildEpisodeContext` never carried them, and nothing else read them either.
 */
export type LongStoryBibleCollection = "secrets" | "foreshadowing";

/**
 * A secret or a piece of foreshadowing. Only these two collections remain: their text is what reaches the script
 * prompt, and `revealAvailableEpisode` is what keeps Episode 8's twist out of Episode 3.
 *
 * The character, location and prop collections are gone, and with them the fields only they used — relationship
 * ids (`locationId`, `ownerId`, `ownedItemIds`, `characterIds`), `alive`/`injured`, `truth`, `content` and the
 * rest. Nothing in the app could set them and nothing read them; the audit that checked those ids could only
 * ever report success. `description` stays: it is the body of a secret, and it is sent.
 */
export interface LongStoryBibleItem {
  id: string;
  name?: string;
  status?: string;
  description?: string;
  revealAvailableEpisode?: number;
}

/**
 * The project's protagonist, stored as `basic.protagonist_asset_link`.
 *
 * A Folder, never a single image: a character is a set of angles of one person, and the per-child descriptions
 * are what an image prompt has to read. It is chosen once for the whole work — a 20-Episode project should not
 * ask for its lead 20 times — which is why it sits here beside the style link rather than on each Episode.
 *
 * Its Folder name is the name the script prompt is given. Before this, no path put a character name into a real
 * script prompt at all: the Story Bible's character collection never reached `buildEpisodeContext`.
 */
export interface LongStoryBibleProtagonistLink {
  assetId: string;
  versionPolicy: "pinned_version" | "follow_latest";
  pinnedVersion: number | null;
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
  protagonistAssetLink?: LongStoryBibleProtagonistLink;
  secrets: LongStoryBibleItem[];
  foreshadowing: LongStoryBibleItem[];
  updatedAt: string;
}

export interface GetLongProjectStoryBibleResponse { storyBible: LongStoryBible; }
/**
 * The world notes, and only those.
 *
 * This used to take `basic` as well and replace both halves, from a screen that edited both as raw JSON. That
 * screen is gone and `basic` now holds the protagonist and style links, each with its own endpoint — so a
 * caller sending world notes had to read `basic` back and send it unchanged, and forgetting to would clear the
 * project's lead. A request cannot do that if it cannot say `basic`.
 */
export interface UpdateLongStoryBibleWorldRequest { world: Record<string, unknown>; }
export interface UpdateLongStoryBibleWorldResponse { storyBible: LongStoryBible; }
/** `null` explicitly removes the global style Asset link. */
export interface UpdateLongStoryBibleStyleAssetLinkRequest { assetLink: LongStoryBibleStyleAssetLink | null; }
export interface UpdateLongStoryBibleStyleAssetLinkResponse { storyBible: LongStoryBible; }
/** `null` explicitly removes the protagonist link. */
export interface UpdateLongStoryBibleProtagonistAssetLinkRequest { assetLink: LongStoryBibleProtagonistLink | null; }
export interface UpdateLongStoryBibleProtagonistAssetLinkResponse { storyBible: LongStoryBible; }
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
  /**
   * Independent of narrationEnabled — a scene's narration text can be burned in as a subtitle during merge
   * without any TTS audio at all ("captions only", a real Shorts use case since many viewers watch muted).
   * A scene only gets a subtitle when this is on AND that scene has narration text; it never depends on
   * whether narration audio was actually generated. For a project stored before this field existed, the
   * server falls back to narrationEnabled's value (see project-settings.ts's toShortProjectSettings) so an
   * existing narration-enabled project keeps exactly its current merged output instead of silently losing
   * subtitles the first time this is read.
   */
  subtitlesEnabled: boolean;
}

/** What a client actually sends: durationSeconds is derived server-side (sceneCount * clipDurationSeconds) and is rejected as an unsupported field if included. */
export type ShortProjectSettingsInput = Omit<ShortProjectSettings, "durationSeconds">;

/**
 * Two flags rather than one, because this form has two locks and they close at different moments.
 *
 * A single `changeable` would have to be false as soon as either closed, which would disable the scene count
 * the instant images existed — a field that is still perfectly editable then, if no Story has been written.
 * The Episode's settings have one lock and so carry one flag; the shape follows the rule, not the other screen.
 *
 * Both exist so the screen does not have to re-derive the server's rule from the project. Computing
 * `scenes.length > 0` in the frontend would be a second copy of the condition the save actually checks, and two
 * copies is how the continuity screen came to disagree with its own server.
 */
export interface GetProjectSettingsResponse {
  settings: ShortProjectSettings;
  /** False once a Story has been written: its scenes are what the rest of the pipeline counts. */
  sceneCountChangeable: boolean;
  /** False once images have been generated at the current orientation. */
  aspectRatioChangeable: boolean;
}
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
 * A caption in progress on the Instagram post-prep screen, saved so a series creator whose hashtag set barely
 * changes between episodes doesn't retype it every time. All fields optional — an unset one is simply blank on
 * the screen, not an error. Never includes attribution text: that is always derived fresh from the current
 * project's usedAudio, not saved, so an edited/deleted track can't leave a stale credit line sitting in a draft.
 */
export interface PostDraft {
  body?: string;
  hashtags?: string;
  aiNotice?: boolean;
}
export type GetPostDraftResponse = PostDraft;
export type PutPostDraftRequest = PostDraft;
export type PutPostDraftResponse = PostDraft;

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

export interface CreateStoryPromptPreviewResponse {
  preview: StoryPromptPreview;
  /** Same meaning and scope as StartImageGenerationResponse.budget (see that field's doc comment) — present only when a real OpenAI credential and budget ledger are wired in, absent in the local fake execution mode. Read before approval, same as the image/video/narration screens' own pre-request estimate + ledger split. */
  budget?: BudgetPreview;
}

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

/**
 * Resets an already-generated Story so its prompt can be approved again from scratch, going through the same
 * `story/approval` flow as the first generation. Allowed only up to the moment image generation actually starts
 * (READY has nothing to regenerate; once even one scene image exists, the money already spent on it would be
 * orphaned by a script change — see STORY_REGENERATION_NOT_ALLOWED). Requires no re-authored prompt of its own:
 * the reset project goes back through `story/preview` and `story/approval` exactly like a first-time run.
 */
export interface RegenerateStoryPromptRequest { approved: true; }
export interface RegenerateStoryPromptResponse { project: Project; }

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
  /** Same meaning, scope, and "quiet unless it happened" principle as LongEpisodeImageReview.referencesUsedCount/referencesOmittedCount (see that field's doc comment). */
  referencesUsedCount?: number;
  referencesOmittedCount?: number;
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

/**
 * Explicit replacement of one already generated image. Calls the real OpenAI image API when a credential is
 * connected (local-fake placeholder image otherwise) — despite this interface's misleading old name, it is not
 * provider-free.
 */
export interface RegenerateImageReviewRequest {
  approved: true;
  /**
   * One-off user direction for this single regeneration only — appended as the prompt's last line, never stored
   * back into the scene or the project's canonical image prompt. Trimmed; empty/whitespace-only is treated as
   * absent. A later regeneration with no additionalInstruction goes back to the plain scene prompt.
   */
  additionalInstruction?: string;
}

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
  /** Whether this scene has audio, and what kind — see NarrationAudioState. */
  audio: NarrationAudioState;
  /**
   * That scene's synthesized audio length, measured from the file. Omitted when there is no audio, or when the
   * length could not be measured.
   *
   * Not a placeholder signal. It used to be read as one — a missing length meant either a placeholder or a
   * failed probe, and nothing could tell those apart — which is exactly the pair of facts `audio` exists to
   * stop deriving from each other.
   */
  audioDurationSeconds?: number;
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
export interface RegenerateNarrationRequest {
  approved: true;
  /**
   * One-off delivery direction for this single synthesis only (e.g. tone/pace), passed to the TTS call's
   * `instructions` parameter — never appended to the spoken narration text itself, and never stored. Trimmed;
   * empty/whitespace-only is treated as absent. Ignored in the local fake execution mode (no real TTS call).
   */
  additionalInstruction?: string;
}

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
  /**
   * Section labels the server had to drop from `prompt` to stay under Runway's prompt length limit — present
   * only when at least one was actually cut (never when a section is merely empty, e.g. scene 1's continuity
   * cue). One of "Continuity cue" | "Environment" | "Performance" | "Pacing", the exact order the server removes
   * them in when the prompt is still too long. Without this, a scene that had detail quietly cut carried no
   * signal anywhere that anything was missing.
   */
  omittedSections?: string[];
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

/**
 * One masked secret per provider. Instagram is deliberately not here: its connection is four values that are
 * written by the same login and stop being true together (app id, app secret, token, token expiry), so it has
 * its own store rather than a single masked string — see InstagramConnectionStatus.
 */
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

/**
 * Body for both the single-scene regenerate route and regenerate-all — regenerate-all has no per-scene number in
 * the URL, so `additionalInstruction`, when given, applies to every scene regenerated by that one call.
 */
export interface RegenerateVideoRequest {
  approved: true;
  /**
   * One-off user direction for this regeneration only — appended as the video prompt's last line, never stored
   * back into the project's canonical video prompt (so a later staleness check still compares against the plain
   * scene-derived prompt). Trimmed; empty/whitespace-only is treated as absent. Ignored in the local fake
   * execution mode (no real Runway call).
   */
  additionalInstruction?: string;
}

export interface RegenerateVideoResponse extends GenerationProgressResponse {
  regeneratedSceneNumbers: SceneNumber[];
}

/**
 * `mode` decides what audio the final merge actually carries — never inferred from whether a BGM track happens
 * to be selected, so switching mode away from "narration+bgm" without clearing trackId can't accidentally leave
 * a track silently attached. "narration" requires the project to actually have narration audio
 * (ProjectSummary.narrationAvailable) — a project with none must default to "silent" and cannot request
 * "narration" at all, since there is nothing to mix (docs/06_DECISIONS.md D-011). trackId is required when (and only meaningful when) mode is "narration+bgm".
 * volume/fadeSeconds apply only to the bgm track — narration is never faded or attenuated by this setting.
 */
export interface MergeAudioSettings {
  mode: "narration" | "narration+bgm" | "silent";
  trackId?: string;
  /** 0 (silent) to 1 (full volume) — the bgm track's own level, independent of narration's. Server default when omitted: 0.25 (bgm audible but clearly secondary to narration). */
  volume?: number;
  /** Fade-in at the start and fade-out at the end of the whole final video, in seconds. Server default when omitted: 2. */
  fadeSeconds?: number;
}

/** Omitted entirely (not just `audio` omitted) falls back to the same narrationAvailable-derived default as an explicit request would compute server-side — see MergeAudioSettings's doc comment. */
export interface MergeVideosRequest {
  audio?: MergeAudioSettings;
}

/** The local FFmpeg render result never exposes an absolute filesystem path. */
export interface MergeVideosResponse {
  project: Project;
  finalVideoPath: "videos/final/instagram_reel.mp4";
}

/**
 * One track in the BGM library — a project-independent, user-supplied resource (distinct from both the Asset
 * Library's input-material role and the Video Library's results-archive role; see VideoLibraryProjectSummary's
 * doc comment for that distinction). "upload" is the only source, permanently — not a placeholder for a later
 * external search/import. Every clean, checked candidate provider failed for a different reason (docs/06_DECISIONS.md D-001): Pixabay has no music/audio API at all and its Terms of Service prohibits scraping around that;
 * Freesound's API exists but its catalog is overwhelmingly CC-BY (attribution required) and sound-effect-
 * oriented, not music; Jamendo requires a separate paid license for commercial use; Meta Sound Collection's
 * license covers using a track inside Instagram itself, not downloading it into a file uploaded elsewhere. A
 * search feature over any CC source risks a user picking a track that turns out to require attribution only
 * *after* they've already published a video with it — exactly the "found out too late" failure this whole
 * feature area has been working to prevent everywhere else, not something to introduce here.
 */
export interface AudioLibraryTrack {
  trackId: string;
  title: string;
  artist?: string;
  durationSeconds: number;
  bytes: number;
  source: "upload";
  /** What the uploader themselves states about where this track came from — the app never verifies it (there is no provider integration to check against). Always present: required at upload time specifically because the moment of upload is the only point the uploader reliably still remembers this (docs/06_DECISIONS.md D-002). */
  licenseKind: "cc0" | "cc-by" | "purchased" | "self-made" | "other";
  /** Whether publishing a video using this track requires crediting it (e.g. in the caption) — true for "cc-by", user-declared for "other", false otherwise. Read by both the BGM library (a persistent notice on the track) and the merge screen (surfaced again at the moment that matters — right before publishing, not just once at upload). */
  attributionRequired: boolean;
  /** The exact sentence the uploader wants used as the credit line, when attributionRequired is true — the app does not compose one on the uploader's behalf, since it cannot know the source's own required wording. */
  attributionText?: string;
  /** Free-text "where I got this" the uploader can optionally record, for their own future reference — never a live link the app fetches from. */
  sourceUrl?: string;
  addedAt: string;
}
export interface GetAudioLibraryResponse { tracks: AudioLibraryTrack[]; }
export interface UploadAudioTrackRequest {
  title?: string;
  artist?: string;
  licenseKind: "cc0" | "cc-by" | "purchased" | "self-made" | "other";
  attributionRequired: boolean;
  attributionText?: string;
  sourceUrl?: string;
}
export interface UploadAudioTrackResponse { track: AudioLibraryTrack; }
/** BGM tracks are the user's own uploaded files, not paid AI-generation results (contrast the Video Library's deliberate no-delete policy) — mistakenly uploading the wrong file is common and low-stakes to undo, and the source file is still on the uploader's own machine. Matches the Asset Library's existing removal precedent rather than inventing a "hide" pseudo-state for the one library that doesn't need it. */
export interface DeleteAudioTrackResponse { trackId: string; }

/**
 * One Instagram professional account this user could publish to, discovered live from the Facebook Pages their
 * access token can see. Deliberately not part of ProviderCredentialKind: a credential answers "can we act at
 * all?" and belongs in settings, while this answers "where does it go?" and has to be visible at the moment of
 * publishing (docs/06_DECISIONS.md D-014).
 */
export interface InstagramPublishTarget {
  igUserId: string;
  /** The @handle, without the @. The only name a person recognises their own account by — a numeric ID cannot serve as the confirmation panel's account name (docs/06_DECISIONS.md D-006). */
  username: string;
  /** The connected Facebook Page's name, shown to tell apart accounts whose handles look alike. */
  pageName: string;
}

export interface GetInstagramTargetsResponse {
  targets: InstagramPublishTarget[];
  /**
   * Present only when a previously stored choice is actually still in `targets` this time. A page can be
   * disconnected, deleted, or have its permission revoked between sessions, so echoing a stored id back without
   * checking would be the app asserting something it never verified (docs/06_DECISIONS.md D-006). Absent means
   * the screen should ask the user to choose again rather than silently publishing somewhere else.
   */
  selectedIgUserId?: string;
}

export interface SetInstagramTargetRequest { igUserId: string; }
export type SetInstagramTargetResponse = GetInstagramTargetsResponse;

/**
 * What the app knows about its own Instagram connection, without ever returning the secret or the token.
 * `tokenExpiresAt` is shown because a long-lived token lasts about sixty days and Meta documents no way to
 * refresh one (D-007) — if the date is not visible, expiry always arrives as "it suddenly stopped working".
 */
export interface InstagramConnectionStatus {
  /** Whether the Meta app id and secret have been entered. Signing in is impossible until they are. */
  appConfigured: boolean;
  /** Whether a token is stored. Says nothing about whether Meta still accepts it — that requires asking (D-006). */
  tokenStored: boolean;
  tokenExpiresAt?: string;
  /**
   * Whether a login can be started against this backend's own callback address — that is, whether a browser tab
   * can finish a sign-in without a window anyone has to watch (docs/06_DECISIONS.md D-022).
   *
   * True means only that this process is serving the callback over HTTPS. It does not claim the address is
   * registered in the Meta app, nor that this browser trusts the certificate — neither is knowable here, and
   * both surface as a failure at Meta's own page rather than as something to report in advance (D-006).
   *
   * The screen needs the other half of the answer itself: inside the desktop shell the desktop flow is always
   * available regardless of this field, because that shell can read the URL its own window landed on. So this
   * is what tells a plain browser tab whether it is on a working path, before the button is pressed.
   */
  callbackLoginAvailable: boolean;
  /**
   * Why the sign-in currently being waited on was refused, when it was — so the screen watching for a token can
   * stop and say what happened instead of waiting out its timeout and blaming the clock.
   *
   * Tied to one attempt, never to the app. It appears only while the attempt it belongs to is the open one, and
   * a new sign-in or a successful one removes it. Absence therefore means "no attempt has anything to report",
   * not "nothing has ever failed" — a stored last-failure would eventually be shown next to a login that had
   * just succeeded (docs/06_DECISIONS.md D-018).
   *
   * `code` is the same error code the failed request itself would have returned, so the screen reuses the
   * message table it already has rather than building a second one keyed on something else. Two tables deciding
   * one thing is how they come to disagree. Meta's own wording and the diagnostic numbers stay out: the numbers
   * answer a question only the log asks, and the wording never leaves this app at all.
   */
  lastLoginError?: { code: string };
}
export interface SetInstagramAppRequest { appId: string; appSecret: string; }
export type SetInstagramAppResponse = InstagramConnectionStatus;
/**
 * Which address Meta is asked to send the browser back to. Required, with no default, because the two flows are
 * not interchangeable and a wrong guess fails silently: the window simply lands somewhere nobody is reading and
 * the screen waits out its timeout with nothing to report (docs/06_DECISIONS.md D-022).
 *
 * "desktop" sends the window to Meta's own success page, which only a shell that can inspect its own window can
 * read. "callback" sends the browser to this backend, which needs no window watched but exists only where the
 * HTTPS callback is being served — see InstagramConnectionStatus.callbackLoginAvailable.
 */
export interface StartInstagramLoginRequest {
  flow: "desktop" | "callback";
}
export interface StartInstagramLoginResponse {
  /** The Meta login page to open in a window. */
  url: string;
  /**
   * The window has arrived once its URL starts with this; hand that whole URL back to complete the login.
   *
   * Present only for the desktop flow, and its absence is the signal that nothing needs watching: the callback
   * flow completes on the server, so the screen finishes by reading the connection status rather than by
   * reading a URL it was never going to be allowed to see.
   */
  redirectPrefix?: string;
}
export interface CompleteInstagramLoginRequest {
  /** The full URL the login window landed on, unparsed — the server reads the code and verifies the state it issued. */
  redirectedUrl: string;
}
export type CompleteInstagramLoginResponse = InstagramConnectionStatus;

/**
 * Publishing this project's final video. `approved` must be true and is never defaulted — this is the same
 * grade of explicit gate the paid Runway steps use, for the same reason stated differently: a mistaken charge
 * costs money, a mistaken post cannot be unseen by whoever already saw it.
 *
 * `igUserId` travels with the request rather than being read from the stored selection, so the account the
 * confirmation named is provably the account published to. The server still checks it is one this login can
 * actually publish to.
 */
/**
 * What an Episode's publish left behind, carried on the Episode itself.
 *
 * On the Episode rather than only in the publish response, because a response lives in the page load that
 * received it. Publishing is the one irreversible outward action in this app, and a screen that forgot it
 * after a refresh would offer to do it again — the same shape that hid a paid video job behind a reload, with
 * a worse ending.
 */
export interface LongEpisodeInstagramPost {
  mediaId: string;
  igUserId: string;
  publishedAt: string;
  caption: string;
}

/** Publishing one Episode's merged final video. Same request shape as the short project's, by design. */
export interface PublishLongEpisodeToInstagramRequest {
  approved: true;
  caption: string;
  igUserId: string;
}
export interface PublishLongEpisodeToInstagramResponse {
  mediaId: string;
  publishedAt: string;
  episode: LongEpisodeDetail;
}

export interface PublishToInstagramRequest {
  approved: true;
  caption: string;
  igUserId: string;
}
export interface PublishToInstagramResponse {
  mediaId: string;
  publishedAt: string;
  project: Project;
}

/**
 * One short-project row in the cross-project video library — an archive view of
 * results, distinct from the Asset Library's input-material role (see AssetLibraryScreen). Only lists a project
 * that has at least one generated scene video; a project that never reached video generation never appears here.
 */
export interface VideoLibraryProjectSummary {
  projectId: string;
  topic: string;
  updatedAt: string;
  sceneCount: number;
  videosReadyCount: number;
  finalVideoAvailable: boolean;
  /** Sum of every recorded Runway spend for this project (RunwayBudget.costsByScene, across every attempt, not just this month) — 0 for a project that never used a real Runway credential (local-fake execution mode). */
  totalActualCostUsd: number;
  /** Same meaning and source as ProjectSummary.aspectRatio (see that field's doc comment) — lets a library card's thumbnail box match the shape this project's videos were actually rendered in. */
  aspectRatio: "9:16" | "16:9";
  /**
   * Derived from ProjectSummary.usedAudio — trimmed to just the two fields a library card actually needs
   * (whether to show a credit-line notice, and what it says), not the full mode/trackId shape, since a
   * "someone comes back later to finally publish this" reader has no use for either. Absent whenever usedAudio itself is (never merged, or a Video Library restore invalidated it — see
   * that field's own doc comment for why restore clears it rather than showing a stale credit line).
   */
  attributionRequired?: boolean;
  attributionText?: string;
}
/**
 * One Episode's results in the video library.
 *
 * A separate array rather than an extra row in `projects`, and that is not tidiness. The same list feeds the
 * Instagram post screen, whose publish route takes a short-project id and reads the short-project repository —
 * an Episode mixed into `projects` would be selectable there and then refuse to publish, which is the exact
 * "both ends fine, middle missing" shape the guards in this repo exist for. A new field nobody reads yet is
 * inert; a new row in an array every consumer already iterates is inherited whether or not it can be handled.
 *
 * Addressed by `projectId` *and* `episodeNumber`: an Episode's clips live under different routes from a short
 * project's, so a card built from this row has to know it is looking at an Episode.
 */
/**
 * One scene image this app generated, listed so it can be found again without remembering its project.
 *
 * The gap this fills is narrow and worth stating exactly: the images are already visible while a project is
 * being reviewed. What has never existed is a way to find "that picture from a while ago" when the project it
 * belongs to is the thing you have forgotten. It is a listing, not a store — the files stay where the project
 * wrote them, because `generated_images` in a stored project holds absolute paths to them and moving a file
 * would leave the project unable to find its own image, with nothing left on disk to undo it by.
 *
 * Viewing only. No edit, no delete: that was the boundary the feature was approved inside.
 */
export interface GeneratedImageSummary {
  projectId: string;
  /** What the person calls this project, so a row is recognisable without opening it. */
  projectTitle: string;
  sceneNumber: SceneNumber;
  /** The file's own last-modified time. Doubles as the cache-buster: regenerating a scene reuses the address. */
  updatedAt: string;
  bytes: number;
}

/** The same for an Episode's scene image, which needs its Episode named as well as its story. */
export interface GeneratedEpisodeImageSummary extends GeneratedImageSummary {
  episodeNumber: number;
  episodeTitle: string;
}

/**
 * Two arrays for the reason the video library has two: a consumer that iterates one of them must not silently
 * inherit rows it cannot address. A short project's image and an Episode's live behind different content
 * routes, and a row that hid that difference would be a link to nowhere.
 */
export interface GetGeneratedImagesResponse {
  projects: GeneratedImageSummary[];
  episodes: GeneratedEpisodeImageSummary[];
}

export interface VideoLibraryEpisodeSummary {
  projectId: string;
  episodeNumber: number;
  /** The Episode's own title, and the story it belongs to — a card needs both to be findable. */
  title: string;
  projectTitle: string;
  updatedAt: string;
  sceneCount: number;
  videosReadyCount: number;
  finalVideoAvailable: boolean;
  /** Same meaning as the short row's: every recorded Runway spend for this Episode, across every attempt. */
  totalActualCostUsd: number;
  aspectRatio: "9:16" | "16:9";
}
export interface GetVideoLibraryResponse { projects: VideoLibraryProjectSummary[]; episodes: VideoLibraryEpisodeSummary[]; }

/**
 * One stored copy of a scene's video, or of the final merged video — the "current" file plus every version
 * archive() displaced into `videos/history/` (or, for the final video, `videos/final/history/`). Ordered newest
 * first by the caller; `isCurrent` marks the one actually served today, not necessarily the most recent by
 * `createdAt` (restoring an older version makes it current again without changing its own creation time).
 * `actualCostUsd` is deliberately not on this type: today's ledger has no versionId to tie a spend row to a
 * specific archived file, and showing an approximate number (matched by timestamp) risked showing a wrong one —
 * a real follow-up, not a silent omission.
 */
export interface VideoVersionSummary {
  versionId: string;
  createdAt: string;
  bytes: number;
  isCurrent: boolean;
}
export interface GetVideoVersionsResponse { versions: VideoVersionSummary[]; }

/**
 * Promotes a past version back to current. Always free (a local file copy, never a provider call) and never
 * destructive: the version that was current before this call is archived first, so restoring is itself
 * reversible, and no version is ever deleted. Restoring a scene version leaves the final merged video (if any)
 * pointing at scene bytes it was not actually rendered from, so the server clears finalVideoPath and reopens
 * VideosApproved for a fresh merge rather than leaving a stale final video looking current.
 */
export interface RestoreVideoVersionRequest { approved: true; }
export interface RestoreVideoVersionResponse { project: Project; }

/**
 * Restoring one of an Episode scene's past clips.
 *
 * Free and non-destructive, exactly like the short project's: the clip that was current is archived first, so
 * the restore is itself reversible and no copy is ever deleted. It does void the Episode's merged final video
 * — the scenes it was built from no longer match — so the Episode comes back with its final path cleared and,
 * if it had been completed, its state back at `videos_approved`. That is why the Episode is in the response:
 * the screen needs the state it is now in, not the one it asked from.
 */
export interface RestoreLongEpisodeVideoVersionResponse { episode: LongEpisodeDetail; }

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
  longProjectStoryBibleWorld: (projectId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/story-bible/world`,
  longProjectStoryBibleStyleAssetLink: (projectId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/story-bible/style-asset-link`,
  longProjectStoryBibleProtagonistAssetLink: (projectId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/story-bible/protagonist-asset-link`,
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
  longProjectEpisodeOutline: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/outline`,
  longEpisode: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}`,
  longEpisodeSettings: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/settings`,
  longEpisodeScriptGeneration: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/script/generations`,
  longEpisodeScript: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/script`,
  longEpisodeScriptApproval: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/script/approval`,
  longEpisodeImageGeneration: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/images/generations`,
  longEpisodeImageReview: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/images/review`,
  /** One scene's generated image, as bytes. The short project's projectImageContent, for an Episode. */
  longEpisodeImageContent: (projectId: string, episodeNumber: number, sceneNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/images/${sceneNumber}/content`,
  /** The Episode's counterpart to `videoContent`. Without it a review card has no address to point a player at. */
  longEpisodeVideoContent: (projectId: string, episodeNumber: number, sceneNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/${sceneNumber}/content`,
  /** The Episode's current video job, so a reloaded screen can find its way back to work already paid for. */
  longEpisodeCurrentVideoJob: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations/current`,
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
  longEpisodeVideoRecovery: (projectId: string, episodeNumber: number, jobId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations/${encodeURIComponent(jobId)}/recovery`,
  longEpisodeVideoReview: (projectId: string, episodeNumber: number, jobId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations/${encodeURIComponent(jobId)}/review`,
  longEpisodeVideoReviewApproval: (projectId: string, episodeNumber: number, jobId: string, sceneNumber: SceneNumber) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations/${encodeURIComponent(jobId)}/review/${sceneNumber}/approve`,
  /**
   * Past copies of one Episode scene's clip, listed / played / restored.
   *
   * Same three shapes as the short project's video library, because they are the same thing: a displaced clip
   * is archived on regeneration either way. Until now the Episode wrote those copies under a timestamped name
   * that nothing in the app could read back, so paid clips accumulated on disk with no way to reach them.
   * `versionId` is `current` or `v001`-style, exactly as VideoVersionSummary already defines it.
   */
  longEpisodeVideoVersions: (projectId: string, episodeNumber: number, sceneNumber: SceneNumber) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/${sceneNumber}/versions`,
  longEpisodeVideoVersionContent: (projectId: string, episodeNumber: number, sceneNumber: SceneNumber, versionId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/${sceneNumber}/versions/${encodeURIComponent(versionId)}/content`,
  longEpisodeVideoVersionRestore: (projectId: string, episodeNumber: number, sceneNumber: SceneNumber, versionId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/${sceneNumber}/versions/${encodeURIComponent(versionId)}/restore`,
  /**
   * Every generated scene image, across every project and Episode.
   *
   * A listing only: each row points at the content route that already serves that image
   * (`imageContent` / `longEpisodeImageContent`), rather than a second address for the same bytes.
   */
  generatedImages: "/images/generated",
  longEpisodeVideoMerge: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/merge`,
  /**
   * The Episode's merged final video, so it can be watched instead of named.
   *
   * The short project has had `videoFinalContent` since its merge screen existed. The Episode's merge screen
   * printed the file path as text and nothing else, and that line lived in React state — a reload left the
   * finished video with no address anywhere in the app. Same hole as the scene clips had before
   * `longEpisodeVideoContent`, one level up.
   */
  longEpisodeFinalVideoContent: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/final/content`,
  longEpisodeNarrationGeneration: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/narration/generations`,
  longEpisodeNarrationReview: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/narration/review`,
  longEpisodeNarrationRegeneration: (projectId: string, episodeNumber: number, sceneNumber: SceneNumber) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/narration/review/${sceneNumber}/regenerate`,
  longEpisodeNarrationContent: (projectId: string, episodeNumber: number, sceneNumber: SceneNumber) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/narration/${sceneNumber}/content`,
  longEpisodeContinuity: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/continuity`,
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
  projectPostDraft: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/post-draft`,
  storyPromptPreview: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/story/preview`,
  storyPromptApproval: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/story/approval`,
  storyRegeneration: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/story/regenerate`,
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
  videoLibrary: "/videos/library",
  videoVersions: (projectId: string, scene: SceneNumber | "final") => `/projects/${encodeURIComponent(projectId)}/videos/${scene}/versions`,
  videoVersionContent: (projectId: string, scene: SceneNumber | "final", versionId: string) => `/projects/${encodeURIComponent(projectId)}/videos/${scene}/versions/${encodeURIComponent(versionId)}/content`,
  videoVersionRestore: (projectId: string, scene: SceneNumber | "final", versionId: string) => `/projects/${encodeURIComponent(projectId)}/videos/${scene}/versions/${encodeURIComponent(versionId)}/restore`,
  audioLibrary: "/audio/library",
  audioLibraryUpload: "/audio/library/upload",
  audioLibraryContent: (trackId: string) => `/audio/library/${encodeURIComponent(trackId)}/content`,
  audioLibraryTrack: (trackId: string) => `/audio/library/${encodeURIComponent(trackId)}`,
  instagramTargets: "/settings/instagram/targets",
  instagramTarget: "/settings/instagram/target",
  instagramConnection: "/settings/instagram/connection",
  instagramApp: "/settings/instagram/app",
  instagramLoginStart: "/settings/instagram/login/start",
  /** The desktop shell hands back the URL its login window landed on. */
  instagramLoginComplete: "/settings/instagram/login/complete",
  /** Where Meta would redirect a browser. Dormant: no address this app can serve is registrable (D-020). */
  instagramLoginCallback: "/settings/instagram/callback",
  /** One Episode's merged final video, published. Mirrors `instagramPublish`, which only ever took a short project. */
  longEpisodeInstagramPublish: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/instagram/publish`,
  instagramPublish: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/instagram/publish`,
  projectAssetMappings: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/assets/mappings`,
  projectAssetMapping: (projectId: string, mappingId: string) =>
    `/projects/${encodeURIComponent(projectId)}/assets/mappings/${encodeURIComponent(mappingId)}`,
  projectAssetMappingReview: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/assets/mapping-review`,
  projectAssetMappingReviewApprove: (projectId: string) =>
    `/projects/${encodeURIComponent(projectId)}/assets/mapping-review/approve`,
  projectAssetMappingSnapshot: (projectId: string, mappingId: string) =>
    `/projects/${encodeURIComponent(projectId)}/assets/mappings/${encodeURIComponent(mappingId)}/snapshot`,

  /**
   * One Episode's asset mappings — the same seven routes as a short project's, under the Episode.
   *
   * Deliberately identical in shape, request and response, because they are the same flow: an Episode owns
   * mappings the way a short project does, and the only thing that differs is which scope is being named. The
   * Episode pipeline used to have its own narrower set (no create, decisions limited to confirm/exclude), and
   * keeping that shape while swapping the implementation underneath would have left the new abilities —
   * linking by hand, Folders, scene-level scope — unreachable from any screen.
   */
  episodeAssetMappings: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/assets/mappings`,
  episodeAssetMapping: (projectId: string, episodeNumber: number, mappingId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/assets/mappings/${encodeURIComponent(mappingId)}`,
  episodeAssetMappingReview: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/assets/mapping-review`,
  episodeAssetMappingReviewApprove: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/assets/mapping-review/approve`,
  episodeAssetMappingSnapshot: (projectId: string, episodeNumber: number, mappingId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/assets/mappings/${encodeURIComponent(mappingId)}/snapshot`,
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
