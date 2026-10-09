import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { API_ROUTES } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppModule } from "../app.module.js";

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
  it("previews without a Provider call, then approves once and persists no original novel text", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "story-analysis-app-"));
    for (const key of envKeys) originalEnvironment.set(key, process.env[key]);
    process.env.LEARNING_DATA_ROOT = path.join(root, "learning_data");
    process.env.PROVIDER_SETTINGS_ROOT = root;
    process.env.PROMPTS_ROOT = path.join(root, "prompts");
    const promptRoot = path.join(root, "prompts", "story");
    await fs.mkdir(promptRoot, { recursive: true });
    await fs.writeFile(path.join(promptRoot, "story_generation.txt"), "topic=$topic", "utf8");

    app = await NestFactory.create(AppModule, { logger: false });
    await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const realFetch = globalThis.fetch;
    const providerCalls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url) === "https://api.openai.com/v1/responses") {
        providerCalls.push(String(url));
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

    const approveResponse = await fetch(`${base}${API_ROUTES.novelStoryAnalysis}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...input, inputSha256: preview.preview.inputSha256, promptSha256: preview.preview.promptSha256, approved: true }),
    });
    expect(approveResponse.status).toBe(201);
    const approved = await approveResponse.json() as { analysis: { title: string }; saved: boolean };
    expect(approved).toMatchObject({ analysis: { title: "새 항구" }, saved: true });
    expect(providerCalls).toHaveLength(1);

    const files = await fs.readdir(path.join(root, "learning_data", "story_sources"));
    const saved = await fs.readFile(path.join(root, "learning_data", "story_sources", files.find((file) => file.endsWith(".json"))!), "utf8");
    expect(saved).not.toContain(sourceText);
    const ledger = JSON.parse(await fs.readFile(path.join(root, "learning_data", "api_budget_usage.json"), "utf8")) as unknown[];
    expect(ledger).toHaveLength(1);
  });
});
