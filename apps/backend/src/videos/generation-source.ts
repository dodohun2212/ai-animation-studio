import type { GenerationSource } from "@ai-animation-studio/shared";

/**
 * One reader for "where did these clips actually come from", shared by everything that has to answer it.
 *
 * The stored `execution_mode` is a storage detail — `"runway"` when a real key and a budget were in place at
 * submission time, `"local_fake_no_provider"` otherwise — and three places had grown their own copy of the same
 * three-line classification: the short-project mapper, the Episode merge, and the Instagram publish gate. They
 * agreed, which is the dangerous shape: the next person to learn a fourth `execution_mode` would teach one of
 * them and the other two would keep answering from the old vocabulary. `docs/06_DECISIONS.md` records the same
 * lesson from the seven services that each carried their own literal 6.
 *
 * 🔴 The classification is deliberately asymmetric, and that asymmetry is the point. A single placeholder clip
 * makes the whole merge a placeholder, because the merged file contains it. "Paid" requires *every* record to
 * say so — anything else, including an empty list or a mode this build does not know, is `unknown_legacy`, which
 * is treated as "no evidence" and never as proof of a paid render. Absent evidence must not read as paid: the
 * one irreversible action in this app (publishing to Instagram) is gated on it.
 *
 * Keeping it here rather than in `src/projects/` is also what lets `projects.no-provider-calls.test.ts` stay
 * honest — that guard forbids the very word `runway` in the short-project create/list/get code, and a provider's
 * name written there is exactly what it is looking for, whether or not it is only being compared against.
 */
const executionModes = (records: readonly unknown[]): readonly unknown[] =>
  records.map((record) => record && typeof record === "object" && !Array.isArray(record)
    ? (record as Record<string, unknown>).execution_mode
    : undefined);

/** The origin of a final video, read off the video generation records that produced it. */
export function generationSourceOfVideoRecords(records: unknown): GenerationSource {
  if (!Array.isArray(records) || records.length === 0) return "unknown_legacy";
  const modes = executionModes(records);
  if (modes.some((mode) => mode === "local_fake_no_provider")) return "local_fake_no_provider";
  return modes.every((mode) => mode === "runway") ? "paid_provider" : "unknown_legacy";
}

/**
 * Whether any clip behind a final video is a local placeholder.
 *
 * Separate from the function above because the question is narrower: a publish only needs to know whether a
 * placeholder is in there, and answering it through the full classification would let a future third source
 * value quietly turn into "publishable".
 */
export function hasLocalFakeVideoRecord(records: unknown): boolean {
  return Array.isArray(records) && executionModes(records).some((mode) => mode === "local_fake_no_provider");
}

/** Narrows a value read back from disk, where an older file may carry nothing or something unrecognised. */
export function storedGenerationSource(value: unknown): GenerationSource {
  return value === "paid_provider" || value === "local_fake_no_provider" || value === "unknown_legacy"
    ? value
    : "unknown_legacy";
}
