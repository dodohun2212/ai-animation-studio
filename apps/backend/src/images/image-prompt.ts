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
 * The Story template assigns the composition fields below to image generation specifically ("이미지 한 장의
 * 구도") — `description` is the narrated script (background, emotional flow, and dialogue) meant for on-screen
 * script display, not a model prompt. Sending `description` to the image model fed it dialogue text no image
 * model can render, while leaving these composition fields generated-but-unused. Mirrors the "select fields,
 * label them, join with newlines" shape of video-preview.service.ts's promptFor, which assembles the equivalent
 * video prompt from this same scene shape — the short-project and Long Episode script schemas both use these
 * exact same 17 field names, so this one function serves both.
 *
 * 🔴 `Scene:` is `start_motion`, and it was `visual_action` until 2026-09-11. That was the app contradicting
 * itself about one file. This picture is handed to Runway as the first frame, and `promptFor` says so in the
 * request's own first line — "from the supplied exact first frame" — and then names what that frame shows:
 * `Starts at: {start_motion}`. The picture was drawn from `visual_action`, which the template defines as the
 * scene's 핵심 행동, the whole action. So Runway was told "this is the beginning" while being handed the end,
 * and the clip had nothing left to do for five seconds.
 *
 * Measured, not reasoned: 캡틴D's 꽃말_해바라기 reel was opened frame by frame (Cowork Round 714). Scene 2's
 * still already showed both cotyledons up; scene 2's clip ended where it began. The growth happened between the
 * cuts instead of inside them, which is the same defect as the earlier 「식물이 가만히 있고 성장을 안 한다」.
 *
 * 🔴 The old sentence justifying `visual_action` claimed the template assigned it to image generation. It does
 * not: only `shot_size`/`camera_angle`/`composition`/`lens_feel`/`focus_subject` carry the 「이미지 한 장의」
 * wording. The comment had widened its own evidence by one field, which is why the line survived this long.
 *
 * 🟠 Replaced, never both. "The action is X, now draw the moment before X" is one request holding two orders,
 * and this repository has already paid for that shape — the flower prompt that forbade people in `[7] 피할 요소`
 * while demanding a 대표 캐릭터 in the same breath. The subject survives the swap because `focus_subject` and
 * `composition` carry it; checked against all 20 recorded scenes on disk, where every `start_motion` is a
 * self-contained description of a drawable frame.
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
/**
 * What a picture must not contain, said to the model that draws it.
 *
 * Runway's own documentation lists two first causes for INTERNAL.BAD_OUTPUT: text or logos on the input media,
 * and a prompt that asks for text. Both are the same failure seen from either end, and this app met both on
 * 2026-09-05 — Episode 5 scene 3's first frame was a close-up of a tape label, the clip was refused twice, and
 * $0.50 bought nothing. The scenes that did get through show the other half: 4번 and 6번 have red caption
 * boards holding the frame for the whole five seconds.
 *
 * Kept out of the recorded prompt on purpose. The record is what staleness compares against, and a constant
 * line added to it would mark every picture ever generated as behind its own script — the trap styleStale's
 * own doc comment describes. This is a rule about how to draw, not a change to any scene, so it travels with
 * the request the same way the reference notes do.
 */
export const NO_LEGIBLE_TEXT_RULE = "Do not render readable writing: no captions, labels, signs, screens of text, subtitles, waveforms or logos. Show what such a thing would say through the image itself.";

/** The prompt as it goes to the provider — the recorded one plus the rules that are about drawing, not about the scene. */
export function imagePromptForRequest(scene: unknown, styleLine: string, referenceNotes = ""): string {
  return `${imagePromptFor(scene, styleLine, referenceNotes)}
${NO_LEGIBLE_TEXT_RULE}`;
}

export function imagePromptFor(scene: unknown, styleLine: string, referenceNotes = ""): string {
  const sections: Array<[string, string]> = [
    ["Scene", sceneValue(scene, "start_motion")],
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
 * Why a recorded image prompt no longer matches the one a regeneration would send.
 *
 * "The prompt changed" and "the scene changed" are not the same sentence, and until now the staleness check
 * reported the first while the badge asserted the second. The art direction (styleLineFrom's one line) is
 * project-wide: filling in the visual-style boxes rewrites the prompt of every scene that was ever generated,
 * without a single word of any scene having been touched. Every one of those scenes was about to be labelled
 * "장면 내용이 바뀐 뒤로" — measured, not feared: project 1 has six recorded prompts and all six carry a Style
 * line, and Episodes 2-4 of project 12 have eighteen more that carry none, so the first save of those boxes
 * moves all of them at once.
 *
 * The style line is what the two prompts are compared without: matching there means the scene's own words are
 * untouched and only the art direction moved. It is the last line and it is the only line that can open with
 * `Style:` or `Avoid:` — a reference block's lines open with "- " or two spaces (image-reference-selection.ts).
 */
export type ImagePromptDrift = "current" | "style" | "scene";

/** Drops the trailing art-direction line, leaving the scene's own labelled fields (and any reference block). */
export function withoutStyleLine(prompt: string): string {
  const lines = prompt.split("\n");
  const last = lines[lines.length - 1];
  return last !== undefined && /^(Style|Avoid): /.test(last) ? lines.slice(0, -1).join("\n") : prompt;
}

/**
 * Whether a recorded prompt is one the pre-2026-09-11 builder wrote: every line identical to today's except a
 * `Scene:` line holding this scene's `visual_action` where today's holds its `start_motion`.
 *
 * Dated and narrow on purpose. It answers one question — did the *scene* change since this picture was made —
 * and for these records the answer is no: nobody edited a word, the builder moved (see imagePromptFor's 🔴).
 * Measured before it was written: 20 recorded image prompts across 5 projects on this machine, and all 20 open
 * with `Scene: {visual_action}`. Without this, changing that one line tells every one of them 「장면 내용이 바뀐
 * 뒤로 이 그림을 다시 만들지 않았습니다」, false 20 times over — the same trap styleStale's own comment
 * describes, and the third time this repository has stood in front of it.
 *
 * 🟠 What it deliberately does not say: that redrawing would now produce a better-framed picture. That is true
 * and it is not this badge's sentence. A badge that means two things is worth less than one that means one, so
 * the recommendation, if anyone wants it, belongs to a screen and is asked for in the mailbox rather than
 * smuggled in here.
 */
function recordedByPreStartMotionBuilder(recorded: string, scene: unknown, referenceNotes: string): boolean {
  const legacy = sceneValue(scene, "visual_action");
  if (!legacy) return false;
  const asItWouldHaveBeen = withoutRequestOnlyLines(imagePromptFor(scene, "", referenceNotes)).split("\n");
  const [first, ...rest] = asItWouldHaveBeen;
  // Only reached when today's builder writes a Scene: line at all — a scene with no start_motion has none, and
  // then there is nothing for a legacy record to have differed from.
  if (first === undefined || !first.startsWith("Scene: ")) return false;
  return withoutStyleLine(recorded) === [`Scene: ${legacy}`, ...rest].join("\n");
}

/**
 * A prompt with the lines that tell the model *how to draw* taken out — what is left is what staleness compares.
 *
 * 🔴 Two kinds of line are about drawing rather than about this scene, and staleness was comparing one of them.
 * The first generation writes the *request* into `image_generation_records[].prompt`, NO_LEGIBLE_TEXT_RULE
 * included, and the staleness check recomputed without it — so the two never matched and every scene read as
 * 「장면 내용이 바뀐 뒤로」. Measured on 꽃말_구기자, generated after the Scene: line moved to start_motion with
 * nothing edited since: all five reported stale, and the only line that differed was that rule. The comment at
 * the call site already said the record should hold the scene and the style line; the field it wrote did not.
 *
 * The role lines are the second kind (image-reference-selection.ts). They are derived from the mapping's role
 * and the Asset's type, and saying them better must not tell a picture that its scene changed — every existing
 * record predates them.
 *
 * 🟠 Deliberately *not* removed: the rest of the References block. This project's staleness has always treated
 * an Asset's name and description as part of what a picture was drawn from — editing a character's description
 * reports those scenes as behind, and a test pins that on purpose. The Episode side decided the opposite and
 * records the scene prompt without the block at all. That disagreement is real and is not settled here; this
 * only stops the two drawing-instruction lines from being read as content, which neither side ever intended.
 *
 * Both are recognised by shape, not by today's wording, so a later edit to either sentence does not turn every
 * existing record stale.
 */
const RULE_OPENING = "Do not render readable writing";
const ROLE_LINE_PREFIX = "  역할: ";
export function withoutRequestOnlyLines(prompt: string): string {
  const kept = prompt.split("\n").filter((line) => !line.startsWith(ROLE_LINE_PREFIX));
  while (kept.length > 0 && kept[kept.length - 1]!.startsWith(RULE_OPENING)) kept.pop();
  return kept.join("\n");
}

export function imagePromptDrift(recorded: string, scene: unknown, styleLine: string, referenceNotes = ""): ImagePromptDrift {
  const record = withoutRequestOnlyLines(recorded);
  const now = (style: string) => withoutRequestOnlyLines(imagePromptFor(scene, style, referenceNotes));
  if (now(styleLine) === record) return "current";
  if (recordedByPreStartMotionBuilder(record, scene, referenceNotes)) return "current";
  // Compared without either side's style line, so an old line, a new one, and a removed one all land here alike.
  return withoutStyleLine(record) === now("") ? "style" : "scene";
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
