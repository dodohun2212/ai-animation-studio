import { useEffect, useRef, useState } from "react";
import type { SceneNumber, VideoPromptPreview } from "@ai-animation-studio/shared";

import { getVideoPromptPreview, toVideoPreviewDisplayError } from "../api/videoPreviewApi.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string };

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "ready"; previews: VideoPromptPreview[] };

const PROMPT_UTF16_LIMIT = 1000;

/** JavaScript string length already counts UTF-16 code units, matching the Backend's limit. */
function utf16Length(value: string): number {
  return value.length;
}

export function VideoPromptPreviewScreen({ projectId, onBack }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [editedPrompts, setEditedPrompts] = useState<Partial<Record<SceneNumber, string>>>({});
  const loadRequest = useRef(0);

  async function load(): Promise<void> {
    const requestId = ++loadRequest.current;
    setState({ status: "loading" });
    try {
      const response = await getVideoPromptPreview(projectId);
      if (requestId !== loadRequest.current) return;
      setState({ status: "ready", previews: response.previews });
      setEditedPrompts(Object.fromEntries(response.previews.map((preview) => [preview.sceneNumber, preview.prompt])));
    } catch (caught) {
      if (requestId !== loadRequest.current) return;
      setState({ status: "error", error: toVideoPreviewDisplayError(caught) });
    }
  }

  useEffect(() => {
    void load();
  }, [projectId]);

  function promptFor(preview: VideoPromptPreview): string {
    return editedPrompts[preview.sceneNumber] ?? preview.prompt;
  }

  /** Edits stay in local component state only — never sent to the Backend or persisted. */
  function updatePrompt(sceneNumber: SceneNumber, value: string): void {
    setEditedPrompts((current) => ({ ...current, [sceneNumber]: value }));
  }

  const previews = state.status === "ready" ? state.previews : [];
  const totalCostUsd = previews.reduce((sum, preview) => sum + preview.estimatedCostUsd, 0);

  return (
    <section className="mt-8 space-y-4">
      <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>
        프로젝트로 돌아가기
      </button>
      <h2 className="text-xl font-semibold">영상 프롬프트 및 비용 확인</h2>
      <p className="text-sm text-amber-300" data-testid="no-provider-notice">
        실제 유료 Runway API를 호출하지 않습니다. 아래 수정 내용은 이 화면에만 유지되며 저장되지 않습니다.
      </p>

      {state.status === "loading" && <p className="text-slate-400">미리보기를 불러오는 중...</p>}
      {state.status === "error" && (
        <div className="space-y-2">
          <p role="alert" data-testid="preview-error" data-error-code={state.error.code} className="text-sm text-rose-400">
            {state.error.message}
          </p>
          <button
            type="button"
            className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300"
            onClick={() => void load()}
          >
            다시 시도
          </button>
        </div>
      )}

      {state.status === "ready" && previews.length > 0 && (
        <>
          <p className="text-sm text-slate-400" data-testid="preview-summary">
            모델: {previews[0]!.model} · 비율: {previews[0]!.ratio} · 장면당 길이: {previews[0]!.durationSeconds}초
          </p>
          <ul className="space-y-4" data-testid="preview-list">
            {previews.map((preview) => {
              const promptText = promptFor(preview);
              const length = utf16Length(promptText);
              const overLimit = length > PROMPT_UTF16_LIMIT;
              return (
                <li
                  key={preview.sceneNumber}
                  data-testid={`preview-${preview.sceneNumber}`}
                  className="space-y-1 rounded-lg border border-white/10 p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-200">{preview.sceneNumber}번 장면</span>
                    <span className="text-xs text-slate-400" data-testid={`cost-${preview.sceneNumber}`}>
                      예상 비용: ${preview.estimatedCostUsd.toFixed(2)}
                    </span>
                  </div>
                  <label className="block text-sm text-slate-300" htmlFor={`prompt-${preview.sceneNumber}`}>
                    Runway 프롬프트
                    <textarea
                      id={`prompt-${preview.sceneNumber}`}
                      className="mt-1 w-full rounded-lg border border-white/10 bg-slate-800 px-3 py-2 text-slate-100"
                      rows={6}
                      value={promptText}
                      onChange={(event) => updatePrompt(preview.sceneNumber, event.target.value)}
                    />
                  </label>
                  <p
                    className={overLimit ? "text-xs text-rose-400" : "text-xs text-slate-400"}
                    data-testid={`prompt-length-${preview.sceneNumber}`}
                  >
                    {length} / {PROMPT_UTF16_LIMIT}
                  </p>
                  {overLimit && (
                    <p
                      role="alert"
                      data-testid={`prompt-limit-error-${preview.sceneNumber}`}
                      className="text-xs text-rose-400"
                    >
                      프롬프트가 최대 글자 수({PROMPT_UTF16_LIMIT}자)를 초과했습니다.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
          <p className="text-sm font-semibold text-slate-200" data-testid="total-cost">
            총 예상 비용: ${totalCostUsd.toFixed(2)}
          </p>
        </>
      )}
    </section>
  );
}
