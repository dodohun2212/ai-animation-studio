/**
 * The bytes the local fake path writes for a scene, and the test for "this file is not a real clip".
 *
 * One definition because there used to be three of the same bytes, and the number of places that knew what a
 * placeholder looks like is exactly the number of places that could disagree about it. They did: the real
 * Runway path wrote this constant over six downloaded clips, every check stayed green, and the merge step was
 * ready to concatenate the result into a file named "final video" — because its only file test was "larger
 * than zero bytes", which a header satisfies.
 *
 * `isPlaceholderClip` is deliberately not "equals these bytes": anything no longer than a bare `ftyp` box is
 * not a video either, whoever wrote it.
 */
export const PLACEHOLDER_MP4 = Buffer.from("000000186674797069736F6D0000020069736F6D69736F32617663316D703431", "hex");

export function isPlaceholderClip(size: number): boolean {
  return size <= PLACEHOLDER_MP4.length;
}

/**
 * Whether any record in this list reached a provider.
 *
 * Written out three times — the scene content route, the final-video route and the library's project scan —
 * always as the same `.some()` over an unknown-shaped record. It decides which of the two file tests below
 * applies, so a copy that drifts does not fail loudly: it quietly moves a run to the lenient test, and the
 * lenient test is the one that let six stubbed clips pass for paid ones.
 */
export function wasPaidRun(records: readonly unknown[]): boolean {
  return records.some((item) => typeof item === "object" && item !== null && (item as { execution_mode?: unknown }).execution_mode === "runway");
}

/**
 * Whether a file on disk can stand in for this run's clip.
 *
 * The composite judgment — a real file, not empty, and for a paid run not a placeholder — appeared verbatim in
 * three routes and once more without the paid gate. The comment at one of them already counted this as "the
 * fifth place this same judgment lives".
 *
 * `paid` chooses the test rather than being folded in, because the lenient answer is correct for the local fake
 * path: it writes placeholders deliberately and serving them is its normal behaviour. Recovery passes `true`
 * unconditionally, which is the honest reading of what it is looking for — a clip somebody paid for.
 *
 * Takes the stat rather than the path: two of the callers need the rest of it (size, mtime) and re-statting to
 * ask one question would be a second answer about a file that can change between the two.
 */
export function isUsableClip(stat: { isFile(): boolean; size: number }, paid: boolean): boolean {
  return stat.isFile() && stat.size > 0 && !(paid && isPlaceholderClip(stat.size));
}
