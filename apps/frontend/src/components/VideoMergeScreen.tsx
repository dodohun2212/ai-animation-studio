import { useEffect, useRef, useState } from "react";
import type { AudioLibraryTrack, MergeAudioSettings, MergeVideosResponse, PhotoCardSubtitleLayout } from "@ai-animation-studio/shared";
import { DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT, WorkflowState } from "@ai-animation-studio/shared";

import { getProject, getProjectSettings, toDisplayError } from "../api/projectsApi.js";
import { getAudioLibrary } from "../api/audioLibraryApi.js";
import type { AudioMode } from "./mergeAudio.js";
import { AttributionNotice, AUDIO_MODE_LABELS, MergeAudioFieldset, needsTrack, toAudioSettings } from "./mergeAudio.js";
import { finalVideoContentUrl, mergeVideos, toVideoMergeDisplayError } from "../api/videoMergeApi.js";
import { getVideoReview } from "../api/videoWorkflowApi.js";
import { hasElectronBridge, openProjectPathInExplorer } from "../api/electronBridge.js";
import { PhotoCardSubtitleFieldset } from "./PhotoCardSubtitleFieldset.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string };
type LoadState = { status: "loading" } | { status: "error"; error: DisplayError } | { status: "ready" };

/** What the merge lays over the clips, as the two settings that decide it. */
interface MediaMode {
  narrationEnabled: boolean;
  subtitlesEnabled: boolean;
}

/**
 * One sentence describing what this merge lays over the clips.
 *
 * Mirrors video-merge.service.ts, where both halves are now gated the same way — "off" means "not used",
 * not "not made again": audio goes on only when narrationEnabled is on AND that scene's file exists, and a
 * subtitle goes on only when subtitlesEnabled is on AND that scene has narration text. The two are otherwise
 * independent, so subtitles-only (no TTS spend) is a real mode and the copy must never tie a subtitle to the
 * presence of audio.
 *
 * Returns null when the settings could not be read: saying nothing beats promising something unconfirmed.
 */
function mergeContentSentence(mode: MediaMode | null): string | null {
  if (!mode) return null;
  if (mode.narrationEnabled && mode.subtitlesEnabled) {
    return "음성을 만들어 둔 장면에는 그 음성이 입혀지고, 내레이션 문장이 있는 장면에는 자막이 들어갑니다 — 음성이 아직 없는 장면에도 자막은 들어갑니다.";
  }
  if (mode.subtitlesEnabled) {
    return "음성은 꺼져 있어 넣지 않습니다. 내레이션 문장이 있는 장면에 자막만 입힙니다.";
  }
  if (mode.narrationEnabled) {
    return "음성을 만들어 둔 장면에는 그 음성이 입혀지고, 자막은 넣지 않습니다.";
  }
  return "음성도 자막도 꺼져 있어 장면 영상만 이어 붙입니다.";
}

