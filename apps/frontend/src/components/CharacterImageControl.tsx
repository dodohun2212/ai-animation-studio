import { useRef, useState } from "react";
import type { GenerateNovelCharacterImageResponse, NovelCharacterImageInput, NovelCharacterImagePreviewResponse } from "@ai-animation-studio/shared";

import { assetContentUrl } from "../api/assetsApi.js";
import {
  generateNovelCharacterImage,
  previewNovelCharacterImage,
  toCharacterImageDisplayError,
  type CharacterImageDisplayError,
} from "../api/storyAnalysisApi.js";
import { outlineButton, primaryButton, smallOutlineButton } from "./ui/surfaces.js";

interface Props {
  /** 이 인물이 속한 분석의 입력 해시 — 이름이 같은 인물이 다른 이야기에서 섞이지 않게 서버가 쓴다. */
  storyInputSha256: string;
  characterId: string;
  name: string;
  appearance: string;
  personality: string;
  isProtagonist: boolean;
  /** 키·예산이 막을 때 갈 곳. */
  onOpenSettings: () => void;
  /** 그림이 보관함에 등록된 뒤 — 부모가 보관함 목록을 새로 읽는다. */
  onGenerated: (result: GenerateNovelCharacterImageResponse) => void;
  /** 사람이 그림을 본 뒤 「주인공 이미지로 쓰기」를 눌렀을 때만(주인공 카드에서만 나온다). */
  onUseAsProtagonist: (folderAssetId: string) => void;
  /** 이 폴더가 이미 주인공 이미지로 골라져 있는지. */
  usedAsProtagonistFolderId: string;
  disabled?: boolean;
}

const usd = (value: number) => `$${value.toFixed(2)}`;

/**
 * 인물 한 명의 **캐릭터 이미지 만들기**(M3) — 미리보기(무료) → 별도 승인 → 유료 1회 → 보관함 캐릭터 폴더로 등록.
 *
 * 🔴 화면을 열거나 미리보기를 만들거나 프로젝트를 확정하는 것만으로는 이미지 요청이 나가지 않습니다. 돈이 나가는 건
 * 「승인하고 이미지 만들기」 한 곳이고, 미리보기 뒤 인물 칸이 바뀌면 그 버튼이 꺼집니다(서버도 해시가 다르면 거절).
 * 🟠 주인공 폴더 연결은 **사람이 그림을 본 뒤 따로 누르는 선택**입니다. 조연은 보관함에 폴더로만 저장되고, 장기 프로젝트의
 * 조연 연결은 아직 없으므로(M4) 연결됐다고 말하지 않습니다.
 */
