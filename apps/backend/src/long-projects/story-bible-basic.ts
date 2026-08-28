/**
 * The Story Bible's `basic` section, with the fields the project settings already own removed.
 *
 * `create()` used to copy eight settings fields in here, and `updateSettings()` writes only project.json — so
 * the copy went stale the first time anything was renamed. Both prompt paths carry the Bible alongside the
 * settings, which handed the model the new title and the old one together and left it to guess. Nothing showed
 * it on a fresh project, because the two agree until something is edited.
 *
 * New projects start with an empty `basic`, so this only matters for ones created before that. Their copies are
 * left on disk rather than deleted: `basic` is reachable from the advanced JSON editor, so it may also hold
 * lines somebody wrote by hand, and those have no duplicate anywhere. Removing exactly what settings own takes
 * the contradiction away and keeps the rest.
 *
 * One function for both prompt paths on purpose. Two copies of "which keys are duplicated" is the shape that
 * caused this in the first place.
 */
const OWNED_BY_SETTINGS = new Set([
  "title", "logline", "overview", "genre", "tone", "theme", "ending_direction", "audience",
]);

/**
 * Asset links live in `basic` because that is where the Story Bible keeps project-wide values, but they are
 * plumbing: an Asset ID and a version policy say nothing to a model writing a script, and the style link has
 * been going into the prompt as a raw blob in the middle of the story setup. What a prompt can use is the thing
 * the link points at — the protagonist's name is added to project_overview by the caller — so the links
 * themselves are removed here.
 */
const PLUMBING = new Set(["style_asset_link", "protagonist_asset_link"]);

export function storyBibleBasicForPrompt(basic: unknown): Record<string, unknown> {
  if (typeof basic !== "object" || basic === null || Array.isArray(basic)) return {};
  return Object.fromEntries(Object.entries(basic as Record<string, unknown>).filter(([key]) => !OWNED_BY_SETTINGS.has(key) && !PLUMBING.has(key)));
}
