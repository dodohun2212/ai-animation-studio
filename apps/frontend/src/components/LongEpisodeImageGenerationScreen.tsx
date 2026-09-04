import { useEffect, useRef, useState } from "react";
import type { BudgetPreview, LongEpisodeContinuityReference, LongEpisodeDetail, LongEpisodeImageGenerationPreview, LongEpisodeImageProgress, LongEpisodeImageReview, LongEpisodeStatus, LongEpisodeStoryBibleLinkDrift, SceneNumber, StartLongEpisodeImageGenerationResponse } from "@ai-animation-studio/shared";
import { IMAGE_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";

import {
  approveLongEpisodeImageReview,
  unapproveLongEpisodeImageReview,
  getLongEpisode,
  getLongEpisodeContinuityReference,
  getLongEpisodeImagePreview,
  getLongEpisodeImageProgress,
  getLongEpisodeImageReview,
  getLongProjectSettings,
  longEpisodeImageContentUrl,
  regenerateLongEpisodeImageReview,
  startLongEpisodeImageGeneration,
  toLongProjectDisplayError,
} from "../api/longProjectsApi.js";
import { longEpisodeStatusLabel } from "../utils/longEpisodeLabels.js";
import { Spinner } from "./Spinner.js";
import { StatusChip } from "./ui/StatusChip.js";
import { StaleBadge } from "./ui/StaleBadge.js";
import { RegenerateInstructionField } from "./ui/RegenerateInstructionField.js";
import { BudgetLine } from "./ui/BudgetLine.js";
import { RetryCostNotice } from "./ui/RetryCostNotice.js";

interface Props { projectId: string; episodeNumber: number; onBack: () => void; onOpenVideoWorkflow?: (projectId: string, episodeNumber: number) => void; }
type DisplayError = { code: string; message: string };
type ReviewState =
  | { status: "idle" | "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; reviews: LongEpisodeImageReview[]; budget?: BudgetPreview; retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview }; imageStale: SceneNumber[]; referenceStale: SceneNumber[]; drift: LongEpisodeStoryBibleLinkDrift[]; driftUnreadable: boolean };
/** The Story Bible's own words for these two links, so the sentence reads like the screen the person set them on. */
const LINK_LABEL: Record<LongEpisodeStoryBibleLinkDrift["link"], string> = { protagonist: "주인공", style: "전체 그림체" };
const SCENE_SLOT_LABEL: Record<string, string> = { generated: "생성됨", waiting: "대기 중", generating: "만드는 중", pending: "검토 대기", approved: "승인됨", done: "완료" };
const sceneSlotLabel = (status: string) => SCENE_SLOT_LABEL[status] ?? status;

/**
 * The Episode's steps in the order they happen, so a screen can ask "are we past this yet" rather than
 * "are we exactly here".
 *
 * The 참고 이미지 연결 notice below was written as `status !== asset_mapping_approved`, so it reappeared the
 * moment generation started — telling someone to approve a thing they had approved a second earlier, while
 * their money was being spent. A step notice has to know direction; equality does not.
 */
const STATUS_ORDER: readonly LongEpisodeStatus[] = [
  "planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review",
  "asset_mapping_approved", "generating_images", "images_ready", "images_review",
  "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved",
  "rendering", "completed",
];
/** `interrupted` and `failed` are not points on the line, so they never read as "before" anything. */
function isBefore(status: LongEpisodeStatus | undefined, marker: LongEpisodeStatus): boolean {
  if (!status) return false;
  const at = STATUS_ORDER.indexOf(status);
  return at !== -1 && at < STATUS_ORDER.indexOf(marker);
}

const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const primaryButton = "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const smallOutlineButton = "rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallAmberButton = "rounded-full bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white shadow-[0_0_12px_rgba(245,158,11,0.35)] disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

export function LongEpisodeImageGenerationScreen({ projectId, episodeNumber, onBack, onOpenVideoWorkflow }: Props) {
  const [episode, setEpisode] = useState<LongEpisodeDetail | null>(null);
  const [continuityReference, setContinuityReference] = useState<LongEpisodeContinuityReference | null>(null);
  const [continuityReferenceLoading, setContinuityReferenceLoading] = useState(true);
  /**
   * Whether the continuity read itself failed, kept apart from the reference being absent.
   *
   * Both used to land on `null`, and `null` was rendered as "이전 에피소드의 마지막 장면 자료가 아직 없어서" — a
   * definite statement about the previous Episode, produced by a screen that had not managed to ask. A 500 or a
   * dropped connection on Episode 4 of a running series therefore told the person the material was missing when
   * it was sitting there, right before they bought six pictures with no continuity attached.
   */
  const [continuityReferenceFailed, setContinuityReferenceFailed] = useState(false);
  /**
   * Only so the image box takes this project's real shape. A 16:9 Episode really does produce landscape images,
   * and fitting one into a portrait box shows the reviewer a tall slice of a picture that is not tall — a paid
   * approve/regenerate decision made against something the model never produced. Failure is silent on purpose:
   * a settings request that does not answer must not cost anyone the picture itself, so the box falls back to
   * the app-wide default shape and the image still renders.
   */
  const [aspectRatio, setAspectRatio] = useState<"9:16" | "16:9">("9:16");
  /** Set once the Episode answers, so the project-settings read below cannot overwrite the more specific value whichever lands first. */
  const episodeAspect = useRef<"9:16" | "16:9" | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<DisplayError | null>(null);
  const [confirmingGeneration, setConfirmingGeneration] = useState(false);
  const [generationPending, setGenerationPending] = useState(false);
  const [generation, setGeneration] = useState<StartLongEpisodeImageGenerationResponse | null>(null);
  /**
   * When this screen started the run, so the clock counts the run rather than the visit.
   *
   * Null for a run that was already going on arrival — reload, another window, or coming back to the Episode.
   * The screen knows such a run exists (the status says so) but not when it began, and a clock started on
   * arrival would read as the run's age, which is a number the app would be making up.
   */
  /**
   * Per-scene progress of the run happening right now, or null when nobody has told us.
   *
   * Null is not "nothing done yet" — it is "not asked, or the ask failed" — and the list below keeps the
   * batch-level 만드는 중 for every scene in that case rather than inventing six 대기 중.
   */
  const [imageProgress, setImageProgress] = useState<LongEpisodeImageProgress | null>(null);
  const [runStartedAt, setRunStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [reviewState, setReviewState] = useState<ReviewState>({ status: "idle" });
  const [approvePending, setApprovePending] = useState<Set<SceneNumber>>(new Set());
  const [regenerateConfirm, setRegenerateConfirm] = useState<SceneNumber | null>(null);
  /** One-off direction for the open confirmation. Cleared whenever a confirmation opens or closes, so it can never ride along to a scene it was not typed for. */
  const [regenerateInstruction, setRegenerateInstruction] = useState("");
  const [regeneratePending, setRegeneratePending] = useState<Set<SceneNumber>>(new Set());
  const generationBusy = useRef(false);
  const approvalBusy = useRef(new Set<SceneNumber>());
  const regenerationBusy = useRef(new Set<SceneNumber>());

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setGeneration(null); setReviewState({ status: "idle" }); setConfirmingGeneration(false);
    episodeAspect.current = null;
    getLongEpisode(projectId, episodeNumber)
      .then((response) => {
        if (cancelled) return;
        setEpisode(response.episode);
        // The Episode's own GET fills this; absent means "not determined here", so the project settings below
        // stay the fallback rather than being overwritten with a guess.
        if (response.episode.aspectRatio) {
          episodeAspect.current = response.episode.aspectRatio;
          setAspectRatio(response.episode.aspectRatio);
        }
      })
      .catch((caught: unknown) => { if (!cancelled) setError(toLongProjectDisplayError(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    setContinuityReferenceFailed(false);
    getLongEpisodeContinuityReference(projectId, episodeNumber)
      .then((response) => { if (!cancelled) setContinuityReference(response.reference); })
      .catch(() => { if (!cancelled) { setContinuityReference(null); setContinuityReferenceFailed(true); } })
      .finally(() => { if (!cancelled) setContinuityReferenceLoading(false); });
    /* Second source, not the first. The Episode now carries its own aspectRatio — added precisely so screens
       stop each landing on their own assumption — and this read only covers an Episode whose GET did not fill
       it. Losing both still costs only the box, never the picture. */
    getLongProjectSettings(projectId)
      .then((response) => { if (!cancelled) setAspectRatio((current) => episodeAspect.current ?? response.settings.aspectRatio ?? current); })
      .catch(() => { /* Shape only — see aspectRatio's own comment. The picture matters more than its box. */ });
    return () => { cancelled = true; };
  }, [projectId, episodeNumber]);

  const reviewable = episode?.status === "images_review" || episode?.status === "waiting_for_video_confirmation";
  /**
   * Whether this Episode has images at all — which is a different question from whether it is being reviewed.
   *
   * The list used to be fetched only while reviewable, because the server refused it otherwise; it does not any
   * more (the pictures were never gone, only the list of them). Reading it at every later stage is what lets
   * the gallery below show real per-scene records instead of guessing scene numbers from the script.
   */
  const imagesMayExist = Boolean(episode) && !isBefore(episode!.status, "images_ready");

  useEffect(() => {
    if (!imagesMayExist || reviewState.status !== "idle") return;
    let cancelled = false;
    setReviewState({ status: "loading" });
    getLongEpisodeImageReview(projectId, episodeNumber)
      .then((response) => { if (!cancelled) { setEpisode(response.episode); setReviewState({ status: "ready", reviews: response.reviews, budget: response.budget, imageStale: response.staleness.imageStale, referenceStale: response.staleness.referenceStale, drift: response.storyBibleLinkDrift, driftUnreadable: response.storyBibleLinkDriftUnreadable === true }); } })
      .catch((caught: unknown) => { if (!cancelled) setReviewState({ status: "error", error: toLongProjectDisplayError(caught) }); });
    return () => { cancelled = true; };
    // reviewState.status is intentionally excluded: it is set inside this effect as a start-once guard,
    // and including it would re-run the effect (and its cleanup) before the in-flight fetch resolves,
    // permanently discarding the response via the `cancelled` flag and leaving the screen stuck loading.
  }, [episodeNumber, projectId, imagesMayExist]);

  /**
   * While images are being made, ask again until they are not.
   *
   * The screen read the Episode once and never again, so a generation that ran for four minutes looked
   * identical to one that had not started: every scene "대기 중", no button, nothing moving. The person who
   * paid for it has no way to tell those apart, and the next thing they do is press generate again.
   *
   * Three seconds because the run makes roughly one image every thirty; the cost of asking is one local
   * request, and the cost of not asking is a second $0.60 batch. Stops the moment the status moves on, and on
   * unmount, so leaving the screen does not leave a timer behind.
   */
  /**
   * A run is happening — either the status says so, or this screen's own POST has not come back yet.
   *
   * The second half is what was missing. `startLongEpisodeImageGeneration` does not return until every image is
   * made, and the status the server writes before the loop is only reachable by asking again. So the screen sat
   * for the whole run holding the state it had before pressing: no panel, six rows reading 대기 중, while the
   * money went out. The panel existed and was tested — but only for a run this screen found, never for one it
   * started, which is every first run.
   */
  const running = generationPending || episode?.status === "generating_images";
  /** Set once the POST has answered, so a poll still in flight cannot put the pre-answer status back. */
  const generationSettled = useRef(false);
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const timer = setInterval(() => {
      /* The progress route rather than the Episode: it answers both questions in one request, so watching a run
         scene by scene costs no more traffic than watching it as one lump did. Six scenes take minutes with
         nothing on screen moving, and a screen where nothing moves is what makes a person press a paid button
         a second time. */
      getLongEpisodeImageProgress(projectId, episodeNumber)
        .then((response) => {
        // The POST's own answer is the authoritative end of the run; a poll that started before it landed
        // would otherwise write "still generating" over the finished state.
        if (cancelled || generationSettled.current) return;
        setEpisode(response.episode);
        setImageProgress(response.progress);
        // The Episode's own GET fills this; absent means "not determined here", so the project settings below
        // stay the fallback rather than being overwritten with a guess.
        if (response.episode.aspectRatio) {
          episodeAspect.current = response.episode.aspectRatio;
          setAspectRatio(response.episode.aspectRatio);
        }
      })
        .catch(() => { /* A dropped poll is not worth an error banner; the next tick asks again. */ });
    }, 3000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [projectId, episodeNumber, running]);

  /* Costs nothing and needs nothing from the server: it is the one thing that proves the app is still alive
     while a batch nobody can see per-scene runs for several minutes. */
  useEffect(() => {
    if (!running || runStartedAt === null) return;
    const ticker = setInterval(() => setElapsedSeconds(Math.floor((Date.now() - runStartedAt) / 1000)), 1000);
    return () => clearInterval(ticker);
  }, [running, runStartedAt]);

  const eligible = episode?.status === "asset_mapping_approved";
  /**
   * The free preflight, asked once the Episode is ready to generate.
   *
   * Soft: if it cannot be read the screen falls back to counting the review list, which is what it did before —
   * a confirmation that refuses to open because a preflight failed helps nobody.
   */
  const [preview, setPreview] = useState<LongEpisodeImageGenerationPreview | null>(null);
  /** Asked when the question is asked, not on arrival: nobody needs a price for a button they have not pressed. */
  function openGenerationConfirmation(): void {
    setConfirmingGeneration(true);
    setPreview(null);
    void getLongEpisodeImagePreview(projectId, episodeNumber)
      .then((response) => setPreview(response.preview))
      .catch(() => setPreview(null));
  }
  async function confirmGeneration(): Promise<void> {
    if (generationBusy.current) return;
    generationBusy.current = true; generationSettled.current = false; setGenerationPending(true); setError(null);
    // Stamped as the request goes out, not when it answers. The answer is minutes away, and the panel is up for
    // all of it; reading runStartedAt as null in that stretch made the screen say it had walked in on a run
    // already going and could not know when it began — about a run it had started itself two lines earlier.
    setRunStartedAt(Date.now()); setElapsedSeconds(0);
    try {
      const response = await startLongEpisodeImageGeneration(projectId, episodeNumber);
      generationSettled.current = true;
      setGeneration(response); setEpisode(response.episode); setConfirmingGeneration(false);
    } catch (caught) { setError(toLongProjectDisplayError(caught)); }
    finally { generationBusy.current = false; setGenerationPending(false); }
  }

  /**
   * Confirm and take-back share one function because they share one rule: whatever the server answers is the
   * new truth on this screen, including the badges. Splitting them invited the drift that Round 469's
   * `update()` was — two paths that must mirror each other and quietly stop doing so.
   *
   * Take-back is refused once the Episode has bought any video (the server reuses regeneration's gate), and
   * that refusal arrives as an ordinary error the banner already shows. The button is not hidden for it: a
   * control that disappears without saying why teaches nothing, and this screen's whole recent history is
   * about screens that gave the wrong reason.
   */
  async function setSceneApproval(sceneNumber: SceneNumber, approved: boolean): Promise<void> {
    if (approvalBusy.current.has(sceneNumber)) return;
    approvalBusy.current.add(sceneNumber); setApprovePending(new Set(approvalBusy.current)); setError(null);
    try {
      const response = approved
        ? await approveLongEpisodeImageReview(projectId, episodeNumber, sceneNumber)
        : await unapproveLongEpisodeImageReview(projectId, episodeNumber, sceneNumber);
      setEpisode(response.episode);
      setReviewState((current) => ({
        status: "ready",
        reviews: response.reviews,
        budget: current.status === "ready" ? current.budget : undefined,
        retryEstimate: current.status === "ready" ? current.retryEstimate : undefined,
        // Carried from the response, not the old state: approving scene 2 must not leave scene 3's badge
        // showing what was true one request ago.
        imageStale: response.staleness.imageStale,
        referenceStale: response.staleness.referenceStale,
        drift: response.storyBibleLinkDrift,
        driftUnreadable: response.storyBibleLinkDriftUnreadable === true,
      }));
    } catch (caught) { setError(toLongProjectDisplayError(caught)); }
    finally { approvalBusy.current.delete(sceneNumber); setApprovePending(new Set(approvalBusy.current)); }
  }

  async function confirmRegenerate(sceneNumber: SceneNumber): Promise<void> {
    if (regenerationBusy.current.has(sceneNumber)) return;
    regenerationBusy.current.add(sceneNumber); setRegeneratePending(new Set(regenerationBusy.current)); setError(null);
    try {
      const response = await regenerateLongEpisodeImageReview(projectId, episodeNumber, sceneNumber, regenerateInstruction);
      setEpisode(response.episode);
      setReviewState({ status: "ready", reviews: response.reviews, budget: response.retryEstimate?.budget, retryEstimate: response.retryEstimate, imageStale: response.staleness.imageStale, referenceStale: response.staleness.referenceStale, drift: response.storyBibleLinkDrift, driftUnreadable: response.storyBibleLinkDriftUnreadable === true });
      setRegenerateConfirm(null);
      setRegenerateInstruction("");
    } catch (caught) { setError(toLongProjectDisplayError(caught)); }
    finally { regenerationBusy.current.delete(sceneNumber); setRegeneratePending(new Set(regenerationBusy.current)); }
  }

  const reviewFor = (sceneNumber: SceneNumber) => reviewState.status === "ready" ? reviewState.reviews.find((item) => item.sceneNumber === sceneNumber) : undefined;

  /**
   * The Episode's scenes as the server reports them, never a constant of its own.
   *
   * This screen used to keep `[1..6]` locally, which made the count a claim the screen invented rather than one
   * it was told — and it would have gone quietly wrong the moment Episodes stopped being six scenes. The review
   * list is the authority once it loads; before that the loaded script is, and while neither has arrived the
   * list is simply empty rather than guessing a number. The short project's video screen works the same way.
   */
  const sceneNumbers: SceneNumber[] = reviewState.status === "ready" && reviewState.reviews.length > 0
    ? reviewState.reviews.map((item) => item.sceneNumber)
    : (episode?.script?.scenes.map((scene) => scene.number) ?? []);

  /**
   * How many scenes already have a picture, and how many this button would actually buy.
   *
   * The panel quoted every scene at full price no matter what existed, while the response it gets back reports
   * `reusedSceneNumbers` — so the screen said one number and the receipt said another, always in the direction
   * that overstates. A review row exists only for a scene that was generated (its status is pending or
   * approved, never "not made"), which makes the list the honest count.
   *
   * The flip side is worth saying out loud too: pressing this again does NOT redraw what exists. Someone who
   * just linked a new reference and expects fresh pictures needs the per-scene 다시 만들기 instead.
   */
  //
  // The count comes from the server's preflight, not from the review list. The review list is only fetched once
  // pictures exist, and this confirmation appears at the one stage where they may not — which is exactly the
  // state a partly-failed run leaves behind. Deriving it here would read "nothing made yet" precisely when
  // something was, and quote all six again.
  const alreadyMadeCount = preview?.reusableSceneNumbers.length ?? (reviewState.status === "ready"
    ? sceneNumbers.filter((sceneNumber) => reviewFor(sceneNumber) !== undefined).length
    : 0);
  const toMakeCount = preview?.generatableSceneNumbers.length ?? Math.max(0, sceneNumbers.length - alreadyMadeCount);
  // The server's own number, never re-multiplied here: two copies of a price is two prices.
  const estimatedCostUsd = preview?.estimatedCostUsd ?? toMakeCount * IMAGE_ESTIMATED_COST_USD;

  return (
    <section className="mt-8 space-y-5">
      <button type="button" className={outlineButton} onClick={onBack}>참고 이미지 연결 검토로</button>
      <header className="space-y-1">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />{`에피소드 ${episodeNumber} 이미지 생성`}</h2>
        <p data-testid="episode-image-cost-notice" className="text-sm text-amber-300">OpenAI 키가 연결되어 있으면 장면마다 실제 유료 요청이 전송됩니다. 연결되어 있지 않으면 비용 없이 임시 이미지로 생성됩니다.</p>
      </header>
      {loading && <Spinner label="에피소드 이미지 상태를 불러오는 중..." />}
      {episode && <p data-testid="episode-image-status" className="text-sm text-slate-400">에피소드 상태: {longEpisodeStatusLabel(episode.status)}</p>}
      {continuityReferenceLoading && <p data-testid="episode-image-continuity-loading" className="text-sm text-slate-400">이전 에피소드 연속성 참고 자료를 확인하는 중...</p>}
      {!continuityReferenceLoading && continuityReference?.available && <p data-testid="episode-image-continuity-available" className="text-sm text-violet-200">에피소드 {continuityReference.previousEpisodeNumber}의 마지막 장면({continuityReference.sourceSceneNumber}번)이 이 에피소드 1번 장면의 기준이 됩니다.</p>}
      {/* Episode 1 has no previous Episode by definition — saying a reference is "missing" there reads as a
          prerequisite the user failed to meet, when nothing is wrong at all. */}
      {/* Could not ask, which is not the same as asked and there is none. Amber rather than the grey of the
          line below: "there is nothing to inherit" is a settled fact the person can generate past, while this
          one is an open question sitting in front of a paid batch. */}
      {/* Never on Episode 1: there is no previous Episode to have failed to ask about, so a failed lookup
          changes nothing a person could act on. Saying "확인하지 못했습니다" there would invent a doubt about a
          question that already has a definite answer. */}
      {!continuityReferenceLoading && continuityReferenceFailed && episodeNumber > 1 && <p data-testid="episode-image-continuity-unknown" className="text-sm text-amber-300">이전 에피소드의 마지막 장면 자료를 확인하지 못했습니다. 이어받을 게 있는지 알 수 없어서, 지금 만들면 이어받지 않고 만들어질 수 있습니다.</p>}
      {!continuityReferenceLoading && (!continuityReferenceFailed || episodeNumber <= 1) && !continuityReference?.available && <p data-testid="episode-image-continuity-unavailable" className="text-sm text-slate-400">{episodeNumber <= 1 ? "첫 에피소드라 이어받을 이전 장면이 없습니다. 이 에피소드부터 새로 시작합니다." : "이전 에피소드의 마지막 장면 자료가 아직 없어서, 이어받지 않고 이 에피소드만으로 만듭니다."}</p>}
      {episode && isBefore(episode.status, "asset_mapping_approved") && <p data-testid="episode-image-not-eligible" className="text-sm text-amber-300">에피소드 이미지 생성을 시작하려면 먼저 참고 이미지 연결을 승인하세요.</p>}
      {/* The short project has said all of this since the run was made pollable; the Episode showed only a list
          of scenes reading 만드는 중, with nothing about whether leaving was safe. That last sentence is the one
          that stops a second $0.60 batch, and it was missing on the side where a batch costs more. */}
      {running && (
        <div data-testid="episode-generation-progress" role="status" className="space-y-1.5 rounded-xl border border-violet-400/30 bg-violet-500/[0.07] p-3.5">
          <p className="text-sm font-semibold text-violet-200">
            {sceneNumbers.length > 0 ? `장면 ${sceneNumbers.length}개의 이미지를 만드는 중입니다.` : "이미지를 만드는 중입니다."}
          </p>
          {/* The count and the bar exist only when the server has actually said how far it got. Drawing a bar
              from a guess is the thing this replaces: this panel said 만드는 중 about all six for the whole
              run, so one finished picture and five finished pictures looked identical. */}
          {imageProgress && (
            <div data-testid="episode-generation-progress-count" className="space-y-1.5">
              <p className="text-sm text-violet-100 tabular-nums">
                {imageProgress.sceneNumbers.length}장 중 <strong>{imageProgress.completedSceneNumbers.length}장</strong> 완료
                {imageProgress.currentSceneNumber !== undefined ? ` · 지금 ${imageProgress.currentSceneNumber}번 장면` : ""}
              </p>
              <div aria-hidden="true" className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-violet-400 to-pink-300 transition-[width] duration-500"
                  style={{ width: `${imageProgress.sceneNumbers.length > 0 ? Math.round((imageProgress.completedSceneNumbers.length / imageProgress.sceneNumbers.length) * 100) : 0}%` }}
                />
              </div>
            </div>
          )}
          {/* No per-scene count and no bar: the Episode does not publish per-scene progress, and a bar drawn
              from nothing is a claim the screen cannot keep. */}
          {runStartedAt !== null ? (
            <p className="text-xs text-slate-400 tabular-nums">
              {Math.floor(elapsedSeconds / 60)}분 {elapsedSeconds % 60}초째 진행 중 · 한 장에 보통 십수 초에서 1분쯤 걸립니다.
            </p>
          ) : (
            <p data-testid="episode-generation-progress-resumed" className="text-xs text-slate-400">
              이 화면에 들어오기 전부터 진행 중이던 생성입니다. 시작한 시각은 알 수 없어 경과 시간은 표시하지 않습니다.
            </p>
          )}
          <p className="text-xs text-slate-500">
            이 화면을 벗어나거나 새로고침해도 서버에서 만드는 것은 계속됩니다. 다시 누르면 같은 장면을 한 번 더 결제하게 됩니다.
          </p>
        </div>
      )}
      {/* A statement of difference, not of error — CLI's own framing and the right one. An Episode drawn before
          the Story Bible changed is allowed to keep the character it was drawn with; the pictures are bought and
          correct for what they were made from. Whether to spend money redrawing is the person's call, so this
          says what is, names no action, and is styled as information rather than as a problem. */}
      {/* An empty drift list used to mean two things — nothing differs, and the Story Bible could not be read —
          and the screen drew both as silence. The paid 다시 만들기 button sits right under that silence, and
          this list holds the one sentence able to say an Episode was drawn with a character the story no longer
          has. A broken story_bible.json therefore switched that warning off without saying so. Amber, not the
          drift section's sky: a difference is settled information, an unread file is an open question. */}
      {reviewState.status === "ready" && reviewState.driftUnreadable && (
        <p role="status" data-testid="episode-story-bible-drift-unknown" className="rounded-xl border border-amber-400/25 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
          설정집을 읽지 못해서, 이 에피소드가 지금 이야기와 <strong className="text-amber-100">다른 인물·그림체로 만들어졌는지 확인할 수 없습니다</strong>.
          달라도 여기서는 알 수 없으니, 다시 만들기를 누르기 전에 그 점을 감안해 주세요.
        </p>
      )}
      {reviewState.status === "ready" && reviewState.drift.length > 0 && (
        <section data-testid="episode-story-bible-drift" aria-label="설정집과 다른 점" className="space-y-1.5 rounded-xl border border-sky-400/25 bg-sky-500/[0.06] px-4 py-3">
          {reviewState.drift.map((item) => (
            <p key={item.link} data-testid={`episode-drift-${item.link}`} className="text-sm text-sky-200">
              이 에피소드는 {LINK_LABEL[item.link]}{" "}
              <strong className="text-sky-100">{item.episodeAssetName ?? item.episodeAssetId ?? "연결 없음"}</strong>
              (으)로 만들어졌습니다. 지금 설정집의 {LINK_LABEL[item.link]}은(는){" "}
              <strong className="text-sky-100">{item.storyBibleAssetName || item.storyBibleAssetId}</strong>입니다.
            </p>
          ))}
          {/* Said once for the section rather than per line: the reason it is not an instruction. */}
          <p className="text-xs text-sky-300/80">이미 만든 그림은 그대로 둡니다. 새 쪽으로 맞추려면 장면마다 다시 만들기를 눌러 주세요 — 다시 만드는 만큼 비용이 듭니다.</p>
        </section>
      )}
      <ol data-testid="episode-image-scenes" className="list-decimal space-y-1 pl-5 text-sm text-slate-300">
        {sceneNumbers.map((sceneNumber) => {
          /* Without the generating case this list said "대기 중" for every scene while five of six were
             already bought — money going out in front of a screen that showed nothing happening, which is
             what makes a person press the button again. Per-scene progress is not published, so this says
             what is true of the batch rather than inventing a per-scene claim. */
          const status = reviewFor(sceneNumber)?.status
            /* Per-scene now, when the server has said so. `imageProgress` null still means "we have not been
               told", and that keeps the old batch-level answer rather than turning silence into 대기 중 —
               saying a scene has not started is a claim, and an unanswered poll does not support it. */
            ?? (running
              ? (imageProgress === null ? "generating"
                : imageProgress.completedSceneNumbers.includes(sceneNumber) ? "done"
                : imageProgress.currentSceneNumber === sceneNumber ? "generating"
                : "waiting")
              // Past the image step the pictures exist — the gallery above is showing them — so "대기 중" here
              // was the same list being wrong at a fourth stage. Review detail is only loaded at the review
              // step; without it this says the one thing that is still true.
              : (episode && !isBefore(episode.status, "images_ready")) || generation ? "generated"
              : "waiting");
          return (
            <li key={sceneNumber} data-testid={`episode-image-scene-${sceneNumber}`} data-status={status}>
              장면 {sceneNumber}: {sceneSlotLabel(status)}
            </li>
          );
        })}
      </ol>
      {/* The pictures stay reachable after the step that made them.
          The review block below is the only place they appeared, and it renders only while the Episode is at
          the review step — so approving the last scene made all six vanish. They are still on disk, and the
          video step is exactly when "what did scene 3 look like" gets asked. A stage is not a reason to hide
          what that stage produced. */}
      {episode && !isBefore(episode.status, "images_ready") && !reviewable && sceneNumbers.length > 0 && (
        <section aria-label="만든 장면 이미지" data-testid="episode-image-gallery" className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <h3 className="text-base font-semibold text-slate-100">만든 장면 이미지</h3>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {sceneNumbers.map((sceneNumber) => (
              <li key={sceneNumber} className="space-y-1">
                <img
                  /* The scene's own updatedAt when the list has it: a regenerated picture changes under the
                     same address, and busting on the Episode's status would keep showing the old one until the
                     Episode moved stage. Falls back to the status, which is what this had before. */
                  src={longEpisodeImageContentUrl(projectId, episodeNumber, sceneNumber, reviewFor(sceneNumber)?.updatedAt ?? episode.status)}
                  /* Eager: six pictures on a screen someone opened to look at them, and a lazy loader that
                     does not fire leaves six empty boxes with no error anywhere. */
                  alt={`${sceneNumber}번 장면 이미지`}
                  className="w-full rounded-lg border border-white/10 object-cover"
                />
                <span className="block text-xs text-slate-400">{sceneNumber}번 장면</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {eligible && !generation && <button type="button" disabled={confirmingGeneration} className={primaryButton} onClick={openGenerationConfirmation}>이미지 생성 시작</button>}
      {confirmingGeneration && (
        <div role="alertdialog" data-testid="episode-image-generate-confirm" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
          <p className="text-sm text-amber-200">
            {alreadyMadeCount > 0
              ? `남은 장면 이미지 ${toMakeCount}장을 생성할까요?`
              : `이 에피소드의 이미지 ${sceneNumbers.length}장을 생성할까요?`}
            {" "}이 확인창을 연 것만으로는 아직 요청이 가지 않았습니다.
          </p>
          {alreadyMadeCount > 0 && (
            <p data-testid="episode-image-reuse-notice" className="text-sm text-slate-300">
              이미 만들어진 <strong className="text-slate-100">{alreadyMadeCount}장</strong>은 그대로 두고 다시 만들지 않습니다 —
              비용도 안 듭니다. 이미 있는 그림을 <strong className="text-slate-100">새로 뽑고 싶다면</strong> 이 버튼이 아니라
              아래 목록에서 장면마다 <span className="text-slate-100">다시 만들기</span>를 눌러 주세요.
            </p>
          )}
          <p data-testid="episode-image-cost-estimate" className="text-xs text-slate-300 tabular-nums">
            예상 비용: ${estimatedCostUsd.toFixed(2)} ({toMakeCount}장 × $
            {IMAGE_ESTIMATED_COST_USD.toFixed(2)}) · 키가 연결되어 있을 때만 청구됩니다
          </p>
          <div className="flex gap-3">
            <button type="button" className={outlineButton} disabled={generationPending} onClick={() => setConfirmingGeneration(false)}>돌아가기</button>
            <button type="button" className={primaryButton} disabled={generationPending} onClick={() => void confirmGeneration()}>{generationPending ? "생성하는 중..." : "이미지 생성"}</button>
          </div>
        </div>
      )}
      {generation && (
        <div className="space-y-1.5">
          <p data-testid="episode-image-generation-summary" className="text-sm text-emerald-400">{generation.generatedSceneNumbers.length}개 생성, {generation.reusedSceneNumbers.length}개 재사용됨.</p>
          <BudgetLine budget={generation.budget} data-testid="episode-image-generation-budget" />
        </div>
      )}
      {reviewState.status === "ready" && <BudgetLine budget={reviewState.budget} data-testid="episode-image-review-budget" />}
      {reviewState.status === "loading" && <Spinner label="이미지 검토 내용을 불러오는 중..." />}
      {reviewState.status === "ready" && (
        <section data-testid="episode-image-review-section" className={cardSection}>
          <h3 className="flex items-center gap-2.5 text-base font-semibold"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />이미지 검토</h3>
          {/* Design system §4.3: overall confirmation progress before the per-scene cards. */}
          <p className="text-sm text-slate-300 tabular-nums" data-testid="episode-image-review-summary">
            {sceneNumbers.length}장면 중 {sceneNumbers.filter((sceneNumber) => reviewFor(sceneNumber)?.status === "approved").length}장면 확정
          </p>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sceneNumbers.map((sceneNumber) => {
            const review = reviewFor(sceneNumber);
            if (!review) return null;
            const approving = approvePending.has(sceneNumber);
            const regenerating = regeneratePending.has(sceneNumber);
            const confirming = regenerateConfirm === sceneNumber;
            return (
              <div
                key={sceneNumber}
                data-testid={`episode-image-review-${sceneNumber}`}
                data-status={review.status}
                className={`space-y-2 rounded-xl border bg-slate-950/40 p-3 ${review.status === "approved" ? "border-emerald-400/30" : "border-white/10"}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-slate-100">{sceneNumber}번 장면</span>
                  <span className="flex flex-wrap items-center gap-2">
                    {/* The same badge the short project uses — one wording for one fact. Never says the rest are
                        current: an image made before prompts were recorded has no record and is simply absent. */}
                    <StaleBadge
                      staleSceneNumbers={reviewState.imageStale}
                      sceneNumber={sceneNumber}
                      kind="image"
                      data-testid={`episode-image-stale-${sceneNumber}`}
                    />
                    {/* Separate from the one above because the causes are separate: that one means the script
                        changed, this one means the character behind the picture did while the words stayed put.
                        A person who is told "your text changed" when it did not goes and re-reads a fine scene. */}
                    <StaleBadge
                      staleSceneNumbers={reviewState.referenceStale}
                      sceneNumber={sceneNumber}
                      kind="reference"
                      data-testid={`episode-reference-stale-${sceneNumber}`}
                    />
                    <StatusChip tone={review.status === "approved" ? "success" : "neutral"}>{sceneSlotLabel(review.status)}</StatusChip>
                  </span>
                </div>
                {/* Quiet unless the Backend's reference cap actually dropped something. The total is derived from
                    both counts it sends, so this line never hardcodes that cap — the same split the short-project
                    screen uses. */}
                {typeof review.referencesOmittedCount === "number" && review.referencesOmittedCount > 0 && (
                  <p data-testid={`episode-image-references-omitted-${sceneNumber}`} className="text-xs text-amber-300">
                    연결한 참고 이미지 중 {(review.referencesUsedCount ?? 0) + review.referencesOmittedCount}장 가운데
                    {" "}{review.referencesUsedCount ?? 0}장만 사용됐습니다. 연결을 줄이면 남은 것이 반영됩니다.
                  </p>
                )}
                {/* The screen this replaces had no <img> at all, and no route existed to serve one: a reviewer
                    approved or paid to regenerate a picture they had never seen. Deliberately NOT gated on the
                    Episode's status — an image that exists must stay visible after the Episode moves on, or the
                    review screen stops showing the thing under review, which is the failure this fixes. */}
                <img
                  src={longEpisodeImageContentUrl(projectId, episodeNumber, sceneNumber, review.updatedAt)}
                  alt={`${sceneNumber}번 장면 이미지`}
                  data-testid={`episode-image-review-picture-${sceneNumber}`}
                  data-aspect={aspectRatio}
                  className={`${aspectRatio === "16:9" ? "aspect-video" : "aspect-[9/16]"} w-full rounded-xl border border-white/10 bg-slate-800 object-cover`}
                />
                <div className="flex flex-wrap justify-end gap-3">
                  <span className="flex flex-col items-end gap-0.5">
                    <button
                      type="button"
                      data-testid={`episode-image-approval-${sceneNumber}`}
                      className={smallOutlineButton}
                      disabled={approving}
                      onClick={() => void setSceneApproval(sceneNumber, review.status !== "approved")}
                    >
                      {approving
                        ? (review.status === "approved" ? "확정 푸는 중..." : "확정하는 중...")
                        : review.status === "approved" ? "확정 완료" : "이 이미지로 확정"}
                    </button>
                    {review.status === "approved" && !approving && (
                      <span className="text-[11px] text-slate-500">한 번 더 누르면 확정을 풉니다</span>
                    )}
                  </span>
                  <button type="button" className={smallOutlineButton} disabled={regenerating || confirming} onClick={() => { setRegenerateInstruction(""); setRegenerateConfirm(sceneNumber); }}>{regenerating ? "다시 만드는 중..." : "다시 만들기"}</button>
                </div>
                {confirming && (
                  <div role="alertdialog" data-testid={`episode-image-regenerate-confirm-${sceneNumber}`} className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3">
                    <p className="text-sm text-amber-200">{sceneNumber}번 장면만 다시 만들까요? OpenAI 키가 연결되어 있으면 이번 재생성분이 실제로 청구됩니다.</p>
                    <RetryCostNotice
                      estimate={reviewState.status === "ready" ? reviewState.retryEstimate : undefined}
                      sceneCount={1}
                      data-testid={`episode-image-regenerate-cost-${sceneNumber}`}
                    />
                    {/* The same field the short project's image review uses. The Episode's narration regenerate
                        already accepted a direction, so this screen was one where the voice could be told what
                        to change and the picture could not. */}
                    <RegenerateInstructionField
                      id={`episode-image-regenerate-instruction-${sceneNumber}`}
                      value={regenerateInstruction}
                      onChange={setRegenerateInstruction}
                      disabled={regenerating}
                      subject="그림"
                      placeholder="예: 더 어둡게, 인물을 더 멀리서"
                      data-testid={`episode-image-regenerate-instruction-${sceneNumber}`}
                    />
                    <div className="flex gap-2">
                      <button type="button" className={smallOutlineButton} disabled={regenerating} onClick={() => { setRegenerateInstruction(""); setRegenerateConfirm(null); }}>취소</button>
                      <button type="button" className={smallAmberButton} disabled={regenerating} onClick={() => void confirmRegenerate(sceneNumber)}>이 장면 다시 만들기</button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          </div>
        </section>
      )}
      {episode?.status === "waiting_for_video_confirmation" && (
        <div className="space-y-2">
          <p data-testid="episode-video-confirmation-transition" className="text-sm text-emerald-400">{sceneNumbers.length}개 장면 이미지가 모두 승인되었습니다. 별도의 영상 확인 단계로 이어서 진행하세요.</p>
          {onOpenVideoWorkflow && <button type="button" data-testid="episode-open-video-workflow" className={outlineButton} onClick={() => onOpenVideoWorkflow(projectId, episodeNumber)}>에피소드 영상 작업 열기</button>}
        </div>
      )}
      {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
    </section>
  );
}
