import * as crypto from "node:crypto";
import { ProjectLockTimeoutError, withProjectLock } from "../videos/project-lock.js";
import { isBudgetLedgerUnreadable, OPENAI_LEDGER_FILE, recordSpend, spendUnrecordedWarning } from "../providers/budget-ledger.js";
import { existsSync } from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { Injectable } from "@nestjs/common";
import { isShortProjectCastLead, STORY_ESTIMATED_COST_USD, WorkflowState } from "@ai-animation-studio/shared";
import type { ApproveStoryPromptRequest, ApproveStoryPromptResponse, CreateStoryPromptDraftPreviewResponse, CreateStoryPromptPreviewResponse, RegenerateStoryPromptResponse, StoryPromptPreview } from "@ai-animation-studio/shared";
import { toApiProject } from "../projects/project.mapper.js";
import { toShortProjectAssetReferences } from "../projects/project-asset-references.js";
import { toShortProjectCast } from "../projects/project-cast.js";
import { previousSceneContext } from "../projects/project-continuity.js";
import { applyShortProjectSettings, parseShortProjectSettings, toShortProjectSettings } from "../projects/project-settings.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import type { LocalAssetsRepository } from "../assets/assets.repository.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { generateLocalStory, type StoredStory } from "./story-generation.service.js";
import { budgetPreviewFor, OpenAiBudget, OpenAiBudgetExceededError } from "../providers/openai-budget.js";
import { OPENAI_STORY_MODEL, OpenAiStoryAdapterError, callOpenAiStoryApi } from "./openai-story-adapter.js";
import { describeAtmosphereAssets, describeCharacterCast, describeSceneReferenceAssets } from "./story-asset-metadata.js";
import { invalidStoryRequest, storyBudgetExceeded, storyBudgetLedgerUnreadable, storyGenerationFailed, storyGenerationNotAllowed, storyLocked, storyPromptStale, storyProviderError, storyRegenerationNotAllowed, storyStorageError } from "./story-api.error.js";

/** The only states where a Story exists but no scene image has been generated for it yet — see RegenerateStoryPromptRequest's doc comment for why the cutoff is drawn there. */
const REGENERATABLE_STATES: ReadonlySet<string> = new Set([WorkflowState.WaitingForAssetMappingReview, WorkflowState.AssetMappingApproved]);

const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const value = (record: Record<string, unknown>, key: string, fallback = "") => typeof record[key] === "string" ? record[key] as string : fallback;

/**
 * What the prompt says where the person left a creative choice open, word for word from the Python baseline
 * (generation_service.py's AUTONOMOUS_SETTING). It is an instruction — "you decide this one" — and it is the
 * reason a blank is not an acceptable substitute: the label with nothing after it reads as a value that went
 * missing, and the model fills the gap by guessing what was supposed to be there.
 *
 * Measured on a copy of the real projects before this existed: all eight sent `대사 스타일:` with nothing after
 * it, three of them sent six such labels, and one sent seven. Every one of those was a paid request.
 */
const AUTONOMOUS_SETTING = "자율";

/**
 * The source is real ESM (apps/backend's package.json has `"type": "module"`), where `import.meta.url` is the
 * correct way to find this module's own directory — but the `package` script also bundles this same source into a
 * single CJS file with esbuild, and esbuild empties `import.meta` in CJS output rather than shimming it (it warns
 * "is not available... and will be empty" at build time). Evaluating `import.meta.url` there produces `undefined`,
 * and `new URL(".", undefined)` throws immediately, which would crash the packaged app at startup. `__dirname` is
 * always defined in that bundled CJS output and never defined in genuine ESM, so branching on it keeps the
 * `import.meta.url` expression unreached (never evaluated, never thrown) whenever `__dirname` is available.
 */
function currentModuleDirectory(): string {
  const cjsDirname: string | undefined = typeof __dirname === "string" ? __dirname : undefined;
  return cjsDirname ?? fileURLToPath(new URL(".", import.meta.url));
}

