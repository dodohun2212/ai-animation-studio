import * as crypto from "node:crypto";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import type { ApproveStoryPromptRequest, ApproveStoryPromptResponse, CreateStoryPromptPreviewResponse, StoryPromptPreview } from "@ai-animation-studio/shared";
import { toApiProject } from "../projects/project.mapper.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { invalidStoryRequest, storyPromptStale, storyStorageError } from "./story-api.error.js";

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

function promptVariables(stored: StoredProject): Record<string, string> {
  const settings = toShortProjectSettings(stored);
  const profile = object(stored.style_profile);
  const notes = settings.styleNotes;
  const story = object(stored.story);
  const cast = object(stored.character_profile).cast;
  const previous = object(stored.lore_context).previous_scene_context;
  return {
    project_name: settings.projectName || "별도 이름 없음",
    topic: settings.topic,
    full_story: settings.fullStory,
    genre: settings.genre,
    mood: settings.mood,
    lore: settings.lore || "AUTONOMOUS_SETTING",
    character: settings.character,
    character_asset_metadata: "",
    character_cast_metadata: Array.isArray(cast) ? JSON.stringify(cast, null, 2) : "",
    atmosphere_asset_metadata: "",
    scene_reference_asset_metadata: "",
    project_asset_metadata: "",
    previous_scene_context: typeof previous === "string" ? previous : "",
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
  constructor(private readonly projects: LocalProjectRepository, private readonly templateRoot = promptsRoot()) {}

  private async original(stored: StoredProject): Promise<string> {
    let template: string;
    try {
      template = await fsPromises.readFile(path.join(this.templateRoot, "story", "story_generation.txt"), "utf8");
    } catch {
      throw storyStorageError();
    }
    return renderTemplate(template, promptVariables(stored));
  }

  async preview(projectId: string): Promise<CreateStoryPromptPreviewResponse> {
    const stored = await this.projects.findById(projectId.trim());
    const originalPrompt = await this.original(stored);
    const preview: StoryPromptPreview = { projectId: stored.project_id, originalPrompt, originalPromptSha256: sha256(originalPrompt), characterCount: characterCount(stored), sceneCount: 6 };
    return { preview };
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
    const prompt = body.prompt.trim();
    const approvedAt = new Date().toISOString();
    const updated: StoredProject = {
      ...stored,
      updated_at: approvedAt,
      story: {
        ...stored.story,
        story_prompt_request: {
          actual_prompt: prompt,
          original_prompt: originalPrompt,
          modified: prompt !== originalPrompt,
          prompt_sha256: sha256(prompt),
          approved_at: approvedAt,
          model: "local-fake-story-adapter",
          character_count: characterCount(stored),
        },
      },
    };
    try { await this.projects.save(updated); } catch { throw storyStorageError(); }
    return { project: toApiProject(updated), originalPrompt, prompt, promptSha256: sha256(prompt), modified: prompt !== originalPrompt, approvedAt };
  }
}
