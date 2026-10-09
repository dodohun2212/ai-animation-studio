import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { StoryAnalysisService } from "./story-analysis.service.js";
import type { NovelStoryAnalysis } from "@ai-animation-studio/shared";

const sourceText = "UNIQUE_NOVEL_SOURCE_SECRET — 옛 항구의 유리등대에서 두 사람이 만난다.";
const input = { sourceText, title: "등대", logline: "두 사람의 여정", rightsConfirmed: true as const, episodeCount: 1, sceneCount: 6 };
const output: NovelStoryAnalysis = {
  title: "유리 너머", logline: "새로운 인물들이 길을 찾는다", genre: "모험", tone: "따뜻함", theme: "용기",
  characters: [{ id: "character-1", name: "나린", role: "protagonist", appearance: "짧은 은발", personality: "침착함" }],
  episodes: [{ episodeNumber: 1, title: "첫걸음", summary: "낯선 문을 연다", mainEvent: "길을 발견한다", conflict: "문이 닫힌다", cliffhanger: "빛이 보인다", nextEpisodeHook: "누가 기다릴까" }],
  warnings: [],
};

let root: string;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

async function setup(analyze = vi.fn(async () => output)) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "story-analysis-"));
  const providerSettings = { rawCredentialIfConnected: vi.fn(async (): Promise<string | null> => "test-key") };
  const budget = new OpenAiBudget(root, 2);
  const service = new StoryAnalysisService(root, providerSettings as never, budget, analyze as never);
  const preview = await service.preview(input);
  const approve = {
    ...input,
    inputSha256: preview.preview.inputSha256,
    promptSha256: preview.preview.promptSha256,
    approved: true as const,
  };
  return { service, preview, approve, analyze, providerSettings, budget };
}

describe("StoryAnalysisService", () => {
  it("previews without a provider call or disk write and rejects changed input", async () => {
    const { service, preview, analyze } = await setup();
    expect(preview.preview).toMatchObject({ providerAvailable: true, sourceCharacterCount: sourceText.length, model: "gpt-5.6-luna" });
    expect(analyze).not.toHaveBeenCalled();
    await expect(service.approve({ ...input, inputSha256: preview.preview.inputSha256, promptSha256: "0".repeat(64), approved: true })).rejects.toMatchObject({ status: 409 });
    await expect(fs.stat(path.join(root, "story_sources"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("stores only metadata and the abstract result, records spend, and reuses the same approved input", async () => {
    const { service, approve, analyze, budget } = await setup();
    const first = await service.approve(approve);
    expect(first).toMatchObject({ analysis: { title: "유리 너머" }, reused: false });
    expect(analyze).toHaveBeenCalledTimes(1);
    const savedPath = path.join(root, "story_sources", `${approve.inputSha256}.json`);
    const saved = await fs.readFile(savedPath, "utf8");
    expect(saved).not.toContain(sourceText);
    expect(saved).not.toContain("sourceText");
    expect(await budget.spentThisMonth()).toBe(0.05);

    const second = await service.approve(approve);
    expect(second).toMatchObject({ reused: true, analysis: { title: "유리 너머" } });
    expect(analyze).toHaveBeenCalledTimes(1);
    const ledger = JSON.parse(await fs.readFile(path.join(root, "api_budget_usage.json"), "utf8")) as unknown[];
    expect(ledger).toHaveLength(1);
  });

  it("returns a saved analysis without requiring a key or remaining budget", async () => {
    const { service, approve, analyze, providerSettings } = await setup();
    await service.approve(approve);
    providerSettings.rawCredentialIfConnected.mockResolvedValue(null);
    const reused = await service.approve(approve);
    expect(reused).toMatchObject({ reused: true, saved: true });
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("blocks a concurrent second approval while the first provider attempt is in flight", async () => {
    let release!: (value: NovelStoryAnalysis) => void;
    const analyze = vi.fn(() => new Promise<NovelStoryAnalysis>((resolve) => { release = resolve; }));
    const { service, approve } = await setup(analyze);
    const first = service.approve(approve);
    await vi.waitFor(async () => expect(await fs.readdir(path.join(root, "story_sources"))).toContain(`${approve.inputSha256}.claimed`));
    await expect(service.approve(approve)).rejects.toMatchObject({ status: 409 });
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    release(output);
    await expect(first).resolves.toMatchObject({ reused: false });
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed attempt claimed so an ambiguous provider failure cannot be retried", async () => {
    const analyze = vi.fn(async () => { throw new Error("network outcome unknown"); });
    const { service, approve, budget } = await setup(analyze);
    await expect(service.approve(approve)).rejects.toMatchObject({ status: 500 });
    expect(await budget.spentThisMonth()).toBe(0.05);
    await expect(service.approve(approve)).rejects.toMatchObject({ status: 409 });
    expect(analyze).toHaveBeenCalledTimes(1);
  });

  it("requires a connected key and affirmative rights confirmation before sending", async () => {
    const { service, approve, providerSettings } = await setup();
    providerSettings.rawCredentialIfConnected.mockResolvedValueOnce(null);
    await expect(service.approve(approve)).rejects.toMatchObject({ status: 409 });
    await expect(service.preview({ ...input, rightsConfirmed: false })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses analysis before claiming or calling the provider when the monthly budget is too low", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-analysis-budget-"));
    const providerSettings = { rawCredentialIfConnected: vi.fn(async (): Promise<string | null> => "test-key") };
    const analyze = vi.fn(async () => output);
    const service = new StoryAnalysisService(root, providerSettings as never, new OpenAiBudget(root, 0.01), analyze as never);
    const preview = await service.preview(input);
    const approve = { ...input, inputSha256: preview.preview.inputSha256, promptSha256: preview.preview.promptSha256, approved: true };
    await expect(service.approve(approve)).rejects.toMatchObject({ status: 409 });
    expect(analyze).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(root, "story_sources"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});