export function CharacterImageControl({
  storyInputSha256, characterId, name, appearance, personality, isProtagonist,
  onOpenSettings, onGenerated, onUseAsProtagonist, usedAsProtagonistFolderId, disabled = false,
}: Props) {
  const input: NovelCharacterImageInput = { storyInputSha256, characterId, name: name.trim(), appearance: appearance.trim(), personality: personality.trim() };
  const inputKey = JSON.stringify(input);
  const complete = input.name.length > 0 && input.appearance.length > 0 && input.personality.length > 0;

  const [preview, setPreview] = useState<{ key: string; response: NovelCharacterImagePreviewResponse } | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<CharacterImageDisplayError | null>(null);
  /** 결과는 **만들 때의 설명(`key`)** 과 묶어 둡니다 — 설명을 바꾼 뒤에 옛 그림이 새 설명의 그림처럼 보이거나 연결되지 않게(CLI 1322). */
  const [result, setResult] = useState<{ key: string; response: GenerateNovelCharacterImageResponse } | null>(null);
  const busy = useRef(false);

  const stale = preview !== null && preview.key !== inputKey;
  const currentResult = result !== null && result.key === inputKey ? result.response : null;
  const oldResult = result !== null && result.key !== inputKey ? result.response : null;
  const info = preview?.response.preview;
  const budget = preview?.response.budget;
  const blockedReason = !info ? null
    : !info.providerAvailable ? "OpenAI 키가 저장·연결되어 있지 않아 이미지를 만들 수 없습니다."
      : budget?.canSpend === false ? "이번 달 OpenAI 예산이 부족해 이미지를 만들 수 없습니다."
        : null;
  const canApprove = info !== undefined && !stale && blockedReason === null && !generating && !previewing && !disabled;

  async function makePreview(): Promise<void> {
    if (!complete || busy.current) return;
    busy.current = true;
    setPreviewing(true);
    setError(null);
    try {
      setPreview({ key: inputKey, response: await previewNovelCharacterImage(input) });
    } catch (caught) {
      setError(toCharacterImageDisplayError(caught));
    } finally {
      busy.current = false;
      setPreviewing(false);
    }
  }

  async function approve(): Promise<void> {
    if (!preview || !canApprove || busy.current) return;
    busy.current = true;
    setGenerating(true);
    setError(null);
    try {
      // 요청을 보낸 시점의 설명 — 기다리는 동안 칸이 바뀌어도 이 결과는 그 설명의 그림으로만 남습니다.
      const requestKey = preview.key;
      const response = await generateNovelCharacterImage({
        ...input,
        inputSha256: preview.response.preview.inputSha256,
        promptSha256: preview.response.preview.promptSha256,
        approved: true,
      });
      setResult({ key: requestKey, response });
      onGenerated(response);
    } catch (caught) {
      // 🔴 자동으로 다시 보내지 않습니다 — 요청이 나갔을 수 있는 실패는 서버가 같은 입력의 재전송을 막고 있고 화면은 그 사실을 말합니다.
      setError(toCharacterImageDisplayError(caught));
    } finally {
      busy.current = false;
      setGenerating(false);
    }
  }

  return (
    <div className="space-y-2 rounded border border-dashed border-line p-3" data-testid={`character-image-${characterId}`}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[11px] font-medium text-bone-dim">캐릭터 이미지 (유료 약 {usd(info?.estimatedCostUsd ?? 0.1)}, 선택)</p>
        <button
          type="button"
          data-testid={`character-image-preview-${characterId}`}
          className={`${smallOutlineButton} ml-auto`}
          onClick={() => void makePreview()}
          disabled={!complete || previewing || generating || disabled}
        >
          {previewing ? "미리보기 만드는 중…" : preview ? "미리보기 다시 만들기" : "이미지 미리보기 (무료)"}
        </button>
      </div>
      {!complete && <p className="text-[11px] text-bone-faint">이름·외모·성격을 모두 채우면 미리볼 수 있습니다.</p>}

      {currentResult && (
        <div className="space-y-2" data-testid={`character-image-result-${characterId}`}>
          <img src={assetContentUrl(currentResult.folderAssetId)} alt={`${input.name} 캐릭터 이미지`} className="h-40 w-auto rounded border border-line object-cover" />
          <p className="text-[11px] text-bone-dim">
            {currentResult.reused
              ? "같은 설명의 지난 그림을 다시 보여 줍니다 — 새로 청구되지 않았습니다."
              : "그림이 이미지 보관함의 캐릭터 폴더로 등록됐습니다."}
          </p>
          {currentResult.spendUnrecorded === true && (
            <p role="status" data-testid={`character-image-spend-${characterId}`} className="text-[11px] text-amber-300">
              그림은 만들어졌지만 이번 지출이 월 예산 장부에 기록되지 않았을 수 있습니다. 실제 청구는 OpenAI 사용량에서 확인해 주세요.
            </p>
          )}
          {isProtagonist ? (
            usedAsProtagonistFolderId === currentResult.folderAssetId
              ? <p data-testid={`character-image-linked-${characterId}`} className="text-[11px] text-emerald-300">이 그림이 주인공 이미지로 연결되도록 골라져 있습니다. 프로젝트를 확정하면 연결됩니다.</p>
              : <button type="button" data-testid={`character-image-use-${characterId}`} className={smallOutlineButton} onClick={() => onUseAsProtagonist(currentResult.folderAssetId)} disabled={disabled}>
                  이 그림을 주인공 이미지로 쓰기
                </button>
          ) : (
            <p className="text-[11px] text-bone-faint">보관함에 폴더로만 저장됩니다. 장기 프로젝트의 조연 연결은 아직 없어 이 프로젝트에는 연결되지 않습니다.</p>
          )}
        </div>
      )}

      {oldResult && (
        <div className="space-y-1" data-testid={`character-image-old-${characterId}`}>
          <img src={assetContentUrl(oldResult.folderAssetId)} alt="바뀌기 전 설명으로 만든 그림" className="h-24 w-auto rounded border border-line object-cover opacity-60" />
          <p role="status" className="text-[11px] text-amber-300">
            이 그림은 <strong className="font-medium">바뀌기 전 인물 설명</strong>으로 만든 것이라 지금 설명의 그림이 아닙니다. 지금 설명으로 다시 만들려면 아래에서 미리보기를 만들고 승인하세요(새로 청구됩니다).
          </p>
        </div>
      )}

      {preview && info && !currentResult && (
        <div className="space-y-2" data-testid={`character-image-card-${characterId}`}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px]">
            <dt className="text-bone-faint">모델·크기</dt><dd className="text-bone-dim" data-testid={`character-image-model-${characterId}`}>{info.model} · {info.size}</dd>
            <dt className="text-bone-faint">예상 비용</dt><dd className="text-bone-dim" data-testid={`character-image-cost-${characterId}`}>{usd(info.estimatedCostUsd)} <span className="text-bone-faint">(1장 고정 견적, 실제 청구와 다를 수 있습니다)</span></dd>
            {budget && (
              <>
                <dt className="text-bone-faint">이번 달 예산</dt>
                <dd className="tabular-nums text-bone-dim" data-testid={`character-image-budget-${characterId}`}>한도 {usd(budget.monthlyLimitUsd)} · 쓴 돈 {usd(budget.spentUsd)} · 남은 돈 {usd(budget.remainingUsd)}</dd>
              </>
            )}
          </dl>
          <details>
            <summary className="cursor-pointer text-[11px] text-bone-dim hover:text-bone">그림 모델로 보낼 글 보기</summary>
            <textarea readOnly rows={5} value={info.prompt} aria-label={`${input.name} 이미지 프롬프트`} data-testid={`character-image-prompt-${characterId}`} className="mt-1 w-full rounded border border-line bg-slate-900/70 p-2 font-mono text-[11px] text-bone" />
          </details>
          {stale && <p role="status" data-testid={`character-image-stale-${characterId}`} className="text-[11px] text-amber-300">미리보기를 만든 뒤 인물 설명이 바뀌었습니다. 「미리보기 다시 만들기」로 새로 확인해야 승인할 수 있습니다.</p>}
          {blockedReason && !stale && (
            <div role="status" data-testid={`character-image-blocked-${characterId}`} className="space-y-1 text-[11px] text-amber-300">
              <p>{blockedReason} 요청은 나가지 않습니다.</p>
              <button type="button" className={smallOutlineButton} onClick={onOpenSettings}>API 설정 열기</button>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid={`character-image-approve-${characterId}`} className={primaryButton} onClick={() => void approve()} disabled={!canApprove}>
              {generating ? "그림 만드는 중… (OpenAI)" : `승인하고 이미지 만들기 (유료 약 ${usd(info.estimatedCostUsd)})`}
            </button>
            <span className="text-[11px] text-bone-faint">누르면 한 장을 만들고 비용이 청구됩니다. 자동으로 다시 보내지 않습니다.</span>
          </div>
        </div>
      )}

      {error && (
        <div role="alert" data-testid={`character-image-error-${characterId}`} data-error-code={error.code} className="space-y-2 rounded-lg border border-rose-400/30 bg-rose-500/15 p-2">
          <p className="text-[12px] text-rose-400">{error.message}</p>
          {(error.code === "NOVEL_CHARACTER_IMAGE_KEY_MISSING" || error.code === "NOVEL_CHARACTER_IMAGE_BUDGET_EXCEEDED") && (
            <button type="button" className={smallOutlineButton} onClick={onOpenSettings}>API 설정 열기</button>
          )}
          {error.recoveryImageBase64 && (
            <a
              data-testid={`character-image-recovery-${characterId}`}
              className={`${outlineButton} inline-block`}
              href={`data:image/png;base64,${error.recoveryImageBase64}`}
              download={`${input.name || "character"}.png`}
            >
              이미 만든 그림 내려받기 (PNG)
            </a>
          )}
        </div>
      )}
    </div>
  );
}
