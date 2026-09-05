import type { WorkflowState } from "./workflow.js";

/**
 * Deliberately a plain `number` rather than a fixed literal union: a scene number is bounded by a project's own
 * scene count (2-12, see MIN/MAX below), not a single fixed set.
 */
export type SceneNumber = number;

/**
 * A short project's scene count is being generalized away from a fixed 6 (see docs/02_MIGRATION_PLAN.md) so it can
 * match whichever video AI provider is connected — different providers support different per-clip durations, so
 * the total video length is scene count times the connected provider's clip length. These bounds are a sanity
 * range, not tied to any one provider.
 */
export const MIN_SCENE_COUNT = 2;
export const MAX_SCENE_COUNT = 12;

/** The canonical 1..count scene number sequence for a project with this many scenes. */
export function sceneNumbersFor(sceneCount: number): SceneNumber[] {
  return Array.from({ length: sceneCount }, (_, index) => index + 1);
}

/**
 * Clip durations Runway Gen-4 Turbo's API accepts (`enum: [5, 10]`, confirmed against docs.aimlapi.com and
 * help.runwayml.com) — there is no bin-packing or mixed-duration support, a project picks one of these directly
 * and its total video length is sceneCount * that duration. Runway is the only supported video Provider today,
 * so this list is not yet keyed by provider; when a second one is added, this becomes a per-provider capability.
 */
/**
 * The video models this app knows how to talk about.
 *
 * One today. It was written out as the bare string `"gen4_turbo"` in eight places — the adapter that actually
 * sends it, four server-side records and previews, two contract fields, and two client response guards — and
 * nothing tied any of them to the one that goes on the wire.
 *
 * 🔴 The two client guards are why this is not tidiness. They read `value.model === "gen4_turbo"` and reject
 * the whole response otherwise, so the moment the adapter's model changes the server answers correctly and both
 * video screens say 서버 응답을 확인할 수 없습니다 about a server that is working. A model swap is a queued
 * task here, so this is a trap with a date on it.
 *
 * Adding a model means adding it here, and the places that must agree stop compiling until they do.
 */
/**
 * What a merged video's soundtrack is made of.
 *
 * The four names were written out by hand in seven places — the contract field itself, three request
 * validators on the server (short project, Episode, and the Episode detail reader), the storage schema's own
 * `USED_AUDIO_MODES`, and the client's radio-button list. They agreed; nothing made them.
 *
 * 🟠 This is also the hole in `contract-value-sets.test.ts`, which can only notice a copy of a set the contract
 * declares as an array. `mode` was an inline union, so the client's `["narration", "narration+bgm", "bgm",
 * "silent"] as AudioMode[]` — the exact shape that guard exists to catch — sat in plain sight and passed.
 *
 * The client list is what draws the buttons, so a mode added to the storage schema and not to it is a mode the
 * server accepts and nobody can pick.
 */
/**
 * The shapes a project renders in.
 *
 * Written out as `"9:16" | "16:9"` on nine contract fields and copied into two more places, one of them a
 * client response guard. Same reason as AUDIO_MODES below: a union the contract states inline is a set neither
 * copy-guard can watch, because there is no array to compare a literal against.
 */
export const ASPECT_RATIOS = ["9:16", "16:9"] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/**
 * A video generation job's status, as both screens poll it.
 *
 * The client guards check a polled status against their own copy of this list and call the whole response
 * malformed otherwise — so a status added on the server and not there stops a job's screen dead while the job
 * runs. Five members, three copies.
 */
export const VIDEO_JOB_STATUSES = ["created", "running", "succeeded", "failed", "interrupted"] as const;
export type VideoJobStatus = (typeof VIDEO_JOB_STATUSES)[number];

/** The two states an Episode outline can be in while the timeline is still editable. */
export const LONG_EPISODE_OUTLINE_STATUSES = ["planned", "outline_ready"] as const;
export type LongEpisodeOutlineStatus = (typeof LONG_EPISODE_OUTLINE_STATUSES)[number];

export const AUDIO_MODES = ["narration", "narration+bgm", "bgm", "silent"] as const;
export type AudioMode = (typeof AUDIO_MODES)[number];
/** A guard rather than a bare `includes`, so a validator that used to be a chain of `!==` keeps narrowing the value it checked. */
export const isAudioMode = (value: unknown): value is AudioMode => AUDIO_MODES.includes(value as AudioMode);

