import { useEffect, useRef, useState } from "react";
import { FINAL_VIDEO_RELATIVE_PATH } from "@ai-animation-studio/shared";
import type { InstagramPublishTarget, InstagramTargetDiagnostics, LongEpisodeDetail, Project, VideoLibraryEpisodeSummary, VideoLibraryProjectSummary } from "@ai-animation-studio/shared";

import { getProject, getProjectSettings, toDisplayError } from "../api/projectsApi.js";
import { forgetInstagramPost, forgetLongEpisodeInstagramPost, publishLongEpisodeToInstagram, publishToInstagram, toInstagramPublishDisplayError } from "../api/instagramPublishApi.js";
import { getInstagramTargets, setInstagramTarget, targetLabel, toInstagramTargetsDisplayError } from "../api/instagramTargetsApi.js";
import { getPostDraft, putPostDraft, toPostDraftDisplayError } from "../api/postDraftApi.js";
import { getVideoLibrary, toVideoLibraryDisplayError } from "../api/videoLibraryApi.js";
import { getLongEpisode, getLongEpisodeSettings, getLongProjectSettings, longEpisodeFinalVideoContentUrl, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { finalVideoContentUrl } from "../api/videoMergeApi.js";
import { hasElectronBridge, openProjectPathInExplorer } from "../api/electronBridge.js";
import { Spinner } from "./Spinner.js";
import { StatusChip } from "./ui/StatusChip.js";

interface Props {
  onBack: () => void;
}

type DisplayError = { code: string; message: string };
type ListState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; projects: VideoLibraryProjectSummary[]; episodes: VideoLibraryEpisodeSummary[] };
/**
 * Where a post would go. Kept apart from the credential settings on purpose — a credential answers "can we act
 * at all?", this answers "where does it land?", and that has to be readable at the moment of publishing rather
 * than two screens away in settings (docs/06_DECISIONS.md D-006).
 */
type TargetsState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; targets: InstagramPublishTarget[]; selectedIgUserId?: string; diagnostics?: InstagramTargetDiagnostics };

/**
 * What is about to be posted. A short project and an Episode are different enough underneath — different video
 * address, different publish route, different record of "already posted" — that they are separate shapes here
 * rather than one blurred one. Everything the screen renders is derived from whichever is picked.
 */
type PickedState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; kind: "project"; project: Project; plannedSeconds: number | null }
  | {
      status: "ready";
      kind: "episode";
      projectId: string;
      episodeNumber: number;
      episode: LongEpisodeDetail;
      aspectRatio: "9:16" | "16:9";
      plannedSeconds: number | null;
    };

/** How an Episode is encoded in the one picker. Short projects keep their bare id, so nothing about them moves. */
const EPISODE_PREFIX = "episode:";
function parseEpisodeSelection(value: string): { projectId: string; episodeNumber: number } | null {
  if (!value.startsWith(EPISODE_PREFIX)) return null;
  const [projectId, rawNumber] = value.slice(EPISODE_PREFIX.length).split("|");
  const episodeNumber = Number(rawNumber);
  return projectId && Number.isInteger(episodeNumber) ? { projectId, episodeNumber } : null;
}

/**
 * Instagram's own published limits, not house rules — a caption over this is rejected at post time and a
 * reel over the duration cannot be uploaded as a reel at all. Checking them here means finding out before the
 * file is carried to another app, not after.
 */
const CAPTION_MAX = 2200;
const HASHTAG_MAX = 30;
const REEL_MAX_SECONDS = 180;


const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";
const fieldClass =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30";