/**
 * `prompts/` is a static repository asset (checked into git, not per-run data), so its location must never depend
 * on the launching process's cwd — unlike `learning_data/`, which is intentionally cwd-relative because every real
 * launch path (`nest start --watch`, `node dist/main.js`, the packaged `dist-bundle`) always runs from
 * `apps/backend`, making that a consistent per-install data directory rather than a bug.
 *
 * The module's own file location is a stable anchor, but its depth below the repository root differs by build
 * output: dev (`apps/backend/src/story/`) and `nest build` (`apps/backend/dist/story/`) both sit 4 directories
 * below the repo root, the single-file esbuild bundle (`apps/backend/dist-bundle/main.cjs`) sits only 3 below, and
 * the packaged Electron app ships `prompts/` as a sibling of the bundle (see apps/desktop/package.json's
 * extraResources). Rather than hardcode one depth, try each candidate and use the first that actually contains
 * the story template.
 */
function promptsRoot(): string {
  if (process.env.PROMPTS_ROOT) return process.env.PROMPTS_ROOT;
  const moduleDirectory = currentModuleDirectory();
  const candidates = [
    path.resolve(moduleDirectory, "../../../../prompts"), // dev: src/story/ -> repo root; build: dist/story/ -> repo root
    path.resolve(moduleDirectory, "../../../prompts"), // bundled: dist-bundle/ -> repo root (e.g. running dist-bundle/main.cjs from a repo checkout)
    path.resolve(moduleDirectory, "prompts"), // packaged: prompts/ copied as a sibling of the bundle
  ];
  return candidates.find((candidate) => existsSync(path.join(candidate, "story", "story_generation.txt"))) ?? candidates[0]!;
}

/** Mirrors Python Template.safe_substitute for this fixed local template. */
export function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\$\$|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, name: string | undefined) => {
    if (match === "$$") return "$";
    return name && name in variables ? variables[name]! : match;
  }).trim();
}