/**
 * What a merge does about background music when the request does not say.
 *
 * Both merges answered this identically and separately: two copies of 0.25, two copies of 2, two spellings of
 * "which modes carry a track", and two of "bgm alone plays at full". They agreed — which is what every copy in
 * this repository did until the day one of them did not, and the two that drifted were both found by someone
 * reading, not by anything failing.
 *
 * 🔴 A drift here is audible and lands in a finished video: the same mode mixed two ways in the two pipelines,
 * with nothing on either screen saying which one a person is hearing.
 *
 * In the contract rather than the backend because `MergeAudioSettings.volume` is optional — a client that omits
 * it is entitled to know what it gets, and today it can only find out by making the video.
 */
export const DEFAULT_BGM_VOLUME = 0.25;
export const DEFAULT_BGM_FADE_SECONDS = 2;

/** Both modes that carry a track. Named once so a third caller cannot forget the newer of the two. */
export const usesBgm = (mode: string): boolean => mode === "narration+bgm" || mode === "bgm";

/**
 * The bgm level to use when the request does not say.
 *
 * 0.25 exists to keep music under a voice. With no voice that reason is gone, and applying it anyway would make
 * someone's own upload quiet for a cause no screen mentions.
 */
export const defaultBgmVolume = (mode: string): number => (mode === "bgm" ? 1 : DEFAULT_BGM_VOLUME);

export const VIDEO_MODELS = ["gen4_turbo"] as const;
export type VideoModel = (typeof VIDEO_MODELS)[number];

/**
 * Everything a screen or a quote needs to know about one video model.
 *
 * The point of this shape is `pricePerSecondUsd`. A model picker whose price does not move with the model is
 * worse than no picker at all: the estimate, the confirmation panel and the budget preflight would all quote
 * the old model's price and let a run through that the month cannot afford — quoting money low being the one
 * direction this must never be wrong in (local-video-workflow.service.ts says so about the same number).
 *
 * `ratios` is here before it is needed. "720:1280" is Runway's own vocabulary and eight files already know it;
 * a second provider will not use those strings, and the day that happens the alternative is finding all eight
 * again. `maxDurationSeconds` is the same bet at lower stakes.
 */
export interface VideoModelOption {
  id: VideoModel;
  /** Shown as-is. Not derived from the id: a person choosing what to spend money on reads a name, not a slug. */
  label: string;
  pricePerSecondUsd: number;
  ratios: readonly string[];
  maxDurationSeconds: number;
}

/**
 * The models this app can be told to use — one today, and the mechanism for choosing is what was asked for.
 *
 * 🔴 A second entry needs a price somebody has confirmed. $0.05/second is not a guess: it reproduces the $0.25
 * per five-second scene that this machine's Runway ledger has been charging all along. Adding a model with an
 * unverified rate would put a fabricated number under the budget check, which is the failure this whole shape
 * exists to prevent — so a new model waits for its real rate rather than a plausible one.
 */
export const VIDEO_MODEL_OPTIONS: readonly VideoModelOption[] = [
  { id: "gen4_turbo", label: "Runway Gen-4 Turbo", pricePerSecondUsd: 0.05, ratios: ["720:1280", "1280:720"], maxDurationSeconds: 10 },
];

/** The one used when nobody has chosen — today's behaviour, unchanged. */
export const DEFAULT_VIDEO_MODEL: VideoModel = "gen4_turbo";

export function videoModelOption(id: string): VideoModelOption {
  return VIDEO_MODEL_OPTIONS.find((option) => option.id === id) ?? VIDEO_MODEL_OPTIONS[0]!;
}

export const RUNWAY_CLIP_DURATIONS = [5, 10] as const;
export type RunwayClipDurationSeconds = (typeof RUNWAY_CLIP_DURATIONS)[number];

/**
 * The longest quote a photo card will take.
 *
 * Here rather than on either side because both need it and they need the same one: the server refuses a longer
 * quote, and the screen has to show a counter — without one a person types past the limit, presses the button,
 * is refused, and writes the sentence again. A number kept in two places drifts, and the drift is invisible
 * until someone is at 301 characters.
 *
 * 300 is a screenful of text over a picture, and a card is something a person reads at a glance.
 */
export const PHOTO_CARD_QUOTE_MAX_LENGTH = 300;