/** `#` is optional in what the person types — they are listing topics, not writing markup. */
function parseHashtags(raw: string): string[] {
  return raw
    .split(/[\s,]+/u)
    .map((token) => token.replace(/^#+/u, "").trim())
    .filter((token) => token.length > 0)
    .map((token) => `#${token}`);
}

function dateOnly(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("ko-KR");
}

function durationLabel(seconds: number): string {
  const whole = Math.round(seconds);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

/**
 * Everything that goes in the caption box, in the order it will be read. Built in one place so the character
 * count below is counting the same string the copy button hands over — a count that drifts from what is
 * actually copied is worse than no count.
 */
function composeCaption(parts: { body: string; attribution: string; aiNotice: string; hashtags: string[] }): string {
  const blocks = [
    parts.body.trim(),
    parts.attribution.trim(),
    parts.aiNotice.trim(),
    parts.hashtags.join(" "),
  ].filter((block) => block.length > 0);
  return blocks.join("\n\n");
}

/**
 * The caption body a project starts with when nothing has ever been written for it.
 *
 * Assembled from what the project already holds — no model call — so opening this screen costs nothing, waits
 * for nothing, and cannot fail. The topic goes first because the first line is what Instagram shows in the feed
 * before "더 보기"; the narration sentences follow as one paragraph when the project has them.
 *
 * Used ONLY when no body has ever been saved for this project. A saved body that is an empty string is a person
 * having deliberately cleared it, and refilling that on the next visit would be the screen undoing an edit —
 * the same silent-overwrite shape as the scene-edit draft being wiped on load.
 */
/**
 * Why the account list is empty, in the words of the one thing the person has to go change.
 *
 * The single sentence this replaces named all three causes at once, so the reader had to try them in turn —
 * and the first two are things this person had already done. Naming one is the whole point.
 *
 * Order matters: a missing permission is checked first because fixing Facebook cannot cure it, and someone told
 * to "link a page" while the token lacks the scope will do that work and see no change.
 */
function describeEmptyTargets(diagnostics: InstagramTargetDiagnostics | undefined): { headline: string; detail: string } {
  if (!diagnostics) {
    return {
      headline: "게시할 수 있는 인스타그램 계정이 없습니다.",
      detail: "인스타그램 프로페셔널 계정이 페이스북 페이지에 연결돼 있어야 합니다.",
    };
  }
  // `permissionsChecked: false` is "not looked at", not "nothing missing". Saying nothing about permissions is
  // the honest reading; an empty list under a failed check would otherwise read as a clean bill.
  if (diagnostics.permissionsChecked && diagnostics.missingPermissions.length > 0) {
    return {
      headline: "이 로그인에 필요한 권한이 빠져 있습니다.",
      detail: `빠진 권한: ${diagnostics.missingPermissions.join(", ")} — 페이스북 쪽 설정을 고쳐도 이건 풀리지 않고, 인스타그램을 다시 연결해야 합니다.`,
    };
  }
  if (diagnostics.pageCount === 0) {
    return {
      headline: "이 로그인으로 보이는 페이스북 페이지가 없습니다.",
      detail: "게시하려면 페이스북 페이지가 하나 있어야 하고, 로그인할 때 그 페이지를 허용해야 합니다.",
    };
  }
  if (diagnostics.pagesWithInstagramAccount === 0) {
    return {
      headline: `페이스북 페이지 ${diagnostics.pageCount}개가 보이는데, 인스타그램 계정이 연결된 페이지가 없습니다.`,
      detail: "인스타그램 프로페셔널 계정을 그 페이지 중 하나에 연결해 주세요.",
    };
  }
  /* Pages exist, one of them has an Instagram account, nothing is missing — and the list is still empty. The
     honest answer is that this screen does not know, said plainly rather than dressed as one of the causes
     above. */
  return {
    headline: "게시할 수 있는 계정을 찾지 못했습니다.",
    detail: `페이지 ${diagnostics.pageCount}개 중 ${diagnostics.pagesWithInstagramAccount}개에 인스타그램 계정이 연결돼 있는데도 목록이 비어 있습니다. 원인을 여기서는 알 수 없습니다.`,
  };
}

/**
 * The caption a project opens with: what it is called, then what it says.
 *
 * A photo card breaks that shape, and the caption box showed it: a card's "narration" is not narration, it is
 * the same quote stored a second time for the renderer to draw onto the picture, so the two blocks joined the
 * quote to itself and every quote post began with the sentence printed twice. A card's caption is the quote,
 * once. The equality guard below is the same defect's general form — any project whose narration comes out
 * identical to its topic should say it once too — and it stays even though the photo-card branch above already
 * covers the case that was reported, because a suggestion is only useful while it is worth keeping as written.
 */
function suggestCaptionBody(project: Project): string {
  const topic = project.topic.trim();
  if (project.photoCard === true) {
    return topic;
  }
  const narration = project.scenes
    .map((scene) => (typeof scene.narration === "string" ? scene.narration.trim() : ""))
    .filter((line) => line.length > 0)
    .join(" ");
  const sameText = (left: string, right: string): boolean =>
    left.replace(/\s+/gu, " ").trim() === right.replace(/\s+/gu, " ").trim();
  const blocks = sameText(narration, topic) ? [topic] : [topic, narration];
  return blocks.filter((block) => block.length > 0).join("\n\n");
}

/**
 * The same suggestion for an Episode, which had none — the box opened empty and stayed empty.
 *
 * A short project got its title and narration written in for it here; an Episode, which is the one a series
 * creator writes over and over, did not. Nothing about an Episode made it harder: the title, the outline
 * summary and the per-scene narration are all already on the Episode this screen has loaded.
 *
 * The summary rather than the ending on purpose — a caption sits above the video and a cliffhanger spoils it.
 */
function suggestEpisodeCaptionBody(episode: LongEpisodeDetail): string {
  const heading = [`${episode.episodeNumber}화`, episode.title.trim()].filter(Boolean).join(". ");
  const narration = (episode.script?.scenes ?? [])
    .map((scene) => (typeof scene.narration === "string" ? scene.narration.trim() : ""))
    .filter((line) => line.length > 0)
    .join(" ");
  return [heading, episode.summary.trim(), narration].filter((block) => block.length > 0).join("\n\n");
}

/**
 * Everything that turns a finished video into a post: which video, what the caption says, whether the shape and
 * length are within what a reel accepts, the credit line the audio licence requires, which account it goes to —
 * and finally the posting itself.
 *
 * Publishing is the one irreversible, public action in this app, so it is never one press away: the confirmation
 * names the account it is about to go out on, and `approved: true` is defaulted nowhere in the chain
 * (docs/06_DECISIONS.md D-015). This screen never talks to Meta directly — the token lives on the server and
 * never reaches the page.
 */
export function InstagramPostScreen({ onBack }: Props) {
  const [list, setList] = useState<ListState>({ status: "loading" });
  /** The picker's raw value: a short project's id, or `episode:<projectId>|<n>`. */
  const [selection, setSelection] = useState("");
  const [picked, setPicked] = useState<PickedState>({ status: "idle" });
  const [body, setBody] = useState("");
  /** True only while the box still holds text this screen put there and the person has not touched it yet. */
  const [bodyAutoFilled, setBodyAutoFilled] = useState(false);
  const [hashtagsRaw, setHashtagsRaw] = useState("");
  const [aiNoticeOn, setAiNoticeOn] = useState(true);
  /**
   * The shape and length of the actual file, read from the player once it has its metadata.
   *
   * The two checks below used to come from project settings — the *planned* aspect ratio and the *planned*
   * duration — while the panel said they were "checked while the file is still on this machine". A merge that
   * produced something other than the plan (a scene dropped, a clip that ran long) was reported as compliant
   * on the strength of a number nobody had compared to the video. The file is already on screen; measuring it
   * costs one metadata load.
   *
   * Null until the metadata arrives, and stays null if it never does — the planned values are then shown as
   * what they are rather than as a measurement.
   */
  const [measured, setMeasured] = useState<{ vertical: boolean | null; seconds: number | null } | null>(null);
  /**
   * Which moment of the video Instagram should use as the cover, in milliseconds.
   *
   * Null means "not chosen", which is the same thing Instagram already does by default — frame 0 — so an unset
   * cover and a cover set to the first frame are the same post. That is why nothing on this screen has to be
   * filled in before publishing.
   *
   * Taken from the player's own position rather than from a scene number: the frame the person is looking at
   * when they press is the frame that goes. A scene picker would have to name a moment they cannot see, and the
   * generated scene image is not that frame — the video was animated from it.
   */
  const [coverOffsetMs, setCoverOffsetMs] = useState<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<DisplayError | null>(null);
  /** The unlock is its own two-step, kept apart from the publish confirmation so neither can stand in for the other. */
  const [confirmForget, setConfirmForget] = useState(false);
  const [forgetting, setForgetting] = useState(false);
  const [forgetError, setForgetError] = useState<DisplayError | null>(null);
  const [targets, setTargets] = useState<TargetsState>({ status: "loading" });
  const [targetPending, setTargetPending] = useState(false);
  /**
   * The saved draft could not be read — which is not the same as there not being one.
   *
   * `getPostDraft(...).catch(() => null)` made a failed read look identical to a project that had never saved a
   * caption, so the screen filled the box with a suggestion and labelled it 미리 채워 뒀습니다 — a positive claim
   * that nothing was stored. Leaving the field then blur-saved that suggestion over the caption it had failed to
   * read, and the person's own words were gone with nothing on screen having said so. A convenience must never
   * be the thing that destroys the work it exists to preserve.
   */
  const [draftUnread, setDraftUnread] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [saveError, setSaveError] = useState<DisplayError | null>(null);
  const [openPending, setOpenPending] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);

  function loadList(): void {
    setList({ status: "loading" });
    getVideoLibrary()
      // Only a project with a merged result can become a post; the rest would be a dead choice.
      // Only something with a merged result can become a post; the rest would be a dead choice — and for
      // Episodes it would be worse than dead, since the publish route refuses them (INSTAGRAM_VIDEO_UNAVAILABLE).
      .then((response) => setList({
        status: "ready",
        projects: response.projects.filter((one) => one.finalVideoAvailable),
        episodes: response.episodes.filter((one) => one.finalVideoAvailable),
      }))
      .catch((caught: unknown) => setList({ status: "error", error: toVideoLibraryDisplayError(caught) }));
  }

  function loadTargets(): void {
    setTargets({ status: "loading" });
    getInstagramTargets()
      .then((response) => setTargets({ status: "ready", targets: response.targets, selectedIgUserId: response.selectedIgUserId, diagnostics: response.diagnostics }))
      .catch((caught: unknown) => setTargets({ status: "error", error: toInstagramTargetsDisplayError(caught) }));
  }

  useEffect(() => {
    loadList();
    loadTargets();
  }, []);

  async function chooseTarget(igUserId: string): Promise<void> {
    if (targetPending || !igUserId) return;
    setTargetPending(true);
    try {
      const response = await setInstagramTarget(igUserId);
      setTargets({ status: "ready", targets: response.targets, selectedIgUserId: response.selectedIgUserId, diagnostics: response.diagnostics });
    } catch (caught) {
      setTargets({ status: "error", error: toInstagramTargetsDisplayError(caught) });
    } finally {
      setTargetPending(false);
    }
  }

  useEffect(() => {
    if (!selection) {
      setPicked({ status: "idle" });
      return;
    }
    let cancelled = false;
    setPicked({ status: "loading" });
    setCopied("idle");
    const asEpisode = parseEpisodeSelection(selection);
    if (asEpisode) {
      /* An Episode carries no saved draft — that one really is short-project-only for now — so what it needs
         here is its own record (has it already been posted?) and its planned length. The credit line is NOT in
         that list any more: the Episode carries usedAudio like a project does, and it is read below. The
         settings degrade to "length unknown" rather than failing the screen, the same way the project path
         treats them. */
      Promise.all([
        getLongEpisode(asEpisode.projectId, asEpisode.episodeNumber),
        getLongEpisodeSettings(asEpisode.projectId, asEpisode.episodeNumber).catch(() => null),
        getLongProjectSettings(asEpisode.projectId).catch(() => null),
      ])
        .then(([episodeResponse, episodeSettings, projectSettings]) => {
          if (cancelled) return;
          const summary = list.status === "ready"
            ? list.episodes.find((one) => one.projectId === asEpisode.projectId && one.episodeNumber === asEpisode.episodeNumber)
            : undefined;
          // The Episode's settings already carry the derived total. Multiplying sceneCount by clip length here
          // would be a second place computing the same number, and the two would drift.
          const episodeSeconds = episodeSettings?.settings.episodeDurationSeconds ?? null;
          // An Episode keeps no saved draft, so there is nothing to preserve and every visit starts from the
          // suggestion — unlike a project, where a saved body always wins over one.
          const suggestedBody = suggestEpisodeCaptionBody(episodeResponse.episode);
          setBody(suggestedBody);
          setBodyAutoFilled(suggestedBody.length > 0);
          setMeasured(null);
          setHashtagsRaw("");
          setAiNoticeOn(true);
          setSaveState("idle");
          setSaveError(null);
          setConfirmForget(false);
          setForgetError(null);
          setPicked({
            status: "ready",
            kind: "episode",
            projectId: asEpisode.projectId,
            episodeNumber: asEpisode.episodeNumber,
            episode: episodeResponse.episode,
            aspectRatio: summary?.aspectRatio ?? projectSettings?.settings.aspectRatio ?? "9:16",
            plannedSeconds: episodeSeconds,
          });
        })
        .catch((caught: unknown) => {
          if (!cancelled) setPicked({ status: "error", error: toLongProjectDisplayError(caught) });
        });
      return () => { cancelled = true; };
    }
    const projectId = selection;
    // The project itself carries usedAudio (the credit line, copied by value at merge time); the settings carry
    // the planned length; the draft carries whatever was typed last time. Only the project is essential — the
    // other two degrade to "unknown length" and "blank caption" rather than failing the whole screen.
    Promise.all([
      getProject(projectId),
      getProjectSettings(projectId).catch(() => null),
      // `undefined` is a draft that answered; `"unread"` is one that did not. Both used to arrive as `null`,
      // and `null?.body === undefined` sent a failed read down the "nothing was ever saved" path.
      getPostDraft(projectId).catch(() => "unread" as const),
    ])
      .then(([projectResponse, settingsResponse, draftOrUnread]) => {
        if (cancelled) return;
        const unread = draftOrUnread === "unread";
        const draft = unread ? undefined : draftOrUnread;
        setDraftUnread(unread);
        // `draft?.body === undefined` is "no body has ever been saved", which is not the same as a saved "".
        // Only the first case gets a suggestion; see suggestCaptionBody. An unread draft gets none either: a
        // suggestion here would be written over the stored caption the moment the box is left.
        const suggested = !unread && draft?.body === undefined ? suggestCaptionBody(projectResponse.project) : "";
        setBody(draft?.body ?? suggested);
        setBodyAutoFilled(!unread && draft?.body === undefined && suggested.length > 0);
        setMeasured(null);
        setHashtagsRaw(draft?.hashtags ?? "");
        setAiNoticeOn(draft?.aiNotice ?? true);
        setSaveState("idle");
        setSaveError(null);
        setConfirmForget(false);
        setForgetError(null);
        setPicked({
          status: "ready",
          kind: "project",
          project: projectResponse.project,
          plannedSeconds: settingsResponse?.settings.durationSeconds ?? null,
        });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setPicked({ status: "error", error: toDisplayError(caught) });
      });
    return () => {
      cancelled = true;
    };
  }, [selection]);

  /**
   * Saves on blur rather than on a button, and rather than on every keystroke.
   *
   * A save button is a button people forget, and the whole reason this draft exists is that a caption was being
   * lost by walking away from the screen — leaving on any real navigation blurs the field first. Per-keystroke
   * saving would put a request behind every character for no benefit the person can see.
   *
   * Sends the whole draft every time because the endpoint replaces rather than merges: an omitted field is a
   * deleted field, so a partial save would quietly erase the other two.
   */
  /**
   * Asks for the saved draft again after a failed read.
   *
   * Only fills the boxes when it actually gets an answer: a second failure leaves the screen exactly as it is,
   * still refusing to save over what it cannot see. Nothing here suggests a caption — the suggestion is for a
   * project that has never saved one, and this is a project whose answer we still do not have.
   */
  async function reloadDraft(): Promise<void> {
    if (picked.status !== "ready" || picked.kind !== "project") return;
    try {
      const draft = await getPostDraft(picked.project.id);
      setDraftUnread(false);
      setBody(draft.body ?? "");
      setHashtagsRaw(draft.hashtags ?? "");
      setAiNoticeOn(draft.aiNotice ?? true);
      setBodyAutoFilled(false);
    } catch { /* Still unread, and the notice below still says so. */ }
  }

  async function saveDraft(next: { body?: string; hashtags?: string; aiNotice?: boolean } = {}): Promise<void> {
    // Drafts belong to short projects; an Episode has nowhere to save one, so the blur handler is a no-op there
    // rather than a request that would 404.
    if (picked.status !== "ready" || picked.kind !== "project") return;
    // Never write over a draft we could not read. This is the automatic save that fires on leaving a field, so
    // it would be the person's stored caption replaced by whatever this screen happened to show — without them
    // asking for a save at all. The notice beside the box says the reading failed and offers to try again; the
    // caption they type still goes out with the post either way.
    if (draftUnread) return;
    const projectId = picked.project.id;
    setSaveState("saving");
    setSaveError(null);
    try {
      await putPostDraft(projectId, {
        body: next.body ?? body,
        hashtags: next.hashtags ?? hashtagsRaw,
        aiNotice: next.aiNotice ?? aiNoticeOn,
      });
      setSaveState("saved");
    } catch (caught) {
      // The text is still in the box, so a failed save is a warning, not a loss — never a reason to block the
      // copy button, which is the one action that actually gets the caption out of here.
      setSaveState("idle");
      setSaveError(toPostDraftDisplayError(caught));
    }
  }

  async function openInExplorer(): Promise<void> {
    // Short projects only: the button it belongs to is not rendered for an Episode.
    if (openPending || picked.status !== "ready" || picked.kind !== "project") return;
    setOpenPending(true);
    setOpenFailed(false);
    try {
      const outcome = await openProjectPathInExplorer(picked.project.id, FINAL_VIDEO_RELATIVE_PATH);
      if (!outcome?.opened) setOpenFailed(true);
    } catch {
      setOpenFailed(true);
    } finally {
      setOpenPending(false);
    }
  }

  const selectedTarget = targets.status === "ready"
    ? targets.targets.find((target) => target.igUserId === targets.selectedIgUserId) ?? null
    : null;
  const selectedLabel = selectedTarget ? targetLabel(selectedTarget) : null;

  const project = picked.status === "ready" && picked.kind === "project" ? picked.project : null;
  const episode = picked.status === "ready" && picked.kind === "episode" ? picked : null;
  /**
   * The credit line's source, on either kind.
   *
   * Was `project?.usedAudio` alone, from a time when an Episode had no such field. It has one now, the Episode
   * merge screen already reads it, and this is the screen where the caption is written — so an Episode built
   * on a CC BY track was going to Instagram with no credit and nothing blocking it. That is the exact failure
   * D-003 exists to prevent, still open on the long side only.
   */
  const usedAudio = project?.usedAudio ?? episode?.episode.usedAudio;
  const creditRequired = usedAudio?.attributionRequired === true;
  const creditText = usedAudio?.attributionText?.trim() ?? "";
  // Required but blank is a real state: attributionText is optional in the contract, and the app must not
  // invent wording a licence may be specific about.
  const creditMissing = creditRequired && !creditText;

  const hashtags = parseHashtags(hashtagsRaw);
  const aiNotice = aiNoticeOn ? "AI로 만든 영상입니다." : "";
  const caption = composeCaption({ body, attribution: creditRequired ? creditText : "", aiNotice, hashtags });

  const captionOver = caption.length > CAPTION_MAX;
  const hashtagsOver = hashtags.length > HASHTAG_MAX;
  const plannedSeconds = picked.status === "ready" ? picked.plannedSeconds : null;
  /**
   * A photo card is one still picture held for a few seconds under a slow zoom, so every frame in it looks the
   * same — the cover picker would be a choice whose options are identical. Offering it does not break anything;
   * it asks the person to decide something that cannot come out differently, which is its own small cost. Read
   * from the project the screen already loaded (Project extends ProjectSummary), not from the picker's row.
   * Episodes are never photo cards, so the question only arises on the short-project side.
   */
  const photoCard = project?.photoCard === true;
  /* Measured beats planned wherever it exists. The planned values remain the fallback rather than the answer:
     losing the measurement must not cost the check, but it must not be reported as one either. */
  const checkedSeconds = measured?.seconds ?? plannedSeconds;
  const tooLong = checkedSeconds !== null && checkedSeconds > REEL_MAX_SECONDS;
  /* Each half is measured or it is not, separately. A browser that states a duration but no frame size is
     ordinary, and `measured` being non-null used to be taken as both facts having been read. */
  const notVertical = measured?.vertical != null
    ? !measured.vertical
    : (project?.aspectRatio ?? episode?.aspectRatio) === "16:9";
  const copyBlocked = captionOver || hashtagsOver || creditMissing;
  /* The server's own record, on either shape — never a local flag. A reload has to keep saying "already
     posted", because the mistake this prevents is a second public copy of something already out there. */
  const published = project?.instagramPost ?? episode?.episode.instagramPost;
  /**
   * Posts this video has had before, on either kind.
   *
   * Shown, not just stored. Clearing the publish record is the only way to publish a re-cut video, and the one
   * thing that clearing would otherwise erase is the fact that something may still be live on the account — a
   * person who answered "yes, I deleted it" and had not would be left with an app that has no idea. That makes
   * this the app's only memory of an action it can neither undo nor re-check, and a record nothing reads is a
   * record that quietly stops being kept correctly.
   */
  const previousPosts = project?.previousInstagramPosts ?? episode?.episode.previousInstagramPosts ?? [];
  // Pressing and being refused is worse than not being able to press: the reasons are all knowable here
  // (no account chosen, caption over the limit, credit line missing, already out in the world).
  const publishBlocked = copyBlocked || !caption || !selectedTarget || Boolean(published);
  const videoSrc = episode
    ? longEpisodeFinalVideoContentUrl(episode.projectId, episode.episodeNumber, episode.episode.updatedAt ?? String(episode.episodeNumber))
    : finalVideoContentUrl(selection);

  /**
   * The one irreversible, public action in this app. Reached only from a panel that named the account, and the
   * account it names travels with the request so the two provably match.
   */
  async function publish(): Promise<void> {
    if (publishing || !selectedTarget || picked.status !== "ready") return;
    setPublishing(true);
    setPublishError(null);
    try {
      if (picked.kind === "episode") {
        const response = await publishLongEpisodeToInstagram(picked.projectId, picked.episodeNumber, caption, selectedTarget.igUserId, coverOffsetMs);
        setConfirmPublish(false);
        // Same reasoning as the project path: the Episode comes back carrying instagramPost, so "already
        // published" is the server's record and survives a reload.
        setPicked((current) => (current.status === "ready" && current.kind === "episode" ? { ...current, episode: response.episode } : current));
        return;
      }
      const response = await publishToInstagram(picked.project.id, caption, selectedTarget.igUserId, coverOffsetMs);
      setConfirmPublish(false);
      // The response carries the project with instagramPost set, so the screen switches to "already published"
      // from the server's own record rather than from a local flag that a refresh would forget.
      setPicked((current) => (current.status === "ready" && current.kind === "project" ? { ...current, project: response.project } : current));
    } catch (caught) {
      setPublishError(toInstagramPublishDisplayError(caught));
    } finally {
      setPublishing(false);
    }
  }

  /**
   * Clears this app's record of the publish so the screen will offer to publish again.
   *
   * Touches nothing on Instagram — this app does not delete other people's posts and must not let anyone
   * believe it can. The record is the only thing that changes, and the post, if it is still up, stays up.
   */
  async function forgetPost(): Promise<void> {
    if (picked.status !== "ready" || forgetting) return;
    setForgetting(true);
    setForgetError(null);
    try {
      if (picked.kind === "episode") {
        const response = await forgetLongEpisodeInstagramPost(picked.projectId, picked.episodeNumber);
        setPicked((current) => (current.status === "ready" && current.kind === "episode" ? { ...current, episode: response.episode } : current));
      } else {
        const response = await forgetInstagramPost(picked.project.id);
        setPicked((current) => (current.status === "ready" && current.kind === "project" ? { ...current, project: response.project } : current));
      }
      // The response carries the cleared record, so the lock lifts without a reload — and from the server's
      // own answer rather than from a local flag a refresh would forget.
      setConfirmForget(false);
    } catch (caught) {
      setForgetError(toInstagramPublishDisplayError(caught));
    } finally {
      setForgetting(false);
    }
  }

  async function copyCaption(): Promise<void> {
    try {
      await navigator.clipboard.writeText(caption);
      setCopied("done");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <section className="mt-8 max-w-5xl space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>
        돌아가기
      </button>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        게시물 준비
      </h1>
      {/* Said once, plainly, at the top: this screen never reaches Instagram. Nothing else on it would tell a
          person that, and "prepare" is a word that could mean either. */}
      <p className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300" data-testid="post-scope-notice">
        올릴 영상을 고르고 캡션을 만든 뒤, 여기서 바로 올릴 수 있습니다. 올리기 전에 어느 계정으로 나가는지 한 번 더 확인합니다.
        캡션만 복사해서 인스타그램 앱에서 직접 올리셔도 됩니다.
      </p>
      <p className="text-sm text-slate-400" data-testid="post-draft-notice">
        쓰던 캡션은 프로젝트별로 저장돼서, 다음에 들어오면 그대로 이어서 쓸 수 있습니다.
      </p>

      {list.status === "loading" && <Spinner label="영상 목록을 불러오는 중..." />}
      {list.status === "error" && (
        <div className="space-y-2">
          <p role="alert" data-testid="post-list-error" data-error-code={list.error.code} className="text-sm text-rose-400">
            {list.error.message}
          </p>
          <button type="button" className={outlineButton} onClick={loadList}>
            다시 시도
          </button>
        </div>
      )}

      {list.status === "ready" && !list.projects.length && !list.episodes.length && (
        <p data-testid="post-empty" className="text-sm text-slate-400">
          아직 합쳐 둔 최종 영상이 없습니다. 프로젝트에서 영상을 합치면 여기에서 고를 수 있습니다.
        </p>
      )}

      {list.status === "ready" && Boolean(list.projects.length || list.episodes.length) && (
        <label className="block text-sm text-slate-300" htmlFor="post-project">
          올릴 영상
          <select
            id="post-project"
            data-testid="post-project"
            className={fieldClass}
            value={selection}
            onChange={(event) => setSelection(event.target.value)}
          >
            <option value="">고르지 않음</option>
            {list.projects.map((candidate) => (
              <option key={candidate.projectId} value={candidate.projectId}>
                {candidate.topic || candidate.projectId}
              </option>
            ))}
            {/* Episodes only appear once they have a merged final video, because that is exactly what the
                publish route requires — a row that could be chosen and then refused is the shape this whole
                separation exists to prevent. */}
            {Boolean(list.episodes.length) && (
              <optgroup label="장기 프로젝트 회차">
                {list.episodes.map((candidate) => (
                  <option
                    key={`${candidate.projectId}-${candidate.episodeNumber}`}
                    value={`${EPISODE_PREFIX}${candidate.projectId}|${candidate.episodeNumber}`}
                  >
                    {candidate.projectTitle} · {candidate.episodeNumber}화 「{candidate.title}」
                  </option>
                ))}
              </optgroup>
            )}
          </select>
        </label>
      )}

      {/* Where it goes, shown next to what goes — not buried in settings. Even with a single account this stays
          on screen: not asking and not showing are different things, and the day a second account appears is
          exactly the day a wrong destination costs something that cannot be taken back. */}
      <div className={cardSection} data-testid="post-target">
        <p className="text-sm font-semibold text-slate-200">올릴 계정</p>

        {targets.status === "loading" && <Spinner label="계정을 불러오는 중..." />}

        {targets.status === "error" && (
          <div className="space-y-2">
            <p role="alert" data-testid="post-target-error" data-error-code={targets.error.code} className="text-sm text-rose-400">
              {targets.error.message}
            </p>
            <button type="button" className={outlineButton} onClick={loadTargets}>
              다시 시도
            </button>
          </div>
        )}

        {/* An empty list is not an error and not "log in" — the account exists but no Facebook Page is linked to
            it, which is a different thing for the user to go fix. */}
        {targets.status === "ready" && !targets.targets.length && (
          <div data-testid="post-target-none" className="space-y-1">
            <p className="text-sm text-slate-200">{describeEmptyTargets(targets.diagnostics).headline}</p>
            <p className="text-sm text-slate-400">{describeEmptyTargets(targets.diagnostics).detail}</p>
            {targets.diagnostics?.permissionsChecked && (
              /* What the token actually holds, not what we think is missing. "Asked for and refused" and "never
                 asked for" produce the same empty list, and only this line tells them apart — which is the
                 difference between re-connecting and changing what the app requests. */
              <p data-testid="post-target-granted" className="pt-1 text-xs text-slate-500">
                이 로그인이 가진 권한: {targets.diagnostics.grantedPermissions.length > 0 ? targets.diagnostics.grantedPermissions.join(", ") : "없음"}
              </p>
            )}
          </div>
        )}

        {targets.status === "ready" && Boolean(targets.targets.length) && (
          <>
            <label className="sr-only" htmlFor="post-target-select">올릴 계정 고르기</label>
            <select
              id="post-target-select"
              data-testid="post-target-select"
              className={fieldClass}
              value={targets.selectedIgUserId ?? ""}
              disabled={targetPending}
              onChange={(event) => void chooseTarget(event.target.value)}
            >
              <option value="">고르지 않음</option>
              {targets.targets.map((target) => {
                const label = targetLabel(target);
                return (
                  <option key={target.igUserId} value={target.igUserId}>
                    {label.name}
                    {label.handleUnavailable ? " (핸들을 읽지 못함)" : ""}
                  </option>
                );
              })}
            </select>

            {/* The field is absent for two different reasons — a stored choice that is no longer in this list,
                and no choice ever having been made (api.ts: "Present only when a previously stored choice is
                actually still in `targets`"). The old sentence said the first as a fact, so somebody publishing
                for the first time on a healthy connection was told their page had been disconnected or its
                permission revoked, and went to Meta to fix nothing. What is true either way goes first; the
                part that only holds in one case is written as the condition it is. */}
            {!targets.selectedIgUserId && (
              <p data-testid="post-target-unset" className="text-sm text-amber-300">
                올릴 계정이 아직 정해지지 않았습니다. 위에서 골라 주세요.
                {" "}전에 골라 두신 적이 있다면, 그 계정이 지금 목록에 없다는 뜻입니다 — 연결이 끊겼거나 권한이 회수됐을 수 있습니다.
              </p>
            )}

            {selectedTarget && (
              <p data-testid="post-target-selected" className="text-sm text-slate-300">
                이 영상은 <strong className="text-slate-100">{selectedLabel?.name}</strong> 계정으로 올라갑니다.
                {selectedLabel?.handleUnavailable && (
                  <span data-testid="post-target-handle-missing" className="mt-1 block text-xs text-amber-300">
                    이 계정의 @핸들을 읽지 못해 연결된 페이지 이름으로 표시하고 있습니다. 올리기 전에 맞는 계정인지 확인해 주세요.
                  </span>
                )}
              </p>
            )}
          </>
        )}
      </div>

      {picked.status === "loading" && <Spinner label="프로젝트를 불러오는 중..." />}
      {picked.status === "error" && (
        <p role="alert" data-testid="post-project-error" data-error-code={picked.error.code} className="text-sm text-rose-400">
          {picked.error.message}
        </p>
      )}

      {picked.status === "ready" && (
        /*
         * Laid out the way the place this is going lays it out: the clip on the left, the words on the right,
         * both on screen at once. It used to be one long column, so the caption was written while the video it
         * describes was scrolled off the top. The columns stack back into that single column below `lg` — on a
         * narrow window side-by-side would make both halves too cramped to use.
         *
         * The left column holds the media and the checks that are about the media; the right holds everything
         * that ends up in the post text, ending with the publish button.
         */
        <div className="grid gap-5 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)] lg:items-start">
          <div className="space-y-5">
          <div className={cardSection} data-testid="post-video">
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- generated clips carry no caption track */}
            <video
              ref={videoRef}
              data-testid="post-video-player"
              className={`${notVertical ? "aspect-video" : "aspect-[9/16]"} w-full rounded-xl border border-white/10 bg-slate-950/60`}
              controls
              /* Was "none". Metadata is what makes the two checks below about this file rather than about the
                 settings it was supposed to be made from, and it is a local read of a file already on disk. */
              preload="metadata"
              src={videoSrc}
              onLoadedMetadata={(event) => {
                const element = event.currentTarget;
                // A stream whose duration the browser cannot state reports Infinity or NaN. That is "not
                // measured", not "zero seconds" — falling through to the planned value is the honest outcome.
                const seconds = Number.isFinite(element.duration) && element.duration > 0 ? element.duration : null;
                /* No frame size is "not measured", the same way Infinity is for the duration — and it used to
                   copy the PLANNED orientation into the measured slot, which made the line below say 위 영상
                   파일을 직접 재어 본 값입니다 about a shape nothing had looked at. The panel's own comment
                   says why that is the worst of the three outcomes: a check that reports the plan as a
                   measurement is worse than no check, because it is believed. And it is believed three cards
                   above the publish button, which is the one action here nobody can take back. */
                const vertical = element.videoWidth && element.videoHeight
                  ? element.videoHeight >= element.videoWidth
                  : null;
                setMeasured(vertical === null && seconds === null ? null : { vertical, seconds });
              }}
            />
            {/* Instagram's own uploader offers a frame strip for this; the app has the same video already on
                screen, so the choice is "the frame you are looking at" rather than a second way to look. Nothing
                has to be pressed — unset means frame 0, which is exactly what Instagram does on its own. */}
            {!photoCard && (
            <div className="flex flex-wrap items-center gap-2" data-testid="post-cover">
              <button
                type="button"
                data-testid="post-cover-set"
                className="rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
                disabled={!!published}
                onClick={() => {
                  const element = videoRef.current;
                  if (!element) return;
                  // Not measured is not zero: a stream whose position the browser cannot state must not be
                  // recorded as "the first frame", which is a choice nobody made.
                  if (!Number.isFinite(element.currentTime) || element.currentTime < 0) return;
                  setCoverOffsetMs(Math.round(element.currentTime * 1000));
                }}
              >
                지금 이 장면을 커버로
              </button>
              {coverOffsetMs === null ? (
                <span data-testid="post-cover-unset" className="text-xs text-slate-400">
                  커버는 첫 장면입니다. 다른 데가 좋으면 영상을 돌린 뒤 눌러 주세요.
                </span>
              ) : (
                <>
                  <span data-testid="post-cover-set-at" className="text-xs text-emerald-400 tabular-nums">
                    커버: {(coverOffsetMs / 1000).toFixed(1)}초 지점
                  </span>
                  <button
                    type="button"
                    data-testid="post-cover-clear"
                    className="text-xs text-slate-400 underline underline-offset-2 hover:text-slate-200 disabled:opacity-50"
                    disabled={!!published}
                    onClick={() => setCoverOffsetMs(null)}
                  >
                    첫 장면으로
                  </button>
                </>
              )}
            </div>
            )}
            {photoCard && (
              <p data-testid="post-cover-photo-card" className="text-xs text-slate-400">
                사진 카드는 한 장의 그림이라 어느 지점을 골라도 같은 그림입니다. 커버는 그 그림 그대로 나갑니다.
              </p>
            )}
            <p className="text-sm text-slate-300" data-testid="post-video-path">
              저장 위치: {episode ? `${episode.episodeNumber}화 폴더의 ${FINAL_VIDEO_RELATIVE_PATH}` : FINAL_VIDEO_RELATIVE_PATH}
            </p>
            {episode && (
              /* Said rather than left to be discovered: the caption box on this screen saves itself for short
                 projects and cannot for an Episode, and a caption quietly lost is the thing that draft was
                 added to stop. */
              <p data-testid="post-episode-draft-notice" className="text-xs text-amber-300">
                회차 캡션은 자동 저장되지 않습니다. 화면을 떠나면 사라지니 올리기 전에 마무리해 주세요.
              </p>
            )}
            {!episode && hasElectronBridge() && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  data-testid="post-open-in-explorer"
                  className={outlineButton}
                  onClick={() => void openInExplorer()}
                  disabled={openPending}
                >
                  {openPending ? "여는 중..." : "탐색기에서 열기"}
                </button>
                {openFailed && (
                  <p role="alert" data-testid="post-open-failed" className="text-sm text-rose-400">
                    폴더를 열지 못했습니다.
                  </p>
                )}
              </div>
            )}
          </div>

          {/* What Instagram decides about this file — read from the file itself once the player has its
              metadata, and from the project's settings only until then. Which of the two it is has to be
              visible: a check that reports the plan as a measurement is worse than no check, because it is
              believed. */}
          <div className={cardSection} data-testid="post-checks">
            <p className="text-sm font-semibold text-slate-200">올리기 전 확인</p>
            <div className="flex flex-wrap items-center gap-2" data-testid="post-check-shape">
              <StatusChip tone={notVertical ? "progress" : "success"}>{notVertical ? "가로 영상" : "세로 9:16"}</StatusChip>
              {notVertical && (
                <span className="text-xs text-slate-400">
                  릴스는 세로가 기본입니다. 올라가긴 하지만 화면에 여백이 생기거나 잘립니다.
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2" data-testid="post-check-length">
              {checkedSeconds === null ? (
                <span className="text-xs text-slate-400">길이를 확인하지 못했습니다.</span>
              ) : (
                <>
                  <StatusChip tone={tooLong ? "danger" : "success"}>{durationLabel(checkedSeconds)}</StatusChip>
                  <span className="text-xs text-slate-400">
                    {tooLong ? "릴스 한도(3분)를 넘습니다. 장면 수나 장면 길이를 줄여야 합니다." : "릴스 한도(3분) 안입니다."}
                  </span>
                </>
              )}
            </div>
            {/* Three outcomes, because there are three. Saying which half came from the file is the whole point
                of the line: the two checks above look identical whether they were measured or assumed. */}
            <p className="text-xs text-slate-500" data-testid="post-check-source">
              {measured?.vertical != null && measured.seconds !== null
                ? "위 영상 파일을 직접 재어 본 값입니다."
                : measured?.vertical != null
                  ? "화면 비율은 위 영상 파일에서 직접 쟀고, 길이는 파일이 알려주지 않아 설정값으로 적었습니다."
                  : measured?.seconds != null
                    ? "길이는 위 영상 파일에서 직접 쟀고, 화면 비율은 파일이 알려주지 않아 설정값으로 적었습니다."
                    : "아직 영상 파일을 읽지 못해 설정값으로 적었습니다. 실제 파일이 다를 수 있습니다."}
            </p>
          </div>
          </div>

          <div className="space-y-5">
          <div className={cardSection}>
            <label className="block text-sm text-slate-300" htmlFor="post-body">
              캡션 본문
              <textarea
                id="post-body"
                data-testid="post-body"
                rows={6}
                className={fieldClass}
                placeholder="첫 줄이 미리보기에 보입니다."
                value={body}
                onChange={(event) => {
                  setBody(event.target.value);
                  setBodyAutoFilled(false);
                }}
                onBlur={() => void saveDraft()}
              />
            </label>
            {bodyAutoFilled && (
              <p data-testid="post-body-autofilled" className="text-xs text-slate-400">
                {picked.status === "ready" && picked.kind === "episode"
                  ? "이 회차의 제목·줄거리·내레이션으로 미리 채워 뒀습니다. 그대로 올려도 되고, 지우고 새로 쓰셔도 됩니다."
                  : "이 프로젝트의 제목과 내레이션으로 미리 채워 뒀습니다. 그대로 올려도 되고, 지우고 새로 쓰셔도 됩니다."}
              </p>
            )}

            <label className="block text-sm text-slate-300" htmlFor="post-hashtags">
              해시태그
              <input
                id="post-hashtags"
                data-testid="post-hashtags"
                className={fieldClass}
                placeholder="쉼표나 띄어쓰기로 구분 · # 은 안 붙여도 됩니다"
                value={hashtagsRaw}
                onChange={(event) => setHashtagsRaw(event.target.value)}
                onBlur={() => void saveDraft()}
              />
            </label>
            <p className={`text-xs tabular-nums ${hashtagsOver ? "text-rose-400" : "text-slate-400"}`} data-testid="post-hashtag-count">
              해시태그 {hashtags.length}/{HASHTAG_MAX}
              {hashtagsOver && " — 인스타그램이 받아주는 한도를 넘었습니다."}
            </p>
            {/* Louder than the save-state lines below it, because it is about work that already exists: the
                caption saved for this project is still on the server, and this screen is deliberately not
                writing over it. Says both halves — what it could not do, and what it is therefore not doing. */}
            {draftUnread && (
              <p role="status" data-testid="post-draft-unread" className="flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/25 bg-amber-500/[0.06] px-3 py-2 text-xs text-amber-200">
                <span>저장해 둔 캡션을 불러오지 못했습니다. 지워지지 않도록 <strong className="text-amber-100">자동 저장을 멈춰 뒀습니다</strong> — 여기 쓴 내용은 그대로 게시에 쓰입니다.</span>
                <button type="button" data-testid="post-draft-reload" className="underline underline-offset-2 hover:text-amber-100" onClick={() => void reloadDraft()}>
                  다시 불러오기
                </button>
              </p>
            )}
            {saveState === "saving" && <p data-testid="post-draft-saving" className="text-xs text-slate-400">저장 중...</p>}
            {saveState === "saved" && <p data-testid="post-draft-saved" className="text-xs text-emerald-400">저장했습니다.</p>}
            {saveError && (
              <p role="alert" data-testid="post-draft-error" data-error-code={saveError.code} className="text-xs text-rose-400">
                {saveError.message} 쓰던 캡션은 화면에 그대로 있으니 복사해 두세요.
              </p>
            )}

            <label className="flex items-start gap-2 text-sm text-slate-300" htmlFor="post-ai-notice">
              <input
                id="post-ai-notice"
                data-testid="post-ai-notice"
                type="checkbox"
                className="mt-1"
                checked={aiNoticeOn}
                onChange={(event) => {
                  setAiNoticeOn(event.target.checked);
                  // A checkbox has no meaningful blur of its own — the click is the whole interaction.
                  void saveDraft({ aiNotice: event.target.checked });
                }}
              />
              <span>
                캡션에 AI 생성 고지 넣기
                <span className="block text-xs text-slate-500">
                  인스타그램 자체의 AI 라벨은 이것과 별개입니다 — 올릴 때 그쪽도 켜 주세요.
                </span>
              </span>
            </label>

            {/* Not editable and not optional: the licence requires this exact sentence to appear where the work
                is published, and letting it be edited here is how it quietly stops matching. */}
            {creditRequired && !creditMissing && (
              <div data-testid="post-credit" className="space-y-1 rounded-xl border border-amber-400/30 bg-amber-500/5 p-3">
                <p className="text-xs font-semibold text-amber-300">이 음원은 출처 표시가 필요해 캡션에 자동으로 들어갑니다.</p>
                <p className="text-sm text-slate-200">{creditText}</p>
              </div>
            )}
            {creditMissing && (
              <p role="alert" data-testid="post-credit-missing" className="text-sm text-rose-400">
                이 영상에 쓴 음원은 출처 표시가 필요한데 적을 문구가 비어 있습니다. 음원 보관함에서 문구를 채운 뒤 다시 오세요.
              </p>
            )}
          </div>

          <div className={cardSection}>
            <p className="text-sm font-semibold text-slate-200">완성된 캡션</p>
            <p
              data-testid="post-caption-preview"
              className="select-all whitespace-pre-wrap rounded-xl bg-slate-950/60 px-3.5 py-3 text-sm text-slate-200"
            >
              {caption || "아직 아무것도 없습니다."}
            </p>
            <p className={`text-xs tabular-nums ${captionOver ? "text-rose-400" : "text-slate-400"}`} data-testid="post-caption-count">
              {caption.length}/{CAPTION_MAX}자
              {captionOver && " — 인스타그램이 받아주는 한도를 넘었습니다."}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="button"
                data-testid="post-copy"
                className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                onClick={() => void copyCaption()}
                disabled={copyBlocked || !caption}
              >
                캡션 복사
              </button>
              {copied === "done" && <span data-testid="post-copied" className="text-xs text-emerald-400">복사했습니다.</span>}
              {copied === "failed" && (
                <span data-testid="post-copy-failed" className="text-xs text-slate-400">
                  복사하지 못했습니다. 위 캡션을 직접 선택해 복사해 주세요.
                </span>
              )}
            </div>
          </div>

          <div className={cardSection} data-testid="post-publish">
            {/* Above both branches on purpose: this matters most in the state where `published` is gone —
                just after clearing the record, with the publish button live again. That is the moment a person
                is one press away from a second copy of something that may still be up. */}
            {previousPosts.length > 0 && (
              <div data-testid="post-previous" className="space-y-2 rounded-xl border border-amber-400/30 bg-amber-500/5 p-4">
                <p className="text-sm font-semibold text-amber-300">
                  이 영상은 전에 {previousPosts.length}번 올라간 적이 있습니다.
                </p>
                <p className="text-xs text-slate-300">
                  이 앱의 기록에서는 지웠지만, 인스타그램에서 지우지 않으셨다면 그 게시물은 계정에 그대로 있습니다.
                </p>
                <ul className="space-y-2">
                  {previousPosts.map((post) => (
                    <li key={post.mediaId} className="rounded-lg bg-slate-950/60 px-3 py-2">
                      <p className="text-xs text-slate-400 tabular-nums">{dateOnly(post.publishedAt)}</p>
                      {/* The caption, because that is where the licence credit and the AI disclosure lived —
                          "what did that one actually say" is the question asked exactly when it matters. */}
                      {post.caption.trim()
                        ? <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-300">{post.caption.trim()}</p>
                        : <p className="mt-1 text-xs text-slate-500">캡션 없이 올라갔습니다.</p>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {published ? (
              // Already out in the world. The button is gone rather than disabled: there is no state of this
              // screen in which pressing it again is something the person wants.
              <>
                <p className="text-sm font-semibold text-emerald-400" data-testid="post-published">
                  이미 게시했습니다 · {dateOnly(published.publishedAt)}
                </p>
                <p className="text-xs text-slate-400">
                  같은 영상을 또 올리면 계정에 같은 게시물이 두 개가 됩니다.
                </p>
                {/* Two steps, and the second one asks about a fact rather than about resolve: whether the post
                    is still up is the only thing that decides whether this leaves one post or two, and it is
                    the one thing this app cannot look up. */}
                {!confirmForget ? (
                  <button
                    type="button"
                    className={outlineButton}
                    data-testid="post-forget"
                    onClick={() => { setForgetError(null); setConfirmForget(true); }}
                  >
                    다시 올릴 수 있게 하기
                  </button>
                ) : (
                  <div
                    role="alertdialog"
                    aria-label="게시 기록 지우기 확인"
                    data-testid="post-forget-confirm"
                    className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4"
                  >
                    <p className="text-sm font-semibold text-amber-300">인스타그램에서 그 게시물을 지우셨습니까?</p>
                    <p className="text-xs text-slate-300">
                      이 앱은 인스타그램을 볼 수 없어서 대신 확인해 드릴 수 없습니다. 아직 안 지우셨다면 계정에 같은 게시물이 두 개가 됩니다.
                    </p>
                    <p className="text-xs text-slate-400">
                      여기서 지우는 것은 이 앱의 기록뿐이고, 인스타그램의 게시물은 그대로 남습니다.
                      지운 뒤에도 이 앱은 그 게시물을 기억합니다.
                    </p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className={outlineButton}
                        data-testid="post-forget-cancel"
                        disabled={forgetting}
                        onClick={() => setConfirmForget(false)}
                      >
                        돌아가기
                      </button>
                      <button
                        type="button"
                        className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                        data-testid="post-forget-confirm-button"
                        disabled={forgetting}
                        onClick={() => void forgetPost()}
                      >
                        {forgetting ? "지우는 중..." : "네, 지웠습니다"}
                      </button>
                    </div>
                  </div>
                )}
                {forgetError && (
                  <p role="alert" data-testid="post-forget-error" data-error-code={forgetError.code} className="text-sm text-rose-400">
                    {forgetError.message}
                  </p>
                )}
              </>
            ) : (
              <>
                <p className="text-sm font-semibold text-slate-200">인스타그램에 올리기</p>

                {!confirmPublish && (
                  <button
                    type="button"
                    data-testid="post-publish-button"
                    className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                    disabled={publishBlocked || publishing}
                    onClick={() => {
                      setPublishError(null);
                      setConfirmPublish(true);
                    }}
                  >
                    올리기
                  </button>
                )}

                {!selectedTarget && !published && (
                  <p data-testid="post-publish-needs-target" className="text-xs text-amber-300">
                    올릴 계정을 먼저 골라 주세요.
                  </p>
                )}

                {confirmPublish && selectedLabel && (
                  <div
                    role="alertdialog"
                    aria-label="인스타그램 게시 확인"
                    data-testid="post-publish-confirm"
                    className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4"
                  >
                    {/* The account is named here, always — including when there is only one. A mistaken charge
                        can be argued about afterwards; a mistaken post cannot be unseen by whoever saw it. */}
                    <p className="text-sm font-semibold text-amber-300">
                      <span data-testid="post-publish-confirm-account">{selectedLabel.name}</span> 계정에 이 영상을 게시합니다.
                    </p>
                    <p className="text-sm text-slate-300">
                      게시하면 되돌릴 수 없습니다. 지운다고 해도 이미 본 사람에게서는 사라지지 않습니다.
                      {selectedLabel.handleUnavailable && " 이 계정의 @핸들을 읽지 못해 페이지 이름으로 표시하고 있습니다 — 맞는 계정인지 다시 확인해 주세요."}
                    </p>
                    {/* The cover, said here because here is where it is decided.
                        캡틴D picked a frame, published, and got the first one — twice. The record proves the app
                        sent no cover offset at all, so the control was simply never pressed: it lives in the
                        left column beside the player, and its "커버는 첫 장면입니다" is a grey line a screen away
                        from the button that ends the argument. Naming the account here was for exactly this
                        reason; the cover is the other thing about this post that cannot be changed afterwards.
                        Said in both directions, and worded so that not choosing reads as a state rather than an
                        omission — because it is a perfectly good choice, just not one to make by accident. */}
                    {!photoCard && (
                      <p data-testid="post-publish-confirm-cover" className={coverOffsetMs === null ? "text-sm text-amber-200" : "text-sm text-slate-300"}>
                        {coverOffsetMs === null
                          ? "커버는 첫 장면으로 나갑니다. 다른 장면이 좋으면 돌아가서 영상을 돌린 뒤 “지금 이 장면을 커버로”를 눌러 주세요."
                          /* A request, not a promise. This app sends `thumb_offset_ms` and never reads the
                             published media back, so a cover that came out right and one that did not look
                             identical from here — 캡틴D reported exactly that, and the record showed the app had
                             done its part. Saying "커버는 X초 지점입니다" asserts an outcome nobody here checked;
                             saying what was requested is the part that is true. The grid crop is named because
                             it is the likeliest reason a correctly-sent frame still looks wrong. */
                          : `${(coverOffsetMs / 1000).toFixed(1)}초 지점을 커버로 요청합니다. 인스타그램이 프로필 격자에서 다시 잘라 보여 줄 수 있습니다.`}
                      </p>
                    )}
                    <p className="text-xs text-slate-400">올리는 데 몇 분까지 걸릴 수 있습니다.</p>
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className={outlineButton}
                        data-testid="post-publish-cancel"
                        disabled={publishing}
                        onClick={() => setConfirmPublish(false)}
                      >
                        돌아가기
                      </button>
                      <button
                        type="button"
                        className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                        data-testid="post-publish-confirm-button"
                        disabled={publishing}
                        onClick={() => void publish()}
                      >
                        {publishing ? "올리는 중입니다..." : "네, 게시합니다"}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {publishError && (
              <p
                role="alert"
                data-testid="post-publish-error"
                data-error-code={publishError.code}
                className="text-sm text-rose-400"
              >
                {publishError.message}
              </p>
            )}
          </div>
          </div>
        </div>
      )}
    </section>
  );
}
