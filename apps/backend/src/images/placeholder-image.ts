/**
 * The bytes the local fake path writes for a scene image, and the test for "this file is not a real picture".
 *
 * One definition, for the reason the clip placeholder needed one: the same base64 lived in three services, and
 * the number of places that know what a placeholder looks like is the number of places that can disagree about
 * it. With clips they did disagree, and six paid videos were replaced by 32-byte stubs while every check stayed
 * green (see videos/placeholder-clip.ts).
 *
 * `isPlaceholderImage` is deliberately not "equals these bytes": a 1×1 PNG is not a scene, whoever wrote it,
 * and any future fake that is smaller still is not one either.
 */
export const PLACEHOLDER_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");

export function isPlaceholderImage(size: number): boolean {
  return size <= PLACEHOLDER_PNG.length;
}
