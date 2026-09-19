import * as path from "node:path";

/**
 * Where a photo card's pictures live, named once.
 *
 * 🔴 **Two services need this and they used to spell it separately** — `photo-card.service.ts` wrote
 * `images/scene1.png` and `video-merge.service.ts` read `images/scene1.png`, each with its own `path.join`.
 * That was survivable while a card held exactly one picture and the name was a constant. It stops being
 * survivable now that the name carries an index: a writer counting from one and a reader counting from zero
 * would produce a card whose first picture is missing and whose last is never shown, and **neither side would
 * be wrong on its own**.
 *
 * Kept where every project's scene images already live, so nothing needs a second convention — and one
 * function, so the convention cannot be half-changed.
 */
export function cardImagePath(projectsRoot: string, projectId: string, scene: number): string {
  return path.join(projectsRoot, projectId, "images", `scene${scene}.png`);
}
