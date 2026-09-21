import type { RunwayVideoRatio, AspectRatio, AudioMode, FrameFit, GenerationSource, LongEpisodeOutlineStatus, Project, VideoModelOption, ProjectSummary, PhotoCardDurationSeconds, SceneNumber, SceneSubtitleLayout, UsedAudio, VideoJobStatus, VideoModel } from "./domain.js";
import { FINAL_VIDEO_RELATIVE_PATH, MAX_SCENE_COUNT, MIN_SCENE_COUNT } from "./domain.js";
import type { Asset, AssetOwnership, AssetType } from "./asset.js";
import type {
  ApproveProjectAssetMappingReviewRequest,
  BeginProjectAssetMappingReviewRequest,
  CreateProjectAssetMappingRequest,
  ProjectAssetMappingReview,
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
  /** A whole number within CLIP_DURATION_LIMITS (domain.ts) — same rule as ShortProjectSettings.clipDurationSeconds (B1-b). Whether the chosen model makes it is asked at the Episode's video start (LONG_EPISODE_VIDEO_DURATION_OUT_OF_RANGE), not here, because settings outlive a model choice. */
  clipDurationSeconds: number;
  aspectRatio: AspectRatio;
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
  /**
   * The art direction, and the only part of a Long Project's settings that reaches the image model.
   *
   * A short project has had this since the beginning; an Episode passed `""` where the style line goes, so every
   * Episode picture was drawn from the scene text and the reference photos alone and nothing a person said about
   * how the work should look ever reached a paid call. The comment on `styleLineFor` said as much in one clause
   * — "LongProjectSettings has no equivalent visual-style fields today" — and that clause was the whole feature
   * gap (Cowork Round 475).
   *
   * Four flat fields rather than the short project's nested `styleNotes`. Its seven fields include three that go
   * somewhere else entirely, and building all seven here would leave three boxes on the screen that do nothing —
   * which is the shape of defect this repository spent a day removing. These four are exactly what the style
   * line is made of, and `LongProjectSettings` is flat, so a lone nested object would be a second container for
   * one idea.
   *
   * All empty is the default and means no style line at all — byte-identical to what Episodes sent before these
   * existed, so nothing changes until somebody fills a box.
   *
   * These reach the picture and not the script. Sitting beside `tone` and `notes`, which reach the script and
   * not the picture, that distinction is invisible unless the screen says it — and not saying it is the
   * misunderstanding this gap grew out of.
   */
  visualStyle: string;
  color: string;
  lighting: string;
  /**
   * What the picture should not contain, sent as its own `Avoid:` sentence rather than folded into the style
   * list — an item in a comma-separated list of styles reads as something to include.
   *
   * Present because the short project's line already has it: `styleLineFor` builds `Style: … . Avoid: …`, and a
   * Long Project whose style line could never carry the second half would be quietly the weaker of the two for
   * no reason anyone chose. Never sent to the video model, which reads negatives backwards
   * (video-preview.service.ts).
   */
  avoid: string;
}

/** What a client actually sends: episodeDurationSeconds is derived server-side (sceneCount * clipDurationSeconds) and is rejected as an unsupported field if included — same shape as ShortProjectSettingsInput. */
/**
 * A save request. `episodeDurationSeconds` is dropped because the server recomputes it, and the four style
 * fields are optional because absent and "" mean the same thing to them — no style line — so a caller that has
 * never heard of them keeps working and gets exactly the behaviour it had before they existed. Every other
 * field stays required: leaving one out of a settings save is a request that means to blank it, and the ones
 * that can be blanked are already strings.
 */
export type LongProjectSettingsInput = Omit<LongProjectSettings, "episodeDurationSeconds" | "visualStyle" | "color" | "lighting" | "avoid">
  & Partial<Pick<LongProjectSettings, "visualStyle" | "color" | "lighting" | "avoid">>;

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
   * Whether this Episode has a continuity memo saved.
   *
   * The memo is written by hand, on the Episode's own continuity screen, and nothing writes it automatically.
   * A later Episode's script prompt reads every earlier Episode's memo and silently skips the ones that are
   * absent — so an Episode without one contributes nothing to any script written after it, and the only way to
   * find that out today is to read the finished script, after it has been paid for.
   *
   * Optional on purpose, and absent means "not determined here" rather than "no memo". A screen that renders
   * the absence as 메모 없음 would be stating something it never checked.
   */
  continuitySaved?: boolean;
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
/**
 * What an uploader may state about where a track came from.
 *
 * The array is the source and the type is derived from it — audio-library.service.ts checks an upload against
 * this exact list, and a union here plus a second list there is the shape that made a written value unreadable
 * once already (Cowork Round 436).
 */
export const AUDIO_LICENSE_KINDS = ["cc0", "cc-by", "purchased", "self-made", "other"] as const;
export type AudioLicenseKind = (typeof AUDIO_LICENSE_KINDS)[number];

/**
 * Every state an Episode can be in, **in the order the work happens** — with two exceptions that are not
 * points on that line at all: `interrupted` and `failed` sit wherever the run stopped.
 *
 * The ordering is load-bearing, not incidental: the frontend derives its "which step comes next" answer
 * from this array rather than writing the sequence out again (utils/longEpisodeLabels.ts). A status added
 * in the wrong place therefore tells someone the wrong step is next, so add one where it belongs, not at
 * the end. A test pins the derived order so an accidental move is visible rather than silent.
 */
export const LONG_EPISODE_STATUSES = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images", "images_ready", "images_review", "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved", "interrupted", "rendering", "completed", "failed"] as const;
export type LongEpisodeStatus = (typeof LONG_EPISODE_STATUSES)[number];

/**
 * The states an Episode passes through before any picture of its own exists.
 *
 * Stated once, negatively, because the useful question is always the other one — "does this Episode have
 * pictures yet?" — and every place that answered it by listing the states where it is true has eventually got
 * the list wrong. There were four such lists, not the three this comment first claimed: a fourth in
 * episode-story-bible-mapping-sync.ts was found spelled out again a week later and folded in. The one in
 * episode-continuity-reference.ts stopped at
 * `videos_approved` and never named `rendering` or `completed`, so an Episode became **less** usable as a
 * continuity reference the more finished it was: 캡틴D's project 12 had three consecutive Episodes with every
 * scene approved and a valid final image, all reporting `available: false`, and every following Episode's
 * pictures were bought with no hand-off from the one before (Cowork Round 473).
 *
 * A list of what is *not* yet done fails the other way. A status added later is, by default, one where pictures
 * exist — and the callers all check the pictures themselves anyway, so the wrong guess costs a file read rather
 * than a silently missing reference on a paid generation.
 *
 * Not a gate on its own. `episode-continuity.service.ts`'s `eligible` is deliberately narrower and means
 * something else (far enough along to write a hand-off note); do not fold the two together. Nor with
 * long-projects.service.ts's BEFORE_IMAGE_GENERATION_STARTS, which is this list minus `generating_images`
 * because a run already spending money must lock the aspect ratio before any file has landed.
 */
export const LONG_EPISODE_STATUSES_BEFORE_IMAGES = ["planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review", "asset_mapping_approved", "generating_images"] as const;
/** Whether an Episode in this state has generated pictures. Says nothing about whether they are approved or readable — ask the files for that. */
export function longEpisodeHasImages(state: LongEpisodeStatus): boolean {
  return !(LONG_EPISODE_STATUSES_BEFORE_IMAGES as readonly LongEpisodeStatus[]).includes(state);
}

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
  /**
   * When this Episode was last written — which includes the moment its final video was merged.
   *
   * Carried so a player can bust its cache with it: an Episode's clips and final video keep the same address
   * across a re-merge, so without a changing value the browser happily shows the previous render.
   */
  updatedAt: string;
  /**
   * Whether this Episode has narration audio on disk — the same "real files exist" meaning the short project's
   * ProjectSummary.narrationAvailable carries.
   *
   * Without it a merge screen has no basis for locking the narration options, so it would either offer a mix
   * the server refuses or hide one that would have worked. Guessing is the one thing it must not do.
   *
   * Optional because only the Episode's own GET actually looks: the responses that carry an Episode alongside
   * something else (a video job's progress, a merge result) do not go to disk for this, and reporting `false`
   * from those would be a claim nobody checked. Absent means "not determined here", never "no narration".
   */
  narrationAvailable?: boolean;
  /** The scene subtitle layout last used for this Episode's final render. */
  sceneSubtitleLayout?: SceneSubtitleLayout;
  /**
   * What the last merge actually used, copied at merge time rather than looked up later.
   *
   * This is the credit line's only source. Without it an Episode built on a CC BY track shows no attribution
   * anywhere — not because the value is empty but because there is nowhere to read it from — and it goes to
   * Instagram uncredited. That is precisely the failure D-003 exists to prevent, and the Episode publish path
   * shipped before this field did.
   */
  usedAudio?: UsedAudio;
  /**
   * The shape this Episode's images and clips were actually rendered in, read from the project it belongs to.
   *
   * Carried because three screens were each assuming "9:16" on their own. The short project has had this field
   * from the start for the same reason its own doc comment gives, and an Episode that guesses is worse than a
   * project that guesses: the warning a screen wants to raise here — "changing this leaves every image you
   * already paid for in the wrong shape" — cannot stand on a guess, or the warning becomes the guess.
   *
   * Optional for the same reason `narrationAvailable` is: the Episode's own GET reads the project and fills it,
   * and responses that carry an Episode alongside something else leave it absent rather than asserting a value
   * they never looked up.
   */
  aspectRatio?: AspectRatio;
  /**
   * What this Episode has to show for a failure, and where its finished video is.
   *
   * A failed Episode could say it had failed and not why; a completed one could not tell a screen that a final
   * video exists without the screen inferring it from the status. Both were on the stored record already and
   * neither came out.
   */
  errors?: string[];
  /** Where the merged file sits inside this Episode — for display. To open it, use `openablePath`; see MergeLongEpisodeVideosResponse.finalVideoPath for why the two differ. */
  finalVideoPath?: string;
  finalVideoGenerationSource?: GenerationSource;
  /** The same file addressed from the project root, safe to hand to the desktop bridge. Absent whenever `finalVideoPath` is. */
  openablePath?: string;
  /** Present once this Episode has been published to Instagram, so a reload still knows. */
  instagramPost?: LongEpisodeInstagramPost;
  /**
   * Posts this Episode has had published and then forgotten, oldest first.
   *
   * Kept because clearing `instagramPost` otherwise erases the fact that something may still be up on the
   * account: a person who answers "yes, I deleted it" and did not would leave the app with no memory of a
   * post that exists. This is the only memory this app has of an action it cannot undo or re-check, so it is
   * carried out to the screen rather than only written to disk — a record nothing reads is a record that
   * quietly stops being kept correctly.
   */
  previousInstagramPosts?: LongEpisodeInstagramPost[];
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
  status: SceneReviewStatus;
  updatedAt: string;
  generationSource?: GenerationSource;
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
/**
 * Which already-paid-for images were made from a script the Episode has since moved past.
 *
 * Same method as LongEpisodeVideoStaleness and the short project's SceneStaleness: rebuild the prompt from the
 * scene as it stands and compare it to the one recorded when that image was generated. Only scenes that were
 * actually generated have a recorded prompt — a placeholder standing in for an image nobody paid for records
 * nothing, and so is never reported as behind, which is correct: there is nothing to be behind.
 *
 * Images generated before the prompt was recorded also have no record, and are likewise absent. That is a real
 * limit and the honest one: this list says "these are known to be behind", never "the rest are known current".
 */
export interface LongEpisodeImageStaleness {
  imageStale: SceneNumber[];
  /**
   * Scenes whose pictures are behind the *art direction*, not the script.
   *
   * The four visual-style boxes are project-wide and they become one line of every scene's prompt. Saving them
   * therefore moves every already-generated scene at once, with nobody having touched a single scene's words.
   * Folded into `imageStale` those scenes carry the sentence "장면 내용이 바뀐 뒤로" — which sends someone to
   * re-read a script that is exactly as they left it. That is the same failure as saying nothing: they look, find
   * nothing changed, and cannot tell whether the app is wrong or they are.
   *
   * A scene appears in exactly one of the two lists. The comparison ignores both sides' style line, so a line
   * added, changed, or removed all land here, and anything else about the prompt lands in `imageStale`.
   */
  styleStale: SceneNumber[];
  /**
   * Scenes whose pictures were drawn from reference images this scene would no longer use.
   *
   * The prompt comparison above cannot see this. An Episode sends its mapped Assets to the image model as
   * bytes, not as text in the prompt, so changing the protagonist to a different Folder — or its representative
   * drawing being replaced, or the mapping being excluded — alters every picture the next run would make while
   * leaving the recorded prompt identical. Before this field there was nothing on disk that could tell.
   *
   * Separate from `imageStale` rather than folded into it because the two mean different things to the person
   * reading them: one says the description changed, the other says the character did. They also arrive from
   * different actions — editing the script versus editing the Story Bible or the mapping — and a screen that
   * merged them would be unable to say which happened.
   *
   * The same "known to be behind" limit applies: only scenes with a recorded reference list appear, so pictures
   * generated before this was recorded are absent rather than wrongly reported.
   */
  referenceStale: SceneNumber[];
}
/**
 * One Story Bible Asset link this Episode's own mapping does not match.
 *
 * An Episode that has already bought pictures keeps the mapping those pictures were made from — that is the
 * rule, so that the record and the files agree — which means changing the Story Bible protagonist leaves that
 * Episode entirely untouched, and `referenceStale` is silent about it by construction. Only this can say "this
 * Episode was drawn with a different person than the story now has".
 *
 * Both names are carried so the screen can write that sentence without a second round trip, and both fall back
 * to the id when the Asset is gone — an id the reader can quote beats a name the screen cannot show.
 *
 * A statement of difference, not of error. An Episode drawn before the change is allowed to keep the character
 * it was drawn with; whether to spend money redrawing it is the person's decision, not the screen's.
 */
/** The Story Bible links an Episode can drift from. A list, so a response guard can read it instead of copying it. */
export const STORY_BIBLE_LINK_KINDS = ["protagonist", "style"] as const;
export type StoryBibleLinkKind = (typeof STORY_BIBLE_LINK_KINDS)[number];

export interface LongEpisodeStoryBibleLinkDrift {
  link: StoryBibleLinkKind;
  storyBibleAssetId: string;
  storyBibleAssetName: string;
  episodeAssetId: string | null;
  episodeAssetName: string | null;
}
/**
 * What an Episode's image generation would actually buy, before anything is sent.
 *
 * The confirmation used to quote every scene — `sceneCount × per-image` — while the generation itself skips any
 * scene that already has a usable picture and charges nothing for it. So a retry after three scenes succeeded
 * was quoted at six and cost three, and a person deciding whether they could afford it was deciding on a number
 * the app already knew was wrong. Overstating a price is not the safe direction: it stops people doing work
 * they could afford.
 *
 * Free and provider-free, like the video preflight: this reads files on disk, never the provider.
 */
export interface LongEpisodeImageGenerationPreview {
  sceneNumbers: SceneNumber[];
  /** The scenes that would actually be generated — the ones this run charges for. */
  generatableSceneNumbers: SceneNumber[];
  /** Scenes that already have a usable picture and would be left alone, at no cost. */
  reusableSceneNumbers: SceneNumber[];
  /** `generatableSceneNumbers.length × per-image`, never the scene count. */
  estimatedCostUsd: number;
  /** Same meaning and scope as StartImageGenerationResponse.budget (see that field's doc comment). */
  budget?: BudgetPreview;
}
export interface GetLongEpisodeImagePreviewResponse { preview: LongEpisodeImageGenerationPreview; }

/**
 * How far an Episode's image generation has got, while it is still running.
 *
 * The generation loop is sequential — `for (const scene of sceneNumbersFor(...))`, one paid call at a time — so
 * at any moment exactly one scene is being drawn. The screen could not see that: its only reading during a run
 * is the Episode's own state, which says `generating_images` and nothing more, so all six rows said 만드는 중
 * at once. That is not vague, it is wrong, and it is why 캡틴D asked for this.
 *
 * Read from the files, never from a record of the run. Every finished scene has already been written to
 * `scene{n}.png` and validated before the loop moves on, and the loop skips scenes that already have one — so
 * the disk holds the whole answer and no new state has to be kept in step with it. A separate job record would
 * eventually disagree with the pictures, and on that day the screen would report an image that is not there.
 *
 * Answerable mid-run, which the review endpoint deliberately is not: `get()` asserts every scene's image exists
 * because a review of missing pictures is meaningless. This exists precisely for the moment when they do not
 * all exist yet, so it asserts nothing and simply reports.
 *
 * Field names match LongEpisodeVideoProgress on purpose, so the two screens can say the same thing the same way.
 */
