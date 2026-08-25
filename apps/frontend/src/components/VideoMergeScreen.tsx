import { useEffect, useRef, useState } from "react";
import type { MergeVideosResponse } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";

import { getProject, getProjectSettings, toDisplayError } from "../api/projectsApi.js";
import { finalVideoContentUrl, mergeVideos, toVideoMergeDisplayError } from "../api/videoMergeApi.js";
import { hasElectronBridge, openProjectPathInExplorer } from "../api/electronBridge.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string };
type LoadState = { status: "loading" } | { status: "error"; error: DisplayError } | { status: "ready" };

/**
 * One sentence describing what this merge lays over the clips.
 *
 * Mirrors video-merge.service.ts. Two things matter, and only one of them is a setting:
 *  - Audio: a scene gets its narration audio whenever that file exists, full stop. The merge does not consult
 *    narrationEnabled, so turning narration off does not strip audio that was already made — the sentence
 *    therefore states the file rule, not the setting.
 *  - Subtitles: a scene gets a subtitle when subtitlesEnabled is on AND it has narration text, whether or not
 *    audio exists. Subtitles-only (no TTS spend) is a deliberate mode, so the copy must never tie subtitles to
 *    audio the way an earlier version of this screen did.
 *
 * Returns null when the settings could not be read: saying nothing beats promising something unconfirmed.
 */
function mergeContentSentence(subtitlesEnabled: boolean | null): string | null {
  if (subtitlesEnabled === null) return null;
  const audio = "음성을 만들어 둔 장면에는 그 음성이 입혀집니다.";
  return subtitlesEnabled
    ? `${audio} 내레이션 문장이 있는 장면에는 자막이 들어갑니다 — 음성이 아직 없는 장면에도 자막은 들어갑니다.`
    : `${audio} 자막은 넣지 않습니다.`;
}

export function VideoMergeScreen({ projectId, onBack }: Props) {
  const [loadState, setLoadState] = useState<LoadState>({ status: "loading" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [result, setResult] = useState<MergeVideosResponse | null>(null);
  const [openPending, setOpenPending] = useState(false);
  const [openFailed, setOpenFailed] = useState(false);
  const [sceneCount, setSceneCount] = useState<number | null>(null);
  /** null until the project settings load, and stays null if they fail — the copy then claims nothing. */
  const [subtitlesEnabled, setSubtitlesEnabled] = useState<boolean | null>(null);
  const busy = useRef(false);

  // A project that already finished merging (revisited later, e.g. from the dashboard) should
  // show its existing result immediately instead of offering to merge again from scratch.
  useEffect(() => {
    let cancelled = false;
    getProject(projectId)
      .then((response) => {
        if (cancelled) return;
        setSceneCount(response.project.scenes.length);
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
        setSubtitlesEnabled(settings.subtitlesEnabled);
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
    if (busy.current || result) return;
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
      const response = await mergeVideos(projectId);
      setResult(response);
      setConfirmOpen(false);
    } catch (caught) {
      setError(toVideoMergeDisplayError(caught));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  const contentSentence = mergeContentSentence(subtitlesEnabled);

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
        {sceneCount !== null ? ` ${sceneCount}개` : ""} 승인 장면 영상을 순서대로 이어 붙입니다.
        {contentSentence ? ` ${contentSentence}` : ""}
      </p>

      {!result && (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
            data-testid="open-merge-confirm-button"
            onClick={openConfirmation}
            disabled={confirmOpen || pending}
          >
            최종 영상으로 병합
          </button>

          {confirmOpen && (
            <div
              role="alertdialog"
              aria-label="최종 영상 병합 확인"
              data-testid="merge-confirm-panel"
              className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4"
            >
              <p className="text-sm font-semibold text-amber-300">
                {sceneCount !== null ? `${sceneCount}개 승인 장면 영상을` : "승인 장면 영상을"} 하나의 최종 영상으로 병합할까요?
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

      {result && (
        <div data-testid="merge-success" className="space-y-3 rounded-2xl border border-emerald-400/30 bg-slate-900/70 p-5">
          <p className="text-sm font-semibold text-emerald-400">
            최종 영상 병합이 완료되었습니다. 이 단계에서는 유료 요청이 전송되지 않았습니다.
          </p>
          <video
            src={finalVideoContentUrl(projectId)}
            data-testid="final-video-player"
            className="w-full max-w-sm rounded-xl border border-white/10 bg-slate-950/60"
            controls
          />
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
