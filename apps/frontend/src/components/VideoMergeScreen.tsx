import { useEffect, useRef, useState } from "react";
import type { AudioLibraryTrack, FrameFit, MergeAudioSettings, MergeVideosResponse, PhotoCardSubtitleLayout, SceneSubtitleLayout, VideoModel, VideoModelOption } from "@ai-animation-studio/shared";
import { DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT, DEFAULT_SCENE_SUBTITLE_LAYOUT, FINAL_VIDEO_RELATIVE_PATH, FRAME_FITS, VIDEO_MODEL_OPTIONS, WorkflowState } from "@ai-animation-studio/shared";
import { FRAME_FIT_NOTES } from "../utils/videoModelFacts.js";

import { getProject, getProjectSettings, toDisplayError } from "../api/projectsApi.js";
import { getAudioLibrary } from "../api/audioLibraryApi.js";
import type { AudioMode } from "./mergeAudio.js";
import { AttributionNotice, AUDIO_MODE_LABELS, MergeAudioFieldset, needsTrack, toAudioSettings } from "./mergeAudio.js";
import { finalVideoContentUrl, mergeVideos, toVideoMergeDisplayError } from "../api/videoMergeApi.js";
import { getVideoReview, sceneImageContentUrl } from "../api/videoWorkflowApi.js";
import { hasElectronBridge, openProjectPathInExplorer } from "../api/electronBridge.js";
import { PhotoCardSubtitleFieldset } from "./PhotoCardSubtitleFieldset.js";
import { SceneSubtitleFieldset, type SubtitledScene } from "./SceneSubtitleFieldset.js";
import { ScreenHeader } from "./ui/ScreenHeader.js";
import { FinalVideoGenerationSourceNotice } from "./GenerationSourceNotice.js";

interface Props {
  projectId: string;
  onBack: () => void;
  onOpenInstagramPost?: (projectId: string) => void;
}

type DisplayError = { code: string; message: string };
type LoadState = { status: "loading" } | { status: "error"; error: DisplayError } | { status: "ready" };

/** What the merge lays over the clips, as the two settings that decide it. */
/**
 * 이 릴의 클립들이 어떤 모양으로 나왔는지, 한 줄로.
 *
 * 🔴 모델이 하나면 문장은 `FRAME_FIT_NOTES` 에서 옵니다 — **틀 그대로 / 틀과 다름 / 확인 안 됨** 셋을 그
 * 표가 가릅니다. 여기서 참/거짓으로 접으면 안 재 본 모델에 대해 「띠가 남습니다」라고 단정하게 됩니다.
 *
 * 🔴 모델이 **섞여 있으면** 일부 클립에만 띠가 생깁니다 — 설정을 바꾼 뒤 일부 장면만 다시 만들면 실제로
 * 일어나는 상태이고, 그때는 「생깁니다」도 「안 생깁니다」도 둘 다 거짓입니다.
 *
 * 🔴 카탈로그가 모르는 이름이 하나라도 있으면 아무 말도 하지 않습니다. `videoModelOption` 은 모르는 이름에
 * 던지므로 쓰지 않고(그 던짐은 값 계산에서 옳습니다), 여기서는 조용히 비켜섭니다.
 */
function frameNoteFor(models: readonly VideoModel[]): { text: string; bars: boolean } | null {
  if (models.length === 0) return null;
  const options = models.map((id) => VIDEO_MODEL_OPTIONS.find((option) => option.id === id));
  if (options.some((option) => option === undefined)) return null;
  const known = options as VideoModelOption[];
  const names = known.map((option) => option.label).join(" · ");
  if (known.length > 1) {
    return { text: `이 릴의 클립은 서로 다른 모델로 만들어졌습니다(${names}) — 일부 클립에만 띠가 생길 수 있습니다.`, bars: true };
  }
  const note = FRAME_FIT_NOTES[known[0]!.frameShape];
  return { text: `이 릴의 클립은 ${names}로 만들어졌고 ${note.text}`, bars: note.bars };
}

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

