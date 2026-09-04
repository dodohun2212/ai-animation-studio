import { toShortProjectSettings } from "../projects/project-settings.js";
import type { StoredProject } from "../projects/project-storage.schema.js";
import { imageSizeForAspect } from "../projects/project-aspect.js";

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
 * The image size a scene is generated at, in OpenAI's own vocabulary (Runway takes the same shape in a different
 * one — see project-aspect.ts, which owns the single reading of the setting).
 *
 * This derivation was added to fix exactly the symptom it then still produced: a 16:9 project's first-frame
 * image was generated portrait regardless of its setting, and that mismatched image was paid for again by Runway
 * before the shape showed up as a cropped or letterboxed video. Adding the function was not enough, because it
 * read `style_profile.aspect` and the setting is stored at `lore_context.style_notes.aspect`.
 */
export const imageSizeFor = imageSizeForAspect;

/**
 * Deterministic, not routed through the Story AI's own translation — same source and priority as the Story
 * prompt's own style fields (project styleNotes override, falling back to the AI-set style_profile). Keeping
 * this line identical across every scene's prompt (unlike the AI-authored fields above) is what gives scene-to-
 * scene visual consistency; camera is deliberately excluded, since camera work is a video concept and would be
 * noise in a still-image prompt. A Long Project keeps the same four values as flat settings fields and calls
 * `styleLineFrom` directly — same sentence, different container.
 */
/**
 * The style sentence itself, built in one place because two projects now need it and they keep it in different
 * containers — a short project under `lore_context.style_notes` with an AI-authored fallback, a Long Project as
 * four flat settings fields. Only the sentence has to be identical; the containers do not.
 *
 * Written as one function rather than one per caller for the reason this repository has met all week: the day
 * one copy changes a separator or drops `Avoid`, two projects start drawing differently and nothing reports it.
 *
 * Returns "" when nothing is filled in, so a caller can append it unconditionally and get a prompt identical to
 * one built without a style line at all.
 */
export function styleLineFrom(parts: { visualStyle?: string; color?: string; lighting?: string; avoid?: string }): string {
  const kept = [parts.visualStyle, parts.color, parts.lighting].map((part) => (part ?? "").trim()).filter((part) => part.length > 0);
  const style = kept.length > 0 ? `Style: ${kept.join(", ")}` : "";
  // Its own labelled sentence, never an item in the style list: an entry in a comma-separated list of styles
  // reads as something to include, and "avoid" is the opposite of that.
  const avoid = (parts.avoid ?? "").trim();
  return [style, avoid ? `Avoid: ${avoid}` : ""].filter(Boolean).join(". ");
}

/**
 * A short project's style line: this project's own source and priority (the user setting overrides the AI-set
 * `style_profile`), formatted by `styleLineFrom`. Camera is deliberately excluded — camera work is a video
 * concept and would be noise in a still-image prompt.
 */
export function styleLineFor(project: StoredProject): string {
  const notes = toShortProjectSettings(project).styleNotes;
  const profile = isObject(project.style_profile) ? project.style_profile : {};
  const fromProfile = (key: string): string => typeof profile[key] === "string" ? (profile[key] as string).trim() : "";
  return styleLineFrom({
    visualStyle: notes.visualStyle ?? fromProfile("visual_style"),
    color: notes.color ?? fromProfile("color"),
    lighting: notes.lighting ?? fromProfile("lighting"),
    avoid: notes.avoid ?? fromProfile("avoid"),
  });
}
