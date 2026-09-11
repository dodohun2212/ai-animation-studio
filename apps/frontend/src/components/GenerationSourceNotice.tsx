import type { GenerationSource } from "@ai-animation-studio/shared";

interface BadgeProps {
  source?: GenerationSource;
  testId: string;
}

interface FinalVideoNoticeProps {
  source?: GenerationSource;
  testId: string;
}

export function GenerationSourceBadge({ source, testId }: BadgeProps) {
  if (!source) return null;
  if (source === "paid_provider") {
    return <span data-testid={testId} className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-300">실제 생성</span>;
  }
  if (source === "local_fake_no_provider") {
    return <span data-testid={testId} className="rounded-full border border-amber-400/40 bg-amber-500/10 px-2 py-0.5 text-xs text-amber-300">임시 생성</span>;
  }
  return <span data-testid={testId} className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2 py-0.5 text-xs text-sky-300">생성 출처 확인 필요</span>;
}

export function FinalVideoGenerationSourceNotice({ source, testId }: FinalVideoNoticeProps) {
  if (source === "paid_provider" || !source) return null;
  if (source === "local_fake_no_provider") {
    return <p data-testid={testId} className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">이 최종 영상에는 임시 생성 장면이 포함되어 있습니다. 검토와 내보내기는 가능하지만 Instagram 게시에는 사용할 수 없습니다.</p>;
  }
  return <p data-testid={testId} className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-300">이 최종 영상의 생성 출처를 확인할 수 없습니다. 게시 전 생성 기록을 확인해 주세요.</p>;
}
