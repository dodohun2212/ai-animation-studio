import * as fs from "node:fs/promises";
import * as path from "node:path";
import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { RUNWAY_PROMPT_MAX_LENGTH, sceneNumbersFor, VIDEO_SCENE_ESTIMATED_COST_USD, WorkflowState, type GetVideoPromptPreviewResponse, type SceneNumber, type VideoPromptPreview } from "@ai-animation-studio/shared";

import { validateImage } from "../assets/image-validation.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { RunwayBudget } from "../providers/runway-budget.js";
import {
  invalidVideoPreviewRequest,
  videoPreviewDataInvalid,
  videoPreviewImagesInvalid,
  videoPreviewNotAllowed,
} from "./video-preview-api.error.js";
import { runwayRatioForAspect } from "../projects/project-aspect.js";

function scenesFor(project: StoredProject): SceneNumber[] {
  return sceneNumbersFor(toShortProjectSettings(project).sceneCount);
}
const SCENE_FIELDS = [
  "number", "description", "visual_action", "start_motion", "main_motion", "end_motion",
  "shot_size", "camera_angle", "composition", "lens_feel", "focus_subject", "camera_motion",
  "environment_motion", "motion_speed", "motion_intensity", "expression_change", "continuity_hint",
] as const;
/**
 * "narration" is a scene field used only by narration/TTS generation, never by the video prompt (see promptFor
 * below — it reads none of the fields here). It is deliberately NOT in SCENE_FIELDS: scenes stored before this
 * field existed have exactly SCENE_FIELDS.length keys and must keep working. It is accepted here only so the
 * strict "no unexpected keys" check below does not reject newer scenes that do carry it.
 */
const OPTIONAL_SCENE_FIELDS = ["narration"] as const;
const UTF16_PROMPT_LIMIT = RUNWAY_PROMPT_MAX_LENGTH;