/**
 * How far a short project's image generation has got, while it is still running.
 *
 * The Episode side of this shipped first because that was where the money was going; the short project has the
 * same loop and had the same blind spot, and Cowork named it in the same round (Round 468). One paid call at a
 * time, and a screen that could only read the workflow state — so every scene said 만드는 중 at once while five
 * of them had not been started.
 *
 * Read from what the generation itself writes: this loop records each scene on the project and validates the
 * file before moving to the next, so a scene is done when the record names its file and that file is a readable
 * PNG. That is the same question the loop asks before skipping a scene, which is what keeps this answer and the
 * work from disagreeing — a run record kept only for progress would eventually claim a picture nobody has.
 *
 * Field names match LongEpisodeImageProgress, which matches LongEpisodeVideoProgress, so all three screens say
 * the same thing the same way.
 */
export interface ImageGenerationProgress {
  /** Every scene in the project, so the screen can draw the full list without a scene-count constant of its own. */
  sceneNumbers: SceneNumber[];
  /**
   * Scenes with a usable picture right now — not scenes this run paid for.
   *
   * A re-run counts the previous run's pictures as complete from its first moment, which is the truth about the
   * pictures and what the loop does with them, but a different number from what was bought. Nothing here should
   * be added up into money.
   */
  completedSceneNumbers: SceneNumber[];
  /**
   * The scene being drawn right now: the first one not yet complete.
   *
   * Absent unless the project is actually generating. Naming the next unfinished scene while nothing is running
   * would say "this is being made at this moment" of a scene nobody has started.
   */
  currentSceneNumber?: SceneNumber;
}
export interface GetImageGenerationProgressResponse { project: Project; progress: ImageGenerationProgress; }

export interface LongEpisodeImageProgress {
  /** Every scene in the Episode, so the screen can draw the full list without a scene-count constant of its own. */
  sceneNumbers: SceneNumber[];
  /**
   * Scenes that have a usable picture on disk right now.
   *
   * Not "scenes this run paid for". A re-run reports the previous run's images as complete from its first
   * moment, which is the truth about the pictures and exactly what the loop does with them (it skips them), but
   * it is a different number from what was bought — LongEpisodeImageGenerationPreview.generatableSceneNumbers is
   * the one that answers cost, and nothing here should be added up into money.
   */
  completedSceneNumbers: SceneNumber[];
  /**
   * The scene being drawn right now: the first one with no usable picture yet.
   *
   * Absent unless the Episode is actually generating. A scene number here means "this is being made at this
   * moment"; reporting the next unfinished scene while nothing is running would say that of a scene nobody has
   * started, which is the same lie in the other direction.
   */
  currentSceneNumber?: SceneNumber;
}
/** `episode` rides along so a screen watching a run can poll this one route instead of this plus the Episode. */
export interface GetLongEpisodeImageProgressResponse { episode: LongEpisodeDetail; progress: LongEpisodeImageProgress; }


export interface GetLongEpisodeImageReviewResponse {
  episode: LongEpisodeDetail;
  reviews: LongEpisodeImageReview[];
  staleness: LongEpisodeImageStaleness;
  /** Story Bible links this Episode's own mapping no longer matches. Empty means they agree — see the flag below for the case where nobody could tell. */
  storyBibleLinkDrift: LongEpisodeStoryBibleLinkDrift[];
  /**
   * Present only when the Story Bible could not be read, so the list above is silence rather than agreement.
   *
   * The two used to be the same empty array. Silence is not neutral on this screen: the paid regenerate button
   * sits under it, and that list is what produces the one sentence able to say an Episode was drawn with a
   * different character than the story now has. A malformed story_bible.json therefore turned off the warning
   * that exists to stop somebody paying twice for the wrong face — quietly, and in the same week that warning
   * was needed (Cowork Round 484 asked which other routes still conflate the two).
   *
   * A missing Story Bible is not this. A project that has none has nothing for its Episodes to disagree with,
   * which is an ordinary answer and stays an empty list.
   */
  storyBibleLinkDriftUnreadable?: true;
  /** Same meaning and scope as StartImageGenerationResponse.budget (see that field's doc comment). */
  budget?: BudgetPreview;
}
export interface ApproveLongEpisodeImageReviewRequest { approved: true; }
export interface ApproveLongEpisodeImageReviewResponse extends GetLongEpisodeImageReviewResponse {}
/**
 * Takes back one scene's approval — 캡틴D asked to be able to press 확정 완료 again and undo it.
 *
 * `approved: false` rather than an empty body, for the same reason approving carries `approved: true`: a request
 * that changes what a person has already signed off on says so in words, and an empty body is a request that
 * could have been sent by accident.
 *
 * Refused once the Episode has moved on to video work — the same gate regeneration uses. An Episode whose clips
 * were bought from these pictures would otherwise be left with a record saying the pictures are still under
 * review, and the record and the paid files would disagree. Undoing that far back is a decision about the
 * videos, made on the screen that owns them.
 */
export interface UnapproveLongEpisodeImageReviewRequest { approved: false; }
export interface UnapproveLongEpisodeImageReviewResponse extends GetLongEpisodeImageReviewResponse {}
export interface RegenerateLongEpisodeImageReviewRequest {
  approved: true;
  /**
   * Same meaning and lifetime as RegenerateImageReviewRequest.additionalInstruction: one-off direction for this
   * single regeneration, appended as the prompt's last line and never stored back into the scene.
   *
   * An Episode's regeneration button used to have no way to say *what to change*, so a person who disliked an
   * image could only buy the same prompt again and hope. The short project has had this since its own review
   * screen existed, and the Episode's narration regeneration already takes one — this was the odd one out.
   *
   * The prompt recorded for staleness stays the plain scene prompt, not the instructed one. Recording the
   * instructed text would leave that scene permanently marked as behind its own script, which is what
   * staleness would then be measuring instead of the thing it exists to measure.
   */
  additionalInstruction?: string;
}

/**
 * Explicit re-submission of one Episode scene's clip, with optional one-off direction.
 *
 * `additionalInstruction` is appended to the Runway prompt for this submission only. The record keeps both:
 * `prompt` is what was actually sent (the submission has to be reproducible from it), and the scene's plain
 * prompt remains the baseline staleness compares against.
 */
export interface RegenerateLongEpisodeVideoRequest {
  approved: true;
  additionalInstruction?: string;
}
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
  /**
   * Same meaning and same order as VideoPromptPreview.omittedSections — see that field. Missing here while
   * the short project has had it since it shipped, and this is the side that needs it more: measured on the
   * real data, Episode prompts run 493-902 characters against a 1,000 limit while the short project's run
   * 599-732. The Episode is the one that will cross it first, and until now it crossed it in silence.
   */
  omittedSections?: string[];
}
export interface GetLongEpisodeVideoPreviewResponse {
  confirmationId: string;
  model: VideoModel;
  ratio: RunwayVideoRatio;
  /** The Episode's own scene length (clipDurationSecondsPerScene): its duration ÷ its scene count, a whole number within CLIP_DURATION_LIMITS. */
  durationSecondsPerScene: number;
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
export interface StartLongEpisodeVideoGenerationResponse {
  jobId: string;
  acceptedSceneNumbers: SceneNumber[];
  episode: LongEpisodeDetail;
  /**
   * Same meaning as LongEpisodeVideoProgress.paidProvider, answered here as well because the screen shows a
   * progress state of its own between starting and the first poll. Without it that moment is the one place the
   * screen has to guess whether the job it just started costs money — which is the guess this field exists to
   * remove.
   */
  paidProvider: boolean;
}
/**
 * What to do about a scene that failed, and whether it was charged for anyway.
 *
 * A failure used to reach the screen as one sentence with the provider's code melted into it — "An unexpected
 * error occurred. (Runway code: INTERNAL.BAD_OUTPUT.CODE01)" — and the client looked that whole string up in a
 * table of known codes, missed, and fell back to "영상 생성에 실패했습니다. 잠시 후 다시 시도해 주세요."
 *
 * 🔴 On 2026-09-05 that advice was wrong and cost money. The provider's own documentation lists
 * INTERNAL.BAD_OUTPUT as "the input had text or logos on it, or the prompt asked for text" — waiting changes
 * nothing, and every press is charged. Captain D pressed it, because the screen told him to.
 *
 * `remedy` is three values rather than a boolean because the provider's own `retryable: yes` means "this may
 * have been transient", not "send the same input again". BAD_OUTPUT is retryable and permanently fails until
 * the input changes. Folding those two into one word is what produced the $0.25 nobody got anything for.
 *
 * `billedOnFailure` is required, not optional. It is the fact a person needs before pressing, and leaving it
 * absent is what "we did not think about it" looks like from the screen.
 */
export const SCENE_FAILURE_REMEDIES = ["retry", "change_input", "not_retryable"] as const;
export type SceneFailureRemedy = (typeof SCENE_FAILURE_REMEDIES)[number];

/**
 * The provider codes this app knows the meaning of, in one table.
 *
 * The remedy and the sentence were about to live in two places — the adapter decided `remedy` from the code,
 * and the screen would have needed its own list of the same codes to say anything but a fallback. Two lists
 * keyed on the same strings is the copy this repository keeps finding, and this one would drift in the worst
 * direction: a code whose remedy says "change the input" beside a sentence that says "try again shortly".
 *
 * That contradiction is live right now. The screen's message table is keyed on this app's own categories, so a
 * Runway task failure — whose category is the provider's raw English sentence — misses and falls back to
 * "영상 생성에 실패했습니다. 잠시 후 다시 시도해 주세요." That is the exact sentence that was followed twice and
 * charged twice on 2026-09-05, and it now appears directly above the correct advice.
 *
 * Prefixes, because the codes carry a variant suffix (`INTERNAL.BAD_OUTPUT.CODE01`). Causes only: whether the
 * attempt was charged is `billedOnFailure`'s sentence to make, and saying it twice is how two sentences about
 * one person's money end up disagreeing.
 *
 * From docs.dev.runwayml.com/errors/task-failures.
 */
export const PROVIDER_TASK_FAILURES: readonly { prefix: string; remedy: SceneFailureRemedy; billedOnFailure: boolean; message: string }[] = [
  {
    prefix: "SAFETY.INPUT", remedy: "not_retryable", billedOnFailure: false,
    message: "첫 프레임이 Runway의 안전 검사에 걸렸습니다. 같은 그림으로는 통과하지 않으니 그 장면의 이미지를 바꿔야 합니다.",
  },
  {
    prefix: "SAFETY.OUTPUT", remedy: "not_retryable", billedOnFailure: true,
    message: "만들어진 영상이 Runway의 안전 검사에 걸렸습니다. 장면 지시를 바꾸지 않으면 같은 결과가 나옵니다.",
  },
  {
    prefix: "INTERNAL.BAD_OUTPUT", remedy: "change_input", billedOnFailure: true,
    message: "Runway가 이 장면을 만들지 못했습니다. 첫 프레임에 글자나 로고가 있거나 장면 지시가 글자를 요구할 때 가장 흔합니다 — 그쪽을 바꿔야 결과가 달라집니다.",
  },
  {
    prefix: "ASSET.INVALID", remedy: "change_input", billedOnFailure: true,
    message: "Runway가 첫 프레임 파일을 읽지 못했습니다. 그 장면의 이미지를 다시 만든 뒤에 다시 시도해 주세요.",
  },
];

/**
 * What is known about one provider code, or nothing.
 *
 * Nothing is an ordinary answer and must stay one: a code this table has never heard of is handled by the
 * caller's own default — `retry`, billed, and the hedged sentence — rather than by guessing here.
 */
export function providerTaskFailure(providerCode: string | undefined): (typeof PROVIDER_TASK_FAILURES)[number] | undefined {
  if (!providerCode) return undefined;
  const code = providerCode.toUpperCase();
  return PROVIDER_TASK_FAILURES.find((entry) => code.startsWith(entry.prefix));
}

/**
 * The `details` of VIDEO_MERGE_CLIPS_INVALID and LONG_EPISODE_MERGE_CLIPS_INVALID, when the server can tell which
 * scenes stopped the merge: not approved, no usable clip on disk, or a clip ffprobe cannot read. Absent when it
 * cannot (a review or record file that will not parse at all) — a guess at a scene would send someone to fix the
 * wrong one. Twelve scenes checked by hand is what the error cost before (Cowork Round 769).
 */
/**
 * The `details` of STORY_PROMPT_STORAGE_ERROR: whether the paid Story request had already gone out when the write
 * failed. Four places raise the code and only one of them is after the call (saving the finished script); the other
 * three — reading the template, marking the project as generating, resetting it for a regeneration — are before it.
 * So "a script may already exist, check before pressing again" is true for one and false for three, and the code
 * alone cannot say which (Cowork Round 786, CLI Round 787).
 */
export interface StoryStorageErrorDetails {
  requestSent: boolean;
}

export interface MergeClipsInvalidDetails {
  sceneNumbers: SceneNumber[];
}

/**
 * The `details` of VIDEO_MERGE_FAILED and LONG_EPISODE_MERGE_FAILED when the render stopped inside FFmpeg: fitting
 * one scene's clip to the frame (and which scene), joining the fitted clips, or laying the music under the result.
 * Absent when it stopped anywhere else (writing a file, an empty output) — the step is then not FFmpeg's to name.
 */
export type MergeFailedDetails =
  | { stage: "scene"; sceneNumber: SceneNumber }
  | { stage: "join" }
  | { stage: "music" };

export interface SceneFailure {
  /** This app's own category, unchanged — still what a screen picks its sentence from. */
  category: string;
  /** The provider's code, alone. Its free-text message is deliberately not carried: a code can be reasoned about, a sentence cannot. */
  providerCode?: string;
  /**
   * Present only when one of the three remedy sentences is true — the rule image and narration failures already
   * follow. Absent for an interrupted submission (the task may already exist, so "send it again" could buy the
   * scene twice — its category's sentence says to check the Runway account first) and for the two refusals made
   * before anything was sent (the budget is spent, or its ledger cannot be read: raising the limit or fixing the
   * file is the fix, not the button). Screens draw no advice line when it is absent (Cowork Round 773).
   */
  remedy?: SceneFailureRemedy;
  billedOnFailure: boolean;
  /**
   * What the provider says this attempt cost, in its own credits (Runway: 1 credit = $0.01) — read from the
   * finished task's `cost.credits`, which a failed or cancelled task carries too ("Fully refunded tasks report 0").
   * When present, `billedOnFailure` is this number's answer rather than the rule's guess. Absent for a failure the
   * provider never priced (a timeout, a refusal before sending) and for records from before it was read.
   */
  billedCredits?: number;
}

/**
 * The `details` of every image failure the provider answered — IMAGE_PROVIDER_ERROR, IMAGE_REVIEW_PROVIDER_ERROR and
 * LONG_EPISODE_IMAGES_PROVIDER_ERROR, first generation and regeneration, short and long (docs/00_NOW.md ②-2).
 *
 * On the error, not on `ImageGenerationProgress`, because image generation is one synchronous request: when a scene
 * fails the request answers with this error, and nothing reads the progress afterwards. A failure field there would
 * be seen by no one.
 *
 * The names are `SceneFailure`'s on purpose, so a screen that draws both pipelines reads one vocabulary.
 */
/**
 * What the failed request was doing, which decides what pressing the button again does.
 *
 * `run` — a multi-scene generation stopped at `sceneNumber`; the scenes before it are saved and a re-run continues
 * from there. `scene` — one scene was being redrawn; the others were never touched and nothing "continues".
 * The Long Episode sends both under one error code, so the code cannot tell a screen which sentence is true.
 */
export const IMAGE_FAILURE_SCOPES = ["run", "scene"] as const;
export type ImageFailureScope = (typeof IMAGE_FAILURE_SCOPES)[number];
/** The same two scopes, named for what they are now: narration failures carry them too (docs/00_NOW.md ②-3). */
export const SCENE_FAILURE_SCOPES = IMAGE_FAILURE_SCOPES;
export type SceneFailureScope = ImageFailureScope;

/**
 * Every category an OpenAI failure is classified into — the closed list the backend's `classifyOpenAiHttpError`
 * answers with and puts into `details.category` for image, narration and story failures.
 *
 * Published so a screen's sentence table can be keyed on it (`Record<OpenAiErrorCategory, string>`) instead of on
 * `string`: two narration tables keyed `server_error`, a name the backend never sends, and every OpenAI 5xx fell to
 * the fallback sentence with nothing to say so (Cowork Round 769/770).
 */
export const OPENAI_ERROR_CATEGORIES = [
  "authentication", "quota_or_permission", "rate_limit", "server", "network",
  "invalid_request", "safety_policy", "context_length_exceeded", "unknown",
] as const;
export type OpenAiErrorCategory = (typeof OPENAI_ERROR_CATEGORIES)[number];
/**
 * The two the adapters add on top when OpenAI answered 200 with nothing usable — a body with no bytes, or one that
 * would not parse. They reach `details.category` too, so a table that means to cover every sent value covers these.
 */
export const OPENAI_FAILURE_CATEGORIES = [...OPENAI_ERROR_CATEGORIES, "empty_response", "invalid_response"] as const;
export type OpenAiFailureCategory = (typeof OPENAI_FAILURE_CATEGORIES)[number];

/**
 * The `details` of a per-scene paid-provider failure that arrives as an error — images and narration, both
 * pipelines. `ImageGenerationFailureDetails` is the same shape under the name it was first given.
 */
export type SceneProviderFailureDetails = ImageGenerationFailureDetails;

export interface ImageGenerationFailureDetails {
  /** This app's own provider category, unchanged — screens still pick their sentence from it. */
  category: string;
  /** The scene that was in flight when the provider refused. For a `run`, the ones before it are saved and a re-run reuses them. */
  sceneNumber: SceneNumber;
  /** A stopped multi-scene run, or one scene's redraw — see IMAGE_FAILURE_SCOPES. */
  scope: ImageFailureScope;
  /**
   * Whether this failed attempt was counted against the month's budget — the meaning it has on the video side too,
   * where a billed failure is exactly the one the ledger records.
   *
   * 🟠 Not a statement about what OpenAI charged. Every paid image call is recorded at its estimate in a `finally`,
   * success or failure (local-image-generation.service.ts), so for these codes this is `true`; whether OpenAI itself
   * billed a refused call is not something the app can see. A screen should say the budget was used, not that the
   * provider charged.
   */
  billedOnFailure: boolean;
  /**
   * Present only when one of `SceneFailureRemedy`'s three sentences is true for this category.
   *
   * 🔴 Absent for `authentication` and `quota_or_permission`, deliberately. Every remedy sentence is about the scene's
   * input — "send it again", "the input is the cause", "change the script or references" — and for a bad key or an
   * exhausted quota all three are false: resending fails the same way, and changing the scene fixes nothing. The
   * category's own sentence ("check the key in API settings") is the right advice there, so the screen keeps it.
   */
  remedy?: SceneFailureRemedy;
}

export interface LongEpisodeVideoProgress {
  /** Same meaning and rule as GenerationProgressResponse.paidProvider — always present, never inferred from a missing cost line. */
  paidProvider: boolean;
  jobId: string;
  status: VideoJobStatus;
  currentSceneNumber?: SceneNumber;
  completedSceneNumbers: SceneNumber[];
  failedSceneNumbers: SceneNumber[];
  /** Same meaning and scope as GenerationProgressResponse.sceneNumbers (see that field's doc comment) — lets the Frontend render the full scene set without a local scene-count constant. */
  sceneNumbers: SceneNumber[];
  episode: LongEpisodeDetail;
  /**
   * Same meaning and scope as GenerationProgressResponse.model (see that field's doc comment): **the job's own**
   * model, read from its records rather than today's setting.
   *
   * Here because the two pipelines' failure cards are the same card. The short side names the model that failed
   * and says the setting will not move this job's retry; an Episode failing the same way with the model left
   * out would be the same code answered two different amounts, which is what putting `runwaySceneError` in one
   * place was for. `episode-videos.service.ts`'s `progressFor` already computes this for its own estimate.
   */
  model: VideoModel;
  /** Same meaning and scope as GenerationProgressResponse.sceneErrors (see that field's doc comment). */
  sceneErrors?: Record<SceneNumber, string>;
  /** The same failures, with the provider's code, what to do about it, and whether it was charged — see SceneFailure. `sceneErrors` stays until every screen reads this instead. */
  sceneFailures?: Record<SceneNumber, SceneFailure>;
  /** Same meaning and scope as GenerationProgressResponse.retryEstimate, `pendingSceneCount` included (see that field's doc comment). */
  retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview; pendingSceneCount: number };
}
/** costUsd: actual cost recorded for this scene's video across every attempt, including past regenerations; absent when nothing has been recorded. */
export interface LongEpisodeVideoReview { sceneNumber: SceneNumber; status: SceneReviewStatus; updatedAt: string; costUsd?: number; }
/**
 * Which already-paid-for clips no longer match the script they were made from.
 *
 * Computed the same way the short project's SceneStaleness is — by rebuilding the prompt from the scene as it
 * stands now and comparing it to the one recorded when that clip was generated — never a stored flag, so there
 * is nothing to keep in sync. A scene with no record is absent rather than listed: nothing has been made yet,
 * so nothing is behind.
 *
 * Only `videoStale`. The short project also reports images and narration, and this deliberately does not: an
 * Episode's image generation records no prompt anywhere, so an `imageStale: []` here would be a list nobody
 * computed presented beside one that was — which is how a screen ends up trusting a blank. When the Episode's
 * image path starts recording its prompt, the field can be added and will mean something.
 */
