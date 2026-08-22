import { useRef, useState } from "react";
import type { MergeVideosResponse } from "@ai-animation-studio/shared";

import { mergeVideos, toVideoMergeDisplayError } from "../api/videoMergeApi.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string };

export function VideoMergeScreen({ projectId, onBack }: Props) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [result, setResult] = useState<MergeVideosResponse | null>(null);
  const busy = useRef(false);

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

  return (
    <section className="mt-8 space-y-4">
      <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>
        프로젝트로 돌아가기
      </button>
      <h2 className="text-xl font-semibold">최종 영상 병합</h2>
      <p className="text-sm text-amber-300" data-testid="no-provider-notice">
        실제 유료 Runway나 OpenAI Provider를 호출하지 않습니다. 이 컴퓨터에 설치된 로컬 영상 병합 프로그램만 실행해
        6개 승인 장면 영상을 순서대로 이어 붙입니다.
      </p>

      {!result && (
        <div className="space-y-3">
          <button
            type="button"
            className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
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
              className="space-y-3 rounded-lg border border-amber-400/40 bg-slate-900 p-4"
            >
              <p className="text-sm font-semibold text-amber-300">
                6개 승인 장면 영상을 하나의 최종 영상으로 병합할까요?
              </p>
              <p className="text-sm text-slate-300">
                아직 병합이 시작되지 않았습니다. 확인을 누르면 로컬 영상 병합 프로그램이 실행되며, 실제 유료
                Provider 요청은 전송되지 않습니다.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
                  data-testid="cancel-merge-button"
                  onClick={cancelConfirmation}
                  disabled={pending}
                >
                  돌아가기
                </button>
                <button
                  type="button"
                  className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  data-testid="confirm-merge-button"
                  onClick={() => void confirmMerge()}
                  disabled={pending}
                >
                  {pending ? "병합 중..." : "네, 로컬로 병합합니다"}
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
        <div data-testid="merge-success" className="space-y-2 rounded-lg border border-emerald-400/30 bg-slate-900 p-4">
          <p className="text-sm font-semibold text-emerald-400">
            최종 영상 병합이 완료되었습니다. 실제 유료 Provider 요청은 전송되지 않았습니다.
          </p>
          <p className="text-sm text-slate-300" data-testid="final-video-path">
            저장 위치: {result.finalVideoPath}
          </p>
        </div>
      )}
    </section>
  );
}
