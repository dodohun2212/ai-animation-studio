import { useRef, useState } from "react";
import type { MergeLongEpisodeVideosResponse } from "@ai-animation-studio/shared";

import { mergeLongEpisodeVideos, toLongProjectDisplayError } from "../api/longProjectsApi.js";

interface Props {
  projectId: string;
  episodeNumber: number;
  onBack: () => void;
  onOpenContinuity?: (projectId: string, episodeNumber: number) => void;
}

type DisplayError = { code: string; message: string };

/**
 * A long-form Episode always has exactly six scenes — unlike a short project, where the user picks the count.
 * This is a backend invariant, not an assumption: episode-scripts.service.ts rejects a script whose scenes are
 * not six, episode-video-merge.service.ts rejects review/record arrays that are not six, and the image, video,
 * mapping and continuity services all iterate a fixed [1..6]. longProjectsApi.ts's own isLongEpisodeScript
 * guard rejects any other length before a response ever reaches this screen, so reading the count back from the
 * Episode could only ever return six — or nothing at all when that request fails, which would drop a number
 * that is always correct. Stated directly for that reason; if Episodes ever become variable, this constant and
 * those services move together.
 */
const EPISODE_SCENE_COUNT = 6;

/** The explicit, final client gate for one Episode's already-approved videos. */
export function LongEpisodeVideoMergeScreen({ projectId, episodeNumber, onBack, onOpenContinuity }: Props) {
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<MergeLongEpisodeVideosResponse | null>(null);
  const [error, setError] = useState<DisplayError | null>(null);
  const busy = useRef(false);

  function openConfirmation(): void {
    if (busy.current || result) return;
    setError(null);
    setConfirmationOpen(true);
  }

  async function confirm(): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      setResult(await mergeLongEpisodeVideos(projectId, episodeNumber));
      setConfirmationOpen(false);
    } catch (caught) {
      setError(toLongProjectDisplayError(caught));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <section className="mt-8 max-w-2xl space-y-5" data-testid="episode-video-merge-screen">
      <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5" onClick={onBack}>
        에피소드 영상으로 돌아가기
      </button>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span
          aria-hidden="true"
          className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
        />
        에피소드 최종 영상
      </h2>
      <p className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300" data-testid="episode-merge-scope-notice">
        이 단계는 비용이 들지 않습니다 — 유료 요청 없이, 이 컴퓨터에 설치된 영상 병합 프로그램만 실행합니다. 승인된 에피소드
        장면 영상 {EPISODE_SCENE_COUNT}개를 순서대로 이어 붙여 최종 영상을 만듭니다.
      </p>
      {!result && (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
            data-testid="episode-open-merge-confirm"
            disabled={confirmationOpen || pending}
            onClick={openConfirmation}
          >
            최종 영상 만들기
          </button>
          {confirmationOpen && (
            <div role="alertdialog" aria-label="에피소드 최종 영상 확인" data-testid="episode-merge-confirm-panel" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
              <p className="text-sm text-slate-300">
                아직 시작되지 않았습니다. 확인을 눌러야 최종 영상 만들기가 시작됩니다. 유료 요청은 전송되지 않습니다.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50"
                  disabled={pending}
                  onClick={() => setConfirmationOpen(false)}
                >
                  돌아가기
                </button>
                <button
                  type="button"
                  className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50"
                  data-testid="episode-confirm-merge"
                  disabled={pending}
                  onClick={() => void confirm()}
                >
                  {pending ? "만드는 중..." : "네, 최종 영상을 만듭니다"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {error && (
        <p role="alert" data-testid="episode-merge-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.message}
        </p>
      )}
      {result && (
        <div data-testid="episode-merge-success" className="space-y-3 rounded-2xl border border-emerald-400/30 bg-slate-900/70 p-5">
          <p className="text-sm font-semibold text-emerald-400">에피소드 최종 영상이 완성되었습니다.</p>
          <p className="text-sm text-slate-300" data-testid="episode-final-video-path">최종 영상: {result.finalVideoPath}</p>
          {onOpenContinuity && (
            <button
              type="button"
              className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-200 hover:bg-white/5"
              data-testid="open-episode-continuity"
              onClick={() => onOpenContinuity(projectId, episodeNumber)}
            >
              연결 기억 검토하기
            </button>
          )}
        </div>
      )}
    </section>
  );
}
