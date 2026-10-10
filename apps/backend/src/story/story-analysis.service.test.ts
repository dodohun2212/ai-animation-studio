import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { StoryAnalysisService } from "./story-analysis.service.js";
import type { NovelStoryAnalysis } from "@ai-animation-studio/shared";

const sourceText = "UNIQUE_NOVEL_SOURCE_SECRET — 옛 항구의 유리등대에서 두 사람이 만난다.";
const input = { sourceText, title: "등대", logline: "두 사람의 여정", rightsConfirmed: true as const, episodeCount: 1, sceneCount: 6 };
const sourceCitation = { provider: "project-gutenberg" as const, sourceId: "11", title: "Alice's Adventures in Wonderland", authors: [{ name: "Lewis Carroll", deathYear: 1898 }], translators: [], language: "en" as const, sourceUrl: "https://www.gutenberg.org/ebooks/11", rightsEvidence: "Korean term filter", fullSourceCharacterCount: 5, selectedCharacterCount: 5 };
const output: NovelStoryAnalysis = {
  title: "유리 너머", logline: "새로운 인물들이 길을 찾는다", genre: "모험", tone: "따뜻함", theme: "용기",
  characters: [{ id: "character-1", name: "나린", role: "protagonist", appearance: "짧은 은발", personality: "침착함" }],
  episodes: [{ episodeNumber: 1, title: "첫걸음", summary: "낯선 문을 연다", mainEvent: "길을 발견한다", conflict: "문이 닫힌다", cliffhanger: "빛이 보인다", nextEpisodeHook: "누가 기다릴까" }],
  warnings: [],
};
const chunkSummary = { themes: ["새 출발"], characterNotes: ["익명의 주인공은 집을 떠난다."], events: ["길을 떠난다."], unresolvedQuestions: ["어디로 향할까?"] };

let root: string;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); vi.restoreAllMocks(); });