export function VideoMergeScreen({ projectId, onBack }: Props) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [result, setResult] = useState<MergeVideosResponse | null>(null);
  const [openPending, setOpenPending] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  /* The content route refuses a file at or below placeholder size, so a merge of stubs fails to load rather
     than showing a black box that claims to be the finished video — the Episode player says this already. */
  const [unplayable, setUnplayable] = useState(false);
  const [sceneCount, setSceneCount] = useState<number | null>(null);
  /** How many of them are actually confirmed. Null until the project loads — see `blocked` for why that matters. */
  const [approvedCount, setApprovedCount] = useState<number | null>(null);
  /**
   * A photo card, which has no scene videos and never will.
   *
   * The card is one picture the person already had; the merge reads that picture directly — video-merge
   * .service.ts's mergeMaterial() branches on exactly this and never opens an approved-reviews file. This
   * screen did not know that, so it counted scene videos, found 0 of 1 confirmed, and disabled the only
   * button on a card the server would have merged. There was no way out of it either: "confirming" a scene
   * video means generating one, and generating one costs money — on the one feature built to cost nothing.
   */
  const [photoCard, setPhotoCard] = useState(false);
  /**
   * The card's own subtitle size and height, and the line they lay out.
   *
   * Both start from the server: a card always comes back carrying a layout (the default filled in when nobody
   * has chosen one), so there is no "unset" state here to guess at. The quote is the scene's narration, which
   * is the exact string the renderer burns in — newlines and all, since the first one is what splits the
   * 사자성어 line from the rest.
   */
  const [layout, setLayout] = useState<PhotoCardSubtitleLayout>(DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT);
  const [quote, setQuote] = useState("");
  /** The frame's shape, read from the project's one `aspectRatio` field rather than assumed — the preview box has to match the video it previews. */
  const [aspectVertical, setAspectVertical] = useState(true);
  /**
   * Whether this card is already out on Instagram, and whether the person has asked to make it again.
   *
   * A card can be merged again — that is the only way to change its subtitles, and there is no paid work or
   * approval behind the old file to protect (CLI Round 441 opened the route; the previous video is archived).
   * A *published* card cannot: the post's video would quietly become a different video, with nothing on either
   * side recording that it had changed. The way out of that one is a new card, and the copy says so.
   */
  const [published, setPublished] = useState(false);
  /** Set only by the person pressing "다시 만들기" — the finished result stays on screen until they do. */
  const [remaking, setRemaking] = useState(false);
  /** null until the project settings load, and stays null if they fail — the copy then claims nothing. */
  const [mediaMode, setMediaMode] = useState<MediaMode | null>(null);
  /** null until the project loads: the default mode is derived from what this project actually has, never assumed. */
  const [narrationAvailable, setNarrationAvailable] = useState<boolean | null>(null);
  const [audioMode, setAudioMode] = useState<AudioMode | null>(null);
  const [tracks, setTracks] = useState<AudioLibraryTrack[]>([]);
  const [trackId, setTrackId] = useState("");
  /** Where in the chosen track the music starts. 0 is the beginning, which is also what the server does with no value. */
  const [audioStartSeconds, setAudioStartSeconds] = useState(0);
  const busy = useRef(false);

  // A project that already finished merging (revisited later, e.g. from the dashboard) should
  // show its existing result immediately instead of offering to merge again from scratch.
  useEffect(() => {
    let cancelled = false;
    getProject(projectId)
      .then((response) => {
        if (cancelled) return;
        setSceneCount(response.project.scenes.length);
        /*
         * The confirmed count comes from the video review, which is addressed by job id — the Episode screen's
         * own design (LongEpisodeVideoMergeScreen), and now this one's.
         *
         * It used to be counted off `scene.videoReview`, and that field has never existed: `project.mapper.ts`
         * spreads the stored scene and asserts `as unknown as Scene`, so two required fields nothing writes were
         * read as answers. Every scene came back `undefined`, `undefined !== "approved"` counted as unconfirmed,
         * and 이배드의 탄생 — COMPLETED, six videos and a final file on disk — was told 장면 6개 중 0개 확정됨 and
         * sent to go and confirm the work whose finished path was printed in the same panel.
         *
         * Null on anything but an answer, and deliberately quiet: a finished project's review is refused
         * (VIDEO_WORKFLOW_NOT_ALLOWED — there is nothing left to confirm), which is an ordinary answer to the
         * question and not this screen failing. `blocked` below already says what to do with an unknown count:
         * leave it unblocked, the server is still the real gate.
         */
        const jobId = response.project.currentVideoJobId;
        if (jobId) {
          void getVideoReview(projectId, jobId)
            .then((review) => { if (!cancelled) setApprovedCount(review.reviews.filter((one) => one.status === "approved").length); })
            .catch(() => { /* Unknown, which is what approvedCount already is. */ });
        }
        setPhotoCard(response.project.photoCard === true);
        if (response.project.subtitleLayout) setLayout(response.project.subtitleLayout);
        setQuote(response.project.scenes[0]?.narration ?? "");
        setAspectVertical(response.project.aspectRatio !== "16:9");
        setPublished(Boolean(response.project.instagramPost));
        // Derived, not assumed: a project that never generated narration cannot merge "narration only", and
        // defaulting to it would label a silent video as a narrated one (docs/06_DECISIONS.md D-011).
        setNarrationAvailable(response.project.narrationAvailable);
        setAudioMode(response.project.narrationAvailable ? "narration" : "silent");
        if (response.project.workflowState === WorkflowState.Completed && response.project.finalVideoPath === "videos/final/instagram_reel.mp4") {
          setResult({ project: response.project, finalVideoPath: response.project.finalVideoPath });
        }
        setLoadState({ status: "ready" });
      })
      .catch((caught: unknown) => {
        if (!cancelled) setLoadState({ status: "error", error: toDisplayError(caught) });
      });
    // What gets laid over the clips only changes this screen's wording, so a failure here is not fatal:
    // the sentence is dropped rather than guessed at.
    getProjectSettings(projectId)
      .then(({ settings }) => {
        if (cancelled) return;
        setMediaMode({ narrationEnabled: settings.narrationEnabled, subtitlesEnabled: settings.subtitlesEnabled });
      })
      .catch(() => {});
    // An empty library simply means the bgm option stays unavailable — never a reason to block merging.
    getAudioLibrary()
      .then((response) => {
        if (!cancelled) setTracks(response.tracks);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function openInExplorer(): Promise<void> {
    if (openPending || !result) return;
    setOpenPending(true);
    setOpenFailed(false);
    try {
      const outcome = await openProjectPathInExplorer(projectId, result.finalVideoPath);
      if (!outcome?.opened) setOpenFailed(true);
    } catch {
      setOpenFailed(true);
    } finally {
      setOpenPending(false);
    }
  }

  /** Opens the explicit confirmation panel. Never calls the network by itself. */
  function openConfirmation(): void {
    if (busy.current || (result && !remaking) || blocked) return;
    setError(null);
    setConfirmOpen(true);
  }

  function cancelConfirmation(): void {
    if (busy.current) return;
    setConfirmOpen(false);
  }

  async function confirmMerge(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      const response = await mergeVideos(projectId, audioSettings ?? undefined, photoCard ? layout : undefined);
      setResult(response);
      // Back to showing the finished video: the request the button existed for has been made.
      setRemaking(false);
      setUnplayable(false);
      setConfirmOpen(false);
    } catch (caught) {
      setError(toVideoMergeDisplayError(caught));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const contentSentence = mergeContentSentence(mediaMode);
  /* Only blocks on a count we actually read. Unknown stays unblocked — the server refuses either way, and a
     button disabled on a guess is worse than one that fails honestly. Same rule as the Episode's merge. */
  const blocked = !photoCard && approvedCount !== null && sceneCount !== null && approvedCount < sceneCount;
  /** Null until the project has loaded — merging before then would send a mode derived from nothing. */
  const audioSettings: MergeAudioSettings | null = toAudioSettings(audioMode, trackId, audioStartSeconds);
  const modeUnready = audioMode !== null && needsTrack(audioMode) && !trackId;

  return (
    <section className="mt-8 max-w-2xl space-y-5">
      <button
        type="button"
        className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
        onClick={onBack}
      >
        프로젝트로 돌아가기
      </button>
      <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        최종 영상 병합
      </h1>
      <p className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300" data-testid="merge-scope-notice">
        이 단계는 비용이 들지 않습니다 — 유료 요청 없이, 이 컴퓨터에 설치된 영상 병합 프로그램만 실행합니다.
        {photoCard
          ? " 고른 그림 한 장을 정해 둔 길이만큼 하나의 영상으로 만듭니다."
          : `${approvedCount !== null ? ` 확정된 ${approvedCount}개` : ""} 장면 영상을 순서대로 이어 붙입니다.`}
        {contentSentence ? ` ${contentSentence}` : ""}
      </p>

      {/* Written since this screen was made and never read, so a failed project read rendered the whole merge
          UI as if it had loaded: no spinner, no error, and 확정 counts sitting at null. The person then pressed
          병합 and got the server's refusal instead of the sentence saying the screen had not managed to read
          the project. The sibling Episode screen has no such state at all — this was vestigial, not a pattern. */}
      {loadState.status === "loading" && <p data-testid="merge-loading" className="text-sm text-slate-400">프로젝트를 불러오는 중...</p>}
      {loadState.status === "error" && (
        <p role="alert" data-testid="merge-load-error" data-error-code={loadState.error.code} className="text-sm text-rose-400">
          {loadState.error.message}
        </p>
      )}

      {!photoCard && approvedCount !== null && sceneCount !== null && (
        <p className="text-sm text-slate-300 tabular-nums" data-testid="merge-approved-count">
          장면 {sceneCount}개 중 <strong className="text-slate-100">{approvedCount}개 확정됨</strong>
        </p>
      )}
      {blocked && approvedCount !== null && sceneCount !== null && (
        /* Named before the button is reached, not after the server refuses — the person can go back and
           confirm the rest instead of reading an error they did not cause. */
        <p role="status" data-testid="merge-blocked" className="rounded-xl border border-amber-400/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
          아직 확정하지 않은 장면이 {sceneCount - approvedCount}개 있습니다. 장면 영상 화면에서 모두 확정한 뒤에 최종 영상을 만들 수 있습니다.
        </p>
      )}

      {(!result || remaking) && photoCard && quote.length > 0 && (
        <PhotoCardSubtitleFieldset
          projectId={projectId}
          quote={quote}
          vertical={aspectVertical}
          layout={layout}
          onChange={setLayout}
          disabled={pending || confirmOpen}
        />
      )}

      {(!result || remaking) && audioMode !== null && (
        <MergeAudioFieldset
          idPrefix="merge-audio"
          tracks={tracks}
          narrationAvailable={narrationAvailable}
          mode={audioMode}
          onModeChange={setAudioMode}
          trackId={trackId}
          onTrackChange={setTrackId}
          startSeconds={audioStartSeconds}
          onStartSecondsChange={setAudioStartSeconds}
          disabled={pending || confirmOpen}
        />
      )}

      {(!result || remaking) && (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
            data-testid="open-merge-confirm-button"
            onClick={openConfirmation}
            disabled={confirmOpen || pending || blocked || modeUnready}
          >
            {audioMode ? `${AUDIO_MODE_LABELS[audioMode]}으로 병합` : "최종 영상으로 병합"}
          </button>
          {modeUnready && (
            <p data-testid="merge-audio-track-required" className="text-xs text-amber-300">
              배경음악을 고르면 병합할 수 있습니다.
            </p>
          )}

          {confirmOpen && (
            <div
              role="alertdialog"
              aria-label="최종 영상 병합 확인"
              data-testid="merge-confirm-panel"
              className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4"
            >
              <p className="text-sm font-semibold text-amber-300">
                {photoCard
                  ? "고른 그림을"
                  : approvedCount !== null
                    ? `확정된 ${approvedCount}개 장면 영상을`
                    : "확정된 장면 영상을"} 하나의 최종 영상으로 병합할까요?
              </p>
              <p className="text-sm text-slate-300">
                아직 병합이 시작되지 않았습니다. 확인을 누르면 이 컴퓨터의 영상 병합 프로그램이 실행됩니다.
                {contentSentence ? ` ${contentSentence}` : ""} 유료 요청은 전송되지 않습니다.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
                  data-testid="cancel-merge-button"
                  onClick={cancelConfirmation}
                  disabled={pending}
                >
                  돌아가기
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                  data-testid="confirm-merge-button"
                  onClick={() => void confirmMerge()}
                  disabled={pending}
                >
                  {pending ? "병합 중..." : "네, 병합합니다"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" data-testid="merge-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}

      {result && photoCard && !remaking && !published && (
        /* The only way to change a card's subtitles, and it has to be here: the person finds out the text sits
           too low by looking at the finished video, which is this screen. */
        <div className="space-y-2">
          <button
            type="button"
            data-testid="photo-card-remake"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
            onClick={() => { setRemaking(true); setError(null); }}
          >
            자막 고쳐서 다시 만들기
          </button>
          <p className="text-xs text-slate-500">지금 영상은 보관되고, 새로 만든 것이 최종 영상이 됩니다. 비용은 들지 않습니다.</p>
        </div>
      )}
      {result && photoCard && published && (
        <p data-testid="photo-card-remake-published" className="rounded-xl border border-amber-400/30 bg-amber-500/[0.06] px-4 py-3 text-sm text-amber-200">
          이 카드는 이미 인스타그램에 올렸기 때문에 다시 만들 수 없습니다. 올라간 게시물의 영상이 소리 없이 다른 영상으로 바뀌기 때문입니다. 자막을 고치시려면 카드를 새 이름으로 만들어 주세요.
        </p>
      )}

      {result && (
        <div data-testid="merge-success" className="space-y-3 rounded-2xl border border-emerald-400/30 bg-slate-900/70 p-5">
          <p className="text-sm font-semibold text-emerald-400">
            최종 영상 병합이 완료되었습니다. 이 단계에서는 유료 요청이 전송되지 않았습니다.
          </p>
          <AttributionNotice usedAudio={result.project.usedAudio} />
          {unplayable ? (
            <p data-testid="final-video-missing" className="rounded-lg border border-amber-400/30 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-200">
              최종 영상 파일을 재생할 수 없습니다. 장면 영상 중에 내용이 비어 있는 것이 섞여 있을 수 있습니다 — 장면 영상 화면에서 하나씩 재생해 확인해 주세요.
            </p>
          ) : (
            <video
              /* Busted on the project's updatedAt: the merged file keeps one address across a re-merge, so
                 without this the browser replays the previous cut and the person concludes nothing happened. */
              src={finalVideoContentUrl(projectId, result.project.updatedAt)}
              data-testid="final-video-player"
              className="w-full max-w-sm rounded-xl border border-white/10 bg-slate-950/60"
              controls
              preload="metadata"
              onError={() => setUnplayable(true)}
            />
          )}
          <p className="text-sm text-slate-300" data-testid="final-video-path">
            저장 위치: {result.finalVideoPath}
          </p>
          {hasElectronBridge() && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="open-in-explorer-button"
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5 disabled:opacity-50"
                onClick={() => void openInExplorer()}
                disabled={openPending}
              >
                {openPending ? "여는 중..." : "탐색기에서 열기"}
              </button>
              {openFailed && (
                <p role="alert" data-testid="open-in-explorer-error" className="text-sm text-rose-400">
                  폴더를 열지 못했습니다.
                </p>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