/**
 * One list, unlike the short project's, and deliberately: an Episode cannot reach SceneStaleness.videoFormatStale's
 * case. Its clip length is its own snapshot (`duration_seconds` on the Episode file, not the project setting),
 * and the one route that rewrites it refuses once a script exists — which every Episode with videos has. Its
 * orientation does come from the live project setting, but changing the aspect ratio is refused once any
 * Episode has passed the pre-images states. Both halves of that prompt line are therefore frozen by the time
 * a clip exists, and a second list here would be one that can never fill.
 */
export interface LongEpisodeVideoStaleness { videoStale: SceneNumber[]; }
export interface GetLongEpisodeVideoReviewResponse { episode: LongEpisodeDetail; reviews: LongEpisodeVideoReview[]; staleness: LongEpisodeVideoStaleness; }
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
/**
 * Fetches a short project's already-paid-for Runway outputs again, for scenes whose files are placeholders.
 *
 * The Episode side has had this since the bug that lost those bytes was found; the short project, which runs
 * the same submissions against the same provider and records the same task ids, had no way back to them. Same
 * rules, because they are the same rules: a status read and a download, never a new generation, so nothing is
 * added to the ledger — and a scene whose output can no longer be fetched is reported and left failed rather
 * than quietly regenerated, because spending money is the person's decision, not a fallback.
 */
export interface RecoverVideosRequest { approved: true; }
export interface RecoverVideosResponse extends GenerationProgressResponse {
  recoveredSceneNumbers: SceneNumber[];
  unrecoverableScenes: { sceneNumber: SceneNumber; reason: string }[];
}

export interface RecoverLongEpisodeVideosRequest { approved: true; }
export interface RecoverLongEpisodeVideosResponse extends LongEpisodeVideoProgress {
  recoveredSceneNumbers: SceneNumber[];
  unrecoverableScenes: { sceneNumber: SceneNumber; reason: string }[];
}

/** Final Episode render has a fixed relative output and never exposes an absolute path. */
/**
 * An Episode's final render, with the same audio vocabulary the short project's merge uses.
 *
 * There was no request type at all: the Episode merge took a project and an episode number and nothing else,
 * so the screen had nowhere to send a choice even after one existed. Same shape as MergeVideosRequest on
 * purpose — two spellings of "put this music under it" would be two places to get it wrong.
 */
export interface MergeLongEpisodeVideosRequest {
  audio?: MergeAudioSettings;
  sceneSubtitleLayout?: { scale?: number; center?: number };
  /** Same meaning and rule as {@link MergeVideosRequest.rotateClockwise}; the shape is the long project's. */
  rotateClockwise?: boolean;
}

