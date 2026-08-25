import type { LongEpisodeStatus } from "@ai-animation-studio/shared";
import type { AssetMappingStatus } from "@ai-animation-studio/shared";

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

/** Korean display labels for the mapping-review-level status (packages/shared/src/api.ts LongEpisodeAssetMappingReview.status). */
export const MAPPING_REVIEW_STATUS_LABEL: Record<"waiting" | "approved", string> = {
  waiting: "검토 대기 중",
  approved: "승인됨",
};

/** Korean display labels for AssetMappingStatus (packages/shared/src/mapping.ts), per-candidate status within a review. */
export const ASSET_MAPPING_STATUS_LABEL: Record<AssetMappingStatus, string> = {
  confirmed: "확정됨",
  suggested: "제안됨",
  ambiguous: "모호함",
  unmatched: "매칭 안 됨",
  excluded: "제외됨",
  invalid: "유효하지 않음",
};

export function assetMappingStatusLabel(status: AssetMappingStatus | string): string {
  return (ASSET_MAPPING_STATUS_LABEL as Record<string, string>)[status] ?? status;
}
