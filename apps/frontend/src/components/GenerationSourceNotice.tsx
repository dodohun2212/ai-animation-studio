import type { GenerationSource } from "@ai-animation-studio/shared";

import { StatusChip, type StatusTone } from "./ui/StatusChip.js";

interface BadgeProps {
  source?: GenerationSource;
  testId: string;
}

interface FinalVideoNoticeProps {
  source?: GenerationSource;
  testId: string;
}

/**
 * Where a result actually came from — drawn with the shared chip (§3.4), not a copy of it.
 *
 * The first version of this badge drew its own pill and gave `paid_provider` the done-color. On the image
 * review screens the badge sits on the same line as the scene's `StatusChip`, so a confirmed scene showed
 * two green pills side by side meaning different things — and 「실제 생성」 is not a completed state.
 * Origin is not a status, so it borrows only the two tones whose §2.1 meaning it really has:
 * a temporary scene is 주의 (`progress`), an unprovable one is 알아 두실 것 (`info`), and a paid one is
 * `neutral` — present, quiet, nothing to flag.
 */
const SOURCE_CHIP: Record<GenerationSource, { tone: StatusTone; label: string }> = {
  paid_provider: { tone: "neutral", label: "실제 생성" },
  local_fake_no_provider: { tone: "progress", label: "임시 생성" },
  unknown_legacy: { tone: "info", label: "생성 출처 확인 필요" },
};

export function GenerationSourceBadge({ source, testId }: BadgeProps) {
  // No field means the Backend did not say. Guessing here would be the one thing this whole feature exists
  // to prevent, so the badge stays away rather than claiming either answer.
  if (!source) return null;
  const chip = SOURCE_CHIP[source];
  return (
    <StatusChip tone={chip.tone} data-testid={testId}>
      {chip.label}
    </StatusChip>
  );
}

export function FinalVideoGenerationSourceNotice({ source, testId }: FinalVideoNoticeProps) {
  if (source === "paid_provider" || !source) return null;
  if (source === "local_fake_no_provider") {
    return <p data-testid={testId} className="rounded-xl border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-300">이 최종 영상에는 임시 생성 장면이 포함되어 있습니다. 검토와 내보내기는 가능하지만 Instagram 게시에는 사용할 수 없습니다.</p>;
  }
  return <p data-testid={testId} className="rounded-xl border border-sky-400/30 bg-sky-500/10 px-3 py-2 text-sm text-sky-300">이 최종 영상의 생성 출처를 확인할 수 없습니다. 게시 전 생성 기록을 확인해 주세요.</p>;
}