export type StoredScene = Record<(typeof SCENE_FIELDS)[number], string | number> & { narration?: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Equivalent to JavaScript's UTF-16 code-unit count used by the Python UI. */
export function utf16Length(value: string): number {
  return value.length;
}

function parseScenes(project: StoredProject, sceneNumbers: readonly SceneNumber[]): StoredScene[] {
  if (project.scenes.length !== sceneNumbers.length) throw videoPreviewDataInvalid();
  return project.scenes.map((raw, index) => {
    const keys = Object.keys(raw as object);
    if (!isObject(raw)
      || keys.some((key) => !(SCENE_FIELDS as readonly string[]).includes(key) && !(OPTIONAL_SCENE_FIELDS as readonly string[]).includes(key))
      || SCENE_FIELDS.some((key) => !(key in raw)) || raw.number !== sceneNumbers[index]
      || SCENE_FIELDS.filter((key) => key !== "number").some((key) => typeof raw[key] !== "string" || !raw[key].trim())
      || ("narration" in raw && typeof raw.narration !== "string")) {
      throw videoPreviewDataInvalid();
    }
    return raw as StoredScene;
  });
}

/** See project-aspect.ts — this used to read a field nothing writes, so every project rendered portrait. */
export const ratioFor = runwayRatioForAspect;

export interface VideoPromptResult {
  prompt: string;
  /** Section labels actually dropped by the length-truncation loop below — never includes "Continuity cue" for
   * scene 1, which is absent for an unrelated reason (there is no previous scene) rather than truncated. Lets a
   * caller that cares (video-preview.service.ts's preview()) tell the user something was cut, instead of quietly
   * shipping a prompt with content missing and no way to know. */
  omittedSections: string[];
}

/**
 * Whether two rendered video prompts describe the same scene — the question staleness is actually asking.
 *
 * The badge this feeds says "장면 내용이 바뀐 뒤로 이 영상을 다시 만들지 않았습니다", so it must fire when the
 * scene changed and stay quiet otherwise. Comparing the two prompts as whole strings also fires when *this file*
 * changes: renaming "Opening movement" to "Starts at" would have put that badge on all twenty-four of 캡틴D's
 * existing clips while every scene was untouched — the app asserting a cause it had not checked, which is the
 * defect this repository has spent a week removing.
 *
 * So only the values are compared, never the labels. A section that gains or
 * loses content still counts, because its value moves; a section that is only renamed does not, because nothing
 * a person wrote is different.
 *
 * This does mean a relabelled prompt is not reported. That is the honest reading: the clip on disk was made from
 * the same scene, and whether a new label would draw it better is a question no comparison here can answer —
 * only regenerating it can, and that is the person's money to spend.
 */
export function describesSameScene(recorded: string, recomputed: string): boolean {
  const values = (prompt: string) => prompt.split("\n").map((line) => { const at = line.indexOf(": "); return at < 0 ? line : line.slice(at + 2); }).join("\n");
  return values(recorded) === values(recomputed);
}

/**
 * Why a recorded video prompt no longer matches the one a resubmission would send.
 *
 * The first line is not fixed, although this file used to say it was: it carries the clip length and the
 * orientation, and both are project-wide settings. Changing the clip length from 5 to 10 seconds — a setting with
 * no guard on either project type — rewrites that line in every prompt ever recorded. Measured before it was
 * written: with two scenes generated and nothing else touched, videoStale went from [] to [1, 2] on that save
 * alone. There are thirty-six recorded video prompts on disk today and every one carries that line.
 *
 * "장면 내용이 바뀐 뒤로" is false for all of them. The clips genuinely are behind — they are the wrong length —
 * so the warning must still fire; only the reason it gave was wrong.
 *
 * The scene comparison is unchanged. This only asks, when the two differ, whether the difference is confined to
 * that first line.
 */
export type VideoPromptDrift = "current" | "format" | "scene";

export function videoPromptDrift(recorded: string, recomputed: string): VideoPromptDrift {
  if (describesSameScene(recorded, recomputed)) return "current";
  const withoutFormatLine = (prompt: string) => prompt.split("\n").slice(1).join("\n");
  return describesSameScene(withoutFormatLine(recorded), withoutFormatLine(recomputed)) ? "format" : "scene";
}

/**
 * Deliberately sends no character/subject description at all — the first-frame image already carries that, and
 * Runway's own Gen-4 Video Prompting Guide warns that "reiterating elements that exist within the image in high
 * detail can lead to reduced motion or unexpected results." This function's sections are all motion/camera/
 * pacing description for exactly that reason; `suffix` below ("Maintain stable identity...") is what actually
 * holds identity steady, not a redundant physical description (raised as a possible
 * gap, verified against Runway's own docs, and closed as intentional design instead).
 *
 * Also never add negative phrasing here (an `Avoid: ...` line, the way image-prompt.ts's styleLineFor() does for
 * OpenAI) — the same guide: "Gen-4 is designed to interpret prompts that describe what should happen... Negative
 * phrasing is not supported and may produce unpredictable or even opposite results." The image side's Avoid
 * pattern does not transfer here; Runway is a different model with the opposite behavior for negatives.
 */
export function promptFor(scene: StoredScene, previous: StoredScene | undefined, ratio: "720:1280" | "1280:720", clipDurationSeconds: number): VideoPromptResult {
  const orientation = ratio === "1280:720" ? "horizontal" : "vertical";
  const continuity = previous
    ? [previous.end_motion, previous.continuity_hint].filter((value, index, values) => values.indexOf(value) === index).join(" ")
    : "";
  const sections: Array<[string, string]> = [
    ["Continuity cue", continuity],
    // Poses, not movements. The script template asks for a pose at each end — "장면 시작 순간의 자세·시선·이동
    // 상태" and "마지막 1초에 도달해야 할 자세" — and these labels asked the model for movement three times in
    // five seconds. A model reads its labels: three movements in a five-second shot is a shot that starts, stops
    // and starts again, which is what 캡틴D described as 부분부분 어색한 파트 (Cowork Round 492, approved by
    // 캡틴D as the redesign to try first). One action between two held poses is the shape the fields describe.
    //
    // It also makes the continuity cue legible: that line hands over the previous scene's end_motion, so
    // "Starts at" is literally where the last shot left off.
    ["Starts at", String(scene.start_motion)],
    ["Action", String(scene.main_motion)],
    ["Performance", String(scene.expression_change)],
    ["Ends at", String(scene.end_motion)],
    ["Motivated camera", String(scene.camera_motion)],
    ["Environment", String(scene.environment_motion)],
    ["Pacing", `motion speed ${scene.motion_speed}; intensity ${scene.motion_intensity}`],
  ];
  const prefix = `Create one continuous cinematic ${clipDurationSeconds}-second ${orientation} image-to-video shot from the supplied exact first frame.`;
  const suffix = "Maintain stable identity, anatomy, clothing, essential objects, lighting and scene continuity throughout the shot.";
  const render = (included: readonly [string, string][]) => [prefix, ...included.map(([label, value]) => `${label}: ${value}`), suffix].join("\n");
  // "Pacing" is the one section this filter cannot see into: it is built as a template, so two blank fields
  // would still render "motion speed ; intensity " and pass. That case does not arise — parseScenes above and
  // episode-videos.service.ts's scenes() both reject any scene field that is blank, so nothing that generates
  // a video can reach here with one. The staleness recompute (projects/scene-staleness.ts) does not validate,
  // and there a blanked field makes the scene read as behind its recorded prompt, which is what it is.
  // Scene 1 has no `previous` by definition, so "Continuity cue" is always "" there — sent unfiltered, every
  // project's scene 1 prompt carried a bare "Continuity cue: " line with nothing after the colon. Matches
  // imagePromptFor's existing filter for the same class of empty-section bug on the image side.
  let included = sections.filter(([, value]) => value);
  const removable = ["Pacing", "Environment", "Performance", "Continuity cue"];
  const omittedSections: string[] = [];
  while (utf16Length(render(included)) > UTF16_PROMPT_LIMIT && removable.length > 0) {
    const label = removable.shift()!;
    const before = included.length;
    included = included.filter(([candidate]) => candidate !== label);
    if (included.length !== before) omittedSections.push(label);
  }
  const prompt = render(included);
  if (utf16Length(prompt) > UTF16_PROMPT_LIMIT) throw videoPreviewDataInvalid();
  return { prompt, omittedSections };
}

@Injectable()
export class LocalVideoPreviewService {
  constructor(
    private readonly projects: LocalProjectRepository,
    private readonly projectsRoot: string,
    private readonly budget: RunwayBudget,
  ) {}

  private imagePath(projectId: string, scene: SceneNumber): string {
    return path.join(this.projectsRoot, projectId, "images", `scene${scene}.png`);
  }

  private async assertApprovedImages(project: StoredProject, sceneNumbers: readonly SceneNumber[]): Promise<void> {
    if (project.workflow_state !== WorkflowState.WaitingForVideoConfirmation) throw videoPreviewNotAllowed();
    if (project.generated_images.length !== sceneNumbers.length) throw videoPreviewImagesInvalid();
    for (const scene of sceneNumbers) {
      const expected = this.imagePath(project.project_id, scene);
      if (project.generated_images[scene - 1] !== expected) throw videoPreviewImagesInvalid();
      try {
        const bytes = await fs.readFile(expected);
        if (validateImage(bytes, "scene.png", "image/png").extension !== ".png") throw videoPreviewImagesInvalid();
      } catch (error) {
        if (error instanceof Error && "response" in error) throw error;
        throw videoPreviewImagesInvalid();
      }
    }
  }

  async preview(projectId: string, body: unknown): Promise<GetVideoPromptPreviewResponse> {
    if (body !== undefined && body !== null && (!isObject(body) || Object.keys(body).length !== 0)) throw invalidVideoPreviewRequest();
    const project = await this.projects.findById(projectId.trim());
    const sceneNumbers = scenesFor(project);
    const clipDurationSeconds = toShortProjectSettings(project).clipDurationSeconds;
    await this.assertApprovedImages(project, sceneNumbers);
    const scenes = parseScenes(project, sceneNumbers);
    const ratio = ratioFor(project);
    const previews: VideoPromptPreview[] = scenes.map((scene, index) => {
      const { prompt, omittedSections } = promptFor(scene, scenes[index - 1], ratio, clipDurationSeconds);
      return {
        sceneNumber: sceneNumbers[index]!,
        prompt,
        model: "gen4_turbo",
        ratio,
        durationSeconds: clipDurationSeconds,
        estimatedCostUsd: VIDEO_SCENE_ESTIMATED_COST_USD,
        ...(omittedSections.length > 0 ? { omittedSections } : {}),
      };
    });
    // This is an opaque, deterministic snapshot of the reviewed images and
    // preflight settings. It is deliberately not persisted: generating a
    // preview must remain provider-free and side-effect-free.
    const digest = createHash("sha256");
    digest.update(project.project_id, "utf8");
    for (const preview of previews) {
      digest.update(await fs.readFile(this.imagePath(project.project_id, preview.sceneNumber)));
      digest.update(preview.prompt, "utf8");
      digest.update(preview.model, "ascii");
      digest.update(preview.ratio, "ascii");
      digest.update(String(preview.durationSeconds), "ascii");
    }
    const estimatedRequestCostUsd = previews.reduce((sum, preview) => sum + preview.estimatedCostUsd, 0);
    // Read-only: previewing never reserves or records budget, it only reports the ledger's current state.
    const [monthlyLimitUsd, spentUsd, remainingUsd] = await Promise.all([this.budget.monthlyLimit(), this.budget.spentThisMonth(), this.budget.remaining()]);
    return {
      previews,
      confirmationId: digest.digest("hex"),
      maximumProviderCalls: sceneNumbers.length,
      budget: {
        monthlyLimitUsd,
        spentUsd,
        remainingUsd,
        estimatedRequestCostUsd,
        canSpend: estimatedRequestCostUsd <= remainingUsd,
      },
    };
  }
}
