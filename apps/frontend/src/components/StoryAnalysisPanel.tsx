import { useRef, useState } from "react";
import {
  NOVEL_ANALYSIS_ESTIMATED_COST_USD,
  type ApproveNovelStoryAnalysisResponse,
  type LongProject,
  type NovelStoryAnalysisInput,
  type NovelStoryAnalysisPreviewResponse,
} from "@ai-animation-studio/shared";

import { approveStoryAnalysis, previewStoryAnalysis, toStoryAnalysisDisplayError } from "../api/storyAnalysisApi.js";
import { Spinner } from "./Spinner.js";
import { StoryAnalysisReview } from "./StoryAnalysisReview.js";
import { outlineButton, primaryButton, smallOutlineButton } from "./ui/surfaces.js";

interface Props {
  /** 입력이 분석 조건을 모두 채웠을 때만(아니면 null) — 칸 검사는 부모 화면이 합니다. */
  input: NovelStoryAnalysisInput | null;
  /** 확인·수정한 결과로 장기 프로젝트가 만들어졌을 때(M2). */
  onProjectCreated: (project: LongProject) => void;
  /** 키가 없을 때 갈 곳 — OpenAI 키 칸은 API 설정에 있습니다. */
  onOpenSettings: () => void;
}

type DisplayError = { code: string; message: string };
const usd = (value: number) => `$${value.toFixed(2)}`;

/**
 * 소설 → AI 분석(M1) — **미리보기(무료) → 사용자의 별도 승인 → 실행(유료 1회)**.
 *
 * 🔴 승인 전에는 유료 요청이 나가지 않습니다. 미리보기는 서버가 OpenAI 로 보낼 **정확한 글**과 모델·견적·예산을 보여 주기만 하고,
 * 입력이 미리보기 뒤에 한 글자라도 바뀌면 승인 버튼이 꺼집니다(서버도 해시가 다르면 거절합니다).
 * 🟠 결과는 **AI가 정리한 제안**입니다 — 법적 권리가 해결됐다거나 원문과 비슷하지 않다는 보장을 하지 않습니다.
 * 원문은 이 요청에만 쓰이고 서버에 저장되지 않으며(저장되는 건 해시·분석 결과), 이 화면도 결과만 들고 있습니다.
 */