async function promptVariables(stored: StoredProject, assets?: LocalAssetsRepository): Promise<Record<string, string>> {
  const settings = toShortProjectSettings(stored);
  const profile = object(stored.style_profile);
  const notes = settings.styleNotes;
  const story = object(stored.story);
  const cast = toShortProjectCast(stored);
  const castLead = cast.find((member) => isShortProjectCastLead(member.castRole));
  const castLeadName = castLead && assets ? (await assets.get(castLead.assetId).catch(() => null))?.display_name : undefined;
  const { atmosphereAssetIds, sceneReferenceAssets } = toShortProjectAssetReferences(stored);
  return {
    project_name: settings.projectName || "별도 이름 없음",
    topic: settings.topic,
    full_story: settings.fullStory || "별도 전체 줄거리 없음",
    genre: settings.genre,
    mood: settings.mood,
    lore: settings.lore || AUTONOMOUS_SETTING,
    // The template asks "대표 캐릭터" twice — once as this line and once inside the cast block, which marks a
    // member 구분: 대표 캐릭터 — and nothing kept the two in agreement. A project with a cast lead and a
    // differently-typed name handed the model two answers to the same question, three lines apart, directly
    // above the instruction not to mix character names. The cast is the richer of the two (name, story role,
    // description, per-child features), so when it names a lead, this line says that lead.
    // `?? settings.character` still lands on the empty string when nobody has named anyone — the baseline left
    // this one bare too, and a project created and generated straight away sends `대표 캐릭터:` with nothing
    // after it. Same word as the other open choices: it is a choice left open, not a value that went missing.
    character: castLeadName || settings.character || AUTONOMOUS_SETTING,
    character_cast_metadata: await describeCharacterCast(assets, cast),
    atmosphere_asset_metadata: await describeAtmosphereAssets(assets, atmosphereAssetIds),
    scene_reference_asset_metadata: await describeSceneReferenceAssets(assets, sceneReferenceAssets),
    // `??` was wrong here as well as blank: a stored empty string is not "absent", so `?? fallback` kept it and
    // the label went out bare. `||` is what Python used and what the measurement above needed.
    //
    // The template prints a heading for each of these and then tells the model what to do with what follows.
    // An empty value leaves the heading standing over nothing, which reads as content that went missing rather
    // than content that does not exist — so both say so, in Python's own words for the same two blanks. The
    // three metadata variables above already carry their own "없음" sentences.
    //
    // Section 5 has no selector on this side: what Python gathered as one "extra Assets" list is the cast,
    // atmosphere and scene-reference selections above, each with its own section. So it is always this
    // sentence today, and the heading now says as much instead of trailing off.
    project_asset_metadata: "선택한 추가 Asset 없음",
    previous_scene_context: previousSceneContext(stored) || "연결된 이전 이야기 없음",
    visual_style: notes.visualStyle || value(profile, "visual_style", AUTONOMOUS_SETTING) || AUTONOMOUS_SETTING,
    color: notes.color || value(profile, "color", AUTONOMOUS_SETTING) || AUTONOMOUS_SETTING,
    lighting: notes.lighting || value(profile, "lighting", AUTONOMOUS_SETTING) || AUTONOMOUS_SETTING,
    camera: notes.camera || value(profile, "camera", AUTONOMOUS_SETTING) || AUTONOMOUS_SETTING,
    dialogue: notes.dialogue || value(profile, "dialogue", AUTONOMOUS_SETTING) || AUTONOMOUS_SETTING,
    avoid: notes.avoid || value(profile, "avoid", AUTONOMOUS_SETTING) || AUTONOMOUS_SETTING,
    aspect: notes.aspect ?? value(profile, "aspect", "9:16"),
    duration_seconds: String(settings.durationSeconds),
    scene_count: String(settings.sceneCount),
    clip_duration_seconds: String(settings.clipDurationSeconds),
    additional_notes: settings.additionalNotes || "별도 지시 없음",
  };
}

function characterCount(stored: StoredProject): number {
  const cast = object(stored.character_profile).cast;
  if (Array.isArray(cast)) return cast.length;
  return value(object(stored.character_profile), "name").trim() ? 1 : 0;
}

