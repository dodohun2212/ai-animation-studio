import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { describeAtmosphereAssets, describeCharacterCast, describeSceneReferenceAssets } from "./story-asset-metadata.js";

const pngFront = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const pngSide = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");
const pngBack = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVSdAIokKEkrLhgvJI9ZlSAAAAAASUVORK5CYII=", "base64");
const pngPlain = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVTdQMpkaIlrblhvZI9ZlSAAAAAASUVORK5CYII=", "base64");
let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "story-asset-metadata-"));
  const assets = new LocalAssetsRepository(root);
  const folder = await assets.createFolder({ assetType: "character", displayName: "주인공", description: "밝고 용감한 주인공, 은발 머리" });
  const front = await assets.create({ buffer: pngFront, originalname: "front.png" }, { assetType: "character", displayName: "정면", description: "정면에서는 미소를 짓고 있다" });
  const side = await assets.create({ buffer: pngSide, originalname: "side.png" }, { assetType: "character", displayName: "옆모습", description: "옆모습에서는 긴 망토가 드러난다" });
  const undescribed = await assets.create({ buffer: pngBack, originalname: "back.png" }, { assetType: "character", displayName: "뒷모습" });
  await assets.setParentFolder(front.asset_id, folder.asset_id);
  await assets.setParentFolder(side.asset_id, folder.asset_id);
  await assets.setParentFolder(undescribed.asset_id, folder.asset_id);
  return { assets, folder };
}

describe("story-asset-metadata folder description merging", () => {
  it("describeCharacterCast includes the Folder's common description plus each described child's individual description", async () => {
    const { assets, folder } = await setup();
    const description = await describeCharacterCast(assets, [{ assetId: folder.asset_id, castRole: "protagonist", storyRole: "주인공" }]);
    expect(description).toContain("설명: 밝고 용감한 주인공, 은발 머리");
    expect(description).toContain("하위 이미지별 개별 특징: 정면: 정면에서는 미소를 짓고 있다 / 옆모습: 옆모습에서는 긴 망토가 드러난다");
    expect(description).not.toContain("뒷모습:");
  });

  it("describeAtmosphereAssets and describeSceneReferenceAssets also merge Folder child descriptions", async () => {
    const { assets, folder } = await setup();
    const atmosphere = await describeAtmosphereAssets(assets, [folder.asset_id]);
    expect(atmosphere).toContain("설명: 밝고 용감한 주인공, 은발 머리");
    expect(atmosphere).toContain("하위 이미지별 개별 특징: 정면: 정면에서는 미소를 짓고 있다 / 옆모습: 옆모습에서는 긴 망토가 드러난다");

    const sceneReference = await describeSceneReferenceAssets(assets, [{ assetId: folder.asset_id, purpose: "표정 참고" }]);
    expect(sceneReference).toContain("하위 이미지별 개별 특징: 정면: 정면에서는 미소를 짓고 있다 / 옆모습: 옆모습에서는 긴 망토가 드러난다");
    expect(sceneReference).toContain("사용 목적: 표정 참고");
  });

  it("omits the child-description line entirely for a non-Folder Asset", async () => {
    const { assets } = await setup();
    const plain = await assets.create({ buffer: pngPlain, originalname: "plain.png" }, { assetType: "character", displayName: "단일 캐릭터", description: "단독 설명" });
    const description = await describeCharacterCast(assets, [{ assetId: plain.asset_id, castRole: "protagonist", storyRole: "주인공" }]);
    expect(description).toContain("설명: 단독 설명");
    expect(description).not.toContain("하위 이미지별 개별 특징");
  });
});
