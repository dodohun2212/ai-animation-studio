import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { EpisodeContinuityService } from "./episode-continuity.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";

let root: string | undefined;
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 5, episodeDurationSeconds: 30, platform: "YouTube Shorts" as const, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "" };
const memory = { episodeSummary: "A bridge collapses.", events: ["The bridge falls"], appearedCharacterIds: ["hero"], characterChanges: [{ characterId: "hero", change: "injured" }], appearedLocationIds: ["bridge"], itemChanges: [{ itemId: "map", change: "lost" }], resolvedConflicts: [], newConflicts: ["The river blocks escape"], revealedSecretIds: ["secret-visible"], remainingSecretIds: ["secret-hidden"], newForeshadowingIds: [], resolvedForeshadowingIds: [], nextActions: ["Find a boat"], timeElapsed: "one hour", worldChanges: [], userEdits: "" };
const episodePath = (number: number) => path.join(root!, "projects", "long", "long_story", `Episode${String(number).padStart(2, "0")}`, "project.json");
async function setup() { root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-continuity-")); const projects = new LongProjectsService(path.join(root, "projects")); await projects.create({ projectId: "long", settings }); const preview = await projects.preview("long"); await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 }); return { continuity: new EpisodeContinuityService(path.join(root, "projects")), scripts: new EpisodeScriptsService(path.join(root, "projects")) }; }
async function markEligible(number: number) { const file = episodePath(number); const value = JSON.parse(await fs.readFile(file, "utf8")) as Record<string, unknown>; value.state = "waiting_for_video_confirmation"; await fs.writeFile(file, JSON.stringify(value)); }
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe("EpisodeContinuityService", () => {
  it("saves only after image approval, atomically persists snake_case, and returns an existing next episode", async () => {
    const { continuity, scripts } = await setup(); await scripts.generate("long", 1, {});
    await expect(continuity.save("long", 1, { memory })).rejects.toMatchObject({ response: { code: "LONG_EPISODE_CONTINUITY_NOT_ALLOWED" } });
    await markEligible(1); await scripts.generate("long", 2, {});
    const saved = await continuity.save("long", 1, { memory });
    expect(saved.memory).toMatchObject({ episodeNumber: 1, episodeSummary: "A bridge collapses." });
    expect(saved.nextEpisode).toMatchObject({ episodeNumber: 2 });
    const raw = JSON.parse(await fs.readFile(path.join(path.dirname(episodePath(1)), "continuity.json"), "utf8"));
    expect(raw).toMatchObject({ episode_number: 1, episode_summary: "A bridge collapses." });
    expect(raw).not.toHaveProperty("episodeNumber");
    expect(await continuity.get("long", 1)).toMatchObject({ memory: { episodeNumber: 1 } });
  });

  it("rejects malformed memory and accepts a missing next Episode as null", async () => {
    const { continuity, scripts } = await setup(); await scripts.generate("long", 1, {}); await markEligible(1);
    await expect(continuity.save("long", 1, { memory: { ...memory, events: ["x", 2] } as never })).rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(continuity.save("long", 1, { memory })).resolves.toMatchObject({ nextEpisode: null });
    await fs.writeFile(path.join(path.dirname(episodePath(1)), "continuity.json"), "{ nope");
    await expect(continuity.get("long", 1)).rejects.toMatchObject({ response: { code: "LONG_PROJECT_JSON_MALFORMED" } });
  });

  it("adds ordered, bounded continuity context without secret fields to the next script history", async () => {
    const { scripts } = await setup();
    for (const number of [1, 2, 3, 4]) { const directory = path.dirname(episodePath(number)); await fs.mkdir(directory, { recursive: true }); await fs.writeFile(path.join(directory, "continuity.json"), JSON.stringify({ episode_number: number, episode_summary: `summary-${number}`, events: [`event-${number}`], character_changes: [{ characterId: `character-${number}` }], next_actions: [`action-${number}`], revealed_secret_ids: ["must-not-appear"], remaining_secret_ids: ["also-hidden"], appeared_character_ids: [], appeared_location_ids: [], item_changes: [], resolved_conflicts: [], new_conflicts: [], new_foreshadowing_ids: [], resolved_foreshadowing_ids: [], time_elapsed: "", world_changes: [], user_edits: "", updated_at: new Date().toISOString() })); }
    await scripts.generate("long", 5, {});
    const saved = JSON.parse(await fs.readFile(episodePath(5), "utf8")); const context = saved.script_history.at(-1).continuity_context;
    expect(context.recentContinuity.map((value: { episodeNumber: number }) => value.episodeNumber)).toEqual([2, 3, 4]);
    expect(context.olderCompressedSummaries).toEqual([{ episodeNumber: 1, summary: "summary-1" }]);
    expect(JSON.stringify(context)).not.toContain("must-not-appear");
    expect(JSON.stringify(context)).not.toContain("revealed_secret_ids");
  });
});
