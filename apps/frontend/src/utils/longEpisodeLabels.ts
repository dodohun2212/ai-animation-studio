import { LONG_EPISODE_STATUSES, type LongEpisodeStatus } from "@ai-animation-studio/shared";

/** Korean display labels for LongEpisodeStatus (packages/shared/src/api.ts), used across the Long Project screens. */
export const LONG_EPISODE_STATUS_LABEL: Record<LongEpisodeStatus, string> = {
  planned: "계획됨",
  outline_ready: "스토리 개요 완료",
  script_review: "대본 검토 중",
  script_approved: "대본 승인됨",
  waiting_for_asset_mapping_review: "에셋 매핑 검토 대기",
  asset_mapping_approved: "에셋 매핑 승인됨",
  generating_images: "이미지 생성 중",
  images_ready: "이미지 준비됨",
  images_review: "이미지 검토 중",
  waiting_for_video_confirmation: "영상 생성 확인 대기",
  videos_generating: "영상 생성 중",
  videos_ready: "영상 준비됨",
  videos_review: "영상 검토 중",
  videos_approved: "영상 승인됨",
  interrupted: "중단됨",
  rendering: "렌더링 중",
  completed: "완료",
  failed: "실패",
};

export function longEpisodeStatusLabel(status: LongEpisodeStatus | string): string {
  return (LONG_EPISODE_STATUS_LABEL as Record<string, string>)[status] ?? status;
}

/*
 * Three exports lived here and nothing imported any of them: MAPPING_REVIEW_STATUS_LABEL, and a second
 * AssetMappingStatus table with its accessor. MappingReviewScreen keeps its own copy, so the dead one had
 * already drifted — it said 확정됨 where the screen says 확인됨, and spelled 매칭 안 됨 where the screen had
 * 매칭 안됨. Two tables for one enum cannot be kept in step by anything but memory, and the unread one is the
 * one that loses. The screen's is the one people actually read, so that is the one that stays — with the
 * spacing corrected to 매칭 안 됨, which is the only place the dead table was right.
 *
 * The 확인됨 / 확정됨 split is deliberately left alone: 확정 is what the image and video screens call approving
 * a thing, and reusing it here for "this link is settled" would make one word mean two jobs. That is a wording
 * decision for a person, not a tidy-up.
 */

/**
 * The Episode's steps in the order they happen.
 *
 * A screen that refuses an action has to say which step is actually next, and "next" needs direction — the
 * image screen learned this the hard way, with one sentence naming 참고 이미지 연결 for every state before it,
 * including states where that screen cannot even open. It lived as a private copy in one component; the video
 * screen needs the same answer, and two copies of a workflow order is how two screens start disagreeing about
 * what comes after what.
 *
 * Derived from the shared list rather than written out again. It used to name sixteen of the eighteen statuses
 * by hand — the backend forbids exactly that shape in its own sources (episode-status-list.test.ts, threshold
 * twelve) because a copy that misses the next status added is the defect that keeps happening; the frontend
 * had no such guard, so this copy was invisible. Deriving makes a new status appear here by construction, and
 * the shared array is maintained in workflow order for exactly this reason.
 */
/** Not points on the line: a run stops at one of these from wherever it was, so neither is "before" anything. */
const OFF_THE_LINE: readonly LongEpisodeStatus[] = ["interrupted", "failed"];

export const LONG_EPISODE_STATUS_ORDER: readonly LongEpisodeStatus[] =
  LONG_EPISODE_STATUSES.filter((status) => !OFF_THE_LINE.includes(status));

/** True only when both statuses are on the line above and `status` comes first. Unknown never reads as before. */
export function isLongEpisodeStatusBefore(status: LongEpisodeStatus | undefined, marker: LongEpisodeStatus): boolean {
  if (!status) return false;
  const at = LONG_EPISODE_STATUS_ORDER.indexOf(status);
  return at !== -1 && at < LONG_EPISODE_STATUS_ORDER.indexOf(marker);
}