/**
 * Runway Gen-4 Turbo's API `prompt` field maxLength (confirmed against docs.aimlapi.com's schema, the same source
 * already cited for {@link RUNWAY_CLIP_DURATIONS}). Measured in UTF-16 code units, matching JavaScript's native
 * `.length` and Runway's own counting. When a rendered video prompt would exceed this, the caller drops optional
 * sections in priority order rather than truncating mid-sentence.
 */
/**
 * Where a finished video is written, relative to whatever owns it — a short project, or one Episode.
 *
 * This literal had ten homes: five in the backend, four in the frontend (two of them inside response guards
 * that reject anything else), and the contract's own two response fields, which type the field as this exact
 * string. Ten copies of a value the contract already declares, and two of them decide whether a merge response
 * is believed at all — so a rename would not break loudly, it would make finished videos stop being recognised.
 *
 * The Episode's directory layout was consolidated for exactly this reason (`LONG_STORY_DIRECTORY`); the file at
 * the end of it was not.
 */
export const FINAL_VIDEO_RELATIVE_PATH = "videos/final/instagram_reel.mp4";

/**
 * Instagram's own two ceilings on a caption.
 *
 * The caption length was written down twice — once on the screen and once in the publish service, whose comment
 * says why it checks at all: *"so a caller that skips the screen cannot get a post rejected after the upload
 * already happened."* Two numbers holding that promise up is one number away from not holding it.
 *
 * 🔴 The hashtag count was written down once, on the screen only. The server never counted them, so the very
 * case that comment describes was open: a request that does not come from the screen uploads the media, and
 * Instagram refuses the publish at the end.
 *
 * Here rather than in either app because both have to agree about them, and this is the one publish that cannot
 * be taken back.
 */
export const INSTAGRAM_CAPTION_MAX = 2_200;
export const INSTAGRAM_HASHTAG_MAX = 30;

/**
 * How many hashtags a caption carries, counted the way Instagram sees it.
 *
 * Over the whole caption, not over the field a person types them into: a tag written in the body counts against
 * the same limit, and a screen counting only its own field would show 29 for a caption Instagram reads as 31.
 * The screen and the server both call this, so they cannot disagree about what a hashtag is — a server refusing
 * what the screen accepted would arrive as a rejection after the upload, which is the failure being prevented.
 *
 * A bare `#` is not a tag. Unicode letters count, because Korean tags are the ordinary case here.
 */
