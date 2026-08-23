import type { AssetType } from "@ai-animation-studio/shared";
import type { LocalAssetsRepository } from "../assets/assets.repository.js";
import type { ShortProjectCastMember } from "@ai-animation-studio/shared";

const STORY_ASSET_TYPE_LABELS: Record<AssetType, string> = {
  character: "캐릭터",
  background: "배경",
  object: "소품",
  style: "시각 스타일",
  general_reference: "일반 참고자료",
};

/** Mirrors Python's `describe_character_cast`: no tags, aliases or image paths reach the LLM prompt. */
export async function describeCharacterCast(assets: LocalAssetsRepository | undefined, cast: ShortProjectCastMember[]): Promise<string> {
  if (cast.length === 0) return "등록된 Character Asset 없음";
  const blocks: string[] = [];
  for (const [index, member] of cast.entries()) {
    const asset = assets ? await assets.get(member.assetId).catch(() => null) : null;
    blocks.push([
      `${index + 1}. 이름: ${asset?.display_name ?? member.assetId}`,
      `   구분: ${member.castRole === "protagonist" || member.castRole === "lead" ? "대표 캐릭터" : "서브 캐릭터"}`,
      `   이야기 역할: ${member.storyRole}`,
      `   설명: ${asset?.description || "별도 설명 없음"}`,
    ].join("\n"));
  }
  return blocks.join("\n\n");
}

/** Mirrors Python's `describe_story_assets`: used for the atmosphere Asset list. */
export async function describeAtmosphereAssets(assets: LocalAssetsRepository | undefined, assetIds: string[]): Promise<string> {
  const blocks: string[] = [];
  for (const assetId of [...assetIds].sort()) {
    const asset = assets ? await assets.get(assetId).catch(() => null) : null;
    if (!asset) continue;
    blocks.push([
      `- 이름: ${asset.display_name}`,
      `  유형: ${STORY_ASSET_TYPE_LABELS[asset.asset_type] ?? asset.asset_type}`,
      `  설명: ${asset.description || "별도 설명 없음"}`,
    ].join("\n"));
  }
  return blocks.join("\n\n") || "없음";
}

/** Mirrors Python's `describe_scene_reference_assets`: adds each Asset's project-local purpose. */
export async function describeSceneReferenceAssets(assets: LocalAssetsRepository | undefined, sceneReferences: { assetId: string; purpose: string }[]): Promise<string> {
  const blocks: string[] = [];
  for (const { assetId, purpose } of [...sceneReferences].sort((left, right) => left.assetId.localeCompare(right.assetId))) {
    const asset = assets ? await assets.get(assetId).catch(() => null) : null;
    if (!asset) continue;
    blocks.push([
      `- 이름: ${asset.display_name}`,
      `  유형: ${STORY_ASSET_TYPE_LABELS[asset.asset_type] ?? asset.asset_type}`,
      `  설명: ${asset.description || "별도 설명 없음"}`,
      `  사용 목적: ${purpose.trim() || "장면 대본에 필요할 때 참고"}`,
    ].join("\n"));
  }
  return blocks.join("\n\n") || "없음";
}
