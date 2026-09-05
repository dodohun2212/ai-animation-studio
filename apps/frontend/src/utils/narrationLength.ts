/**
 * Whether one narration line is too long for its clip — the guess and the measurement, in one place.
 *
 * Both narration review screens carried this whole pair: the same constant, the same two predicates, differing
 * only in the parameter's type name. The Episode screen's comment said the copy was deliberate — "kept as a
 * local copy rather than shared because it is a display heuristic, not a contract value" — and that reasoning
 * is right about the contract and wrong about here. The contract is for facts both sides need; this is a
 * frontend display rule two frontend screens need, which is what this folder is for.
 *
 * 🟠 It matters because the number is already documented as wanting a change: the comment below says it reads
 * Korean-calibrated and over-triggers on Latin text and numbers. Whoever acts on that will edit one screen,
 * and then the same script under the same 5-second clip gets flagged on one screen and not the other.
 *
 * The parameter is a shape, not a named type: the short project and the Episode have their own review types
 * and these two rules only ever look at the two fields both of them have.
 *
 * 🔴 `clipDurationSeconds` accepts null as well as undefined, and that is not tidiness — the two screens hold
 * the same value in different shapes (`useState<number | null>` on the Episode, undefined on the short
 * project), which is the residue of the very duplication this file removes. Narrowing it would push a
 * conversion onto one caller for no gain; the body already reads both as "not known" (`Boolean(null)` is
 * false, `null ?? 0` is 0).
 */

/**
 * Rough Korean narration reading pace, in characters per second. Only a fallback: once a scene's audio exists
 * the server reports its measured length, and a measured length is a fact where this is a guess (it also reads
 * Korean-calibrated, so Latin text and numbers over-trigger it). Never blocks anything either way — it flags
 * lines for a human to shorten, it does not decide for them.
 */
export const READING_CHARS_PER_SECOND = 5;

interface NarrationLine {
  narration: string;
  /** Present once the audio has actually been made. Absent is "not made yet", never "zero seconds". */
  audioDurationSeconds?: number;
}

/** A guess from character count — used only for scenes whose audio has not been made yet. */
export function narrationLooksTooLong(item: NarrationLine, clipDurationSeconds: number | null | undefined): boolean {
  return item.audioDurationSeconds === undefined
    && Boolean(clipDurationSeconds)
    && item.narration.trim().length > (clipDurationSeconds ?? 0) * READING_CHARS_PER_SECOND;
}

/** Measured from the actual audio file — this one is a fact, not an estimate. */
export function narrationRunsTooLong(item: NarrationLine, clipDurationSeconds: number | null | undefined): boolean {
  return item.audioDurationSeconds !== undefined
    && Boolean(clipDurationSeconds)
    && item.audioDurationSeconds > (clipDurationSeconds ?? 0);
}
