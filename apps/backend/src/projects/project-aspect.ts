import { IMAGE_SIZE_FOR_ASPECT, isAspectRatio, RUNWAY_RATIO_FOR_ASPECT, type AspectRatio, type ImageSize, type RunwayVideoRatio } from "@ai-animation-studio/shared";
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
 * anything that is not recognisably one of ASPECT_RATIOS is treated as portrait — the same fallback every copy
 * had, kept because a project with a missing or unreadable value is far more likely to be a vertical short than
 * a mistyped landscape or square one.
 */
export function shortProjectAspectRatio(project: StoredProject): AspectRatio {
  const styleNotes = project.lore_context.style_notes;
  const raw = typeof styleNotes === "object" && styleNotes !== null
    ? (styleNotes as Record<string, unknown>).aspect
    : undefined;
  const aspect = typeof raw === "string" ? raw.replaceAll(" ", "") : "";
  return isAspectRatio(aspect) ? aspect : "9:16";
}

/**
 * The same orientation in the image provider's size vocabulary.
 *
 * The providers are deliberately not named anywhere in this file: it lives under projects/, which
 * projects.no-provider-calls.test.ts keeps free of provider references, and that guard reads the source as text
 * — a mention in a comment counts. Converting a shape into a provider's spelling is not talking to that
 * provider, so the constant belongs here with the setting it derives from rather than in the adapter.
 */
export function imageSizeForAspect(project: StoredProject): ImageSize {
  return IMAGE_SIZE_FOR_ASPECT[shortProjectAspectRatio(project)];
}

/** The same orientation in the video provider's ratio vocabulary. */
export function runwayRatioForAspect(project: StoredProject): RunwayVideoRatio {
  return RUNWAY_RATIO_FOR_ASPECT[shortProjectAspectRatio(project)];
}
