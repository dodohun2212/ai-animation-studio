import { useEffect, useRef, useState } from "react";
import type { BudgetPreview, NarrationReview, SceneNumber } from "@ai-animation-studio/shared";
import { TTS_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";

import { getProjectSettings } from "../api/projectsApi.js";
import {
  getNarrationReview,
  narrationContentUrl,
  regenerateNarration,
  startNarrationGeneration,
  toNarrationDisplayError,
} from "../api/narrationApi.js";
import { Spinner } from "./Spinner.js";
import { StatusChip } from "./ui/StatusChip.js";
import { BudgetLine } from "./ui/BudgetLine.js";
import { RetryCostNotice } from "./ui/RetryCostNotice.js";

interface Props {
  projectId: string;
  onBack: () => void;
}

type DisplayError = { code: string; message: string };

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: DisplayError }
  | {
      status: "ready";
      narrations: NarrationReview[];
      budget?: BudgetPreview;
      retryEstimate?: { perSceneCostUsd: number; budget: BudgetPreview };
    };

/**
 * Rough Korean narration reading pace, in characters per second, used only to warn that a line looks too long
 * for its clip. Deliberately conservative, and never used to block anything — it flags lines for a human to
 * shorten, it does not decide for them.
 */
const READING_CHARS_PER_SECOND = 5;

const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallOutlineButton =
  "rounded-full border border-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50";
const smallAmberButton =
  "rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-white hover:bg-amber-400 disabled:opacity-50";
const cardSection = "space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

