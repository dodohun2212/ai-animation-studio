import { DEFAULT_SCENE_COUNT } from "@ai-animation-studio/shared";

/**
 * How many scenes a stored record has, for records written before `scene_count` existed.
 *
 * Six services wrote this same ternary out, each with its own literal 6. The number itself is the contract's —
 * `DEFAULT_SCENE_COUNT` sits beside the bounds every count is checked against, because a default outside them
 * is a project whose fallback fails the validation that sent us to the fallback.
 *
 * What made the copies worth collecting is not the digit. It is that this answer decides how many scenes get
 * walked: a service that answers 6 for a twelve-scene Episode stops halfway and reports the rest as absent,
 * and one that answers 12 for a six-scene one looks for files nobody ever made. Six places deciding that
 * separately is six chances for two screens to disagree about how long an Episode is.
 *
 * Deliberately not a validation. A record that says 12 is taken at its word here — whether 12 is allowed is
 * MIN/MAX_SCENE_COUNT's question, asked where a count is chosen rather than where an old record is read.
 */
export function storedSceneCount(record: Record<string, unknown>): number {
  return Number.isInteger(record.scene_count) ? record.scene_count as number : DEFAULT_SCENE_COUNT;
}
