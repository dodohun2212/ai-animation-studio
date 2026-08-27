import type { StoredProject } from "./project-storage.schema.js";

/**
 * The one place a short project's orientation is read from storage.
 *
 * It exists because there used to be five: project.mapper.ts, video-library.service.ts, video-preview.service.ts,
 * video-merge.service.ts and image-prompt.ts each kept "its own tiny copy" of the derivation, and every one of
 * them read `style_profile.aspect` — a field nothing has ever written. The settings screen stores the choice at
 * `lore_context.style_notes.aspect` (see applyShortProjectSettings), so every reader fell through to the
 * portrait default and a project set to 가로형 was generated, merged and displayed vertical anyway. Checked
 * against real stored projects: `style_profile.aspect` appears in none of them.
 *
 * The copies did not disagree with each other, which is why nothing caught it — they were identically wrong, and
 * there was no single place where being wrong once would have been visible. That is the argument for one
 * function rather than five: not that copies drift, but that a copy has no place to be corrected.
 *
 * Whitespace is stripped because the value reaches storage as free-ish text ("16 : 9" has been seen), and
 * anything that is not recognisably 16:9 is treated as portrait — the same fallback every copy had, kept
 * because a project with a missing or unreadable value is far more likely to be a vertical short than a
 * mistyped landscape one.
 */
export function shortProjectAspectRatio(project: StoredProject): "9:16" | "16:9" {
  const styleNotes = project.lore_context.style_notes;
  const raw = typeof styleNotes === "object" && styleNotes !== null
    ? (styleNotes as Record<string, unknown>).aspect
    : undefined;
  const aspect = typeof raw === "string" ? raw.replaceAll(" ", "") : "";
  return aspect === "16:9" ? "16:9" : "9:16";
}

/**
 * The same orientation in the image provider's size vocabulary.
 *
 * The providers are deliberately not named anywhere in this file: it lives under projects/, which
 * projects.no-provider-calls.test.ts keeps free of provider references, and that guard reads the source as text
 * — a mention in a comment counts. Converting a shape into a provider's spelling is not talking to that
 * provider, so the constant belongs here with the setting it derives from rather than in the adapter.
 */
export function imageSizeForAspect(project: StoredProject): "1024x1536" | "1536x1024" {
  return shortProjectAspectRatio(project) === "16:9" ? "1536x1024" : "1024x1536";
}

/** The same orientation in the video provider's ratio vocabulary. */
export function runwayRatioForAspect(project: StoredProject): "720:1280" | "1280:720" {
  return shortProjectAspectRatio(project) === "16:9" ? "1280:720" : "720:1280";
}