@Injectable()
export class StoryPromptService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly templateRoot = promptsRoot(),
    private readonly mappings?: ProjectAssetMappingsService,
    private readonly providerSettings?: ProviderSettingsService,
    private readonly budget?: OpenAiBudget,
    private readonly assets?: LocalAssetsRepository,
  ) {}

  /** Real OpenAI generation only runs when a connected credential and a budget tracker are both wired in; otherwise this always falls back to the local fake adapter. */
  private async generateStory(stored: StoredProject, prompt: string, apiKey: string | null): Promise<{ story: StoredStory; spendUnrecorded: boolean }> {
    if (!apiKey || !this.budget) return { story: await generateLocalStory(stored, prompt), spendUnrecorded: false };
    await this.budget.preflight(STORY_ESTIMATED_COST_USD);
    let succeeded = false;
    let story: StoredStory | undefined;
    let spendUnrecorded = false;
    try {
      ({ story } = await callOpenAiStoryApi(apiKey, prompt, { sceneCount: toShortProjectSettings(stored).sceneCount }));
      succeeded = true;
    } finally {
      // `recordSpend` rather than a bare await, because this is a `finally`: a throw here discards the Story
      // OpenAI was already paid for, and on the failure path it replaces the provider's real error — a rejected
      // prompt would be reported as a ledger problem (providers/budget-ledger.ts, docs/06_DECISIONS.md D-037).
      spendUnrecorded = await recordSpend(() => this.budget!.record(stored.project_id, "story", succeeded, STORY_ESTIMATED_COST_USD));
    }
    // Returned after the finally, not from inside the try. A `return { story, spendUnrecorded }` in there builds
    // its object before the finally runs, so the flag the finally sets never reaches the caller — the warning
    // was silently never attached, and only the test that asserts the sentence caught it.
    return { story: story!, spendUnrecorded };
  }

  private async original(stored: StoredProject): Promise<string> {
    let template: string;
    try {
      template = await fsPromises.readFile(path.join(this.templateRoot, "story", "story_generation.txt"), "utf8");
    } catch {
      throw storyStorageError();
    }
    return renderTemplate(template, await promptVariables(stored, this.assets));
  }

  async preview(projectId: string): Promise<CreateStoryPromptPreviewResponse> {
    const stored = await this.projects.findById(projectId.trim());
    const originalPrompt = await this.original(stored);
    const sceneCount = toShortProjectSettings(stored).sceneCount;
    const preview: StoryPromptPreview = { projectId: stored.project_id, originalPrompt, originalPromptSha256: sha256(originalPrompt), characterCount: characterCount(stored), sceneCount };
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    // Read-only, same as a preview's budget field elsewhere — never reserves anything, just reports the ledger's current state.
    const budget = apiKey && this.budget ? await budgetPreviewFor(this.budget, STORY_ESTIMATED_COST_USD) : undefined;
    return { preview, ...(budget ? { budget } : {}) };
  }

  /**
   * Renders the exact Story prompt from settings the user hasn't saved yet — for a live side-panel preview
   * while editing the settings form. Never writes to the project, never calls a paid provider.
   */
  async draftPreview(projectId: string, request: unknown): Promise<CreateStoryPromptDraftPreviewResponse> {
    const stored = await this.projects.findById(projectId.trim());
    const settings = parseShortProjectSettings(object(request).settings);
    const draft = applyShortProjectSettings(stored, settings, stored.updated_at);
    const prompt = await this.original(draft);
    return { prompt };
  }

  /**
   * Refuses a second run while one is in flight, the way narration and image generation do.
   *
   * `approve` reads READY, decides it may run, and only then writes GENERATING_STORY. Two presses that arrive
   * together both read READY, and both pay for a Story. The prompt hash guards against approving a *stale*
   * prompt; it does nothing about two identical approvals racing.
   *
   * Refused at once rather than queued, and `PROJECT_LOCKED` because that is the code every module sends for
   * this (docs/06_DECISIONS.md D-005).
   */
  async approve(projectId: string, request: unknown): Promise<ApproveStoryPromptResponse> {
    const id = projectId.trim();
    try {
      return await withProjectLock(this.projects.projectDirectory(id), `${id}:story`, () => this.approveCore(projectId, request), { timeoutMs: 0 });
    } catch (error) {
      if (error instanceof ProjectLockTimeoutError) throw storyLocked();
      throw error;
    }
  }

  private async approveCore(projectId: string, request: unknown): Promise<ApproveStoryPromptResponse> {
    if (typeof request !== "object" || request === null || Array.isArray(request)) throw invalidStoryRequest("Story prompt approval request is invalid.");
    const body = request as Record<string, unknown>;
    if (Object.keys(body).some((key) => !["originalPromptSha256", "prompt", "approved"].includes(key))
      || typeof body.originalPromptSha256 !== "string" || !/^[a-f0-9]{64}$/.test(body.originalPromptSha256)
      || typeof body.prompt !== "string" || body.prompt.trim().length === 0 || body.approved !== true) {
      throw invalidStoryRequest("Story prompt approval request is invalid.");
    }
    const stored = await this.projects.findById(projectId.trim());
    const originalPrompt = await this.original(stored);
    if (body.originalPromptSha256 !== sha256(originalPrompt)) throw storyPromptStale();
    if (stored.workflow_state !== WorkflowState.Ready) throw storyGenerationNotAllowed();
    const prompt = body.prompt.trim();
    const approvedAt = new Date().toISOString();
    const apiKey = this.providerSettings ? await this.providerSettings.rawCredentialIfConnected("openai") : null;
    const generating: StoredProject = {
      ...stored,
      workflow_state: WorkflowState.GeneratingStory,
      updated_at: approvedAt,
      lore_context: {
        ...stored.lore_context,
        story_prompt_request: {
          actual_prompt: prompt,
          original_prompt: originalPrompt,
          modified: prompt !== originalPrompt,
          prompt_sha256: sha256(prompt),
          approved_at: approvedAt,
          model: apiKey ? OPENAI_STORY_MODEL : "local-fake-story-adapter",
          character_count: characterCount(stored),
        },
      },
    };
    try { await this.projects.save(generating); } catch { throw storyStorageError(); }

    let story: StoredStory;
    let spendUnrecorded: boolean;
    try {
      ({ story, spendUnrecorded } = await this.generateStory(generating, prompt, apiKey));
    } catch (error) {
      // Return to READY so the user can retry instead of being stuck in GENERATING_STORY forever.
      try { await this.projects.save({ ...generating, workflow_state: WorkflowState.Ready, updated_at: new Date().toISOString() }); } catch { /* best-effort recovery */ }
      if (isBudgetLedgerUnreadable(error)) throw storyBudgetLedgerUnreadable(); if (error instanceof OpenAiBudgetExceededError) throw storyBudgetExceeded(error.message);
      if (error instanceof OpenAiStoryAdapterError) throw storyProviderError(error.category, error.message);
      throw storyGenerationFailed();
    }
    const completedAt = new Date().toISOString();
    const updated: StoredProject = {
      ...generating,
      story,
      scenes: story.scenes,
      script_revision: generating.script_revision + 1,
      workflow_state: WorkflowState.WaitingForAssetMappingReview,
      updated_at: completedAt,
      ...(spendUnrecorded ? { warnings: [...generating.warnings, spendUnrecordedWarning("이야기 생성", OPENAI_LEDGER_FILE)] } : {}),
    };
    try {
      await this.projects.save(updated);
      if (this.mappings) {
        const review = await this.mappings.beginReview(updated.project_id, { scriptRevision: updated.script_revision });
        updated.mapping_revision = review.review.mappingRevision;
        updated.updated_at = new Date().toISOString();
        await this.projects.save(updated);
      }
    } catch { throw storyStorageError(); }
    return { project: toApiProject(updated), originalPrompt, prompt, promptSha256: sha256(prompt), modified: prompt !== originalPrompt, approvedAt };
  }

  /**
   * Resets a generated Story back to READY so `preview()`/`approve()` can run again from scratch, same as a
   * first-time generation. Allowed only while a Story exists and no scene image has been generated for it yet
   * (checked here again server-side — the client's own read of this is not trusted): once even one image exists,
   * a script change would leave it orphaned, and the honest next step is a new project instead (product decision). `scenes`/`story`/`image_prompts`/`motion_prompts` are cleared along with the
   * state so a run that changes scene count starts from a clean slate; `script_revision` is left untouched, since
   * `approve()` always advances it forward regardless of its current value.
   */
  async regenerate(projectId: string, request: unknown): Promise<RegenerateStoryPromptResponse> {
    if (typeof request !== "object" || request === null || Array.isArray(request)
      || Object.keys(request).length !== 1 || (request as Record<string, unknown>).approved !== true) {
      throw invalidStoryRequest("Story regeneration request is invalid.");
    }
    const stored = await this.projects.findById(projectId.trim());
    if (!REGENERATABLE_STATES.has(stored.workflow_state) || stored.scenes.length === 0 || stored.generated_images.length > 0) {
      throw storyRegenerationNotAllowed();
    }
    const reset: StoredProject = {
      ...stored,
      workflow_state: WorkflowState.Ready,
      scenes: [],
      story: {},
      image_prompts: [],
      motion_prompts: [],
      updated_at: new Date().toISOString(),
    };
    try { await this.projects.save(reset); } catch { throw storyStorageError(); }
    return { project: toApiProject(reset) };
  }
}