export function instagramHashtagCount(caption: string): number {
  return caption.match(/#[\p{L}\p{N}_]+/gu)?.length ?? 0;
}

export const RUNWAY_PROMPT_MAX_LENGTH = 1_000;

/**
 * Sent with every video prompt, never recorded with one.
 *
 * Runway's own INTERNAL.BAD_OUTPUT documentation names two first causes: readable text or logos on the input
 * frame, and a prompt that asks for text. The image side has been covering the first since the no-legible-text
 * rule went into the request-time image prompt. The second was still wide open — and it is not hypothetical.
 * Four scenes in the live projects ask for it in the fields the video prompt is built from:
 *
 *   12/Episode01 scene 2   end_motion 이 'IBAD' 손글씨를 드러내고, camera_motion 이 그 글씨로 돌리 인한다
 *   12/Episode03 scene 4   광고 문구가 낙서를 덮었다가 갈라진다
 *   IBAD/Episode01 scene 2 허공의 분류 문구가 교차 표시된다
 *   IBAD/Episode01 scene 4 네온 간판이 물웅덩이에 흔들린다
 *
 * The first of those is the whole documented failure in one scene: a shot whose final beat is lettering, with
 * a camera move onto it.
 *
 * Request-time only, exactly like the image rule and for the same reason: putting a constant line into the
 * *recorded* prompt would mark all 43 recorded prompts stale — 43 scenes reading "your prompt has changed"
 * because of a line no person wrote.
 */
export const NO_LEGIBLE_TEXT_VIDEO_RULE = "Do not render readable writing in frame: no signs, labels, captions or logos.";

/**
 * What a prompt may be *before* the rule above is appended — the limit every screen and every check that
 * handles an author's prompt must use.
 *
 * Reserved rather than checked after the fact. A prompt accepted at the full 1,000 would exceed it the moment
 * the rule is added, and the adapter would refuse the scene right before submitting it: no charge, but the job
 * halts on a limit the person was told they were inside of. Room taken up front cannot run out.
 *
 * Today's recorded prompts are 493–902 code units, so nothing existing moves. A prompt long enough to feel this
 * drops a removable section in the builder that already exists for it, and says which one.
 */
export const RUNWAY_PROMPT_AUTHORING_LIMIT = RUNWAY_PROMPT_MAX_LENGTH - (NO_LEGIBLE_TEXT_VIDEO_RULE.length + 1);

/**
 * Conservative local per-request cost estimates, used both for the local budget ledgers' preflight/record
 * accounting (apps/backend/src/providers/{openai,runway}-budget.ts) and for any UI that needs to display or
 * compute an estimate — e.g. the in-app workflow guide, or a video job's own stored estimated_cost_usd. Backend
 * and frontend must never each hold their own copy of these (see Round 22's RUNWAY_PROMPT_MAX_LENGTH consolidation
 * for the same reasoning) — a rate change updates every consumer via this single source.
 */
export const STORY_ESTIMATED_COST_USD = 0.05;
export const IMAGE_ESTIMATED_COST_USD = 0.10;
/**
 * One second of generated video, and the per-scene estimate derived from it.
 *
 * This was a flat `VIDEO_SCENE_ESTIMATED_COST_USD = 0.25` per scene while `RUNWAY_CLIP_DURATIONS` has always
 * offered 5 and 10 — so a project set to 10-second clips bought twice the video and was quoted the same price,
 * everywhere: the preflight that decides whether to spend, the confirmation panel, the preview, the retry
 * notice, the library total. Ten-second projects exist on this machine today.
 *
 * Which direction that is wrong in is the whole point. local-video-workflow.service.ts already says it:
 * quoting money low is the one direction this must never be wrong in. A flat number is right for 5 seconds and
 * half the truth for 10.
 *
 * $0.05/second reproduces today's $0.25 at 5 seconds exactly, so nothing about a 5-second project moves. If
 * Runway in fact bills per clip rather than per second, this over-quotes a 10-second scene — the safe
 * direction, and still the direction to be wrong in.
 *
 * There is deliberately no flat per-scene constant left to reach for. Every caller has a clip duration in hand
 * (both a short project's settings and an Episode's carry one), and a site that cannot name a duration is a
 * site that does not know what it is pricing. The generic workflow guide, which has no project, states the
 * duration it is quoting.
 */
export const VIDEO_SECOND_ESTIMATED_COST_USD = 0.05;
/**
 * What one scene costs, from the two things that decide it: how long the clip is and which model draws it.
 *
 * The model argument is why this is a function and not a constant. A picker that leaves the price behind is
 * the failure this signature prevents — every quote, confirmation and preflight passes the model it is about,
 * and one that cannot name a model gets today's default rather than a silent zero.
 */
/**
 * 🔴 Takes the option itself, not only a name.
 *
 * Given an id it does not know, this used to fall back to the first listed model and quote *that* model's rate
 * — the exact failure the shape exists to prevent, found by Cowork's own pair: a card rendering a second
 * option priced every row at the default's $0.05. Silently answering about a different model is worse than
 * refusing, and worse than the constant this replaced.
 *
 * A caller holding the option passes it and is priced from it. A caller holding only a name is on the server,
 * where the name came from `resolveVideoModel` and is always one of ours; an unrecognised one there still
 * resolves to the default, which is that function's documented job.
 */
export function videoSceneEstimatedCostUsd(clipDurationSeconds: number, model: string | VideoModelOption = DEFAULT_VIDEO_MODEL): number {
  const rate = typeof model === "string" ? videoModelOption(model).pricePerSecondUsd : model.pricePerSecondUsd;
  return Math.round(clipDurationSeconds * rate * 100) / 100;
}
/**
 * A Long Project outline call returns the whole-project overview plus every Episode's lightweight outline in
 * one request — its output can span far more content than a single 6-scene short-project Story (a project can
 * have dozens of Episodes), so this is set higher than STORY_ESTIMATED_COST_USD despite being the same one-call
 * shape. Like the other constants here, it is a flat conservative local estimate, not a per-Episode-count
 * calculation — the real per-request cost genuinely does grow with episodeCount, but Provider APIs never expose
 * a way to know that ahead of the call, so every long-project outline preview shows this same flat number
 * regardless of episode count, same as Story/Image/Video before it.
 */
export const LONG_OUTLINE_ESTIMATED_COST_USD = 0.10;
/**
 * One narration TTS call per scene (matching Image/Video's per-scene pattern, since each scene has distinct
 * narration text). Based on gpt-4o-mini-tts's real per-minute rate (~$0.015/min as of 2026-08, from
 * $0.60/1M input text tokens + $12/1M audio output tokens) applied to the longest supported clip
 * (RUNWAY_CLIP_DURATIONS' 10s max) — actual cost per scene is closer to $0.0025, so this keeps a roughly
 * 4x safety margin without wildly overstating the true cost the way a same-order-of-magnitude-as-Image
 * estimate would.
 */
export const TTS_ESTIMATED_COST_USD = 0.01;

/**
 * Where to go after a budget refusal, said in one place because a refusal with no way out is not information.
 *
 * Until the monthly limit reached a settings screen, "이번 달 예산을 초과했습니다" was the whole truth: the only
 * ways past it were to wait for the calendar month or to hand-edit the spend ledger, and neither is something to
 * put in an error message. Now there is a door, and a refusal that does not mention it leaves the person exactly
 * where the old one did.
 *
 * Appended to every budget-exceeded message rather than shown separately, so it travels with the sentence into
 * whichever screen renders it — there is no one place these are displayed. `budget-refusal-route.test.ts` holds
 * the rule that a new one cannot be added without it.
 */
export const BUDGET_LIMIT_ROUTE_HINT = "설정 화면의 「이번 달 쓸 수 있는 돈」에서 한도를 올릴 수 있습니다.";

export type ProjectType = "short_project" | "long_story_project";
export const REVIEW_DECISIONS = ["pending", "approved", "rejected"] as const;
export type ReviewDecision = (typeof REVIEW_DECISIONS)[number];
export type JobStatus =
  | "created"
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted"
  | "cancelled";

export interface Scene {
  number: SceneNumber;
  script: string;
  motionPrompt: string;
  generatedImagePath?: string;
  generatedVideoPath?: string;
  /** This project type's narration/subtitle sentence — Long Episodes have their own separate LongEpisodeScene.narration field (api.ts), not this one, since a long-form Episode never uses this Scene type at all. Optional: absent on scenes stored before this field existed. Present regardless of ShortProjectSettings.narrationEnabled — only actually turned into TTS audio when that flag is on. */
  narration?: string;
  /**
   * The 16 remaining short-project scene fields PATCH /projects/:id/scenes/:sceneNumber can edit
   * (`description` is Story's own narrated-script text, display-only — nothing downstream reads it;
   * the rest feed image or video prompt assembly, see that endpoint's editable-field grouping). Kept
   * snake_case rather than translated to camelCase like `script`/`imagePrompt`/`motionPrompt` above,
   * because unlike those three (which are computed, mapped fields), these are the project's own raw
   * scene object passed straight through with its original key names — naming them camelCase here would
   * claim a translation that doesn't actually happen. All optional: absent on scenes stored before Story
   * generation ran, and on any legacy scene shape from before these fields existed.
   */
  description?: string;
  visual_action?: string;
  shot_size?: string;
  camera_angle?: string;
  composition?: string;
  lens_feel?: string;
  focus_subject?: string;
  start_motion?: string;
  main_motion?: string;
  end_motion?: string;
  expression_change?: string;
  camera_motion?: string;
  environment_motion?: string;
  motion_speed?: string;
  motion_intensity?: string;
  continuity_hint?: string;
}

export interface ProjectSummary {
  id: string;
  topic: string;
  projectType: ProjectType;
  workflowState: WorkflowState;
  createdAt: string;
  updatedAt: string;
  /**
   * True only for a photo card: one chosen picture and one line of text, no script and no video generation.
   *
   * Deliberately not a third `ProjectType`. A photo card is a short project in every way that matters — same
   * storage, same merge, same publish, same audio library and licence credit — and giving it its own type would
   * mean re-attaching all five to a new owner. What it needs is one fact the pipeline can branch on: its scene
   * is a still image, so the merge holds it and pans instead of playing it, and nothing about it is worth
   * charging a provider for.
   *
   * Absent means an ordinary project. A screen may read this to drop a choice that has no meaning here — the
   * publish screen's cover-frame offset picks a moment out of five seconds of slow zoom, where every moment
   * looks the same.
   */
  photoCard?: boolean;
  /**
   * Where this card's text sits and how big it is — the values its last merge used, or the defaults for a card
   * that has never been merged with a choice.
   *
   * Present only for a photo card. Ordinary projects have no such control: their subtitle stays at the bottom,
   * because raising it would cover the action the shot exists to show.
   *
   * Sent so the screen that offers the control starts from what the video actually looks like, and so a card
   * merged again does not silently go back to the defaults — the person adjusted it once. See
   * {@link PHOTO_CARD_SUBTITLE_SCALE} for the numbers and the reasoning.
   */
  subtitleLayout?: PhotoCardSubtitleLayout;
  /**
   * Same source and priority as video-preview.service.ts's ratioFor()/image-prompt.ts's imageSizeFor()
   * (style_profile.aspect, "16:9" vs anything else defaulting to vertical) — added here so every screen that
   * needs to know this project's shape (a review thumbnail's aspect box, a video library card) reads the one
   * fact instead of assuming a default independently. Three screens/services had already done that
   * independently and landed on three different wrong assumptions before this field existed.
   */
  aspectRatio: AspectRatio;
  /**
   * Whether this project has at least one real generated narration audio file today — not simply whether
   * ShortProjectSettings.narrationEnabled is on, since a project can have the setting on with nothing generated
   * yet (or narration later disabled after generating). Lets the merge screen derive its audio mode's default
   * from what the project actually has (docs/06_DECISIONS.md D-011) rather than the user needing to discover by
   * trial that "narration" silently produces no narration.
   */
  narrationAvailable: boolean;
  /**
   * What audio the most recent completed merge actually used — set once by `merge()`, cleared by a Video
   * Library restore (a restored scene invalidates the final video entirely; a restored final version's own
   * audio was never separately recorded per-version, so it is cleared rather than shown as if still current).
   * `attributionRequired`/`attributionText` are copied by value from the track at merge time, not a live
   * reference, specifically so that deleting the track afterward (allowed — see AudioLibraryTrack's own doc
   * comment) can never silently erase the credit line a published video still owes (docs/06_DECISIONS.md D-003).
   */
  /**
   * Set once this project's final video has actually been published to Instagram. Present means it is out in
   * the world: the screen uses this to stop offering to publish the same cut twice, and the server refuses a
   * second publish outright (D-005) — an accidental duplicate post cannot be taken back from whoever saw it.
   */
  instagramPost?: {
    mediaId: string;
    igUserId: string;
    publishedAt: string;
    /**
     * What was actually published with it.
     *
     * Stored since the first publish and carried nowhere, so the screen could say a project was posted but not
     * what went out with it — while the Episode's record carried the caption from the start. The caption is
     * where the licence credit and the AI disclosure live, so "what did this post say" is the question someone
     * asks precisely when it matters (D-003).
     */
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
  };
  /**
   * Posts published and then forgotten, oldest first — see LongEpisodeDetail.previousInstagramPosts.
   *
   * Clearing `instagramPost` is how a re-cut video becomes publishable again, and on its own that clearing
   * would also erase the only trace that something may still be live on the account.
   */
  previousInstagramPosts?: Array<{ mediaId: string; igUserId: string; publishedAt: string; caption: string }>;
  usedAudio?: UsedAudio;
}

/**
 * What a finished merge actually used, copied at merge time.
 *
 * Named rather than written inline because the Episode needs the same shape, and a second anonymous copy is a
 * second place for the credit line's fields to drift — which for `attributionText` means a video published
 * without the credit its licence requires (D-003).
 */
export interface UsedAudio {
  mode: AudioMode;
  trackId?: string;
  attributionRequired?: boolean;
  attributionText?: string;
}

export interface Project extends ProjectSummary {
  scenes: Scene[];
  finalVideoPath?: string;
  /** The most recently submitted local fake video job's ID, when one exists — lets a dashboard resume directly into its progress screen. */
  currentVideoJobId?: string;
  warnings: string[];
  errors: string[];
}

/**
 * A photo card's subtitle size and position, as fractions of the frame height.
 *
 * Fractions, not pixels: the same card is rendered at 1080x1920 or 1920x1080, and a pixel size would mean two
 * different-looking videos from one setting.
 *
 * Two handles, not three. The heading size is derived from the body (`* 1.4`) rather than set on its own —
 * three handles can be turned into a combination that does not fit together, and nothing on screen would say
 * so. The defaults are the pair 캡틴D chose from rendered drafts (52px body / 73px heading at 1920).
 *
 * The bounds are refusals, not clamps: a request outside them is rejected rather than quietly corrected, so a
 * screen can never send one number and get a video made from another (see the storage-schema drift in CLI
 * Round 437 for what silent disagreement between two layers costs).
 */
export interface PhotoCardSubtitleLayout {
  /** Body text height as a fraction of frame height. */
  scale: number;
  /** Vertical centre of the whole text block as a fraction of frame height. */
  center: number;
}

/** Body size: 0.027 of frame height is 52px at 1920. The range is "readable at a glance" to "a third of the frame", both ends tried on real cards. */
export const PHOTO_CARD_SUBTITLE_SCALE = { default: 0.027, min: 0.020, max: 0.050 } as const;
/**
 * Block centre: 0.40 of frame height.
 *
 * Not the bottom, which is where subtitles were and where Reels puts its caption, account name and buttons —
 * the text was rendered under the platform's own interface and could not be read at all. Not dead centre
 * either: the last line landed under the right-hand button column. The range stays clear of both edges of the
 * frame; it is "not covered, and near the picture's focus", not a measured optimum.
 */
export const PHOTO_CARD_SUBTITLE_CENTER = { default: 0.40, min: 0.15, max: 0.85 } as const;

/** The layout a card gets when nobody has chosen one. */
export const DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT: PhotoCardSubtitleLayout = {
  scale: PHOTO_CARD_SUBTITLE_SCALE.default,
  center: PHOTO_CARD_SUBTITLE_CENTER.default,
};

/** True when both numbers are real, finite and inside their published ranges — the one definition both the server's refusal and the screen's own check read. */
export function isPhotoCardSubtitleLayout(value: unknown): value is PhotoCardSubtitleLayout {
  if (typeof value !== "object" || value === null) return false;
  const { scale, center } = value as { scale?: unknown; center?: unknown };
  return typeof scale === "number" && Number.isFinite(scale) && scale >= PHOTO_CARD_SUBTITLE_SCALE.min && scale <= PHOTO_CARD_SUBTITLE_SCALE.max
    && typeof center === "number" && Number.isFinite(center) && center >= PHOTO_CARD_SUBTITLE_CENTER.min && center <= PHOTO_CARD_SUBTITLE_CENTER.max;
}

/**
 * One photo card's text, split the way it is rendered: an optional heading line and the body under it.
 *
 * The split is a rule, not a formatting detail — the first line is the heading only when a line follows it. The
 * quote is typed by hand, so a card with no line break has no heading, and assuming two parts renders a
 * one-line card entirely in the heading face.
 */
export function splitPhotoCardSubtitle(text: string): { heading?: string; body: string[] } {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.length >= 2 ? { heading: lines[0]!, body: lines.slice(1) } : { body: lines };
}

/** Every number the card's text is drawn from, in output pixels. */
export interface PhotoCardSubtitleGeometry {
  bodySize: number;
  headSize: number;
  /** Distance from the heading's centre to the body block's first line centre. */
  headGap: number;
  /** Distance between body lines, centre to centre. */
  lineGap: number;
  /** Vertical centre of the heading line. */
  headingY: number;
  /** Vertical centre of the body block. */
  bodyY: number;
  /** Horizontal centre — every line is placed by its own centre. */
  centerX: number;
  /** Left and right margin, which is what a long line wraps against. */
  margin: number;
}

/**
 * Where a photo card's text lands, given the frame and the chosen layout.
 *
 * Here rather than in the renderer because two places draw this and they must agree: FFmpeg burns it into the
 * video, and the screen that offers the control draws a preview of it before anything is rendered. A preview
 * that is a second implementation of these five lines is a preview that can be wrong — and it would be wrong
 * silently, showing the person a picture of a video that was never made (Cowork Round 440 asked for exactly
 * this, having written the copy and said so).
 *
 * Pixels, not fractions, so the caller does the same rounding the renderer does. The heading is derived here
 * too: nothing outside this function decides how big it is relative to the body.
 */
export function photoCardSubtitleGeometry(
  width: number,
  height: number,
  layout: PhotoCardSubtitleLayout,
  bodyLineCount: number,
  hasHeading: boolean,
): PhotoCardSubtitleGeometry {
  const bodySize = Math.round(height * layout.scale);
  const headSize = Math.round(bodySize * PHOTO_CARD_HEADING_RATIO);
  const headGap = Math.round(headSize * 1.6);
  const lineGap = Math.round(bodySize * 1.5);
  const bodySpan = lineGap * Math.max(0, bodyLineCount - 1);
  const blockHeight = (hasHeading ? headGap : 0) + bodySpan;
  const headingY = Math.round(height * layout.center) - Math.round(blockHeight / 2);
  return {
    bodySize, headSize, headGap, lineGap,
    headingY,
    bodyY: headingY + (hasHeading ? headGap : 0) + Math.round(bodySpan / 2),
    centerX: Math.round(width / 2),
    margin: Math.round(width * 0.07),
  };
}

/**
 * The card text's stroke and drop shadow, in output pixels at the rendered frame size.
 *
 * Here for the same reason as the geometry, with one honest limit: a preview cannot draw this. libass strokes
 * the glyph outline; CSS can only stack shadows around it, and at preview scale a 4px stroke drawn that way
 * reads as a black box around every letter rather than as a thin edge. So a preview scales these to its own
 * height and approximates the look — what it must not do is invent the numbers, because then a change here
 * would leave the preview quietly describing the old design (Cowork Round 442 kept the approximation and
 * flagged it, which is the right call; this is the half that can be shared).
 *
 * 4, not 3: the card sits over a photograph, and a thinner edge disappeared into the bright parts of it.
 */
export const PHOTO_CARD_SUBTITLE_OUTLINE = 4;
export const PHOTO_CARD_SUBTITLE_SHADOW = 2;

/**
 * How to draw the card's text in CSS at the size it will actually be in the video.
 *
 * ASS `Fontsize` is not CSS `font-size`. libass scales a font by its own vertical metrics, and for these two
 * Noto CJK files a Hangul glyph at `Fontsize` N advances well under N pixels — so a preview that sets
 * `font-size: N` draws text about half again as wide as the video does. It then wraps earlier than the render,
 * and reports overflow the render never has (Cowork Round 446 saw exactly that at the largest size).
 *
 * Multiply the ASS size by these to get the CSS size. **Measured, not derived**: rendered through the real
 * FFmpeg with these font files and read off the frame — 10 glyphs against 16, so glyph bearings and the
 * outline cancel out. subtitle-font-metrics.test.ts does that measurement and fails if a font file is replaced
 * by one that draws differently. Do not adjust these by eye; re-measure.
 *
 * Re-measured on 2026-09-05 after the two variable fonts were replaced with real Bold 700 / Medium 500 static
 * instances: 0.662 → 0.6712 and 0.625 → 0.6346. Small, and smaller than expected — a heavier CJK face inks
 * more of the same box rather than advancing further, so weight moves the stroke and barely moves the width.
 * The old numbers were still inside the pair's tolerance, which is why it did not go red; they were stale all
 * the same, and a preview drawing 1.5% narrow than the video is the thing this constant exists to stop.
 */
export const PHOTO_CARD_SUBTITLE_CSS_RATIO = { heading: 0.671, body: 0.635 } as const;

/** How much larger the heading is than the body. Not a handle: three sizes can be set to a combination that does not fit together, and two cannot. */
export const PHOTO_CARD_HEADING_RATIO = 1.4;

export interface ApiUsageRecord {
  timestamp: string;
  projectId: string;
  provider: "openai" | "runway";
  operation: "story" | "image" | "video";
  estimatedCostUsd: number;
  actualCostUsd: number;
  succeeded: boolean;
}

export interface ProviderTaskRecord {
  projectId: string;
  sceneNumber: SceneNumber;
  taskId: string;
  inputHash: string;
  userRequestId: string;
  status: JobStatus;
  estimatedCostUsd: number;
  createdAt: string;
  completedAt?: string;
  error?: string;
}

/** Whether `value` is a plausible scene number for *some* project (2-12 scenes) — not tied to any one project's actual scene count. */
export function isSceneNumber(value: number): value is SceneNumber {
  return Number.isInteger(value) && value >= 1 && value <= MAX_SCENE_COUNT;
}
