import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { INestApplication } from "@nestjs/common";
import { API_ROUTES, type ApproveNovelStoryAnalysisResponse } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBackendApp } from "../create-backend-app.js";

let app: INestApplication | undefined;
let root: string | undefined;
const originalEnvironment = new Map<string, string | undefined>();
const envKeys = ["LEARNING_DATA_ROOT", "PROVIDER_SETTINGS_ROOT", "PROMPTS_ROOT"];

afterEach(async () => {
  vi.unstubAllGlobals();
  await app?.close(); app = undefined;
  for (const key of envKeys) {
    const prior = originalEnvironment.get(key);
    if (prior === undefined) delete process.env[key]; else process.env[key] = prior;
  }
  originalEnvironment.clear();
  if (root) await fs.rm(root, { recursive: true, force: true });
  root = undefined;
});

describe.sequential("Story analysis AppModule HTTP flow", () => {
  it("previews and approves the novel, then registers a mocked character image without the source text", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-analysis-app-"));
    for (const key of envKeys) originalEnvironment.set(key, process.env[key]);
    process.env.LEARNING_DATA_ROOT = path.join(root, "learning_data");
    process.env.PROVIDER_SETTINGS_ROOT = root;
    process.env.PROMPTS_ROOT = path.join(root, "prompts");
    const promptRoot = path.join(root, "prompts", "story");
    await fs.mkdir(promptRoot, { recursive: true });
    await fs.writeFile(path.join(promptRoot, "story_generation.txt"), "topic=$topic", "utf8");

    app = await createBackendApp({ logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const realFetch = globalThis.fetch;
    const providerCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.openai.com/v1/images/generations") {
        providerCalls.push(String(url));
        const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=";
        return new Response(JSON.stringify({ data: [{ b64_json: png }] }), { status: 200 });
      }
      if (String(url) === "https://api.openai.com/v1/responses") {
        providerCalls.push(String(url));
        const request = JSON.parse(String(init?.body)) as { text?: { format?: { name?: string } } };
        if (request.text?.format?.name === "novel_story_chunk_summary") {
          const summary = { themes: ["희망"], characterNotes: ["익명의 주인공은 집을 떠난다."], events: ["길을 떠난다."], unresolvedQuestions: ["어디로 향할까?"] };
          return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(summary) }] }] }), { status: 200 });
        }
        const response = {
          title: "새 항구", logline: "새로운 시작", genre: "모험", tone: "따뜻함", theme: "용기",
          characters: [{ name: "나린", role: "protagonist", appearance: "짧은 은발", personality: "침착함" }],
          episodes: [{ episodeNumber: 1, title: "첫걸음", summary: "길을 발견한다", mainEvent: "문을 연다", conflict: "문이 닫힌다", cliffhanger: "빛이 보인다", nextEpisodeHook: "누가 왔을까" }],
          warnings: [],
        };
        return new Response(JSON.stringify({ output: [{ type: "message", content: [{ type: "output_text", text: JSON.stringify(response) }] }] }), { status: 200 });
      }
      return realFetch(url, init);
    }));

    const sourceText = "APP_MODULE_PRIVATE_NOVEL — 오래된 유리등대 아래에서 두 사람이 만난다.";
    const input = { sourceText, title: "유리등대", logline: "숨겨진 길을 찾는다", rightsConfirmed: true, episodeCount: 1, sceneCount: 6 };
    const save = await fetch(`${base}/settings/providers/openai/credential`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ value: "sk-story-analysis-test-key" }),
    });
    expect(save.status).toBe(200);
    const previewResponse = await fetch(`${base}${API_ROUTES.novelStoryAnalysisPreview}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input),
    });
    const preview = await previewResponse.json() as { preview: { inputSha256: string; promptSha256: string; providerAvailable: boolean } };
    expect(previewResponse.status).toBe(201);
    expect(preview.preview.providerAvailable).toBe(true);
    expect(providerCalls).toHaveLength(0);

    const longInput = { ...input, sourceText: "나".repeat(60_001) };
    const longPreviewResponse = await fetch(`${base}${API_ROUTES.novelStoryAnalysisPreview}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(longInput),
    });
    expect(longPreviewResponse.status).toBe(201);
    const longPreview = await longPreviewResponse.json() as { preview: { inputSha256: string; promptSha256: string; providerCallCount: number; estimatedCostUsd: number } };
    expect(longPreview.preview).toMatchObject({ providerCallCount: 3, estimatedCostUsd: 0.15 });
    expect(providerCalls).toHaveLength(0);

    const approveResponse = await fetch(`${base}${API_ROUTES.novelStoryAnalysis}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, inputSha256: preview.preview.inputSha256, promptSha256: preview.preview.promptSha256, approved: true }),
    });
    expect(approveResponse.status).toBe(201);
    const approved = await approveResponse.json() as ApproveNovelStoryAnalysisResponse;
    expect(approved).toMatchObject({ analysis: { title: "새 항구" }, saved: true });
    expect(providerCalls).toHaveLength(1);

    const files = await fs.readdir(path.join(root, "learning_data", "story_sources"));
    const saved = await fs.readFile(path.join(root, "learning_data", "story_sources", files.find((file) => file.endsWith(".json"))!), "utf8");
    expect(saved).not.toContain(sourceText);
    const ledger = JSON.parse(await fs.readFile(path.join(root, "learning_data", "api_budget_usage.json"), "utf8")) as unknown[];
    expect(ledger).toHaveLength(1);

    const character = { storyInputSha256: preview.preview.inputSha256, characterId: "c1", name: "나린", appearance: "짧은 은발", personality: "침착함" };
    const imagePreviewResponse = await fetch(`${base}${API_ROUTES.novelCharacterImagePreview}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(character),
    });
    expect(imagePreviewResponse.status).toBe(201);
    const imagePreview = await imagePreviewResponse.json() as { preview: { inputSha256: string; promptSha256: string; prompt: string } };
    expect(imagePreview.preview.prompt).not.toContain(sourceText);
    expect(providerCalls).toHaveLength(1);
    const imageResponse = await fetch(`${base}${API_ROUTES.novelCharacterImageGenerate}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...character, inputSha256: imagePreview.preview.inputSha256, promptSha256: imagePreview.preview.promptSha256, approved: true }),
    });
    expect(imageResponse.status).toBe(201);
    const created = await imageResponse.json() as { folderAssetId: string; imageAssetId: string; reused: boolean };
    expect(created).toMatchObject({ reused: false });
    const assetResponse = await fetch(`${base}${API_ROUTES.asset(created.folderAssetId)}`);
    expect(assetResponse.status).toBe(200);
    const savedFolder = await assetResponse.json() as { asset: { isFolder: boolean; thumbnailAssetId: string } };
    expect(savedFolder.asset).toMatchObject({ isFolder: true, thumbnailAssetId: created.imageAssetId });
    expect(providerCalls).toHaveLength(2);
    const finalLedger = JSON.parse(await fs.readFile(path.join(root, "learning_data", "api_budget_usage.json"), "utf8")) as unknown[];
    expect(finalLedger).toHaveLength(2);

    const analysis = approved.analysis;
    const projectResponse = await fetch(`${base}${API_ROUTES.novelStoryProjectCreate}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        projectId: "novel_m3_integration", source: approved.source, analysis, protagonistAssetId: created.folderAssetId,
        settings: {
          title: analysis.title, logline: analysis.logline, overview: analysis.logline, genre: analysis.genre,
          tone: analysis.tone, theme: analysis.theme, episodeCount: analysis.episodes.length, sceneCount: 6,
          clipDurationSeconds: 5, aspectRatio: "9:16", audience: "", notes: "", startingState: "", midpoint: "",
          endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false,
        },
      }),
    });
    expect(projectResponse.status).toBe(201);
    const project = await projectResponse.json() as { project: { outlineStatus: string; episodes: Array<{ status: string }> } };
    expect(project.project.outlineStatus).toBe("outline_ready");
    expect(project.project.episodes.every((episode) => episode.status === "outline_ready")).toBe(true);
    const bible = JSON.parse(await fs.readFile(path.join(root, "learning_data", "projects", "novel_m3_integration", "long_story", "story_bible.json"), "utf8")) as { basic: { protagonist_asset_link: { asset_id: string } } };
    expect(bible.basic.protagonist_asset_link.asset_id).toBe(created.folderAssetId);

    const longApprove = await fetch(`${base}${API_ROUTES.novelStoryAnalysis}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...longInput, inputSha256: longPreview.preview.inputSha256, promptSha256: longPreview.preview.promptSha256, approved: true }),
    });
    expect(longApprove.status).toBe(201);
    const longAnalysis = await longApprove.json() as ApproveNovelStoryAnalysisResponse;
    expect(longAnalysis).toMatchObject({ analysis: { title: "새 항구" }, reused: false, saved: true });
    expect(providerCalls).toHaveLength(5);
    const totalLedger = JSON.parse(await fs.readFile(path.join(root, "learning_data", "api_budget_usage.json"), "utf8")) as unknown[];
    expect(totalLedger).toHaveLength(5);
  });
});