export interface MergeLongEpisodeVideosResponse {
  episode: LongEpisodeDetail;
  /**
   * Where the file sits **inside the Episode**, for showing a person which file was written.
   *
   * The identical string on the short project's merge response is relative to the *project*, and the desktop
   * bridge resolves everything it is handed against the project folder. So this value looks like one that can
   * be opened and is not: handed over as-is it names `<projectId>/videos/final/instagram_reel.mp4`, which is
   * either nothing at all or — for an id that is also a short project — somebody else's finished video.
   * Display this; open `openablePath`.
   */
  finalVideoPath: typeof FINAL_VIDEO_RELATIVE_PATH;
  /**
   * The same file, addressed from the project root: `long_story/Episode07/videos/final/instagram_reel.mp4`.
   *
   * Composed here rather than in the screen. The Episode's directory layout has one home in this codebase
   * (`LONG_STORY_DIRECTORY`, `episodeDirectoryName`) precisely so that a second copy of it cannot drift — and a
   * screen that assembles the path is that second copy, in the one place least likely to be checked against
   * disk. The screen passes this through untouched.
   */
  openablePath: string;
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
/**
 * Whether one generated scene has been looked at and accepted.
 *
 * The same two words on four contract fields — a short project's image review, an Episode's image review, an
 * Episode's video review, a short project's video review — and copied into three services. One set, because a
 * screen that learns to read one review reads them all.
 */
export const SCENE_REVIEW_STATUSES = ["pending", "approved"] as const;
export type SceneReviewStatus = (typeof SCENE_REVIEW_STATUSES)[number];

export const NARRATION_AUDIO_STATES = ["none", "placeholder", "generated"] as const;
export type NarrationAudioState = (typeof NARRATION_AUDIO_STATES)[number];

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
/**
 * Which already-spoken scenes no longer match the words the script now has.
 *
 * The last of the three: the Episode's video and image reviews already say this, and the voice — the one a
 * viewer hears rather than sees — did not. The generation path has always known, because it compares the
 * scene's narration to the recorded one to decide whether to re-buy the audio. It simply never told the screen,
 * so a person could approve narration that says something the script no longer does.
 *
 * A scene with no record is absent, not listed: nothing has been spoken yet, so nothing is behind. Placeholder
 * audio is likewise not "stale" — it matches its text; it is just not real speech, which `state` already says.
 */
export interface LongEpisodeNarrationStaleness { narrationStale: SceneNumber[]; }

export interface GetLongEpisodeNarrationReviewResponse {
  episode: LongEpisodeDetail;
  narrations: LongEpisodeNarrationReview[];
  staleness: LongEpisodeNarrationStaleness;
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
  /**
   * Recomputed for every scene, not just the regenerated one.
   *
   * Without it the screen has to carry its previous list forward and take the regenerated scene out of it — a
   * correct inference, and a second place that decides what "stale" means. The server already does this
   * comparison to answer the review, so sending it costs nothing and removes the copy. The alternative the
   * screen would otherwise reach for — re-reading the whole review — throws away the `retryEstimate` that only
   * this response carries.
   */
  staleness: LongEpisodeNarrationStaleness;
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
/**
 * nextEpisode is null only when the story has no Episode after this one.
 *
 * Typed as the outline rather than the detail because an Episode that is planned but not yet scripted has no
 * record of its own — the directory holding it is created by the script save and nothing else — and it was
 * being reported as absent, so a save on Episode 4 of ten told the person it was the last one. Anyone working
 * in the order the app recommends meets that case every time, since these notes are written before the next
 * script exists. An Episode that has been started still arrives with its full detail; the outline is what is
 * guaranteed, and status says which kind it is.
 */
export interface SaveLongEpisodeContinuityResponse { memory: LongEpisodeContinuityMemory; nextEpisode: LongEpisodeOutline | null; }

export interface SearchLongStoryBibleItemsResponse { items: LongStoryBibleItem[]; }
export interface DuplicateLongStoryBibleItemResponse { item: LongStoryBibleItem; storyBible: LongStoryBible; }
/**
 * Why there is no picture to carry forward — the half `available: false` could never say.
 *
 * Every failure in this lookup used to land in one catch and come back as the same false, so "the Episode
 * before this one is not finished yet" and "its records could not be read" reached the screen as one sentence:
 * *이전 에피소드의 마지막 장면 자료가 아직 없어서…*. 캡틴D saw that on three consecutive Episodes while the
 * Episodes in question were finished and their pictures were on disk (Cowork Round 473) — the screen was giving
 * a reason, and the reason was wrong, which is worse than giving none.
 *
 * - `not_finished`: the previous Episode genuinely has no approved final picture yet, or there is no previous
 *   Episode. The ordinary case, and the only one the old sentence was ever right about.
 * - `image_unreadable`: it says its pictures are done, but the final scene's file is missing or is not a PNG.
 *   The record and the disk disagree — worth showing, because nothing else in the app will notice.
 * - `unreadable`: its stored records could not be read at all. Not an answer, an admission.
 */
export const LONG_EPISODE_CONTINUITY_UNAVAILABLE_REASONS = ["not_finished", "image_unreadable", "unreadable"] as const;
export type LongEpisodeContinuityUnavailableReason = (typeof LONG_EPISODE_CONTINUITY_UNAVAILABLE_REASONS)[number];
export interface LongEpisodeContinuityReference {
  previousEpisodeNumber: number;
  /** The previous Episode's actual last scene number (its own sceneCount) — no longer always 6. */
  sourceSceneNumber: SceneNumber;
  available: boolean;
  /** Present only when unavailable. Absent means there is a picture to carry. */
  unavailableReason?: LongEpisodeContinuityUnavailableReason;
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
  outlineStatus: LongEpisodeOutlineStatus;
  createdAt: string;
  updatedAt: string;
  /**
   * Plain-language notices about this project as a whole, in the person's language — never a raw code.
   *
   * The counterpart of `LongEpisodeOutline.warnings`, for the things that are not about any one Episode. The
   * outline generation is the case that made it necessary: it is one paid call that produces every Episode, so
   * when its cost cannot be written to the spend ledger there is nowhere honest to say so — putting it on an
   * arbitrary Episode would be a lie, and on all of them, noise (docs/06_DECISIONS.md D-037).
   *
   * Optional and usually absent, like the Episode field: most projects never have one.
   */
  warnings?: string[];
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
/**
 * A Long Project's settings, and whether its one lock has closed.
 *
 * Only one, and that is the answer rather than an omission. `sceneCount` and `clipDurationSeconds` here are the
 * defaults a *new* Episode starts from — every Episode snapshots its own copy the moment it is created, and the
 * lock on changing them lives on that Episode's own settings, which already reports `changeable`. A
 * `sceneCountChangeable` on this response could only ever be `true`, and a flag that is always true is a flag a
 * screen learns to stop reading.
 *
 * The aspect ratio is not like that: images, video generation and the merge each read the project's ratio when
 * they run, so changing it once any Episode has images means portrait images sent to Runway asking for
 * landscape video and then padded by the merge — all paid, none matching. This is the same condition the save
 * enforces, answered by the same code, so the screen never has to re-derive the server's rule. Computing it in
 * the frontend would be a second copy of that rule, which is how the continuity screen once came to disagree
 * with its own server.
 */
export interface GetLongProjectSettingsResponse {
  settings: LongProjectSettings;
  /** False once any Episode has reached image generation — see this type's own doc comment. */
  aspectRatioChangeable: boolean;
  /**
   * Which Episode closed it. Present only when `aspectRatioChangeable` is false.
   *
   * A bare `false` leaves the screen saying "you cannot change this any more" and the person asking why now —
   * the answer is one Episode, by number, and the server already knows which one because the refusal names it.
   */
  aspectRatioLockedByEpisodeNumber?: number;
}
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
 * One Episode sitting in the project's recoverable archive.
 *
 * Archiving already moved the folder aside rather than deleting it, and already handed back an `archiveId` —
 * which had nowhere to go. There was no way to see what had been archived and no way to bring one back, so a
 * "recoverable" action was, from the app, indistinguishable from a deletion. That is also the answer to whether
 * archiving needs a typed confirmation: it does not, once it is listable and reversible. What makes an action
 * safe is being able to undo it, not being asked twice.
 *
 * `archivedAt` is read back out of the id the archive was named with, and is absent rather than guessed when
 * that name does not parse — a folder from some future naming scheme should still be listed and restorable,
 * just without a date.
 */
export interface ArchivedLongEpisodeSummary {
  archiveId: string;
  /** The number it held when it was archived — not the number it would come back as, which depends on how many Episodes exist now. */
  episodeNumber: number;
  title: string;
  archivedAt?: string;
}
export interface ListArchivedLongEpisodesResponse { archives: ArchivedLongEpisodeSummary[]; }

/**
 * Brings an archived Episode back as the project's last Episode.
 *
 * Back as the *last* one, not the number it left from: archiving only ever takes the final Episode, and the
 * project may well have grown since. Restoring into an occupied number would either overwrite an Episode or
 * renumber the ones after it, and both of those lose work that nobody asked to lose.
 */
export interface RestoreLongEpisodeRequest { approved: true; }
export interface RestoreLongEpisodeResponse { project: LongProject; episode: LongEpisodeOutline; }

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
export const LONG_STORY_BIBLE_COLLECTIONS = ["secrets", "foreshadowing"] as const;
export type LongStoryBibleCollection = (typeof LONG_STORY_BIBLE_COLLECTIONS)[number];

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
/**
 * Which version of the linked asset a Story Bible link follows.
 *
 * Written down once because six places had their own copy: two validators and two casts on the server, and two
 * runtime guards on the client. They agreed, and nothing made them agree — the style link's own set was a local
 * `stylePolicies` array in one service, and the protagonist's was a pair of `!==` comparisons in the next
 * method down. Adding a fourth policy would have compiled everywhere and been rejected at runtime by whichever
 * copy nobody remembered.
 *
 * The two sets are deliberately separate and not derived from each other or from ASSET_MAPPING_VERSION_POLICIES,
 * which happens to hold the same three strings today. Nothing carries a link's policy into the mapping it seeds
 * — `episode-story-bible-mapping-sync.ts` never reads it — so tying them together would pin a relationship this
 * app does not have, and the day one of them gains a policy the other cannot take, that has to be a decision
 * rather than a build error.
 */
export const LONG_STORY_BIBLE_PROTAGONIST_LINK_POLICIES = ["pinned_version", "follow_latest"] as const;
export type LongStoryBibleProtagonistLinkPolicy = (typeof LONG_STORY_BIBLE_PROTAGONIST_LINK_POLICIES)[number];
/** The style link additionally takes a snapshot, and always carries a version number — see the protagonist set above. */
export const LONG_STORY_BIBLE_STYLE_LINK_POLICIES = ["pinned_version", "follow_latest", "snapshot"] as const;
export type LongStoryBibleStyleLinkPolicy = (typeof LONG_STORY_BIBLE_STYLE_LINK_POLICIES)[number];

export interface LongStoryBibleProtagonistLink {
  assetId: string;
  versionPolicy: LongStoryBibleProtagonistLinkPolicy;
  pinnedVersion: number | null;
}

/** Project-wide visual style reference stored as `basic.style_asset_link`. */
export interface LongStoryBibleStyleAssetLink {
  assetId: string;
  versionPolicy: LongStoryBibleStyleLinkPolicy;
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

/** The built-in forms that write a project's settings for it. One today: the flower-meaning reel. */
export const SETTINGS_PRESET_IDS = ["flower_meaning"] as const;
export type SettingsPresetId = (typeof SETTINGS_PRESET_IDS)[number];
/** A preset and the revision of its text that produced these settings — see ShortProjectSettings.preset. */
export interface SettingsPreset {
  id: SettingsPresetId;
  /** A positive integer the preset raises whenever the text it writes changes. */
  revision: number;
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
  /**
   * A whole number of seconds within CLIP_DURATION_LIMITS (domain.ts) — not tied to a model here, because the
   * setting outlives the model choice. Whether the chosen model makes a clip this long is checked on the video
   * confirmation screen and refused at the video start (VIDEO_CLIP_DURATION_OUT_OF_RANGE).
   */
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
  /**
   * Whether each scene's picture is drawn with the previous scene's approved picture as a reference.
   *
   * Off by default, and off for every project stored before this field existed. Not a global rule, because a
   * story with people usually changes place between scenes and handing the model the last scene would fight
   * that; a 꽃말 reel is the opposite — one flower, one pot, one light, a single forward movement — and there
   * the chain is the point rather than a feature. Being off by default is also what keeps existing projects
   * from all reporting their references as changed the moment this shipped: a project with the switch off
   * resolves exactly the references it always did.
   */
  sceneImageContinuityEnabled: boolean;
  /**
   * Which built-in form wrote these settings, and which revision of it — present only for a project a preset made.
   *
   * 🔴 A preset is computed once, when the project is made, and stored; changing the preset afterwards reaches no
   * existing project. 캡틴D changed the flower preset three times and approved a Story three times against the old
   * text, paying each time, with nothing on screen to say the project predated the change (Cowork Round 787).
   * With this, the approval screen can compare the stored revision with the current one and say so.
   *
   * Optional on the way in, like sceneImageContinuityEnabled and for the same reason. And absent in a save means
   * "not saying", not "clear it": a settings screen that never knew about presets must not erase the mark.
   */
  preset?: SettingsPreset;
}

/**
 * What a client actually sends: durationSeconds is derived server-side (sceneCount * clipDurationSeconds) and
 * is rejected as an unsupported field if included.
 *
 * sceneImageContinuityEnabled is optional here while its two boolean siblings are required, and the difference
 * is deliberate. They were required from the start, so no client ever existed that did not send them. This one
 * arrived after builds were already running in browsers, and making it required would have made every one of
 * those saves fail on a field the page has never heard of — the exact shape that cost Captain D the whole video
 * step when a client guard was one clip length behind the contract. Absent means off, which is what it means
 * everywhere else.
 */
export type ShortProjectSettingsInput =
  Omit<ShortProjectSettings, "durationSeconds" | "sceneImageContinuityEnabled">
  & { sceneImageContinuityEnabled?: boolean };

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
/**
 * The two `castRole` spellings this app treats as the 대표 — named here because three readers were deciding
 * it from their own copy of the pair and the contract said nothing.
 *
 *     ShortProjectSettingsScreen.tsx  isRepresentative()
 *     story-prompt.service.ts         the cast lead the Story prompt is built around
 *     story-asset-metadata.ts         대표 캐릭터 vs 서브 캐릭터 in the prompt metadata
 *
 * `castRole` stays free text on purpose: Python wrote whatever it liked there and those projects still open.
 * So this is not a union that narrows the field — it is the list the readers agree on, in one place. A value
 * outside it is not invalid; it simply is not the 대표, which is exactly what every reader already meant.
 *
 * `"lead"` is read and never written — `setRepresentative` writes `"protagonist"`. It is here because
 * Python-era projects on disk carry it, and dropping it would silently demote a cast lead someone set years
 * ago. That asymmetry is the reason the pair has to be written down rather than remembered.
 *
 * Cowork Round 528 found the cost of the silence: a fixture said `castRole: "representative"`, which type
 * checks perfectly against `string` and is a value nothing here treats as the 대표. Four fixtures carried it;
 * three passed anyway.
 */
export const SHORT_PROJECT_LEAD_CAST_ROLES = ["protagonist", "lead"] as const;

/** Whether this cast row is the 대표 — the one question all three readers were asking their own way. */
export function isShortProjectCastLead(castRole: string): boolean {
  return (SHORT_PROJECT_LEAD_CAST_ROLES as readonly string[]).includes(castRole);
}

/** What the screen writes when someone presses 대표. The first spelling, and the only one this app writes. */
export const SHORT_PROJECT_LEAD_CAST_ROLE = SHORT_PROJECT_LEAD_CAST_ROLES[0];

export interface ShortProjectCastMember {
  assetId: string;
  /** Free text — Python has no fixed enum here. Which spellings count as the 대표 is SHORT_PROJECT_LEAD_CAST_ROLES. */
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
  /**
   * How many people are in this project's cast — not how many letters are in the prompt.
   *
   * The old name is `characterCount`, and it did real damage on the way out: the screen above the prompt box
   * read 「글자 수: 0」 on a 꽃말 reel, which is a correct cast count and an alarming letter count, and Captain D
   * stopped to ask whether something was broken. The screen was fixed first; leaving the contract saying
   * `character` would have let the next reader take the word at face value again.
   */
  castCount: number;
  /**
   * @deprecated The same number as `castCount`, kept only until the screens read the new name.
   *
   * Not renamed in place, because a response is read by whatever build is already open in a browser. A page
   * that guards on this field — `storyPromptApi.ts` does — would call a perfectly good response malformed and
   * say 서버 응답을 확인할 수 없습니다 about a working server, which is exactly what cost Captain D the whole
   * video step this morning. Both names ship, the screens move, then this one goes.
   */
  characterCount: number;
  sceneCount: number;
  /**
   * The preset mark of the very settings this prompt was rendered from — read in the same pass, so the prompt and
   * the revision it came from cannot disagree. Absent for a project no preset made.
   *
   * On the preview rather than fetched beside it: this screen exists to show what is about to be sent, and a
   * revision read at another moment could describe other settings (Cowork Round 790). The screen compares it with
   * the preset's current revision and says so above the paid button.
   */
  preset?: SettingsPreset;
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
  status: SceneReviewStatus;
  updatedAt: string;
  generationSource?: GenerationSource;
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

/**
 * The review as it stands after the redraw — everything GET returns, from the same server computation.
 *
 * 🔴 It carried no `staleness`, so the screen guessed: it took the list it had and removed the redrawn scene.
 * That guess can only switch a badge off. A redraw can also put a *different* scene behind — in a chained
 * project scene N+1 was drawn from scene N's picture, and its recorded reference no longer matches once scene N
 * is redrawn — and the screen could never say so (Cowork Round 797). The Episode side has had this shape
 * (RegenerateLongEpisodeImageReviewResponse extends its GET) all along.
 *
 * `staleness` is absent only when it could not be computed after the picture was saved: the picture was paid
 * for and is kept, and the response must not fail over a read done on the side. Read GET again in that case.
 * `budget` follows GET's rule (connected credential only) and is also left out when the ledger could not be
 * read after the call — see `retryEstimate`.
 */
export interface RegenerateImageReviewResponse extends GetImageReviewResponse {
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
  model: VideoModel;
  ratio: RunwayVideoRatio;
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
  /**
   * The approved picture this clip is asked to end on — the next scene's — when it is: the project draws its scenes
   * as a chain (sceneImageContinuityEnabled), the model takes a last frame, and there is a next scene. Clip N then
   * runs from picture N to picture N+1 and clip N+1 starts on that same picture, so the cut has nothing to jump.
   * Absent otherwise, and then the clip is sent its first frame only, as before.
   *
   * On the preview, and in its confirmation, because it changes the paid request: a person confirms what is sent.
   */
  lastFrameSceneNumber?: SceneNumber;
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

export const ASSET_FILE_AUDIT_CLASSIFICATIONS = ["healthy", "missing", "damaged"] as const;
export type AssetFileAuditClassification = (typeof ASSET_FILE_AUDIT_CLASSIFICATIONS)[number];
/** Where an audited Asset file came from. A list, so a response guard can read it instead of copying it. */
export const ASSET_FILE_SOURCE_KINDS = ["manual", "project"] as const;
export type AssetFileSourceKind = (typeof ASSET_FILE_SOURCE_KINDS)[number];

export interface AssetFileAuditEntry {
  assetId: string;
  displayName: string;
  classification: AssetFileAuditClassification;
  sourceKind: AssetFileSourceKind;
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
/**
 * What a backfill of already-generated images found and did.
 *
 * The Library indexes a project's generated images when they are made, and re-seeds them when a scene is
 * approved or regenerated. A project that finished before any of that existed does neither ever again, so its
 * pictures stay on disk and out of the Library permanently — which is what a real Episode turned out to be.
 * This is the way to fix those without asking someone to press the right buttons in the right order.
 *
 * `scanned` counts every project and Episode looked at; `registered` counts the ones that gained a Folder;
 * `skipped` is those that already had one — untouched on purpose, exactly as the legacy migration leaves an
 * already-migrated item alone. `failed` is the ones whose scene files could not be read, reported rather than
 * retried, because a picture that is genuinely gone is not something a second pass will find.
 */
/**
 * Everything a photo card is: one picture already in the Asset Library, one line of text, and how long to hold
 * it for.
 *
 * No script, no scene planning, no image generation, no video generation — which is the point. The picture is
 * copied to the project's scene-1 slot and recorded there, so nothing downstream is tempted to make one; the
 * quote becomes that scene's narration text, which is what the merge already burns in as a subtitle; and the
 * project lands ready to merge.
 *
 * `clipDurationSeconds` is the same choice an ordinary short project makes, reused rather than invented,
 * because the merge reads the hold from exactly that setting.
 */
export interface CreatePhotoCardRequest {
  projectId: string;
  /**
   * The pictures, in the order they are shown — one scene each.
   *
   * 🔴 **A list rather than one id, and N scenes rather than one scene holding N pictures.** The merge already
   * walks scenes and concatenates them, so this reuses that path without changing a line of it, and every
   * picture gets the existing Ken Burns push for free. A scene that held several images would need new code at
   * exactly the place `d=frames` once produced a 625-second card.
   *
   * 🟠 **The finished card is now `scenes × clipDurationSeconds` long.** A photo card used to be one scene, so
   * its length was the hold; three pictures at ten seconds is thirty. Choosing pictures is choosing the length,
   * and the screen has to say so.
   *
   * 🔴 캡틴D chose hard cuts between them (Cowork Round 934 §1), which is why no crossfade exists: the join is
   * `-c copy` and a transition there would mean re-encoding every seam.
   */
  readonly assetIds: readonly string[];
  quote: string;
  clipDurationSeconds: PhotoCardDurationSeconds;
  aspectRatio: AspectRatio;
}

/**
 * The most pictures one card may hold.
 *
 * 🟠 A bound rather than a preference: each picture is a scene, each scene is an encode, and the finished file
 * grows with it. Twelve at the longest hold is two minutes — already past what this app makes — so the number
 * is the point where "a card" stops being a card rather than a limit anybody should meet.
 */
export const PHOTO_CARD_MAX_PICTURES = 12;

export interface CreatePhotoCardResponse {
  project: Project;
}


export interface BackfillGeneratedImageAssetsResponse {
  scanned: number;
  registered: number;
  skipped: number;
  failed: number;
}

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
export const PROVIDER_CREDENTIAL_KINDS = ["openai", "runway", "gemini"] as const;
export type ProviderCredentialKind = (typeof PROVIDER_CREDENTIAL_KINDS)[number];

/**
 * The providers whose spending is counted **in dollars, per month**.
 *
 * 🔴 **Not the same list as the one above, and keeping them apart is the point.** They were one list while the
 * two providers happened to coincide — a key and a dollar budget arrived together — so the single union quietly
 * meant both "we store a key for this" and "this has a monthly limit in money". Gemini has the first and not
 * the second: it is used on a free tier, and what bounds it is a **count per day** in its own ledger
 * (`news_call_usage.json`), which is a different unit over a different window.
 *
 * Left merged, adding Gemini would have drawn it a monthly budget card reading "$10.00 남음" — a limit that
 * refuses nothing, about money nobody is spending, next to the one number that actually stops paid work. The
 * screen is spared that by the type rather than by anyone remembering: `MonthlyBudgetCard` is keyed to this
 * list, so a provider without dollars cannot appear in it.
 *
 * 🟠 This is the same distinction CLI got wrong in Round 926 and corrected in 928 — `api_budget_usage.json` is
 * one provider's dollars per month, and the news reel's cap is another provider's calls per day. Merging them
 * in the contract would have undone in types what the ledgers already keep apart.
 */
export const PROVIDER_BUDGET_KINDS = ["openai", "runway"] as const;
export type ProviderBudgetKind = (typeof PROVIDER_BUDGET_KINDS)[number];

/**
 * What a person has to know **at the moment they paste a key**, for the providers where it is not obvious.
 *
 * 🔴 Gemini's entry is a condition, not a tip. A Gemini key is always issued inside a Google Cloud project, and
 * a key made in a project that already has billing attached is **a paid key from its first request** — the free
 * allowance simply becomes the first slice of a bill. Our own daily cap bounds what that costs (Round 926 §1),
 * but a cap is "cheap when the promise breaks"; nobody owned "do not break it", and the only place that can be
 * owned is the field where the key goes in (Cowork Round 941 §1).
 *
 * A `Record` over the union rather than an optional field, so adding a provider is a decision about this rather
 * than a default. And per provider rather than one sentence about keys in general, because it is **false for
 * the others**: a Runway key is supposed to have billing behind it, and telling somebody otherwise would break
 * the thing it was trying to protect.
 */
export const PROVIDER_KEY_NOTES: Record<ProviderCredentialKind, string | null> = {
  openai: null,
  runway: null,
  gemini: "결제가 연결되지 않은 구글 클라우드 프로젝트에서 만든 키를 넣어 주세요. 그래야 무료 한도를 넘었을 때 청구가 아니라 거절이 됩니다. 결제가 걸린 프로젝트의 키는 처음부터 유료로 동작하고, 이 앱은 그 차이를 확인할 방법이 없습니다.",
};

export interface ProviderCredentialStatus {
  provider: ProviderCredentialKind;
  configured: boolean;
  connected: boolean;
  maskedValue: string | null;
}

/**
 * What this computer may spend on one provider in a month, and what it has spent.
 *
 * `monthlyLimitUsd` is the same knob as the OPENAI_MONTHLY_BUDGET_USD / RUNWAY_MONTHLY_BUDGET_USD environment
 * variables — saving it here writes that line into the app's own settings file, and a value saved here wins
 * over one the app was launched with. `isDefault` says nobody has chosen: it is the built-in $10, not a number
 * anybody typed, which is the difference between "this is my limit" and "I never set one".
 *
 * The two spend figures come from the same ledgers the refusal is computed from, so the screen showing this is
 * showing the number that will actually stop a request rather than a second estimate of it.
 */
export interface ProviderMonthlyBudget {
  /** 🔴 Budget kinds, not credential kinds — a provider counted in calls per day has no row here at all. */
  provider: ProviderBudgetKind;
  monthlyLimitUsd: number;
  isDefault: boolean;
  spentUsd: number;
  remainingUsd: number;
  /** Absent when the ledger could not be read — the limit is still true, the spend is simply not known right now. */
  spendUnavailable?: true;
}

/**
 * Which video model this computer is set to use, and everything a screen needs to say what that costs.
 *
 * The options travel with the choice so a picker can show the price beside each name — the estimate has to move
 * with the selection, or a model change quotes the old rate into the budget check.
 */
export interface VideoModelSetting {
  selected: VideoModel;
  /** True when nobody has chosen and the built-in default is in use — the same distinction the monthly budget draws. */
  isDefault: boolean;
  options: readonly VideoModelOption[];
}

export interface GetProviderSettingsResponse { providers: ProviderCredentialStatus[]; monthlyBudgets: ProviderMonthlyBudget[]; videoModel: VideoModelSetting; }
export interface SaveVideoModelRequest { model: VideoModel; }
export interface SaveVideoModelResponse { videoModel: VideoModelSetting; }
export interface SaveProviderMonthlyBudgetRequest { monthlyLimitUsd: number; }
export interface SaveProviderMonthlyBudgetResponse { budget: ProviderMonthlyBudget; }
export interface SaveProviderCredentialRequest { value: string; }
export interface SaveProviderCredentialResponse { provider: ProviderCredentialStatus; }
export interface SetProviderConnectionResponse { provider: ProviderCredentialStatus; }

export interface BudgetPreview {
  monthlyLimitUsd: number;
  spentUsd: number;
  remainingUsd: number;
  estimatedRequestCostUsd: number;
  canSpend: boolean;
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
  /**
   * Whether this job sends paid provider requests, decided when it was submitted and true for its whole life.
   *
   * **Always present.** That is the point of it. A screen used to read this off `retryEstimate`'s absence —
   * no cost line, therefore no cost — and said "made at no cost" out loud on that basis. The moment
   * `retryEstimate` gained a second reason to be missing (an unreadable spend ledger, docs/06_DECISIONS.md
   * D-037), the screen started saying that about a real, paid, running job. A fact a person is told about money
   * must not be carried by the absence of something else, because absence acquires new causes.
   *
   * Says "paid", not which provider: the sentence a person needs does not change when a second one is added,
   * and this is the field they will read.
   */
  paidProvider: boolean;
  status: VideoJobStatus;
  currentSceneNumber?: SceneNumber;
  completedSceneNumbers: SceneNumber[];
  failedSceneNumbers: SceneNumber[];
  /** Every scene number belonging to this job, 1..N in order — lets a caller render the full scene set without assuming a fixed count. */
  sceneNumbers: SceneNumber[];
  /**
   * The project's shape — the shape of every picture this job animates, since a project's shape cannot change once
   * it has pictures (projects.service `aspectRatioLocked`).
   *
   * **Always present**, because this is the response a screen shows for the whole generation. The screen used to
   * learn the shape only from the video review, which is read once the job has succeeded; until then it drew every
   * picture in a portrait box, and a 16:9 project spent its whole generation looking like a vertical reel being
   * made — the person watching asked why their landscape project was generating portrait video (Cowork Round 865).
   */
  aspectRatio: AspectRatio;
  /**
   * The model this job's clips are being made with — **the job's own**, from its records, not today's setting.
   *
   * 🔴 Here for the same reason `aspectRatio` is (Cowork Round 865): a screen that shows a whole generation must
   * not have to wait for the review to learn what the generation *is*. Until now the failure line on this screen
   * could only say 「Runway …」, because Runway is where the key and the billing live — true, and useless when the
   * catalogue holds twenty models from MiniMax, Alibaba, ByteDance, Google and xAI. A failed Seedance clip told
   * the person to top up their Runway credits without ever naming Seedance, so nothing on screen said **which
   * model to change**, which is the one thing they can act on.
   *
   * The job's model rather than the current setting, for the reason the estimate and the ledger already read it
   * that way (`local-video-workflow.service.ts:178`): a retry resumes *this* job, confirmed under its own model,
   * and switching the setting mid-job must not rewrite what the failed scene was sent to.
   */
  model: VideoModel;
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
  /** The same failures, with the provider's code, what to do about it, and whether it was charged — see SceneFailure. `sceneErrors` stays until every screen reads this instead. */
  sceneFailures?: Record<SceneNumber, SceneFailure>;
  /**
   * Local guard information for a paid retry/regenerate action on this job — the same read-only, never-reserving
   * principle as {@link GetVideoPromptPreviewResponse.budget}. `perSceneCostUsd` is the cost of retrying exactly
   * one scene; regenerating N scenes at once costs `perSceneCostUsd * N`, which the caller computes itself rather
   * than receiving a pre-multiplied total, since the number of scenes being retried is a UI choice this response
   * has no way to know in advance. `budget` is the current ledger snapshot (`estimatedRequestCostUsd`/`canSpend`
   * describe a single-scene retry specifically); comparing `perSceneCostUsd * N` against `budget.remainingUsd`
   * covers the "regenerate all" case. Absent in the local fake execution mode, where nothing is charged.
   *
   * `pendingSceneCount` is how many scenes this job has not finished — every scene not yet `succeeded`. It is
   * here because a retry does not buy only the scene that was selected: a failed scene halts the pipeline
   * (scenes continue each other, so nothing skips ahead), and clearing that failure resumes the whole job, so
   * every unfinished scene after it is submitted and charged without another confirmation. Measured: with
   * scene 5 failed and scene 6 waiting, one press of "retry scene 5" sent two paid submissions while the
   * screen said one (CLI Round 429).
   *
   * What a retry buys is `{selected} ∪ {not succeeded}`, and only two states are reachable — mid-generation,
   * where the selected scene is itself a failed one (so the union is `pendingSceneCount`), and a finished job,
   * where nothing is pending (so it is the number selected). `Math.max(pendingSceneCount, selectedCount)` is
   * therefore the count to multiply, and this field exists so no screen has to derive that rule from scene
   * arrays: the rule comes from the backend's own halting behaviour, and two screens deriving it separately is
   * how the two ends drift apart.
   */
  retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview; pendingSceneCount: number };
}

export interface VideoReview {
  sceneNumber: SceneNumber;
  status: SceneReviewStatus;
  updatedAt: string;
  /** Actual cost recorded for this scene's video across every attempt, including past regenerations; absent when nothing has been recorded (e.g. the local fake execution mode). */
  costUsd?: number;
  /**
   * The model this scene's clip was made with — from the job's own record, never from today's setting. Absent
   * when no provider made it (the local fake execution mode).
   *
   * 🔴 The setting and the clip can disagree, and a screen that reads the setting says true things about the
   * wrong clip: Cowork reported the first chained reel as wan3_720p twice, from the screen, when every record,
   * ledger line and file said h3_max_768p (Rounds 802–806, F5). Anything a screen says about a finished clip —
   * its bars, its sound — comes from here. A record older than the model field is gen4_turbo, the only model there
   * was (recordedVideoModel).
   */
  model?: VideoModel;
  /**
   * What the clip on disk actually is — measured with ffprobe when the review is read, not inferred from the model.
   * Absent when it could not be measured (ffprobe missing, or a local placeholder that is not a real video).
   *
   * Two questions, two fields. `VideoModelOption.frameShape` answers before anything is bought — 「what will this
   * model make」 — and there is nothing to measure then. This answers after — 「what did it make」 — and wins there:
   * the merge screen's bars sentence reads this when it is present (Cowork Round 817). A measurement that disagrees
   * with the catalogue's `frameShape` is evidence the catalogue is wrong, the way h3_max_768p's was (`2a087b5`).
   *
   * `hasAudio` is whether the file carries an audio track at all, not whether it is loud; the merge's own mapping
   * decides what is heard (today: nothing from the clip — see VIDEO_CLIP_AUDIO_NOTE).
   */
  clip?: VideoClipFacts;
}

/** A clip's measured shape and whether it carries sound — see VideoReview.clip. */
export interface VideoClipFacts {
  width: number;
  height: number;
  hasAudio: boolean;
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
 * "narration" at all, since there is nothing to mix (docs/06_DECISIONS.md D-011). trackId is required when (and only meaningful when) mode is "narration+bgm" or "bgm".
 * volume/fadeSeconds apply only to the bgm track — narration is never faded or attenuated by this setting.
 */
export interface MergeAudioSettings {
  /**
   * `"bgm"` is music with nothing under it, and it exists because there was no way to say that.
   *
   * The three modes before it all described narration — with music, without, or off — so a project with no
   * narration had exactly one reachable option: silence. Music alone was never forbidden; the vocabulary just
   * had no word for it. `"bgm"` needs a track and does not need narration, which is the whole difference from
   * `"narration+bgm"`.
   */
  mode: AudioMode;
  trackId?: string;
  /**
   * 0 (silent) to 1 (full volume) — the bgm track's own level, independent of narration's.
   *
   * The default depends on the mode, because the reason for a default does. Under `"narration+bgm"` it is 0.25:
   * audible but clearly secondary to a voice. Under `"bgm"` there is no voice to sit beneath, so quartering the
   * track would make someone's own music inexplicably quiet with nothing on screen to explain it — the default
   * there is 1, the level they uploaded.
   */
  volume?: number;
  /** Fade-in at the start and fade-out at the end of the whole final video, in seconds. Server default when omitted: 2. */
  fadeSeconds?: number;
  /**
   * 0 to 1 — the clips' own sound, laid under whatever `mode` makes (narration, music, or silence). Omitted or 0
   * is the merge as before: the clip's sound is dropped.
   *
   * One layer on every mode rather than more modes (CLI Round 821 · Cowork Round 822): `silent` + 1 is 「영상 소리만」,
   * `narration` + 0.3 is a voice over the clip's ambience — the pairing 캡틴D's H3 Max reel asked for. Only clips
   * that carry a sound track contribute; a scene whose clip has none is merged as before. The clip layer fades in
   * and out over 0.15 s at every scene, so the ambience does not snap at the cuts. Refused on a photo card, which
   * has no clip.
   */
  clipVolume?: number;
  /**
   * Where in the track the music starts, in seconds. Default 0.
   *
   * A song is longer than a Reel — a two-minute upload is cut to the first thirty seconds — and the part
   * someone wants is rarely the beginning. This is that choice, and only the start: the end is decided by the
   * video's own length, so a range would be a second control that could never disagree with the first usefully
   * (캡틴D asked for it; Cowork Round 431 proposed the single handle, Round 456 carries the go-ahead).
   *
   * Refused, not clamped, when it falls outside the track — with the track's real length in `details` so the
   * screen can say how long the song actually is rather than only that the number was wrong. Looping is
   * unchanged: a track shorter than the video still repeats, from this point each time.
   */
  startSeconds?: number;
}

/** Omitted entirely (not just `audio` omitted) falls back to the same narrationAvailable-derived default as an explicit request would compute server-side — see MergeAudioSettings's doc comment. */
export interface MergeVideosRequest {
  audio?: MergeAudioSettings;
  /**
   * Photo cards only: where the card's text goes in the video this merge is about to make.
   *
   * Carried on the merge rather than saved through a settings route of its own, so a value is stored only at
   * the moment it is actually used — an adjustment made and then abandoned never comes back to change a later
   * video. What is stored comes back as {@link ProjectSummary.subtitleLayout}, so merging the same card again
   * starts from the layout it already has instead of the defaults.
   *
   * Either number may be omitted, and the omitted one keeps whatever the card is already using. Out of range is
   * refused, never clamped (see PhotoCardSubtitleLayout). Sent for an ordinary project, it is refused too: the
   * scene subtitle has no such control and silently ignoring the field would let a screen believe it had one.
   */
  subtitleLayout?: { scale?: number; center?: number };
  /**
   * Ordinary projects only: where the scene subtitles go in the video this merge is about to make.
   *
   * Everything `subtitleLayout` above says about carrying this on the merge applies here unchanged — stored
   * only at the moment it is used, either number omittable, out of range refused rather than clamped — and the
   * two are refused in opposite directions: this one on a photo card, that one on a project with scenes. A
   * card has no scene subtitle and a scene has no card text, so a request naming the wrong one is a screen
   * that thinks it is looking at a different project, which is worth an error rather than a shrug.
   *
   * 🔴 A separate field, not a shared one, although the two carry the same two numbers. The layouts differ
   * (0.40 against 0.78) and TypeScript cannot tell the two shapes apart, so the only thing keeping a card
   * layout out of a scene's subtitle is that they never share a name — see {@link SceneSubtitleLayout}.
   */
  sceneSubtitleLayout?: { scale?: number; center?: number };
  /**
   * Ordinary projects only: whether clips whose shape differs from the reel's get bars or fill the frame — see
   * FRAME_FITS. Omitted is `pad`, the merge as it always was.
   *
   * Not stored: it is a choice about this render, and the screen sends it each time. Refused on a photo card,
   * which is drawn to the frame already — a control there would change nothing about the video.
   */
  frameFit?: FrameFit;
  /**
   * Turn the finished video a quarter clockwise — a 16:9 video becomes exactly a 9:16 Reel, with nothing cut and
   * no bars, and the viewer turns their phone to watch it (캡틴D, Cowork Round 866: clockwise, short and Episode).
   * Its top lands on the right, so the phone is turned anticlockwise to read it; the subtitles are burned in
   * before the turn and read upright that way.
   *
   * Not a FRAME_FITS value: those fit a clip into the reel's frame, and this changes which way the frame faces —
   * the two combine (a turned reel still fits its clips as `frameFit` says). Refused, not ignored, on any shape but
   * 16:9, where a turn would not make a Reel frame. Omitted is no turn. Not stored, like `frameFit`: the file is
   * what carries it, and every screen that shows the finished video sizes itself from the file.
   */
  rotateClockwise?: boolean;
}

/** The local FFmpeg render result never exposes an absolute filesystem path. */
export interface MergeVideosResponse {
  project: Project;
  finalVideoPath: typeof FINAL_VIDEO_RELATIVE_PATH;
}

/**
 * `POST videoFinalRotate` — turn a finished 16:9 project's final video a quarter clockwise, in place, so it fills a
 * 9:16 Reel (the same turn as {@link MergeVideosRequest.rotateClockwise}, for a video that was merged without it).
 * No body. Re-merging is not the way: an ordinary project cannot be merged twice, because its clips were paid for
 * (캡틴D wanted 꽃말_보리수나무 turned after it was finished — Cowork Round 879).
 *
 * The cut it replaces is kept as a final-video version first, so it can be restored. Only the picture is
 * re-encoded; the sound is copied. `project.updatedAt` moves, which is what a screen's final-video address busts
 * its cache on.
 *
 * Refused, before anything is written: a project without a finished final (VIDEO_MERGE_CONTENT_UNAVAILABLE), a
 * shape other than 16:9 (INVALID_REQUEST), a final already posted to Instagram (VIDEO_FINAL_ALREADY_PUBLISHED —
 * the post and the file would stop matching), and a final that is already portrait (VIDEO_FINAL_ALREADY_ROTATED —
 * a second turn would stand it on its head). The last is read off the file, not remembered.
 */
export type RotateFinalVideoResponse = MergeVideosResponse;

/**
 * A photo card's subtitle colours as the merge will burn them, as CSS `#RRGGBB` — the body text, the quote's first
 * line, and the outline (the merge also uses the outline, at half opacity, as the shadow). Chosen from the picture
 * under the text so the text suits it and always reads at 4.5:1 against it (캡틴D, Cowork Rounds 879/880).
 */
export interface PhotoCardSubtitleColors {
  body: string;
  heading: string;
  outline: string;
}

/**
 * `GET photoCardSubtitleColors` — the colours for the card's text centred at `center` (the layout's own
 * `center`, same bounds; omitted means the card's stored layout). Asked again as the slider moves, because a
 * different band of the picture can choose different colours. The same sampling the merge runs, so the preview
 * cannot disagree with the video (Cowork Round 887).
 *
 * `colors: null` means the picture could not be read, and the merge will then burn the plain white text on a
 * black outline — the preview should draw exactly that. Refused (INVALID_REQUEST) for a project that is not a
 * photo card, and for a `center` out of bounds.
 */
export interface GetPhotoCardSubtitleColorsResponse {
  colors: PhotoCardSubtitleColors | null;
}

/** The longest a news summary may be, in characters. Named, because "짧게" is not a rule anything can check. */
export const NEWS_SUMMARY_MAX_CHARS = 400;

/**
 * One article this app has been given, whatever it came from.
 *
 * Stage one is paste: the person supplies the body themselves. A feed reader can fill this same shape later and
 * no screen changes, which is the reason it is shaped around the *article* rather than around a feed entry.
 *
 * 🔴 `body` is the full text and it is not optional. The checking below can only look for things inside text it
 * holds, so an article with no body cannot be checked — and an unchecked news summary is the one thing this
 * feature must not produce. That rules out any source that publishes headlines and blurbs only; the condition
 * on a publisher is not that it is reputable but that its full text arrives.
 */
export interface NewsArticleInput {
  title: string;
  body: string;
  publisher: string;
  /** ISO 8601. What the publisher says, not when we read it. */
  publishedAt: string;
  /** Where a reader goes to check it. Shown on screen and written into the caption — never dropped. */
  sourceUrl: string;
}

/** What kind of claim a checked span is, so a screen can say which sort went missing rather than only how many. */
export type NewsClaimKind = "number" | "date" | "quote";

/**
 * One thing the summary asserts that was looked for in the article, word for word.
 *
 * `found` false is the whole point of the type: a summariser invents plausible figures, dates and quotations,
 * and those are exactly the three that can be searched for mechanically.
 */
export interface NewsClaimCheck {
  kind: NewsClaimKind;
  /** The span as the summary wrote it. Shown to the person, so they can see what was not in the article. */
  text: string;
  found: boolean;
}

/**
 * What the checking actually did — deliberately not a verdict.
 *
 * 🔴 There is no `verified` field and there must not be one. This compares numbers, dates and quoted strings
 * against the article's text; it cannot see whether a causal claim ("A 때문에 B") is supported, and nothing here
 * should be read as saying it is. A screen showing this states **which three kinds were checked**, every time —
 * without that line the feature sells a guarantee it does not have.
 *
 * `claims` carries every span that was looked at, found or not, because "checked 9, missed 0" and "checked 0"
 * are different facts and a count of failures alone cannot tell them apart.
 */
export interface NewsSummaryCheck {
  claims: NewsClaimCheck[];
  /** Convenience over `claims`, and required to agree with it — the spans whose `found` is false. */
  missing: NewsClaimCheck[];
}

/**
 * A publisher this app is willing to fetch from.
 *
 * 🔴 **This travels so the screen can say it, never so the screen can decide with it.** The decision stays on
 * the server, because the host that matters is the one a redirect finally lands on and a screen cannot see that
 * (CLI Round 929 §2). But withholding the list does not prevent a second copy of it — it *guarantees* one, in
 * hand-written prose on an empty screen, where nothing checks it and the day a publisher is added it goes
 * quietly wrong (Cowork Round 931 §2). Two copies of a safety-relevant fact is the argument this repository
 * already made about the checker itself; the same argument points the other way here.
 *
 * The screen is stopped from gating on it by a pair, not by ignorance: a domain that is *not* on this list must
 * still reach the server when the button is pressed.
 *
 * `host` is what a pasted address can be matched against; `name` is what a person can read. Both come from one
 * place on the server, so neither can drift from the other.
 */
/**
 * Whether a publisher's article body can be read from its address alone.
 *
 * 🔴 **Four values rather than a `needsPaste` boolean, because the two failures are different facts** (Cowork
 * Round 942 §5). "This site draws its article with JavaScript, so the body is not in the document" is a
 * property of how the site is built — one article shows it and the next will not differ. "This article's body
 * was not where we look" might be true of that article only. A boolean would flatten them, and the screen
 * would then say the same sentence about a publisher that never works and one that usually does.
 *
 * 🔴 `unknown` exists so that **not having measured is not written down as an answer.** Two of the twelve could
 * not be sampled — their entry pages did not expose article links this measurement recognises, which is a
 * limit of the measurement rather than a fact about the site. Recording those as either "works" or "needs
 * pasting" would be inventing a result, and the invented one would never be re-measured.
 */
export type NewsPublisherBody =
  /** Every article sampled parsed from its address. */
  | "address"
  /** Some articles parsed and some did not — the person finds out per article. */
  | "varies"
  /** The body is not in the document at all. No parser reaches it, so this publisher is always a paste. */
  | "paste"
  /** Not sampled. Neither promised nor ruled out. */
  | "unknown";

export interface NewsPublisher {
  host: string;
  name: string;
  /** 🔴 Measured, not assumed — see NewsPublisherBody, and `unknown` is a real answer. */
  body: NewsPublisherBody;
}

/**
 * How many summary calls today has already used.
 *
 * 🔴 **`null` is not "there is room" — it is "we cannot tell, so we will not call".** The ledger refuses rather
 * than answering zero when it cannot be read (D-036), and that refusal has to survive the trip to the screen in
 * the same direction it has on the server. A screen that renders a missing count as an empty budget would undo
 * the guard at the last step. The button is closed on `null`, and the screen says why.
 */
export interface NewsDailyCallCount {
  used: number;
  limit: number;
}

/**
 * What the news reel screen needs the moment it opens, before anybody types anything.
 *
 * 🟠 The two facts are independent on purpose. A ledger file that cannot be read has nothing to do with which
 * publishers we accept, so a broken ledger must not also blank the list — one failure should break one thing.
 */
export interface NewsReelSetupResponse {
  publishers: NewsPublisher[];
  /** `null` when the ledger could not be read. See NewsDailyCallCount — this is never "you have room". */
  dailyCalls: NewsDailyCallCount | null;
}

/**
 * Why the server would not fetch an address.
 *
 * Separate values because each one leaves the person a **different thing to do**, and a refusal that does not
 * name the next step is a dead end. `page_too_large` was split out after measuring the real sites (Round 940):
 * 조선일보's front page is 3.3MB, and folded into `unsupported_address` it told somebody to 「https 로 시작하는
 * 기사 주소를 넣어 주세요」 about an address that already began with https. What they actually need to hear is
 * "that is a section front — give me the article".
 */
export type NewsFetchRefusalReason =
  | "publisher_not_allowed"
  | "private_address"
  | "unsupported_address"
  | "too_many_redirects"
  | "page_too_large";

export interface NewsFetchArticleRequest {
  url: string;
}

/**
 * What came back from trying to fetch one article.
 *
 * 🔴 **`body_not_found` is deliberately not a refusal and not an error.** The server knocked, got a page, and
 * could not tell which part of it was the article — it did its job and one step is left for the person (Cowork
 * Round 931 §4). Calling that "실패" would be us misdescribing our own work, and more practically it sends the
 * screen down the wrong branch: a refusal means *try something else*, this means *paste the body here*, with
 * the address, publisher and date already filled in so nothing is retyped.
 *
 * `refused` carries the publisher list again even though the screen already has it: a refusal is a statement
 * about this moment, and a screen that has been open a while may be holding an older one.
 */
export type NewsFetchArticleResponse =
  | { outcome: "article"; article: NewsArticleInput }
  | { outcome: "body_not_found"; sourceUrl: string; publisher: string; title: string; publishedAt: string | null }
  | { outcome: "unreachable"; sourceUrl: string }
  | { outcome: "refused"; reason: NewsFetchRefusalReason; publishers: NewsPublisher[] };

/**
 * One article as a publisher's feed advertised it.
 *
 * 🔴 **Nothing here was read from the article.** The feed says a title, an address and a time; the body still
 * has to be fetched through `newsArticle`, with the same allowlist and the same redirect checking. Clicking a
 * row is exactly typing that address, saved the typing — it is not a second, more trusted way in.
 *
 * 🟠 `host` travels beside `publisher` so the screen can group these the way `NewsReelSetupResponse.publishers`
 * is already grouped, without matching on a display name.
 */
export interface NewsFeedItem {
  title: string;
  url: string;
  publisher: string;
  host: string;
  /** The feed's own timestamp, ISO 8601. `null` when it gave none or gave one we could not read. */
  publishedAt: string | null;
  /**
   * A picture the feed advertised, or `null`.
   *
   * 🔴 **`null` is "the feed gave none", not "we could not fetch it".** Measured 2026-09-20: 연합뉴스, SBS and
   * 동아 carry one; 뉴시스, 경향 and 한겨레 carry none at all. Half the rows will be `null` on any given day,
   * so a screen that draws a missing picture as a failure would be reporting its own bug about somebody
   * else's editorial choice. Same shape and same reason as `publishedAt`.
   *
   * 🟠 The address is on the publisher's image host (`img.yna.co.kr`, `img.sbs.co.kr`), not the article host,
   * and is only ever put in an `<img src>` — the browser fetches it, this server never does. It is https-only
   * for the ordinary reason: an http image on an https page is blocked before it is drawn.
   */
  imageUrl: string | null;
}

/**
 * What the article picker shows.
 *
 * 🔴 **One feed failing drops that publisher, not the list.** Feeds are other people's servers and one of them
 * is always down; blanking the picker because 뉴시스 timed out would cost somebody the four publishers that
 * did answer. Same asymmetry as the image library's Episode rows, for the same reason.
 *
 * 🟠 `unavailable` is carried rather than dropped silently: a picker that is quietly short is a picker that
 * lies about what is available today. The screen can say which publisher is missing and let somebody paste its
 * address by hand, which still works.
 */
export interface NewsFeedResponse {
  items: NewsFeedItem[];
  unavailable: NewsPublisher[];
}

export interface CreateNewsSummaryRequest {
  article: NewsArticleInput;
}

/**
 * A summary the provider wrote, and what checking it against the article produced.
 *
 * 🔴 **The check travels with the summary and is never a gate on returning it.** A summary that invented a
 * figure is exactly what somebody needs to see — refusing to hand it back would leave them with "something was
 * wrong" and no way to know what. What is gated is the *card*: the screen's button stays shut while `missing`
 * is non-empty, which is where the refusal has always lived.
 *
 * 🔴 `dailyCalls` comes back on **every** answer, including the ones that failed, because the number a person
 * needs before pressing again is the number after this press. A screen that updates it only on success would
 * count down more slowly than the provider does.
 */
export interface CreateNewsSummaryResponse {
  summary: string;
  check: NewsSummaryCheck;
  dailyCalls: NewsDailyCallCount;
  /**
   * 🟠 True when the provider answered with more than `NEWS_SUMMARY_MAX_CHARS` characters.
   *
   * Reported rather than trimmed. Cutting a summary to length can slice a number in half — `4,000` becoming
   * `4,0` — and the checker would then see a figure the provider never wrote and call it invented. Handing the
   * whole thing back with a flag costs nothing, wastes no call, and leaves the shortening to the person, who
   * can see which sentence to drop.
   */
  tooLong?: true;
}

/*
 * 🟢 The shapes above landed with the controller that serves them (CLI Round 943), which is what Round 910
 * said would happen and why they were taken back out of `28794b2`. Two of this repo's guards refused the
 * client half on its own and both were right: `route-shape-coverage` (a client route with no handler — it has
 * no exemption list, which is the point of it) and `contract-request-coverage` (nothing in the app sends the
 * field). The rule that came out of it is kept here because the next person to add a route will want it:
 * **a route's request, response, `API_ROUTES` entry and handler go in one commit.**
 */

/**
 * One news reel card: whose article it is, the two-line headline, the line under it, and what the picture's
 * licence asks for.
 *
 * 🔴 **A different thing from a photo card, not a branch of one** (docs/06_DECISIONS.md D-052). A quote
 * card is one picture and one line of narration. This has a publisher band, a headline in two lines and two
 * colours, a caption band at the bottom, and a picture whose licence can carry an obligation. Four things
 * differ at once, and one shape trying to be both would drag `publisher?` and `headline?` through every quote
 * card ever made.
 *
 * 🔴 **The picture the article arrived with is deliberately not here.** `NewsFeedItem.imageUrl` reaches the
 * picking screen and stops: a press photograph is used whole rather than quoted, naming the source does not
 * license it, and the person in it holds a separate right (캡틴D's decision, docs/06_DECISIONS.md D-056). What gets
 * burned is one of our own topic pictures or a free-licence photograph. That is also the cheaper side — a
 * settlement costs more than a picture does.
 *
 * 🔴 **`publisher` is the name as letters. Never the logo** — a logo is their trademark, and reproducing it is
 * a second permission nobody gave us (캡틴D, docs/06_DECISIONS.md D-056).
 *
 * 🟠 **Not here yet, on purpose**: which picture, `sourceUrl` and `publishedAt`. The screen already holds all
 * three; whether they are *burned into the file* is a separate question from whether the screen knows them,
 * and it has not been asked yet.
 */
export interface NewsReelCard {
  publisher: string;
  /** Fixed for the whole reel — the band does not change when the picture does. */
  headline: NewsReelHeadline;
  /**
   * One caption per picture, in the same order as the reel's pictures: `captions[i]` sits under picture `i` for
   * as long as that picture is held.
   *
   * 🔴 캡틴D, 2026-09-22: 「릴스가 몇 장면 몇 분인 줄 알고 이렇게 적음?」 — one caption for the whole reel held
   * the same two lines for thirty seconds across three pictures. MBC's reels change the line when the picture
   * changes. 🔴 **The length must equal the number of pictures**, and the server refuses a card whose count
   * differs before anything is written: otherwise which picture a caption belongs to is written nowhere.
   */
  readonly captions: readonly NewsReelCaption[];
  /**
   * Whether publishing this reel requires crediting the picture — the same pair, for the same reason, that
   * `AudioLibraryTrack` already carries for music.
   *
   * 🔴 **Two fields rather than one nullable string.** With `imageCredit: string | null`, "this picture needs
   * no credit" and "this picture needs a credit nobody has written yet" are the same value — and the first may
   * be burned while the second must not be (docs/06_DECISIONS.md D-054).
   *
   * 🟠 The three free sources this was sized for split exactly along it: Pexels and Unsplash ask for nothing,
   * 공공누리 제1유형 requires the source, and Wikimedia CC BY requires author and licence in wording the licence
   * itself sets. So "only use pictures that need no credit" is not a simplification, it is dropping 공공누리 —
   * the one with the most Korean public-affairs photographs in it.
   */
  creditRequired: boolean;
  /**
   * The exact sentence the source asks for, when `creditRequired` is true.
   *
   * 🔴 **Never composed here.** CC BY wants author, licence name and a link; 공공누리 wants a different line
   * again; stitching one together from parts we guessed produces a credit that satisfies neither. Whoever
   * chooses the picture copies the wording the source states, and it travels by value with the card the way a
   * track's attribution is copied at merge time rather than looked up live.
   *
   * 🔴 **`undefined` is the only way to be absent — `""` never is.** An empty string here is the nullable field
   * this pair exists to avoid, wearing a different hat.
   */
  creditText?: string;
}

/**
 * The headline, two lines, both required.
 *
 * 🔴 **Two fields, not one string with a line break in it.** The lines are drawn in two different colours
 * (white, then yellow), so the split is not typography the renderer may decide — it is content, and a contract
 * that left it to automatic wrapping would be handing an invisible decision to whatever wraps last.
 *
 * 🟠 **Both required.** A headline with the yellow line empty is not a shorter headline, it is a card missing
 * half its design.
 */
export interface NewsReelHeadline {
  line1: string;
  line2: string;
}

/**
 * The caption band under the headline: one line, optionally a second.
 *
 * 🔴 **Two lines maximum, and the third is not left open.** MBC's own reels do not go past two, and a box the
 * model may fill, it will fill (docs/06_DECISIONS.md D-054). 🔴 **A narrow contract widens later; a wide one cannot
 * narrow** — reels already made to three lines would break the day it was cut back to two.
 *
 * 🔴 **`null` is a one-line caption, and it is spelled out rather than left off.** `line2?:` would let a
 * producer omit the second line by forgetting it, which reads identically to deciding there is not one — the
 * same ambiguity `creditRequired`/`creditText` exists to avoid, one field along. And `""` is refused outright:
 * the empty string is never a value in this contract, because it cannot be told apart from "not written yet".
 */
export interface NewsReelCaption {
  line1: string;
  line2: string | null;
}

/** Every box on the card that holds counted text, named the way a screen would label it. */
export const NEWS_REEL_TEXT_FIELDS = ["headline.line1", "headline.line2", "caption.line1", "caption.line2"] as const;
export type NewsReelTextField = typeof NEWS_REEL_TEXT_FIELDS[number];

/**
 * How much each box holds, and whether it may be left out.
 *
 * 🔴 **The limits are measured widths, not preferences.** Burned at 1080×1920 with a 6% side margin the usable
 * width is 950px, and in the font that actually burns (`fonts/NotoSansKR-*.ttf`, through ffmpeg) one Hangul
 * syllable takes `font size × 0.63` — the same ratio at five sizes, and bold does not widen it by more than
 * 0.1px (docs/06_DECISIONS.md D-053). 15 syllables is one line at 96px; 20 is one line at 72px. 🟠 Two earlier
 * numbers for this were wrong and both were guesses — ×1.00 assumed, ×0.77 measured in the browser's preview
 * font rather than the burning one.
 *
 * 🟠 15 leaves three syllables over MBC's longest measured headline line (12), on purpose.
 *
 * 🔴 **A table keyed by the union, so adding a box is a compile error here** rather than a box nothing counts.
 * It is the only place these numbers are written: the screen reads them through `newsReelTextBox` instead of
 * keeping its own copy (docs/06_DECISIONS.md D-053).
 */
export const NEWS_REEL_TEXT_BOXES: Readonly<Record<NewsReelTextField, { readonly limit: number; readonly required: boolean }>> = {
  "headline.line1": { limit: 15, required: true },
  "headline.line2": { limit: 15, required: true },
  "caption.line1": { limit: 20, required: true },
  "caption.line2": { limit: 20, required: false },
};

/** Why one box cannot be used as it stands. `too_long` carries how far over in `remaining`. */
export type NewsReelTextRefusal = "too_long" | "missing" | "blank";

/**
 * Ask the provider to fill a card's four boxes from one article.
 *
 * 🔴 **A different call from the summary, not a second use of it.** A summary is one paragraph about the
 * article; a card is four lines that each do a different job, and the first real reel proved that cutting the
 * one into the other produces neither (271 characters into a line that holds 15 — docs/06_DECISIONS.md D-052). The prompt
 * behind this asks for the four separately and says what each is for.
 *
 * 🟠 Same article shape, same daily count, same five refusals as the summary route — those name a cause and a
 * next step ("no key", "today's allowance is gone", "the ledger cannot be read"), and both buttons leave a
 * person with exactly the same thing to do about each.
 */
export interface CreateNewsReelCardTextRequest {
  article: NewsArticleInput;
}

/**
 * What came back, box by box — and never a card.
 *
 * 🔴 **This does not return a `NewsReelCard`, on purpose.** A card is what gets burned, and it is only a card
 * once the boxes hold text that fits and the picture's credit is settled. What arrives here is the provider's
 * attempt at four lines, which may be too long, may be missing one, and is finished by a person in the boxes
 * that already count characters for them. Handing back a half-built card typed as a whole one would be this
 * contract telling itself a thing it does not know.
 *
 * 🔴 **`check` runs on the card's own lines, not on a summary of the article.** The lines are what gets burned
 * under a real publisher's name, so they are what has to be looked for in the article word for word. The
 * summary route checks the paragraph it returns for the same reason; this is the same rule applied to what
 * actually reaches the screen.
 */
export interface CreateNewsReelCardTextResponse {
  /** Every box a label arrived for, as the provider wrote it — never trimmed to fit. */
  values: Partial<Record<NewsReelTextField, string>>;
  /** Required boxes no label arrived for, so a screen can say which one to write rather than "something failed". */
  missing: NewsReelTextField[];
  /** Boxes whose label arrived twice. Never chosen between — which one was meant is not knowable from here. */
  repeated: NewsReelTextField[];
  /** Lines the answer carried that no box claimed. Reported rather than dropped: the call was paid for. */
  ignored: string[];
  /** The four lines, checked against the article — the same shape, and the same refusal, as the summary's. */
  check: NewsSummaryCheck;
  /** Comes back on every answer, including refusals, because the number somebody needs is the one after this press. */
  dailyCalls: NewsDailyCallCount;
}

/**
 * Everything a news reel is: the pictures it holds, the card that goes over them, and how long each is held.
 *
 * 🔴 **Pictures come from the Asset Library, the same way a photo card's do.** Both things 캡틴D chose to burn
 * — our own topic pictures and free-licence photographs (docs/06_DECISIONS.md D-056) — are files this app already
 * keeps there, so nothing new has to be invented to hold them. 🟠 What is *not* settled by this shape is which
 * pictures exist: the topic list and which free-photo sites to draw from are still 캡틴D's to choose, and
 * neither touches this request. If that choice ever stops being "a file in the library", this is one field.
 *
 * 🔴 **The article's own picture is still not here.** `NewsFeedItem.imageUrl` reaches the picking screen and
 * stops; a press photograph is used whole rather than quoted, and a settlement costs more than a picture does.
 */
export interface CreateNewsReelRequest {
  projectId: string;
  readonly assetIds: readonly string[];
  card: NewsReelCard;
  clipDurationSeconds: PhotoCardDurationSeconds;
  aspectRatio: AspectRatio;
}

export interface CreateNewsReelResponse {
  project: Project;
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
  licenseKind: AudioLicenseKind;
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
  licenseKind: AudioLicenseKind;
  attributionRequired: boolean;
  /**
   * The caption line the licence asks for. Required — non-blank — when `attributionRequired` is true, and the
   * upload is refused without it: the library has no route to add it later, a merge copies the credit it had,
   * and publishing refuses a video whose music needs a credit it does not carry. Left blank here, the only way
   * out was delete, upload again and merge again, found out just before posting (CLI Round 835 · Cowork 837).
   */
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

/**
 * Why the list of places to publish came back empty.
 *
 * An empty list has three different causes with three different fixes — no Facebook page, a page with no
 * Instagram professional account linked, or a token that was never granted the permissions to see either —
 * and until now all three ended at one sentence, leaving the person to guess which part of their account to
 * go and change. The middle of that answer existed at the provider and simply was not carried across.
 *
 * Counts and permission names only. No token, no id, no secret: what the screen needs is which of the three
 * it is, and that is expressible without any of them.
 */
export interface InstagramTargetDiagnostics {
  /** Facebook pages this login can see. Zero points at the page itself, or at a token that cannot list pages. */
  pageCount: number;
  /** Of those, how many have an Instagram professional account linked. Zero with pages > 0 is the linking step. */
  pagesWithInstagramAccount: number;
  /** Permissions this app asks for that the token does not hold. Non-empty means re-connecting is the fix. */
  missingPermissions: string[];
  /**
   * Everything Meta says the token holds, not only the four this app requests.
   *
   * `missingPermissions` is measured against our own list, so a permission we never ask for cannot appear in
   * it — and if the provider requires one we do not request, that field would read "nothing missing" while
   * being the whole cause. Reporting the granted set makes an absence visible instead of unrepresentable.
   */
  grantedPermissions: string[];
  /** False when the permission check itself could not be made, so the screen does not present a guess as fact. */
  permissionsChecked: boolean;
}

export interface GetInstagramTargetsResponse {
  /** Present only when the list came back empty — there is nothing to diagnose otherwise. */
  diagnostics?: InstagramTargetDiagnostics;
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
    /**
     * Which frame was asked for as the cover, in milliseconds — `null` when none was sent.
     *
     * Publishing cannot be undone, and until this was written nothing on disk said what cover the request
     * carried. 캡틴D reported a Reel whose cover was not the frame they picked, and the app could not tell three
     * cases apart: nothing was sent (Instagram then uses the first frame), `0` was sent (same result), or a real
     * offset was sent and ignored. Cowork traced the whole path and found it unbroken — which left no way to
     * proceed except by guessing, on an action nobody can take back (Cowork Round 476).
     *
     * `null` and absent are different. `null` means this publish sent no cover offset; absent means the post
     * predates this record and nobody knows. Writing 0 for both would be the app inventing an answer for a
     * question it never asked — the same mistake the screen already refuses to make when a video's position
     * cannot be measured.
     */
  thumbOffsetMs?: number | null;
}

/** Publishing one Episode's merged final video. Same request shape as the short project's, by design. */
export interface PublishLongEpisodeToInstagramRequest {
  approved: true;
  caption: string;
  igUserId: string;
  /**
   * Which frame becomes the Reel's cover, in milliseconds from the start.
   *
   * `thumb_offset` is the only cover control this app can use. Meta's other one, `cover_url`, takes an image it
   * fetches itself — "the image must be on a public server" — and this app's videos and frames never leave the
   * person's machine until the upload itself, so there is nothing for Meta to fetch. `cover_url` also wins when
   * both are sent, which is the second reason not to send it.
   *
   * Optional because absent and `0` mean the same thing to Meta — the first frame — and the first frame is what
   * every Reel this app has published so far has used. An omitted value therefore cannot change what happens,
   * which is not true of an omitted caption (see createInstagramResumableContainer).
   */
  thumbOffsetMs?: number;
  /**
   * "I checked the account and the previous attempt is not up there."
   *
   * Only meaningful after a publish is refused with INSTAGRAM_PUBLISH_OUTCOME_UNKNOWN: a previous attempt
   * reached Meta and the process died before it could write down the answer, so the app knows a publish
   * happened and cannot know whether it succeeded. Nothing it can call settles that — Meta will list the
   * account's pages, not say whether a given Reel came from here — so, exactly like
   * ForgetInstagramPostRequest.acknowledged, the fact is supplied by the only party who can see it.
   *
   * Literally `true` or absent, never `false`. A coerced or defaulted value would turn "the person did not
   * answer" into "the person said no post is up", on the one action that cannot be taken back.
   */
  acknowledgedUnknownAttempt?: true;
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
  /**
   * Which frame becomes the Reel's cover, in milliseconds from the start.
   *
   * `thumb_offset` is the only cover control this app can use. Meta's other one, `cover_url`, takes an image it
   * fetches itself — "the image must be on a public server" — and this app's videos and frames never leave the
   * person's machine until the upload itself, so there is nothing for Meta to fetch. `cover_url` also wins when
   * both are sent, which is the second reason not to send it.
   *
   * Optional because absent and `0` mean the same thing to Meta — the first frame — and the first frame is what
   * every Reel this app has published so far has used. An omitted value therefore cannot change what happens,
   * which is not true of an omitted caption (see createInstagramResumableContainer).
   */
  thumbOffsetMs?: number;
  /**
   * "I checked the account and the previous attempt is not up there."
   *
   * Only meaningful after a publish is refused with INSTAGRAM_PUBLISH_OUTCOME_UNKNOWN: a previous attempt
   * reached Meta and the process died before it could write down the answer, so the app knows a publish
   * happened and cannot know whether it succeeded. Nothing it can call settles that — Meta will list the
   * account's pages, not say whether a given Reel came from here — so, exactly like
   * ForgetInstagramPostRequest.acknowledged, the fact is supplied by the only party who can see it.
   *
   * Literally `true` or absent, never `false`. A coerced or defaulted value would turn "the person did not
   * answer" into "the person said no post is up", on the one action that cannot be taken back.
   */
  acknowledgedUnknownAttempt?: true;
}
export interface PublishToInstagramResponse {
  mediaId: string;
  publishedAt: string;
  project: Project;
}

/**
 * Forgetting a publish, so the same video can be published again.
 *
 * The stored record is what stops a second publish, and there was no way to clear it — a re-cut video could
 * never go out. This clears the app's record and **nothing on Instagram**: the post stays up, and publishing
 * again leaves the account holding two. Named for what it does for exactly that reason; a `republish` route
 * would read, to the next person, as if Meta were being asked to replace something.
 *
 * `acknowledged` is the publish request's `approved` gate turned around. It is not asked because the action is
 * destructive — the archive routes' confirmation-must-match-the-topic convention is the one for that, and it
 * would prove nothing here since the screen holds the topic already. It is asked because **the app cannot
 * check the one fact that decides the outcome**: whether the post was taken down on Instagram. Only a person
 * looking at the account knows, so only a person can assert it.
 */
export interface ForgetInstagramPostRequest { acknowledged: true; }
export interface ForgetInstagramPostResponse { project: Project; }
/** Same for one Episode. Same shape by design — the two publish paths already share everything downstream. */
export interface ForgetLongEpisodeInstagramPostResponse { episode: LongEpisodeDetail; }

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
  /**
   * Everything recorded against this project, both ledgers, across every attempt and not just this month: Runway's
   * video spend (RunwayBudget.costsByScene) plus OpenAI's story, image and narration spend (OpenAiBudget.costsByProject).
   * 0 for a project that never used a real credential (local-fake execution mode).
   *
   * 🔴 This said 「Runway spend」 after the code stopped meaning that — it read only RunwayBudget once, and showed $8.00
   * against $12.60 actually spent (Cowork Round 532); the fix added OpenAI and the sentence stayed behind. A money
   * field's comment decides what the screen reading it says, and Cowork nearly labelled this 「영상 $X」 from it
   * (Cowork Round 835).
   */
  totalActualCostUsd: number;
  /** Same meaning and source as ProjectSummary.aspectRatio (see that field's doc comment) — lets a library card's thumbnail box match the shape this project's videos were actually rendered in. */
  aspectRatio: AspectRatio;
  /**
   * Derived from ProjectSummary.usedAudio — trimmed to just the two fields a library card actually needs
   * (whether to show a credit-line notice, and what it says), not the full mode/trackId shape, since a
   * "someone comes back later to finally publish this" reader has no use for either. Absent whenever usedAudio itself is (never merged, or a Video Library restore invalidated it — see
   * that field's own doc comment for why restore clears it rather than showing a stale credit line).
   */
  attributionRequired?: boolean;
  attributionText?: string;
  /**
   * Present only on a photo card, which has no scene videos by design.
   *
   * A card is one picture under a slow zoom, merged straight to a final video, so its row reads "장면 0/1" —
   * which looks like unfinished work sitting next to "최종 영상 있음" on the same card, two lines contradicting
   * each other. The screen could infer it from finalVideoAvailable && videosReadyCount === 0 && sceneCount === 1,
   * and that is the shape this repository has spent a week removing: a screen deducing a fact the server knows.
   * So the row says it.
   */
  photoCard?: true;
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
  /**
   * Every recorded Runway spend for this Episode, across every attempt — video only. Not the short row's meaning:
   * an Episode's scripts, images and narration are recorded against the parent story id, so they appear once on the
   * story's `ownCostUsd` rather than on each Episode.
   */
  totalActualCostUsd: number;
  aspectRatio: AspectRatio;
  /**
   * Same two fields, same meaning, same source as the short row's — see VideoLibraryProjectSummary.
   *
   * Here for the reason that field exists at all: the person who comes back to this card later to finally
   * publish is the one who has to write the credit line, and an Episode built on a CC BY track was the one
   * kind of card that did not say so. The Episode has carried `usedAudio` since its merge screen started
   * asking about audio; only this row was still short of it.
   */
  attributionRequired?: boolean;
  attributionText?: string;
}
/**
 * A long project's own spend, which had no row anywhere.
 *
 * The OpenAI ledger has no scene or episode dimension: an Episode's script, images and narration are all
 * recorded under the parent project's id, not under `<id>:episodeN`. So the episode rows correctly add nothing
 * for them, and until now the money simply did not appear — $3.45 on the real ledger with no line on any screen
 * showing it. Not a missing number: a number with nowhere to go.
 *
 * It belongs to the story rather than to any one episode, so it is its own row, above the episodes it paid for.
 * Splitting it across them would invent a division the ledger does not record.
 */
export interface VideoLibraryLongProjectSummary {
  projectId: string;
  title: string;
  /** Scripts, images, narration and the outline, all recorded against the parent id. Never includes Runway spend, which is on the episode rows. */
  ownCostUsd: number;
  /** The episodes' own Runway spend added up, so the header can say what the story cost in total without the screen adding money itself. */
  episodesCostUsd: number;
}

export interface GetVideoLibraryResponse { projects: VideoLibraryProjectSummary[]; episodes: VideoLibraryEpisodeSummary[]; longProjects: VideoLibraryLongProjectSummary[]; }

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
  /**
   * Scenes whose clips are behind the *format*, not the script.
   *
   * The clip length and the orientation are project-wide settings, and they are the first line of every video
   * prompt. Saving a different clip length therefore moves every already-generated scene at once — measured, not
   * feared: two generated scenes went from an empty list to both of them on that save alone, with no scene
   * touched. Folded into `videoStale` they would all read "장면 내용이 바뀐 뒤로", sending someone to re-read a
   * script that never moved.
   *
   * The clips are behind — they are the wrong length — so the warning still belongs. A scene appears in exactly
   * one of the two lists.
   */
  videoFormatStale: SceneNumber[];
  /**
   * Scenes whose pictures are behind the *art direction*, not the script.
   *
   * The four visual-style boxes are project-wide and they become one line of every scene's prompt. Saving them
   * therefore moves every already-generated scene at once, with nobody having touched a single scene's words.
   * Folded into `imageStale` those scenes carry the sentence "장면 내용이 바뀐 뒤로" — which sends someone to
   * re-read a script that is exactly as they left it. That is the same failure as saying nothing: they look, find
   * nothing changed, and cannot tell whether the app is wrong or they are.
   *
   * A scene appears in exactly one of the two lists. The comparison ignores both sides' style line, so a line
   * added, changed, or removed all land here, and anything else about the prompt lands in `imageStale`.
   */
  styleStale: SceneNumber[];
  videoStale: SceneNumber[];
  narrationStale: SceneNumber[];
  /**
   * Scenes whose pictures were drawn from reference images that are no longer the ones this scene would use.
   *
   * `imageStale` catches part of this already, because the recorded prompt carries a text description of the
   * mapped Assets — swap one Asset for another and the names differ. It cannot catch the rest: the bytes come
   * from whichever version the mapping currently resolves to, and a Folder mapping is always follow_latest. Draw
   * a new representative picture for the same character Folder and the description is word-for-word identical
   * while every reference byte has changed.
   *
   * Same meaning and same limit as the Episode's field of this name: only scenes with a recorded reference list
   * appear, so this says "known to be behind" and never "the rest are current".
   */
  referenceStale: SceneNumber[];
}

export interface UpdateSceneResponse {
  project: Project;
  staleness: SceneStaleness;
}

/**
 * The name of the file part in each multipart upload — the one thing about an upload that both sides must write
 * identically and that neither side's own tests can see.
 *
 * The BGM upload sent its part as `"file"` while the server read `"audio"`, so the file never arrived: the
 * server refused the request for having no file, and the screen turned that into a generic "try again later"
 * for something that could never succeed. Both halves were green — the frontend asserted its own FormData, the
 * backend called its service with a file object directly — and neither test ever looked at the name that joins
 * them (CLI Round 429, Cowork Round 428).
 *
 * A field name is part of the request contract exactly like a route or a body field, so it lives here with
 * them. Read these; do not retype the string.
 */
export const AUDIO_UPLOAD_FILE_FIELD = "audio";
/**
 * The largest audio file the library accepts, in bytes. The server refuses anything bigger (the upload's own size
 * limit and the service's check both read this), and the screen refuses it *before* sending and builds its
 * 「… 이하」 label from it — one number, so the sentence and the check cannot drift (Cowork Round 834).
 */
export const AUDIO_UPLOAD_MAX_BYTES = 50 * 1024 * 1024;
/** The Asset Library's equivalent — three routes read it, and the frontend writes it in three places. */
export const ASSET_UPLOAD_FILE_FIELD = "image";

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
  /** Re-buys every scene of this job at once. Same body, same per-scene cost — it removes the repetition, not the charge. */
  longEpisodeVideoRegenerateAll: (projectId: string, episodeNumber: number, jobId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/generations/${encodeURIComponent(jobId)}/regenerate-all`,
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
   *
   * `"final"` addresses the merged video, the same word the short project's routes use. Re-merging an Episode
   * used to overwrite the finished cut in place with nothing kept — a cut someone may already have watched,
   * approved, or been one press away from publishing. Restoring one makes it current again and leaves the
   * Episode completed, where restoring a *scene* clears the final video instead: that one invalidates the
   * merge, this one is the merge.
   */
  longEpisodeVideoVersions: (projectId: string, episodeNumber: number, sceneNumber: SceneNumber | "final") =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/${sceneNumber}/versions`,
  longEpisodeVideoVersionContent: (projectId: string, episodeNumber: number, sceneNumber: SceneNumber | "final", versionId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/videos/${sceneNumber}/versions/${encodeURIComponent(versionId)}/content`,
  longEpisodeVideoVersionRestore: (projectId: string, episodeNumber: number, sceneNumber: SceneNumber | "final", versionId: string) =>
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
  backfillGeneratedImages: "/assets/backfill-generated-images",
  photoCards: "/photo-cards",
  /** What the news reel screen reads when it opens: today's count and which publishers we will fetch from. */
  newsReelSetup: "/news/setup",
  /** Fetch one article by address. Free — the paid summary is a separate route that waits on 캡틴D. */
  newsArticle: "/news/article",
  /** The one paid-capable call in this feature. Free tier, but the count is ours and closes first. */
  newsSummaries: "/news/summaries",
  /** Today's articles from the publishers whose bodies we can read. Free — RSS, no key, no provider. */
  newsFeed: "/news/feed",
  /** The card's four lines, written by the provider from one article. Paid-capable, and counted against the same day as the summary. */
  newsReelCardText: "/news/card-text",
  /** Make a project from a finished card and the pictures it goes over. Free — no provider, no key. */
  newsReels: "/news/reels",
  /** One subtitle font file by name, so a card preview can draw with the same bytes FFmpeg burns in. */
  subtitleFont: (name: string) => `/fonts/${name}`,
  providerSettings: "/settings/providers",
  providerCredential: (provider: ProviderCredentialKind) =>
    `/settings/providers/${provider}/credential`,
  providerDisconnect: (provider: ProviderCredentialKind) =>
    `/settings/providers/${provider}/disconnect`,
  providerReconnect: (provider: ProviderCredentialKind) =>
    `/settings/providers/${provider}/reconnect`,
  providerMonthlyBudget: (provider: ProviderCredentialKind) =>
    `/settings/providers/${provider}/monthly-budget`,
  /** The video model this computer uses. Not per provider: it is one choice about what draws the clips. */
  videoModelSetting: "/settings/video-model",
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
  videoFinalRotate: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/videos/final/rotate`,
  photoCardSubtitleColors: (projectId: string, center?: number) => `/projects/${encodeURIComponent(projectId)}/photo-card/subtitle-colors${center === undefined ? "" : `?center=${center}`}`,
  videoLibrary: "/videos/library",
  videoVersions: (projectId: string, scene: SceneNumber | "final") => `/projects/${encodeURIComponent(projectId)}/videos/${scene}/versions`,
  videoVersionContent: (projectId: string, scene: SceneNumber | "final", versionId: string) => `/projects/${encodeURIComponent(projectId)}/videos/${scene}/versions/${encodeURIComponent(versionId)}/content`,
  videoVersionRestore: (projectId: string, scene: SceneNumber | "final", versionId: string) => `/projects/${encodeURIComponent(projectId)}/videos/${scene}/versions/${encodeURIComponent(versionId)}/restore`,
  /** POST re-fetches this job's paid Runway outputs for scenes left holding a placeholder. Never generates. */
  videoRecovery: (projectId: string, jobId: string) => `/projects/${encodeURIComponent(projectId)}/videos/generations/${encodeURIComponent(jobId)}/recovery`,
  /** The Episodes this project has archived, newest first. */
  longEpisodeArchives: (projectId: string) => `/long-projects/${encodeURIComponent(projectId)}/episodes/archives`,
  longEpisodeArchiveRestore: (projectId: string, archiveId: string) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/archives/${encodeURIComponent(archiveId)}/restore`,
  /** A free, provider-free preflight: which scenes an image generation would actually buy. */
  longEpisodeImagePreview: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/images/generations/preview`,
  /** How far a running image generation has got, scene by scene. Reads files; costs nothing; never refuses mid-run. */
  longEpisodeImageProgress: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/images/generations/progress`,
  /** Takes back one scene's approval. A separate route from approve so neither body can be mistaken for the other. */
  longEpisodeImageReviewUnapproval: (projectId: string, episodeNumber: number, sceneNumber: SceneNumber) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/images/review/${sceneNumber}/unapprove`,
  /** How far a running short-project image generation has got, scene by scene. Reads files; costs nothing; never refuses mid-run. */
  imageGenerationProgress: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/images/generations/progress`,
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
  /** DELETE clears this project's stored post so it can be published again. Never touches Instagram. */
  instagramPostRecord: (projectId: string) => `/projects/${encodeURIComponent(projectId)}/instagram/post`,
  longEpisodeInstagramPostRecord: (projectId: string, episodeNumber: number) =>
    `/long-projects/${encodeURIComponent(projectId)}/episodes/${episodeNumber}/instagram/post`,
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

/**
 * The one thing a `NewsSummaryCheck` can lie about, refused at the boundary.
 *
 * 🔴 `missing` is a convenience over `claims`, and the moment the two disagree the screen's red banner and the
 * server's decision to refuse come apart — a summary could be handed over as clean while `claims` holds a span
 * that was never in the article, or blocked over a span that was. Both readings of "is this safe" must come
 * from the same list, so the derived one is checked against its source rather than trusted.
 *
 * Also refuses a claim with no text: an empty span cannot have been looked for, and `found: true` on one would
 * be a pass nobody earned.
 */
export function assertNewsSummaryCheck(check: NewsSummaryCheck): void {
  if (check.claims.some((claim) => !claim.text.trim())) {
    throw new Error("A checked claim must carry the text that was looked for.");
  }
  const notFound = check.claims.filter((claim) => !claim.found);
  if (check.missing.length !== notFound.length || check.missing.some((item, index) => item !== notFound[index])) {
    throw new Error("`missing` must be exactly the claims whose `found` is false, in order.");
  }
}

const isPublisher = (value: unknown): value is NewsPublisher =>
  typeof value === "object" && value !== null
  && typeof (value as NewsPublisher).host === "string" && !!(value as NewsPublisher).host.trim()
  && typeof (value as NewsPublisher).name === "string" && !!(value as NewsPublisher).name.trim()
  // 🔴 Checked against the four, not merely for being a string. An unrecognised value would reach a
  // branch nobody wrote and render as whichever one happens to be last — and the branch that matters here is
  // `unknown`, which must never be drawn as a promise either way.
  && ["address", "varies", "paste", "unknown"].includes((value as NewsPublisher).body);

/**
 * 🔴 The guard is here for one field, and it is `dailyCalls`.
 *
 * A response whose `dailyCalls` key is simply **absent** would read as `undefined`, and `undefined` is the shape
 * a screen is most likely to treat as "nothing to worry about". `null` is a statement — *the ledger could not be
 * read, so no call may be made* — and losing the difference between "said null" and "said nothing" turns the
 * most conservative answer the server has into the most permissive one the screen can draw. So the key must be
 * present, and the only two things it may be are a pair of numbers or `null`.
 *
 * This is the distinction `colors: null` already draws on the card preview: a value of null and a missing key
 * are different facts and only one of them is an answer.
 */
export function isNewsReelSetupResponse(value: unknown): value is NewsReelSetupResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.publishers) || !candidate.publishers.every(isPublisher)) return false;
  if (!("dailyCalls" in candidate)) return false;
  const calls = candidate.dailyCalls;
  if (calls === null) return true;
  if (typeof calls !== "object") return false;
  const { used, limit } = calls as NewsDailyCallCount;
  return Number.isInteger(used) && used >= 0 && Number.isInteger(limit) && limit > 0;
}

/**
 * 🔴 Every row is checked, and a bad row fails the whole answer rather than being dropped.
 *
 * The image library drops a malformed Episode row and keeps the rest, because a broken Episode must not cost
 * somebody the pictures they came for. This is the other case: a row here is an **address the server will be
 * sent to next**, and a list that quietly discards the ones it could not read is a list whose length nobody
 * can reason about. There is nothing to salvage — the publisher can be pasted by hand.
 */
export function isNewsFeedResponse(value: unknown): value is NewsFeedResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.items) || !Array.isArray(candidate.unavailable)) return false;
  if (!candidate.unavailable.every(isPublisher)) return false;
  return candidate.items.every((item) => {
    if (typeof item !== "object" || item === null) return false;
    const row = item as Record<string, unknown>;
    const text = (key: string) => typeof row[key] === "string" && !!(row[key] as string).trim();
    if (!text("title") || !text("url") || !text("publisher") || !text("host")) return false;
    for (const key of ["publishedAt", "imageUrl"] as const) {
      if (!(key in row)) return false;
      if (row[key] !== null && typeof row[key] !== "string") return false;
    }
    return true;
  });
}

/**
 * 🟠 Checks the `outcome` tag hard, because every branch below it is drawn differently and an unknown tag
 * silently falling through to the friendliest branch is how a refusal gets rendered as a blank article form.
 */
export function isNewsFetchArticleResponse(value: unknown): value is NewsFetchArticleResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  const str = (key: string) => typeof candidate[key] === "string" && !!(candidate[key] as string).trim();
  switch (candidate.outcome) {
    case "article": {
      const article = candidate.article as NewsArticleInput | undefined;
      return typeof article === "object" && article !== null
        && ["title", "body", "publisher", "publishedAt", "sourceUrl"].every(
          (key) => typeof article[key as keyof NewsArticleInput] === "string" && !!article[key as keyof NewsArticleInput].trim(),
        );
    }
    case "body_not_found":
      // 🟠 `publishedAt` may genuinely be null and `title` may genuinely be empty — plenty of pages say neither,
      // and refusing the whole response over a missing headline would turn the paste branch into a dead end.
      // Absent is still not allowed: a key that is not there is not an answer.
      return str("sourceUrl") && str("publisher")
        && typeof candidate.title === "string"
        && "publishedAt" in candidate && (candidate.publishedAt === null || typeof candidate.publishedAt === "string");
    case "unreachable":
      return str("sourceUrl");
    case "refused":
      // The reason is checked against the four the screen draws, not merely for being a string — an unknown
      // reason would reach a branch nobody wrote and render as whichever one happens to be last.
      return ["publisher_not_allowed", "private_address", "unsupported_address", "too_many_redirects", "page_too_large"]
        .includes(candidate.reason as string)
        && Array.isArray(candidate.publishers) && candidate.publishers.every(isPublisher);
    default:
      return false;
  }
}

/**
 * 🔴 The guard exists for `check`, and for one property of it: `missing` has to agree with `claims`.
 *
 * The screen decides whether the card button opens from `missing`, and the sentence it shows about what went
 * wrong comes from the same list. If a response could disagree with itself, a summary carrying an invented
 * figure could arrive with an empty `missing` and be handed to the card flow as clean. `assertNewsSummaryCheck`
 * already refuses that on the server; this refuses it again at the boundary, because the two ends are allowed
 * to be different programs.
 */
export function isCreateNewsSummaryResponse(value: unknown): value is CreateNewsSummaryResponse {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.summary !== "string" || !candidate.summary.trim()) return false;

  const check = candidate.check as NewsSummaryCheck | undefined;
  if (typeof check !== "object" || check === null) return false;
  const isClaim = (claim: unknown): claim is NewsClaimCheck =>
    typeof claim === "object" && claim !== null
    && ["number", "date", "quote"].includes((claim as NewsClaimCheck).kind)
    && typeof (claim as NewsClaimCheck).text === "string" && !!(claim as NewsClaimCheck).text.trim()
    && typeof (claim as NewsClaimCheck).found === "boolean";
  if (!Array.isArray(check.claims) || !check.claims.every(isClaim)) return false;
  if (!Array.isArray(check.missing) || !check.missing.every(isClaim)) return false;
  const notFound = check.claims.filter((claim) => !claim.found);
  if (check.missing.length !== notFound.length) return false;
  if (check.missing.some((item, index) => item.text !== notFound[index]?.text || item.kind !== notFound[index]?.kind)) return false;

  const calls = candidate.dailyCalls as NewsDailyCallCount | undefined;
  if (typeof calls !== "object" || calls === null) return false;
  if (!Number.isInteger(calls.used) || calls.used < 0 || !Number.isInteger(calls.limit) || calls.limit <= 0) return false;

  // 🟠 `tooLong` is either absent or literally `true`. A `false` would be a third state saying the same thing
  // as absent, and two ways to say one thing is how a screen ends up checking only one of them.
  return !("tooLong" in candidate) || candidate.tooLong === true;
}

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
