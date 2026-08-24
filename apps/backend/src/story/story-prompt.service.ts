import * as crypto from "node:crypto";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import { WorkflowState } from "@ai-animation-studio/shared";
import type { ApproveStoryPromptRequest, ApproveStoryPromptResponse, CreateStoryPromptDraftPreviewResponse, CreateStoryPromptPreviewResponse, StoryPromptPreview } from "@ai-animation-studio/shared";
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
import { OpenAiBudget, OpenAiBudgetExceededError, STORY_ESTIMATED_COST_USD } from "../providers/openai-budget.js";
import { OPENAI_STORY_MODEL, OpenAiStoryAdapterError, callOpenAiStoryApi } from "./openai-story-adapter.js";
import { describeAtmosphereAssets, describeCharacterCast, describeSceneReferenceAssets } from "./story-asset-metadata.js";
import { invalidStoryRequest, storyBudgetExceeded, storyGenerationFailed, storyGenerationNotAllowed, storyPromptStale, storyProviderError, storyStorageError } from "./story-api.error.js";

const sha256 = (value: string) => crypto.createHash("sha256").update(value, "utf8").digest("hex");
const object = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
const value = (record: Record<string, unknown>, key: string, fallback = "") => typeof record[key] === "string" ? record[key] as string : fallback;

function promptsRoot(): string {
  return process.env.PROMPTS_ROOT ?? path.resolve(process.cwd(), "prompts");
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
  const { atmosphereAssetIds, sceneReferenceAssets } = toShortProjectAssetReferences(stored);
  return {
    project_name: settings.projectName || "별도 이름 없음",
    topic: settings.topic,
    full_story: settings.fullStory,
    genre: settings.genre,
    mood: settings.mood,
    lore: settings.lore || "AUTONOMOUS_SETTING",
    character: settings.character,
    character_asset_metadata: "",
    character_cast_metadata: await describeCharacterCast(assets, cast),
    atmosphere_asset_metadata: await describeAtmosphereAssets(assets, atmosphereAssetIds),
    scene_reference_asset_metadata: await describeSceneReferenceAssets(assets, sceneReferenceAssets),
    project_asset_metadata: "",
    previous_scene_context: previousSceneContext(stored),
    visual_style: notes.visualStyle ?? value(profile, "visual_style"),
    color: notes.color ?? value(profile, "color"),
    lighting: notes.lighting ?? value(profile, "lighting"),
    camera: notes.camera ?? value(profile, "camera"),
    dialogue: notes.dialogue ?? value(profile, "dialogue"),
    avoid: notes.avoid ?? value(profile, "avoid"),
    aspect: notes.aspect ?? value(profile, "aspect", "9:16"),
    duration_seconds: String(settings.durationSeconds),
    scene_count: "6",
    additional_notes: settings.additionalNotes,
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
  private async generateStory(stored: StoredProject, prompt: string, apiKey: string | null): Promise<StoredStory> {
    if (!apiKey || !this.budget) return generateLocalStory(stored, prompt);
    await this.budget.preflight(STORY_ESTIMATED_COST_USD);
    let succeeded = false;
    try {
      const { story } = await callOpenAiStoryApi(apiKey, prompt);
      succeeded = true;
      return story;
    } finally {
      await this.budget.record(stored.project_id, "story", succeeded, STORY_ESTIMATED_COST_USD);
    }
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
    const preview: StoryPromptPreview = { projectId: stored.project_id, originalPrompt, originalPromptSha256: sha256(originalPrompt), characterCount: characterCount(stored), sceneCount: 6 };
    return { preview };
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

  async approve(projectId: string, request: unknown): Promise<ApproveStoryPromptResponse> {
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
    try {
      story = await this.generateStory(generating, prompt, apiKey);
    } catch (error) {
      // Return to READY so the user can retry instead of being stuck in GENERATING_STORY forever.
      try { await this.projects.save({ ...generating, workflow_state: WorkflowState.Ready, updated_at: new Date().toISOString() }); } catch { /* best-effort recovery */ }
      if (error instanceof OpenAiBudgetExceededError) throw storyBudgetExceeded(error.message);
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
}
