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