export function StoryAnalysisPanel({ input, onOpenSettings, onProjectCreated }: Props) {
  const [preview, setPreview] = useState<{ key: string; response: NovelStoryAnalysisPreviewResponse } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [approving, setApproving] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [result, setResult] = useState<{ key: string; response: ApproveNovelStoryAnalysisResponse } | null>(null);
  const busy = useRef(false);

  const inputKey = input ? JSON.stringify(input) : null;
  const previewStale = preview !== null && preview.key !== inputKey;
  const resultStale = result !== null && result.key !== inputKey;

  async function makePreview(): Promise<void> {
    if (!input || busy.current) return;
    busy.current = true;
    setPreviewing(true);
    setError(null);
    try {
      setPreview({ key: JSON.stringify(input), response: await previewStoryAnalysis(input) });
    } catch (caught) {
      setError(toStoryAnalysisDisplayError(caught));
    } finally {
      busy.current = false;
      setPreviewing(false);
    }
  }

  async function approve(): Promise<void> {
    if (!input || !preview || previewStale || busy.current) return;
    if (!preview.response.preview.providerAvailable || preview.response.budget?.canSpend === false) return;
    busy.current = true;
    setApproving(true);
    setError(null);
    try {
      const response = await approveStoryAnalysis({
        ...input,
        inputSha256: preview.response.preview.inputSha256,
        promptSha256: preview.response.preview.promptSha256,
        approved: true,
      });
      setResult({ key: preview.key, response });
    } catch (caught) {
      // 🔴 자동으로 다시 보내지 않습니다 — 요청이 나갔을 수 있는 실패는 서버가 같은 입력의 재전송을 막고 있고, 화면은 그 사실을 말합니다.
      setError(toStoryAnalysisDisplayError(caught));
    } finally {
      busy.current = false;
      setApproving(false);
    }
  }

  const info = preview?.response.preview;
  const budget = preview?.response.budget;
  const blockedReason = !info
    ? null
    : !info.providerAvailable
      ? "OpenAI 키가 저장·연결되어 있지 않아 분석을 보낼 수 없습니다."
      : budget?.canSpend === false
        ? "이번 달 OpenAI 예산이 부족해 분석을 보낼 수 없습니다."
        : null;
  const canApprove = info !== undefined && !previewStale && blockedReason === null && !approving && !previewing;

  return (
    <div className="space-y-4" data-testid="story-analysis">
      <p className="text-xs text-bone-dim">
        소설을 AI가 한 번 읽어 <strong className="font-medium text-bone">줄거리·인물·회차 구성</strong>으로 정리합니다. 먼저 보낼 내용과 비용을 미리 보고, 승인해야만 보냅니다(승인 전에는 비용이 나가지 않습니다).
      </p>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" data-testid="story-preview-run" className={outlineButton} onClick={() => void makePreview()} disabled={input === null || previewing || approving}>
          {previewing ? "미리보기 만드는 중…" : preview ? "미리보기 다시 만들기" : "분석 미리보기 만들기 (무료)"}
        </button>
        {input === null && <span className="text-xs text-bone-faint">제목·한 줄 줄거리·본문·권리 확인을 채우면 만들 수 있습니다.</span>}
      </div>

      {preview && info && (
        <div data-testid="story-preview" className="space-y-3 rounded-lg border border-line p-4">
          <h3 className="text-sm font-medium text-bone">보낼 내용 확인</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
            <dt className="text-bone-faint">모델</dt><dd className="text-bone-dim" data-testid="story-preview-model">{info.model}</dd>
            <dt className="text-bone-faint">본문 글자 수</dt><dd className="tabular-nums text-bone-dim">{info.sourceCharacterCount.toLocaleString("ko-KR")}자</dd>
            <dt className="text-bone-faint">예상 비용</dt>
            <dd className="text-bone-dim" data-testid="story-preview-cost">
              {usd(info.estimatedCostUsd)} <span className="text-bone-faint">(1회 고정 견적{info.estimatedCostUsd === NOVEL_ANALYSIS_ESTIMATED_COST_USD ? "" : " — 서버가 알려 준 값"}, 실제 청구와 다를 수 있습니다)</span>
            </dd>
            {budget && (
              <>
                <dt className="text-bone-faint">이번 달 예산</dt>
                <dd className="tabular-nums text-bone-dim" data-testid="story-preview-budget">
                  한도 {usd(budget.monthlyLimitUsd)} · 쓴 돈 {usd(budget.spentUsd)} · 남은 돈 {usd(budget.remainingUsd)}
                </dd>
              </>
            )}
          </dl>
          <details>
            <summary className="cursor-pointer text-xs text-bone-dim hover:text-bone">OpenAI로 보낼 글 전체 보기</summary>
            <textarea readOnly rows={8} value={info.prompt} aria-label="OpenAI로 보낼 글" data-testid="story-preview-prompt" className="mt-2 w-full rounded border border-line bg-slate-900/70 p-2 font-mono text-[11px] text-bone" />
          </details>

          {previewStale && (
            <p role="status" data-testid="story-preview-stale" className="text-xs text-amber-300">
              미리보기를 만든 뒤 입력이 바뀌었습니다. 「미리보기 다시 만들기」로 새로 확인해야 승인할 수 있습니다.
            </p>
          )}
          {blockedReason && !previewStale && (
            <div role="status" data-testid="story-preview-blocked" className="space-y-2 text-xs text-amber-300">
              <p>{blockedReason} 요청은 나가지 않습니다.</p>
              <button type="button" className={smallOutlineButton} onClick={onOpenSettings} data-testid="story-open-settings">API 설정 열기</button>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" data-testid="story-approve" className={primaryButton} onClick={() => void approve()} disabled={!canApprove}>
              {approving ? "분석 중… (OpenAI)" : `승인하고 분석 보내기 (유료 약 ${usd(info.estimatedCostUsd)})`}
            </button>
            <span className="text-xs text-bone-faint">누르면 위 글이 OpenAI로 한 번 전송되고 비용이 청구됩니다. 자동으로 다시 보내지 않습니다.</span>
          </div>
        </div>
      )}

      {(previewing || approving) && <Spinner label={approving ? "AI가 소설을 읽는 중… 비용이 청구됩니다." : "미리보기를 만드는 중…"} />}

      {error && (
        <div role="alert" data-testid="story-analysis-error" data-error-code={error.code} className="space-y-2 rounded-lg border border-rose-400/30 bg-rose-500/15 p-3">
          <p className="text-sm text-rose-400">{error.message}</p>
          {(error.code === "STORY_ANALYSIS_KEY_MISSING" || error.code === "STORY_ANALYSIS_BUDGET_EXCEEDED") && (
            <button type="button" className={smallOutlineButton} onClick={onOpenSettings} data-testid="story-error-open-settings">API 설정 열기</button>
          )}
        </div>
      )}

      {result && <StoryAnalysisReview key={`${result.response.source.inputSha256}-${result.response.source.analyzedAt}`} response={result.response} stale={resultStale} onCreated={onProjectCreated} />}
    </div>
  );
}
