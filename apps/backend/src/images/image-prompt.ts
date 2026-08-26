import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads one string field off a loosely-typed stored scene object, trimmed; empty string if absent or not a string. */
export function sceneValue(scene: unknown, key: string): string {
  return isObject(scene) && typeof scene[key] === "string" ? (scene[key] as string).trim() : "";
}

/**
 * The Story template's own field definitions assign `visual_action` and the composition fields below to image
 * generation specifically ("이미지 한 장의 구도") — `description` is the narrated script (background, emotional
 * flow, and dialogue) meant for on-screen script display, not a model prompt. Sending `description` to the image
 * model fed it dialogue text no image model can render, while leaving these composition fields generated-but-
 * unused. Mirrors the "select fields, label them, join with newlines" shape of video-preview.service.ts's
 * promptFor, which assembles the equivalent video prompt from this same scene shape — the short-project and Long
 * Episode script schemas both use these exact same 17 field names, so this one function serves both.
 *
 * `styleLine` is a caller-supplied, already-formatted "Style: ..." line (see local-image-generation.service.ts's
 * styleLineFor) appended when non-empty. It is not computed here because its source differs: a short project has
 * ShortProjectSettings.styleNotes/style_profile to draw from, but LongProjectSettings has no equivalent visual-
 * style fields today, so a Long Episode caller simply passes "".
 *
 * `referenceNotes` is likewise a caller-supplied, already-formatted block (see
 * image-reference-selection.ts's describeReferenceMappingsForScene) appended when non-empty — text for the same
 * confirmed Asset Mappings whose image bytes collectReferenceImages sends alongside this prompt. Without it, the
 * model receives a reference photo with no name or description attached to it, and anything a photo alone
 * cannot convey (a stated personality, a Folder child's individual note) never reaches the model at all.
 *
 * No length truncation: OpenAI's image prompt limit (32,000 chars) is far larger than anything a single scene's
 * fields could reach.
 */
export function imagePromptFor(scene: unknown, styleLine: string, referenceNotes = ""): string {
  const sections: Array<[string, string]> = [
    ["Scene", sceneValue(scene, "visual_action")],
    ["Shot", [sceneValue(scene, "shot_size"), sceneValue(scene, "camera_angle")].filter(Boolean).join(", ")],
    ["Composition", sceneValue(scene, "composition")],
    ["Lens", sceneValue(scene, "lens_feel")],
    ["Focus", sceneValue(scene, "focus_subject")],
  ];
  const lines = sections.filter(([, value]) => value).map(([label, value]) => `${label}: ${value}`);
  if (referenceNotes) lines.push(referenceNotes);
  if (styleLine) lines.push(styleLine);
  return lines.join("\n");
}

/**
 * Same source and priority as video-preview.service.ts's ratioFor() (project.style_profile.aspect, "16:9" vs
 * anything else defaulting to vertical) — but returns one of OpenAI's own image-generation size strings rather
 * than a Runway ratio string, since the two providers take the shape in different vocabularies. Nothing derived
 * this before (`.claude-bridge` Round 165): every call site let the adapter's own OPENAI_IMAGE_SIZE default
 * apply unconditionally, so a landscape (16:9) project's first-frame image was generated portrait regardless of
 * its own setting, and that mismatched image was then paid for again by Runway before the shape mismatch showed
 * up as a cropped or letterboxed finished video.
 */
export function imageSizeFor(project: StoredProject): "1024x1536" | "1536x1024" {
  const aspect = typeof project.style_profile.aspect === "string"
    ? project.style_profile.aspect.replaceAll(" ", "")
    : "";
  return aspect === "16:9" ? "1536x1024" : "1024x1536";
}

/**
 * Deterministic, not routed through the Story AI's own translation — same source and priority as the Story
 * prompt's own style fields (project styleNotes override, falling back to the AI-set style_profile). Keeping
 * this line identical across every scene's prompt (unlike the AI-authored fields above) is what gives scene-to-
 * scene visual consistency; camera is deliberately excluded, since camera work is a video concept and would be
 * noise in a still-image prompt. Short-project-specific: LongProjectSettings has no equivalent visual-style
 * fields today, so a Long Episode caller simply passes "" as imagePromptFor's styleLine instead of calling this.
 */
export function styleLineFor(project: StoredProject): string {
  const notes = toShortProjectSettings(project).styleNotes;
  const profile = isObject(project.style_profile) ? project.style_profile : {};
  const fromProfile = (key: string): string => typeof profile[key] === "string" ? (profile[key] as string).trim() : "";
  const parts = [notes.visualStyle ?? fromProfile("visual_style"), notes.color ?? fromProfile("color"), notes.lighting ?? fromProfile("lighting")]
    .filter((part) => part.trim().length > 0);
  const style = parts.length > 0 ? `Style: ${parts.join(", ")}` : "";
  // Same source/priority as the other style fields above (user setting overrides the AI-set profile), kept as
  // its own labeled sentence rather than folded into the Style list — an item in a comma-separated style list
  // reads as something to include, and "avoid" is the opposite of that.
  const avoid = (notes.avoid ?? fromProfile("avoid")).trim();
  const avoidLine = avoid ? `Avoid: ${avoid}` : "";
  return [style, avoidLine].filter(Boolean).join(". ");
}
