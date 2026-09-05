/**
 * Adds a warning to a project's list, once.
 *
 * This repository already decided the rule and wrote it down — *"never stack the same sentence twice"* — and
 * then kept it in two places out of fourteen. The Episode helper checks, the short project's orphan-recovery
 * checks, and twelve other appends did not.
 *
 * 🔴 The sentences that repeat are the ones that matter. `spendUnrecordedWarning` is written every time a paid
 * call succeeds and its ledger row does not, so a ledger that stays unwritable adds one per scene, per run,
 * forever. The screen ends up showing the same instruction six or twelve times, which reads as six or twelve
 * separate problems — and buries whatever else the project was trying to say.
 *
 * Identity is the whole sentence, deliberately. Two warnings that name different scenes are two different
 * facts and both belong; the same sentence twice is one fact, said twice.
 */
export function withWarning(existing: readonly string[], message: string): string[] {
  return existing.includes(message) ? [...existing] : [...existing, message];
}