export function VideoMergeScreen({ projectId, onBack, onOpenInstagramPost }: Props) {
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
  /**
   * The same two numbers for an ordinary reel, and a separate field on purpose.
   *
   * A card layout centres at 0.40; a scene layout at 0.78. They are the same SHAPE, so one field carrying both
   * would type-check while putting a scene's subtitle in the middle of moving footage — a value nobody asked
   * for. The server keeps them apart the same way and answers with `undefined` rather than the other one's
   * numbers if this screen ever read the wrong side (CLI Round 665 ⑥).
   */
  const [sceneLayout, setSceneLayout] = useState<SceneSubtitleLayout>(DEFAULT_SCENE_SUBTITLE_LAYOUT);
  /**
   * Every scene that will actually carry a subtitle, with the line it carries.
   *
   * Not just the first: the layout is one setting applied to all of them, and the longest sentence is the one
   * that runs off the frame. A scene with no narration gets no subtitle, so it is left out rather than
   * previewed as an empty block.
   */
  const [subtitledScenes, setSubtitledScenes] = useState<SubtitledScene[]>([]);
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
  /* 기본값은 「여백」 — 캡틴D 가 고르기 전까지 결과가 지금과 같아야 합니다. 저장되는 값이 아니라 이 렌더
     한 번에 대한 선택이라, 화면을 떠나면 다시 기본값입니다(계약의 `frameFit` 주석 그대로).

     🔴 「여백」일 때는 칸을 **안 보냅니다.** 계약이 「생략 = pad」라고 적었으니 보내나 마나 결과는 같은데,
     안 보내면 오늘까지의 요청과 **바이트가 같습니다** — 이 파일의 `audio`·`subtitleLayout` 이 이미 그 규칙을
     따릅니다(「사람에게 실제로 물어본 호출만 보낸다」). 덕분에 지금 있는 병합 짝들이 본문을 통째로 비교해도
     그대로 참이고, 새 칸이 생겼다는 이유만으로 다른 화면의 짝을 고치지 않아도 됩니다. */
  const [frameFit, setFrameFit] = useState<FrameFit>("pad");
  /* 클립을 **만든** 모델들 — 오늘 설정이 아니라 작업 기록에서(`VideoReview.model`, CLI Round 813). 둘은 다를 수
     있고, 띠를 만드는 것은 설정이 아니라 이미 만들어진 클립입니다. 여러 개인 것도 실제 상태입니다: 설정을
     바꾼 뒤 일부 장면만 다시 만들면 한 릴 안에 모양이 다른 클립이 섞입니다. */
  const [clipModels, setClipModels] = useState<VideoModel[]>([]);
  const [audioMode, setAudioMode] = useState<AudioMode | null>(null);
  const [tracks, setTracks] = useState<AudioLibraryTrack[]>([]);
  const [trackId, setTrackId] = useState("");
  /** Where in the chosen track the music starts. 0 is the beginning, which is also what the server does with no value. */
  const [audioStartSeconds, setAudioStartSeconds] = useState(0);
  /** null is "untouched" — the server owns both defaults, so an untouched field is not sent. See toAudioSettings. */
  const [bgmVolumePercent, setBgmVolumePercent] = useState<number | null>(null);
  const [bgmFadeSeconds, setBgmFadeSeconds] = useState<number | null>(null);
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
            .then((review) => {
              if (cancelled) return;
              setApprovedCount(review.reviews.filter((one) => one.status === "approved").length);
              setClipModels([...new Set(review.reviews.map((one) => one.model).filter((model): model is VideoModel => model !== undefined))]);
            })
            .catch(() => { /* Unknown, which is what approvedCount already is. */ });
        }
        setPhotoCard(response.project.photoCard === true);
        if (response.project.subtitleLayout) setLayout(response.project.subtitleLayout);
        if (response.project.sceneSubtitleLayout) setSceneLayout(response.project.sceneSubtitleLayout);
        setQuote(response.project.scenes[0]?.narration ?? "");
        setSubtitledScenes(
          response.project.scenes
            .map((scene) => ({ number: scene.number, text: (scene.narration ?? "").trim() }))
            .filter((scene) => scene.text.length > 0),
        );
        setAspectVertical(response.project.aspectRatio !== "16:9");
        setPublished(Boolean(response.project.instagramPost));
        // Derived, not assumed: a project that never generated narration cannot merge "narration only", and
        // defaulting to it would label a silent video as a narrated one (docs/06_DECISIONS.md D-011).
        setNarrationAvailable(response.project.narrationAvailable);
        setAudioMode(response.project.narrationAvailable ? "narration" : "silent");
        if (response.project.workflowState === WorkflowState.Completed && response.project.finalVideoPath === FINAL_VIDEO_RELATIVE_PATH) {
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
      const response = await mergeVideos(projectId, audioSettings ?? undefined, photoCard ? layout : undefined, sceneSubtitleAdjustable ? sceneLayout : undefined, photoCard || frameFit === "pad" ? undefined : frameFit);
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

  /**
   * Whether this merge has scene subtitles to place at all — the one condition for both offering the control
   * and sending its numbers.
   *
   * 🔴 Both, deliberately. Sending a layout for a merge that burns no text in would store a chosen position for
   * something never drawn, and the value is stored precisely because it is what a real video was made with. A
   * project with subtitles turned off still carries narration text it will not burn in, so "has narration" is
   * not the question; "will any of it appear" is.
   */
  const sceneSubtitleAdjustable = !photoCard && subtitledScenes.length > 0 && mediaMode?.subtitlesEnabled === true;
  const contentSentence = mergeContentSentence(mediaMode);
  /* Only blocks on a count we actually read. Unknown stays unblocked — the server refuses either way, and a
     button disabled on a guess is worse than one that fails honestly. Same rule as the Episode's merge. */
  const blocked = !photoCard && approvedCount !== null && sceneCount !== null && approvedCount < sceneCount;
  /** Null until the project has loaded — merging before then would send a mode derived from nothing. */
  const audioSettings: MergeAudioSettings | null = toAudioSettings(audioMode, trackId, audioStartSeconds, bgmVolumePercent, bgmFadeSeconds);
  const modeUnready = audioMode !== null && needsTrack(audioMode) && !trackId;
  const clipFrameNote = frameNoteFor(clipModels);

  return (
    <section className="mt-8 max-w-2xl space-y-5">
      <ScreenHeader title="최종 영상 병합" backLabel="프로젝트로 돌아가기" onBack={onBack} />
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

      {/* The scene half of the same control. Gated on there being a subtitle at all: a project merged with
          subtitles off carries narration text it will not burn in, and offering to place text that will not
          appear is the same failure as hiding text that will. */}
      {(!result || remaking) && sceneSubtitleAdjustable && (
        <SceneSubtitleFieldset
          previewImageUrl={(sceneNumber) => sceneImageContentUrl(projectId, sceneNumber)}
          scenes={subtitledScenes}
          vertical={aspectVertical}
          layout={sceneLayout}
          onChange={setSceneLayout}
          disabled={pending || confirmOpen}
        />
      )}

      {/* 🔴 2026-09-13 에 완성된 첫 릴 위아래에 검은 띠가 붙었습니다. 원인은 병합이 아니라 모델입니다 —
          클립이 릴 틀과 다른 모양으로 오고(h3_max_768p 는 장면 그림의 2:3 을 그대로 내보냅니다), 병합은
          그 모양을 틀 안에 넣느라 여백을 붙였습니다. 잘라 채우면 **어느 모델을 골랐든** 띠가 없어집니다.

          🔴 여기서 「지금 고른 모델」을 읽어 문장을 쓰지 않습니다. 띠를 만드는 것은 설정이 아니라 **이미
          만들어진 클립**이고, 둘은 다를 수 있습니다 — 같은 날 저는 확인 화면의 설정을 읽고 이 릴이 무엇으로
          나갔는지 틀리게 보고했습니다(CLI Round 809 · F5). 그래서 두 줄은 모델과 무관하게 참인 말만 합니다.

          포토카드는 틀에 맞춰 그려지므로 선택이 아무것도 바꾸지 않고, 서버도 거절합니다 — 그래서 숨깁니다. */}
      {(!result || remaking) && !photoCard && (
        <fieldset data-testid="merge-frame-fit" className="space-y-2 rounded-2xl border border-white/10 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-4">
          <legend className="px-1 text-sm font-semibold text-slate-100">화면 맞춤</legend>
          {FRAME_FITS.map((value) => (
            <label key={value} className="flex cursor-pointer items-start gap-2.5 text-sm text-slate-300">
              <input
                type="radio"
                name="merge-frame-fit"
                className="mt-1"
                value={value}
                checked={frameFit === value}
                disabled={pending || confirmOpen}
                onChange={() => setFrameFit(value)}
                data-testid={`merge-frame-fit-${value}`}
              />
              <span>
                <span className="block text-slate-100">{value === "pad" ? "여백 두기" : "꽉 채우기"}</span>
                <span className="block text-xs text-slate-400">
                  {value === "pad"
                    ? "클립이 릴 틀과 다른 모양이면 빈 자리에 검은 띠가 남습니다 — 지금까지의 결과입니다."
                    : aspectVertical
                      ? "띠 없이 틀을 채우고, 대신 좌우 가장자리가 조금 잘립니다."
                      : "띠 없이 틀을 채우고, 대신 위아래 가장자리가 조금 잘립니다."}
                </span>
              </span>
            </label>
          ))}
          {/* 🔴 「지금 고른 모델」이 아니라 **이 클립들을 만든 모델**입니다. 같은 날 저는 확인 화면의 설정을 읽고
              이 릴이 무엇으로 나갔는지 틀리게 보고했습니다(CLI Round 809 · F5) — 설정과 클립은 다를 수 있고,
              띠를 만드는 쪽은 클립입니다. 카탈로그가 모르는 이름이 하나라도 섞이면 아무 말도 하지 않습니다:
              모르는 모델의 모양을 아는 척하는 것이 「모른다」보다 나쁩니다. */}
          {clipFrameNote && (
            <p data-testid="merge-frame-fit-clip-models" className={`text-xs ${clipFrameNote.bars ? "text-amber-300/90" : "text-slate-400"}`}>
              {clipFrameNote.text}
            </p>
          )}
        </fieldset>
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
          volumePercent={bgmVolumePercent}
          onVolumePercentChange={setBgmVolumePercent}
          fadeSeconds={bgmFadeSeconds}
          onFadeSecondsChange={setBgmFadeSeconds}
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
              className="space-y-3 rounded-xl border border-amber-400/40 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-4"
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
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
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
        <div data-testid="merge-success" className="space-y-3 rounded-2xl border border-emerald-400/30 bg-gradient-to-b from-slate-900/80 to-slate-900/55 p-5">
          <p className="text-sm font-semibold text-emerald-400">
            최종 영상 병합이 완료되었습니다. 이 단계에서는 유료 요청이 전송되지 않았습니다.
          </p>
          <AttributionNotice usedAudio={result.project.usedAudio} />
          <FinalVideoGenerationSourceNotice source={result.project.finalVideoGenerationSource} testId="final-video-generation-source-notice" />
          {unplayable ? (
            <p data-testid="final-video-missing" className="rounded-xl border border-amber-400/30 bg-amber-500/[0.06] px-3 py-2 text-sm text-amber-200">
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
          {onOpenInstagramPost && (
            <button
              type="button"
              data-testid="open-instagram-post"
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5"
              onClick={() => onOpenInstagramPost(projectId)}
            >
              게시물 준비로
            </button>
          )}
          {hasElectronBridge() && (
            <div className="flex items-center gap-3">
              <button
                type="button"
                data-testid="open-in-explorer-button"
                className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
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