async function setup(analyze = vi.fn(async () => output), analyzeChunk = vi.fn(async () => chunkSummary), requestInput = input) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "story-analysis-"));
  const providerSettings = { rawCredentialIfConnected: vi.fn(async (): Promise<string | null> => "test-key") };
  const budget = new OpenAiBudget(root, 2);
  const service = new StoryAnalysisService(root, providerSettings as never, budget, analyze as never, undefined, analyzeChunk as never);
  const preview = await service.preview(requestInput);
  const approve = {
    ...requestInput,
    inputSha256: preview.preview.inputSha256,
    promptSha256: preview.preview.promptSha256,
    approved: true as const,
  };
  return { service, preview, approve, analyze, analyzeChunk, providerSettings, budget };
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

  it("accepts and persists a catalog citation without storing the imported source text", async () => {
    const requestInput = { ...input, source: sourceCitation };
    const { service, approve, preview } = await setup(undefined, undefined, requestInput);
    expect(preview.preview).toMatchObject({ providerAvailable: true });

    const result = await service.approve(approve);

    expect(result.source.source).toEqual(sourceCitation);
    const saved = await fs.readFile(path.join(root, "story_sources", `${approve.inputSha256}.json`), "utf8");
    expect(saved).toContain("Lewis Carroll");
    expect(saved).not.toContain(sourceText);
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

  it("uses one prompt through 60,000 characters and rejects text above 120,000", async () => {
    const { service, analyze } = await setup();
    const single = await service.preview({ ...input, sourceText: "가".repeat(60_000) });
    expect(single.preview).toMatchObject({ sourceCharacterCount: 60_000, sourceChunkCount: 1, providerCallCount: 1, estimatedCostUsd: 0.05 });
    expect(single.preview.prompts).toHaveLength(1);
    expect(analyze).not.toHaveBeenCalled();
    await expect(service.preview({ ...input, sourceText: "가".repeat(120_001) })).rejects.toMatchObject({ status: 400 });
    await expect(service.preview({ ...input, sourceText: "가".repeat(120_000) })).resolves.toMatchObject({ preview: { sourceChunkCount: 2, providerCallCount: 3 } });
  });

  it("does not split a UTF-16 surrogate pair across chunk prompts", async () => {
    const { service } = await setup();
    const sourceText = `${"가".repeat(59_999)}😀${"나".repeat(59_999)}`;
    const preview = await service.preview({ ...input, sourceText });
    expect(preview.preview.sourceChunkCount).toBe(3);
    expect(preview.preview.prompts[0]).toContain(`${"가".repeat(59_999)}\n\n자료 끝.`);
    expect(preview.preview.prompts[1]).toContain(`😀${"나".repeat(59_998)}`);
  });

  it("splits 60,001–120,000 characters into 60,000-character blocks plus one synthesis call", async () => {
    const analyze = vi.fn(async () => output);
    const analyzeChunk = vi.fn(async () => chunkSummary);
    const { service, budget } = await setup(analyze, analyzeChunk);
    const longInput = { ...input, sourceText: "가".repeat(60_001) };
    const preview = await service.preview(longInput);
    expect(preview.preview).toMatchObject({ sourceCharacterCount: 60_001, sourceChunkCount: 2, providerCallCount: 3, estimatedCostUsd: 0.15 });
    expect(preview.preview.prompts).toHaveLength(3);
    expect(preview.preview.prompts[0]).toContain("자료 순서: 1/2");
    expect(preview.preview.prompts[1]).toContain("자료 순서: 2/2");
    expect(preview.preview.prompts[2]).toContain("승인 후 각 본문 부분");
    expect(analyzeChunk).not.toHaveBeenCalled();
    const approved = await service.approve({ ...longInput, inputSha256: preview.preview.inputSha256, promptSha256: preview.preview.promptSha256, approved: true });
    expect(approved.analysis).toEqual(output);
    expect(analyzeChunk).toHaveBeenCalledTimes(2);
    expect(analyze).toHaveBeenCalledTimes(1);
    expect(await budget.spentThisMonth()).toBeCloseTo(0.15);
    const stored = await fs.readFile(path.join(root, "story_sources", `${preview.preview.inputSha256}.json`), "utf8");
    expect(stored).not.toContain("가가가");
    expect(stored).not.toContain("sourceText");
  });

  it("preflights the full chunk cost before a claim or provider call", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-analysis-long-budget-"));
    const analyze = vi.fn(async () => output);
    const analyzeChunk = vi.fn(async () => chunkSummary);
    const providerSettings = { rawCredentialIfConnected: vi.fn(async (): Promise<string | null> => "test-key") };
    const service = new StoryAnalysisService(root, providerSettings as never, new OpenAiBudget(root, 0.1), analyze as never, undefined, analyzeChunk as never);
    const longInput = { ...input, sourceText: "가".repeat(60_001) };
    const preview = await service.preview(longInput);
    await expect(service.approve({ ...longInput, inputSha256: preview.preview.inputSha256, promptSha256: preview.preview.promptSha256, approved: true })).rejects.toMatchObject({ status: 409 });
    expect(analyzeChunk).not.toHaveBeenCalled();
    expect(analyze).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(root, "story_sources"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps a partially failed multi-call analysis claimed and records attempted spend", async () => {
    const analyzeChunk = vi.fn().mockResolvedValueOnce(chunkSummary).mockRejectedValueOnce(new Error("unknown network outcome"));
    const analyze = vi.fn(async () => output);
    const { service, budget } = await setup(analyze, analyzeChunk);
    const longInput = { ...input, sourceText: "가".repeat(60_001) };
    const preview = await service.preview(longInput);
    const approval = { ...longInput, inputSha256: preview.preview.inputSha256, promptSha256: preview.preview.promptSha256, approved: true };
    await expect(service.approve(approval)).rejects.toMatchObject({ status: 500 });
    expect(analyzeChunk).toHaveBeenCalledTimes(2);
    expect(analyze).not.toHaveBeenCalled();
    expect(await budget.spentThisMonth()).toBe(0.1);
    await expect(service.approve(approval)).rejects.toMatchObject({ status: 409 });
    expect(analyzeChunk).toHaveBeenCalledTimes(2);
  });
});
