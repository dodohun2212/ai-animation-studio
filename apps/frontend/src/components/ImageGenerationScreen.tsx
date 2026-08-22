import { useEffect, useRef, useState } from "react";
import type { Project, StartImageGenerationResponse } from "@ai-animation-studio/shared";
import { WorkflowState } from "@ai-animation-studio/shared";

import { getProject, toDisplayError } from "../api/projectsApi.js";
import { startImageGeneration, toImageGenerationDisplayError } from "../api/imageGenerationApi.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string };

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | { status: "success"; project: Project };

const SCENE_NUMBERS = [1, 2, 3, 4, 5, 6] as const;

export function ImageGenerationScreen({ projectId, onBack }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [generatePending, setGeneratePending] = useState(false);
  const [generateError, setGenerateError] = useState<DisplayError | null>(null);
  const [result, setResult] = useState<StartImageGenerationResponse | null>(null);
  const generateBusy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    setResult(null);
    setGenerateError(null);
    setConfirmOpen(false);
    getProject(projectId)
      .then((response) => {
        if (!cancelled) setState({ status: "success", project: response.project });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", error: toDisplayError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const currentProject = result?.project ?? (state.status === "success" ? state.project : null);
  const allowed = currentProject?.workflowState === WorkflowState.AssetMappingApproved;

  function sceneStatus(number: number): "completed" | "pending" {
    const scene = currentProject?.scenes.find((item) => item.number === number);
    return scene?.generatedImagePath ? "completed" : "pending";
  }

  /** Opens the explicit confirmation panel. Never calls the network — only the final confirm button does. */
  function openConfirmation(): void {
    if (!allowed) return;
    setGenerateError(null);
    setConfirmOpen(true);
  }

  function cancelConfirmation(): void {
    if (generatePending) return;
    setConfirmOpen(false);
  }

  async function confirmGeneration(): Promise<void> {
    if (generateBusy.current) return;
    generateBusy.current = true;
    setGeneratePending(true);
    setGenerateError(null);
    try {
      const response = await startImageGeneration(projectId);
      setResult(response);
      setConfirmOpen(false);
    } catch (caught) {
      setGenerateError(toImageGenerationDisplayError(caught));
    } finally {
      generateBusy.current = false;
      setGeneratePending(false);
    }
  }

  return (
    <section className="mt-8 space-y-4">
      <button type="button" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300" onClick={onBack}>
        프로젝트로 돌아가기
      </button>
      <h2 className="text-xl font-semibold">장면 이미지 생성</h2>

      {state.status === "loading" && <p className="text-slate-400">불러오는 중...</p>}
      {state.status === "error" && (
        <p role="alert" data-testid="load-error" data-error-code={state.error.code} className="text-sm text-rose-400">
          {state.error.message}
        </p>
      )}

      {currentProject && (
        <>
          <p className="text-sm text-amber-300" data-testid="no-paid-notice">
            실제 유료 OpenAI 이미지 API를 호출하지 않습니다. 로컬 가짜(local fake) 어댑터로 장면 이미지 6장을 생성합니다.
          </p>

          {!allowed && !result && (
            <p className="text-sm text-slate-400" data-testid="not-allowed">
              이미지 생성은 Asset Mapping이 승인된 프로젝트에서만 가능합니다. 현재 상태: {currentProject.workflowState}
            </p>
          )}

          <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-300" data-testid="scene-results">
            {SCENE_NUMBERS.map((number) => (
              <li key={number} data-testid={`scene-${number}`} data-status={sceneStatus(number)}>
                {number}번 장면 · {sceneStatus(number) === "completed" ? "완료" : "대기"}
              </li>
            ))}
          </ol>

          {allowed && !result && (
            <button
              type="button"
              className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              onClick={openConfirmation}
              disabled={confirmOpen}
            >
              이미지 생성 시작
            </button>
          )}

          {confirmOpen && (
            <div
              role="alertdialog"
              aria-label="장면 이미지 생성 확인"
              data-testid="generate-confirm-panel"
              className="space-y-3 rounded-lg border border-amber-400/40 bg-slate-900 p-4"
            >
              <p className="text-sm font-semibold text-amber-300">장면 이미지 6장을 생성할까요?</p>
              <p className="text-sm text-slate-300">
                아직 생성이 시작되지 않았습니다. 확인을 누르면 로컬 가짜 어댑터가 이미지 6장을 생성하며, 실제 유료 요청은
                전송되지 않습니다.
              </p>
              <div className="flex gap-3">
                <button
                  type="button"
                  className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 disabled:opacity-50"
                  onClick={cancelConfirmation}
                  disabled={generatePending}
                >
                  돌아가기
                </button>
                <button
                  type="button"
                  className="rounded-full bg-violet-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  onClick={() => void confirmGeneration()}
                  disabled={generatePending}
                >
                  {generatePending ? "생성 중..." : "예, 로컬 이미지 생성을 시작합니다"}
                </button>
              </div>
            </div>
          )}

          {generateError && (
            <p role="alert" data-testid="generate-error" data-error-code={generateError.code} className="text-sm text-rose-400">
              {generateError.message}
            </p>
          )}

          {result && (
            <p data-testid="generation-summary" className="text-sm text-emerald-400">
              생성 완료 · 새로 생성 {result.generatedSceneNumbers.length}장 · 기존 이미지 재사용{" "}
              {result.reusedSceneNumbers.length}장
            </p>
          )}
        </>
      )}
    </section>
  );
}
