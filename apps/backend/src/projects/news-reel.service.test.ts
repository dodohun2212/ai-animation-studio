import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { WorkflowState, type CreateNewsReelRequest, type NewsReelCard } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { NewsReelService } from "./news-reel.service.js";
import { LocalProjectRepository } from "./projects.repository.js";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");

let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

const CARD: NewsReelCard = {
  publisher: "연합뉴스",
  headline: { line1: "검찰청 폐지 하루 만에", line2: "후속 법률 51건 통과" },
  caption: { line1: "9월 17일 국회 본회의", line2: null },
  creditRequired: false,
};

async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "news-reel-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LocalProjectRepository(projectsRoot);
  const assets = new LocalAssetsRepository(root);
  const asset = await assets.create({ buffer: PNG, originalname: "topic.png", mimetype: "image/png" }, { assetType: "general_reference", displayName: "정치" });
  const service = new NewsReelService(projects, assets, projectsRoot, { warn: () => {} });
  return { service, projects, projectsRoot, assetId: asset.asset_id };
}

const request = (assetId: string, over: Partial<CreateNewsReelRequest> = {}): unknown => ({
  projectId: "news_1",
  assetIds: [assetId],
  card: CARD,
  clipDurationSeconds: 5,
  aspectRatio: "9:16",
  ...over,
});

describe("news reel creation", () => {
  it("writes the card onto the project, so the merge can draw it later", async () => {
    const { service, projects, assetId } = await setup();

    const result = await service.create(request(assetId));
    expect(result.project.id).toBe("news_1");

    const stored = await projects.findById("news_1");
    expect((stored.lore_context as { news_reel_card?: NewsReelCard }).news_reel_card).toEqual(CARD);
  });

  /**
   * 🔴 자막을 끄고 내레이션을 비워 둡니다. 포토카드는 내레이션이 곧 자막이지만, 뉴스 릴은 **카드가 자기 글을
   * 그립니다** — 켜 두면 같은 글이 자기 띠 밑에 한 번 더 구워집니다.
   */
  it("leaves the ordinary subtitle off, because the card draws its own text", async () => {
    const { service, projects, assetId } = await setup();

    await service.create(request(assetId));

    const stored = await projects.findById("news_1");
    const lore = stored.lore_context as { subtitles_enabled?: boolean; narration_enabled?: boolean };
    expect(lore.subtitles_enabled).toBe(false);
    expect((stored.scenes as ReadonlyArray<{ narration?: string }>).map((scene) => scene.narration)).toEqual([""]);
    expect((stored.scenes as ReadonlyArray<{ narration?: string }>).map((scene) => scene.narration)).toEqual([""]);
  });

  /** 🟠 그림은 보관함에서 복사되고 **기록에 적힙니다** — 기록이 없으면 생성이 그 장면을 돈 주고 다시 그립니다. */
  it("copies the picture and records it, so nothing pays to draw it again", async () => {
    const { service, projects, projectsRoot, assetId } = await setup();

    await service.create(request(assetId));

    const stored = await projects.findById("news_1");
    expect(stored.generated_images).toHaveLength(1);
    const written = stored.generated_images![0]!;
    expect(written.startsWith(projectsRoot)).toBe(true);
    expect((await fs.readFile(written)).equals(PNG)).toBe(true);
    expect(stored.workflow_state).toBe(WorkflowState.VideosApproved);
  });

  /**
   * 🔴 **화면이 세는 것과 서버가 세는 것이 같은 함수입니다.** 화면은 사람이 보는 쪽이고 여기는 사람이 돌아갈
   * 수 없는 쪽인데, 둘이 다르면 화면이 통과시킨 카드가 여기서 거절됩니다.
   */
  it("refuses a line the contract does not fit, and says how far over", async () => {
    const { service, assetId } = await setup();
    const long = { ...CARD, headline: { line1: "가".repeat(16), line2: CARD.headline.line2 } };

    await expect(service.create(request(assetId, { card: long }))).rejects.toMatchObject({
      response: { code: "NEWS_REEL_INVALID_REQUEST", message: expect.stringContaining("1자 넘었습니다") },
    });
  });

  /** 🔴 빈 문자열은 값이 아닙니다 — 「둘째 줄이 없다」와 「아직 안 썼다」가 같은 값이 되면 안 됩니다. */
  it("refuses an empty second caption line, which null is for", async () => {
    const { service, assetId } = await setup();
    const blank = { ...CARD, caption: { line1: CARD.caption.line1, line2: "" } };

    await expect(service.create(request(assetId, { card: blank }))).rejects.toMatchObject({
      response: { code: "NEWS_REEL_INVALID_REQUEST" },
    });
  });

  /**
   * 🔴 **출처가 필요한데 문구가 없으면 굽지 않습니다.** 칸을 둘로 나눈 이유가 바로 이 순간이고, 여기를 지나면
   * 그림은 사람이 올릴 수 있는 파일 안으로 들어갑니다.
   */
  it("refuses a picture whose credit is required but not written", async () => {
    const { service, assetId } = await setup();
    const owed = { ...CARD, creditRequired: true };

    await expect(service.create(request(assetId, { card: owed }))).rejects.toMatchObject({
      response: { code: "NEWS_REEL_INVALID_REQUEST", message: expect.stringContaining("출처") },
    });

    await expect(service.create(request(assetId, { card: { ...owed, creditText: "사진: 공공누리 제1유형" } }))).resolves.toBeTruthy();
  });

  it("refuses a picture the library cannot read, without writing a project", async () => {
    const { service, projects } = await setup();

    await expect(service.create(request("no-such-asset"))).rejects.toMatchObject({
      response: { code: "NEWS_REEL_ASSET_UNUSABLE" },
    });
    await expect(projects.findById("news_1")).rejects.toThrow();
  });

  it("refuses a field the contract does not have, rather than ignoring it", async () => {
    const { service, assetId } = await setup();

    await expect(service.create({ ...(request(assetId) as object), quote: "명언" })).rejects.toMatchObject({
      response: { code: "NEWS_REEL_INVALID_REQUEST" },
    });
  });
});