export function NarrationReviewScreen({ projectId, onBack }: Props) {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  /**
   * Loaded separately and treated as optional: the clip length only powers a soft "this line looks long"
   * warning, so a settings request that fails must not take the narration text down with it.
   */
  const [clipDurationSeconds, setClipDurationSeconds] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [generatePending, setGeneratePending] = useState(false);
  const [actionError, setActionError] = useState<DisplayError | null>(null);
  const [generationSummary, setGenerationSummary] = useState<{ generated: number; reused: number; skipped: number } | null>(null);
  const [regenerateConfirmScene, setRegenerateConfirmScene] = useState<SceneNumber | null>(null);
  const [regeneratePendingScenes, setRegeneratePendingScenes] = useState<Set<SceneNumber>>(new Set());
  /** Bumped after any successful synthesis so <audio> refetches instead of replaying the cached file. */
  const [audioVersion, setAudioVersion] = useState(0);
  const loadRequest = useRef(0);
  const generateBusy = useRef(false);
  const regenerateBusy = useRef<Set<SceneNumber>>(new Set());

  useEffect(() => {
    const requestId = ++loadRequest.current;
    setState({ status: "loading" });
    setClipDurationSeconds(null);
    getNarrationReview(projectId)
      .then((response) => {
        if (requestId !== loadRequest.current) return;
        setState({ status: "ready", narrations: response.narrations, budget: response.budget });
      })
      .catch((caught: unknown) => {
        if (requestId !== loadRequest.current) return;
        setState({ status: "error", error: toNarrationDisplayError(caught) });
      });
    getProjectSettings(projectId)
      .then((response) => {
        if (requestId !== loadRequest.current) return;
        setClipDurationSeconds(response.settings.clipDurationSeconds);
      })
      .catch(() => {
        // Length warnings are a convenience, not the point of this screen — silently do without them.
      });
  }, [projectId]);

  const narrations = state.status === "ready" ? state.narrations : [];
  const withText = narrations.filter((item) => item.narration.trim());
  const missing = narrations.filter((item) => !item.narration.trim());
  const estimatedCost = withText.length * TTS_ESTIMATED_COST_USD;
  const tooLongFor = (text: string) =>
    Boolean(clipDurationSeconds) && text.trim().length > (clipDurationSeconds ?? 0) * READING_CHARS_PER_SECOND;
  const overLongCount = withText.filter((item) => tooLongFor(item.narration)).length;

  async function confirmGeneration(): Promise<void> {
    if (generateBusy.current) return;
    generateBusy.current = true;
    setGeneratePending(true);
    setActionError(null);
    try {
      const response = await startNarrationGeneration(projectId);
      const review = await getNarrationReview(projectId);
      setState({ status: "ready", narrations: review.narrations, budget: response.budget ?? review.budget });
      setGenerationSummary({
        generated: response.generatedSceneNumbers.length,
        reused: response.reusedSceneNumbers.length,
        skipped: response.skippedSceneNumbers.length,
      });
      setAudioVersion((version) => version + 1);
      setConfirmOpen(false);
    } catch (caught) {
      setActionError(toNarrationDisplayError(caught));
    } finally {
      generateBusy.current = false;
      setGeneratePending(false);
    }
  }

  async function confirmRegenerate(sceneNumber: SceneNumber): Promise<void> {
    if (regenerateBusy.current.has(sceneNumber)) return;
    regenerateBusy.current.add(sceneNumber);
    setRegeneratePendingScenes(new Set(regenerateBusy.current));
    setActionError(null);
    try {
      const response = await regenerateNarration(projectId, sceneNumber);
      setState({
        status: "ready",
        narrations: response.narrations,
        budget: response.retryEstimate?.budget,
        retryEstimate: response.retryEstimate,
      });
      setAudioVersion((version) => version + 1);
      setRegenerateConfirmScene(null);
    } catch (caught) {
      setActionError(toNarrationDisplayError(caught));
    } finally {
      regenerateBusy.current.delete(sceneNumber);
      setRegeneratePendingScenes(new Set(regenerateBusy.current));
    }
  }

  return (
    <section className="mt-8 max-w-4xl space-y-5">
      <header className="space-y-1.5">
        <button type="button" className="text-xs text-slate-400 hover:text-slate-300" onClick={onBack}>
          <span aria-hidden="true">←</span> 프로젝트로 돌아가기
        </button>
        <h1 className="flex items-center gap-2.5 text-2xl font-semibold text-slate-100">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
          />
          내레이션 확인
        </h1>
      </header>
      <p className="text-sm leading-relaxed text-slate-400">
        음성으로 만들어질 문장입니다. 음성 생성은 장면마다 한 번씩 비용이 들기 때문에, 만들기 전에 여기서 먼저 읽어볼 수
        있게 했습니다. 문장 자체를 고치려면 대본을 다시 만들어야 합니다.
      </p>

      {state.status === "loading" && <Spinner label="내레이션을 불러오는 중..." />}
      {state.status === "error" && (
        <p role="alert" data-testid="narration-load-error" data-error-code={state.error.code} className="text-sm text-rose-400">
          {state.error.message}
        </p>
      )}

      {state.status === "ready" && (
        <>
          <section aria-label="내레이션 요약" data-testid="narration-summary" className={cardSection}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="text-xs text-slate-400">내레이션이 있는 장면</p>
                <p data-testid="narration-count" className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-100">
                  {withText.length} / {narrations.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400">음성 생성 예상 비용</p>
                <p data-testid="narration-estimated-cost" className="mt-0.5 text-2xl font-semibold tabular-nums text-slate-100">
                  ${estimatedCost.toFixed(2)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {withText.length}장면 × ${TTS_ESTIMATED_COST_USD.toFixed(2)} · 키가 연결되어 있을 때만 청구됩니다
                </p>
              </div>
            </div>
            <BudgetLine budget={state.budget} data-testid="narration-budget" />
            {missing.length > 0 && (
              <p role="alert" data-testid="narration-missing" className="text-sm text-amber-300">
                {missing.length}개 장면에 내레이션 문장이 없습니다. 내레이션을 켜기 전에 만들어진 대본이라면, 대본을 다시
                만들어야 문장이 생깁니다.
              </p>
            )}
            {overLongCount > 0 && (
              <p role="alert" data-testid="narration-too-long" className="text-sm text-amber-300">
                {overLongCount}개 장면의 문장이 {clipDurationSeconds}초 안에 읽기에 길어 보입니다. 음성이 장면보다 길어질 수
                있으니 줄이는 편이 좋습니다.
              </p>
            )}

            {withText.length > 0 && (
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  data-testid="narration-generate-button"
                  className={primaryButton}
                  onClick={() => {
                    setConfirmOpen(true);
                    setActionError(null);
                  }}
                  disabled={confirmOpen || generatePending}
                >
                  음성 만들기
                </button>
              </div>
            )}

            {confirmOpen && (
              <div
                role="alertdialog"
                aria-label="음성 생성 확인"
                data-testid="narration-generate-confirm"
                className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4"
              >
                <p className="text-sm font-semibold text-amber-300">{withText.length}개 장면의 음성을 만들까요?</p>
                <p className="text-sm text-slate-300">
                  아직 요청이 가지 않았습니다. OpenAI 키가 연결되어 있으면 확인을 누르는 순간 실제 유료 요청이 전송됩니다.
                  이미 음성이 있는 장면은 다시 만들지 않아 비용도 들지 않습니다.
                </p>
                {/* The estimate is computable without a ledger, so it is its own line — BudgetLine
                    deliberately renders nothing when there is no budget, and that rule stays intact.
                    Same split as ImageGenerationScreen's confirmation panel. */}
                <p data-testid="narration-generate-cost-estimate" className="text-xs text-slate-300 tabular-nums">
                  예상 비용: ${estimatedCost.toFixed(2)} ({withText.length}장면 × ${TTS_ESTIMATED_COST_USD.toFixed(2)}) · 키가
                  연결되어 있을 때만 청구됩니다
                </p>
                <BudgetLine
                  budget={state.budget}
                  estimatedRequestCostUsd={estimatedCost}
                  data-testid="narration-generate-budget"
                />
                <div className="flex gap-3">
                  <button type="button" className={outlineButton} onClick={() => setConfirmOpen(false)} disabled={generatePending}>
                    돌아가기
                  </button>
                  <button type="button" className={primaryButton} onClick={() => void confirmGeneration()} disabled={generatePending}>
                    {generatePending ? "만드는 중..." : "예, 음성을 만듭니다"}
                  </button>
                </div>
              </div>
            )}

            {actionError && (
              <p role="alert" data-testid="narration-action-error" data-error-code={actionError.code} className="text-sm text-rose-400">
                {actionError.message}
              </p>
            )}

            {generationSummary && (
              <p data-testid="narration-generation-summary" className="text-sm font-semibold text-emerald-400">
                음성 생성 완료 · 새로 만듦 {generationSummary.generated}개 · 기존 음성 재사용 {generationSummary.reused}개
                {generationSummary.skipped > 0 ? ` · 문장이 없어 건너뜀 ${generationSummary.skipped}개` : ""}
              </p>
            )}
          </section>

          {narrations.length === 0 && (
            <p data-testid="narration-empty" className="text-sm text-slate-400">
              아직 장면이 없습니다. 대본을 먼저 만들어 주세요.
            </p>
          )}

          {narrations.length > 0 && (
            <ul aria-label="장면별 내레이션" className="space-y-2">
              {narrations.map((item) => {
                const text = item.narration.trim();
                const tooLong = tooLongFor(item.narration);
                const regenerating = regeneratePendingScenes.has(item.sceneNumber);
                const confirming = regenerateConfirmScene === item.sceneNumber;
                return (
                  <li
                    key={item.sceneNumber}
                    data-testid={`narration-scene-${item.sceneNumber}`}
                    data-has-narration={text ? "true" : "false"}
                    data-has-audio={item.hasAudio ? "true" : "false"}
                    className={`space-y-2 rounded-xl border bg-slate-950/40 p-3.5 ${
                      tooLong ? "border-amber-400/40" : "border-white/10"
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-slate-100">{item.sceneNumber}번 장면</span>
                      <span className="flex items-center gap-2">
                        {text ? (
                          <StatusChip tone={tooLong ? "progress" : "neutral"}>
                            {text.length}자{tooLong ? " · 길 수 있음" : ""}
                          </StatusChip>
                        ) : (
                          <StatusChip tone="danger">문장 없음</StatusChip>
                        )}
                        {item.hasAudio && <StatusChip tone="success">음성 있음</StatusChip>}
                      </span>
                    </div>
                    {text ? (
                      <p className="text-sm leading-relaxed text-slate-300">{text}</p>
                    ) : (
                      <p className="text-sm text-slate-500">이 장면에는 읽어줄 문장이 없어 음성도 만들어지지 않습니다.</p>
                    )}

                    {item.hasAudio && (
                      <audio
                        controls
                        data-testid={`narration-audio-${item.sceneNumber}`}
                        className="w-full"
                        src={narrationContentUrl(projectId, item.sceneNumber, String(audioVersion))}
                      >
                        이 브라우저는 오디오 재생을 지원하지 않습니다.
                      </audio>
                    )}

                    {item.hasAudio && text && (
                      <div className="flex justify-end">
                        <button
                          type="button"
                          data-testid={`narration-regenerate-${item.sceneNumber}`}
                          className={smallOutlineButton}
                          onClick={() => {
                            setRegenerateConfirmScene(item.sceneNumber);
                            setActionError(null);
                          }}
                          disabled={regenerating || confirming}
                        >
                          {regenerating ? "다시 만드는 중..." : "음성 다시 만들기"}
                        </button>
                      </div>
                    )}

                    {confirming && (
                      <div
                        role="alertdialog"
                        aria-label={`${item.sceneNumber}번 장면 음성 재생성 확인`}
                        data-testid={`narration-regenerate-confirm-${item.sceneNumber}`}
                        className="space-y-2 rounded-lg border border-amber-400/40 bg-slate-900/70 p-3"
                      >
                        <p className="text-sm text-amber-200">
                          {item.sceneNumber}번 장면 음성을 다시 만들까요? OpenAI 키가 연결되어 있으면 이번 재생성분이 실제로
                          청구됩니다.
                        </p>
                        <RetryCostNotice
                          estimate={state.retryEstimate}
                          sceneCount={1}
                          data-testid={`narration-regenerate-cost-${item.sceneNumber}`}
                        />
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className={smallOutlineButton}
                            onClick={() => setRegenerateConfirmScene(null)}
                            disabled={regenerating}
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            className={smallAmberButton}
                            onClick={() => void confirmRegenerate(item.sceneNumber)}
                            disabled={regenerating}
                          >
                            {regenerating ? "다시 만드는 중..." : "예, 다시 만듭니다"}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
