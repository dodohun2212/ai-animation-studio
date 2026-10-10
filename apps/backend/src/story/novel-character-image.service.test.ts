import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { NovelCharacterImageService } from "./novel-character-image.service.js";

const png: Buffer = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const input = { storyInputSha256: "a".repeat(64), characterId: "c1", name: "나린", appearance: "짧은 은발과 파란 외투", personality: "침착하고 호기심 많음" };
let root = "";
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = ""; vi.restoreAllMocks(); });

async function setup(generate = vi.fn(async () => ({ bytes: png, requestId: "req-test" })), limit = 2) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "novel-character-"));
  const assets = new LocalAssetsRepository(root);
  const providerSettings = { rawCredentialIfConnected: vi.fn(async (): Promise<string | null> => "test-key") };
  const budget = new OpenAiBudget(root, limit);
  const service = new NovelCharacterImageService(root, assets, providerSettings as never, budget, generate as never);
  const preview = await service.preview(input);
  const approve = { ...input, inputSha256: preview.preview.inputSha256, promptSha256: preview.preview.promptSha256, approved: true as const };
  return { assets, providerSettings, budget, service, preview, approve, generate };
}

describe("NovelCharacterImageService", () => {
  it("previews the exact paid prompt and budget without calling the image provider", async () => {
    const { service, preview, approve, generate } = await setup();
    expect(preview.preview).toMatchObject({ model: "gpt-image-2", size: "1024x1536", estimatedCostUsd: 0.1, providerAvailable: true });
    expect(preview.preview.prompt).toContain(input.appearance);
    expect(preview.preview.prompt).toContain(input.personality);
    expect(preview.preview.prompt).not.toContain(input.storyInputSha256);
    expect(preview.budget).toMatchObject({ canSpend: true, estimatedRequestCostUsd: 0.1 });
    expect(generate).not.toHaveBeenCalled();
    await expect(service.approve({ ...approve, appearance: "바뀐 외모" })).rejects.toMatchObject({ status: 409 });
    expect(generate).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(root, "novel_character_images"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("charges once, registers a character folder with its image, and reuses it after restart", async () => {
    const { assets, service, approve, generate, budget, providerSettings } = await setup();
    const existing = await assets.create({ buffer: png, originalname: "old.png", mimetype: "image/png" }, { assetType: "character", displayName: "기존 그림" });
    const first = await service.approve(approve);
    expect(first).toMatchObject({ reused: false });
    const folder = await assets.get(first.folderAssetId);
    const child = await assets.get(first.imageAssetId);
    expect(folder).toMatchObject({ asset_type: "character", is_folder: true, display_name: "나린", child_asset_ids: [child.asset_id], thumbnail_asset_id: child.asset_id });
    expect(child).toMatchObject({ parent_folder_id: folder.asset_id, role: "front", approved: false, status: "generated" });
    expect(await fs.readFile((await assets.resolveFolderRepresentativeContentPath(folder))!)).toEqual(png);
    expect((await assets.get(existing.asset_id)).display_name).toBe("기존 그림");
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await budget.spentThisMonth()).toBe(0.1);
    providerSettings.rawCredentialIfConnected.mockResolvedValue(null);
    const restarted = new NovelCharacterImageService(root, new LocalAssetsRepository(root), providerSettings as never, budget, generate as never);
    expect(await restarted.approve(approve)).toMatchObject({ ...first, reused: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await budget.spentThisMonth()).toBe(0.1);
  });

  it("keeps an ambiguous provider attempt claimed and never automatically resends", async () => {
    const generate = vi.fn(async (): Promise<{ bytes: Buffer; requestId: string }> => { throw new Error("connection lost"); });
    const { service, approve, budget } = await setup(generate);
    await expect(service.approve(approve)).rejects.toMatchObject({ status: 500 });
    await expect(service.approve(approve)).rejects.toMatchObject({ status: 409 });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await budget.spentThisMonth()).toBe(0.1);
  });

  it("recovers a paid image when the Library index write fails, without paying again", async () => {
    const { assets, service, approve, generate, budget } = await setup();
    const realCreate = assets.createNovelCharacterFolder.bind(assets);
    const create = vi.spyOn(assets, "createNovelCharacterFolder").mockRejectedValueOnce(new Error("disk unavailable")).mockImplementation(realCreate);
    await expect(service.approve(approve)).rejects.toMatchObject({ status: 500 });
    expect(await fs.readFile(path.join(root, "novel_character_images", `${approve.inputSha256}.png`))).toEqual(png);
    const recovered = await service.approve(approve);
    expect(recovered).toMatchObject({ reused: true });
    expect(create).toHaveBeenCalledTimes(2);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await budget.spentThisMonth()).toBe(0.1);
  });

  it("keeps the unrecorded spend warning when a generated folder is reused after restart", async () => {
    const { service, approve, generate, budget, assets, providerSettings } = await setup();
    vi.spyOn(budget, "record").mockRejectedValueOnce(new Error("ledger write failed"));
    expect(await service.approve(approve)).toMatchObject({ reused: false, spendUnrecorded: true });
    const restarted = new NovelCharacterImageService(root, new LocalAssetsRepository(root), providerSettings as never, budget, generate as never);
    expect(await restarted.approve(approve)).toMatchObject({ reused: true, spendUnrecorded: true });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(await assets.findNovelCharacterFolder(approve.inputSha256)).not.toBeNull();
  });

  it("blocks missing keys and insufficient budget before a claim or provider request", async () => {
    const { service, approve, generate, providerSettings } = await setup(undefined, 0);
    await expect(service.approve(approve)).rejects.toMatchObject({ status: 409 });
    providerSettings.rawCredentialIfConnected.mockResolvedValue(null);
    await expect(service.approve(approve)).rejects.toMatchObject({ status: 409 });
    expect(generate).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(root, "novel_character_images"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
