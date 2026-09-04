import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { LongProjectsService } from "./long-projects.service.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { StoryBibleService } from "./story-bible.service.js";

let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }); root = undefined; });

const settings = { title: "Long project", logline: "A local story", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };
const image = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const scenes = Array.from({ length: 6 }, (_, index) => ({ number: index + 1, description: `scene ${index + 1}` }));

/** Two Episodes: the first has not generated pictures, the second has. */
async function setup(states: readonly string[] = ["script_approved", "images_ready"]) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bible-sync-"));
  const projectsRoot = path.join(root, "projects");
  const long = new LongProjectsService(projectsRoot);
  await long.create({ projectId: "long_sync", settings });

  const longStory = path.join(projectsRoot, "long_sync", "long_story");
  await fs.writeFile(path.join(longStory, "episode_outlines.json"), JSON.stringify(states.map((_, index) => ({ episode_number: index + 1 }))), "utf8");
  for (const [index, state] of states.entries()) {
    const directory = path.join(longStory, `Episode0${index + 1}`);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path.join(directory, "project.json"), JSON.stringify({ number: index + 1, state, approved: false, script: { scenes }, script_revision: 1, scene_count: 6, updated_at: "2026-08-30T00:00:00.000Z" }), "utf8");
  }

  const assets = new LocalAssetsRepository(root);
  const mappings = new LocalProjectAssetMappingsRepository(projectsRoot);
  return { bible: new StoryBibleService(projectsRoot, assets, mappings), assets, mappings, projectsRoot };
}

const episodeLocation = (projectsRoot: string, number: number) => ({
  id: `long_sync/Episode0${number}`,
  directory: path.join(projectsRoot, "long_sync", "long_story", `Episode0${number}`),
  ensureExists: async () => {},
});

describe("Story Bible links reaching Episode mappings", () => {
  it("seeds the protagonist into Episodes that have not made pictures, and leaves the ones that have", async () => {
    // The line Captain D drew. An Episode whose pictures already exist keeps the mapping those pictures were
    // made from: changing it would make the record disagree with the files, and the pictures do not redraw
    // themselves to match — they were already paid for.
    const { bible, assets, mappings, projectsRoot } = await setup();
    const folder = await assets.createFolder({ assetType: "character", displayName: "이배드" });

    await bible.updateProtagonistAssetLink("long_sync", { assetLink: { assetId: folder.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });

    const first = await mappings.load(episodeLocation(projectsRoot, 1));
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      asset_id: folder.asset_id, usage_role: "character", assignment_source: "auto", match_reason: "auto_protagonist",
      // Confirmed from the start: they chose this person by name in the Story Bible, and asking again once per
      // Episode is the pressing this exists to remove.
      status: "confirmed", user_confirmed: true, enabled: true, project_id: "long_sync/Episode01",
    });
    expect(await mappings.load(episodeLocation(projectsRoot, 2))).toEqual([]);
  });

  /**
   * The order a person actually uses, which is the order the screen tells them to use.
   *
   * The mapping screen says the protagonist and the style chosen in settings "이 목록에 자동으로 올라옵니다",
   * and the push that makes that true runs when the Story Bible is saved — over the Episode folders that exist
   * *at that moment*. Episode folders are created when a script is written. So choosing first, which is what
   * the screen invites, seeded nothing, and the promise was false for exactly the people who followed it:
   * 캡틴D connected it by hand and then asked why it was not automatic (Cowork Round 463).
   *
   * No Episode exists when the links are saved here. One is created afterwards, the way it is in the app.
   */
  it("seeds an Episode created after the links were chosen — the order the screen asks for", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bible-sync-order-"));
    const projectsRoot = path.join(root, "projects");
    const long = new LongProjectsService(projectsRoot);
    await long.create({ projectId: "long_sync", settings });
    // The outline has to be approved before an Episode script can be written — the same door the app makes a
    // person walk through, so the order under test is the real one.
    const outline = await long.preview("long_sync");
    await long.approve("long_sync", { approved: true, prompt: outline.preview.prompt, promptSha256: outline.preview.promptSha256 });
    const assets = new LocalAssetsRepository(root);
    const mappings = new LocalProjectAssetMappingsRepository(projectsRoot);
    const bible = new StoryBibleService(projectsRoot, assets, mappings);
    const protagonist = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    const style = await assets.create({ buffer: image, originalname: "style.png", mimetype: "image/png" }, { assetType: "style", displayName: "수채화", approved: true });

    await bible.updateProtagonistAssetLink("long_sync", { assetLink: { assetId: protagonist.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    await bible.updateStyleAssetLink("long_sync", { assetLink: { assetId: style.asset_id, versionPolicy: "snapshot", pinnedVersion: 1 } });
    // Nothing to seed yet, and that part was never the defect.
    expect(await mappings.load(episodeLocation(projectsRoot, 1))).toEqual([]);

    await new EpisodeScriptsService(projectsRoot, undefined, undefined, assets, mappings)
      .generate("long_sync", 1, { userRequestId: "bible-sync-order" });

    const seeded = await mappings.load(episodeLocation(projectsRoot, 1));
    expect(seeded.map((mapping) => mapping.match_reason).sort()).toEqual(["auto_protagonist", "auto_style"]);
    expect(seeded.every((mapping) => mapping.status === "confirmed" && mapping.assignment_source === "auto")).toBe(true);
  });


  it("follows the link when it is changed and when it is cleared", async () => {
    const { bible, assets, mappings, projectsRoot } = await setup(["script_approved"]);
    const first = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    const second = await assets.createFolder({ assetType: "character", displayName: "민재" });

    await bible.updateProtagonistAssetLink("long_sync", { assetLink: { assetId: first.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    await bible.updateProtagonistAssetLink("long_sync", { assetLink: { assetId: second.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    expect((await mappings.load(episodeLocation(projectsRoot, 1))).map((mapping) => mapping.asset_id)).toEqual([second.asset_id]);

    await bible.updateProtagonistAssetLink("long_sync", { assetLink: null });
    expect(await mappings.load(episodeLocation(projectsRoot, 1))).toEqual([]);
  });

  it("keeps the style and protagonist tags apart", async () => {
    // Two tags, two sets. Saving one link must not clear the other's mapping — that is the whole reason
    // syncAutoMappings takes a tag, and the reason this pushes both links rather than only the changed one.
    const { bible, assets, mappings, projectsRoot } = await setup(["script_approved"]);
    const character = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    const style = await assets.create({ buffer: image, originalname: "style.png", mimetype: "image/png" }, { assetType: "style", displayName: "수채화", approved: true });

    await bible.updateProtagonistAssetLink("long_sync", { assetLink: { assetId: character.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    await bible.updateStyleAssetLink("long_sync", { assetLink: { assetId: style.asset_id, versionPolicy: "snapshot", pinnedVersion: 1 } });

    const stored = await mappings.load(episodeLocation(projectsRoot, 1));
    expect(stored.map((mapping) => [mapping.match_reason, mapping.usage_role, mapping.asset_id]).sort())
      .toEqual([["auto_protagonist", "character", character.asset_id], ["auto_style", "style", style.asset_id]].sort());
  });

  /**
   * `generating_images` sits on the "no pictures yet" side, and nothing was testing that it does.
   *
   * I expected the opposite when I wrote this and had to correct it: an Episode there is spending money right
   * now, so leaving it alone looks safer. It is not, and the run is why. generateCore loads the mappings once at
   * the start and holds the project lock for the whole run, so a Bible change landing mid-run cannot reach the
   * pictures being made. What it does reach is the next run — and the staleness report says so, because the
   * recorded reference_sources will no longer match. Excluding the state would instead have the Bible link
   * silently fail to reach an Episode, which is the failure nobody can see.
   *
   * Pinned because it was invisible: dropping `generating_images` from the shared list turned no test red in
   * either app before this, and the three callers of longEpisodeHasImages all answer differently without it.
   */
  it("still follows the Story Bible while pictures are being generated, since the run holds its own snapshot", async () => {
    const { bible, assets, mappings, projectsRoot } = await setup(["script_approved", "generating_images"]);
    const folder = await assets.createFolder({ assetType: "character", displayName: "이배드" });

    await bible.updateProtagonistAssetLink("long_sync", { assetLink: { assetId: folder.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });

    for (const episodeNumber of [1, 2]) {
      expect((await mappings.load(episodeLocation(projectsRoot, episodeNumber))).map((mapping) => mapping.asset_id), `Episode ${episodeNumber}`).toEqual([folder.asset_id]);
    }
  });

  /** The other side of the same line: once the pictures exist, the Bible no longer moves them. */
  it("leaves an Episode whose pictures already exist alone", async () => {
    const { bible, assets, mappings, projectsRoot } = await setup(["script_approved", "images_ready"]);
    const folder = await assets.createFolder({ assetType: "character", displayName: "이배드" });

    await bible.updateProtagonistAssetLink("long_sync", { assetLink: { assetId: folder.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });

    expect((await mappings.load(episodeLocation(projectsRoot, 1))).map((mapping) => mapping.asset_id)).toEqual([folder.asset_id]);
    expect(await mappings.load(episodeLocation(projectsRoot, 2)), "already paid for; the pictures cannot change to match").toEqual([]);
  });

  it("keeps going past an Episode it cannot read", async () => {
    // One unreadable folder must not cost the other Episodes their mapping. Losing all of them because of one
    // is the failure that looks like nothing happened at all, and the person has no way to tell which it was.
    const { bible, assets, mappings, projectsRoot } = await setup(["script_approved", "script_approved"]);
    const folder = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    // Reachable state, unreadable contents: the state field says "no pictures yet", so this Episode is one we
    // try to seed, and then the file turns out to have no script in it. The `continue` has to be reached.
    await fs.writeFile(path.join(projectsRoot, "long_sync", "long_story", "Episode01", "project.json"), JSON.stringify({ number: 1, state: "script_approved" }), "utf8");

    await bible.updateProtagonistAssetLink("long_sync", { assetLink: { assetId: folder.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    expect((await mappings.load(episodeLocation(projectsRoot, 2))).map((mapping) => mapping.asset_id)).toEqual([folder.asset_id]);
  });

  it("saves the link even when no Episode can be seeded", async () => {
    // Storing the link is what the person asked for. An unreadable Episode folder must not turn that into an
    // error — the mapping they did not get is one they can still make by hand; a link that did not save is not.
    const { bible, assets, projectsRoot } = await setup(["script_approved"]);
    const folder = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    await fs.writeFile(path.join(projectsRoot, "long_sync", "long_story", "episode_outlines.json"), "not json", "utf8");

    const linked = await bible.updateProtagonistAssetLink("long_sync", { assetLink: { assetId: folder.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    expect(linked.storyBible.protagonistAssetLink?.assetId).toBe(folder.asset_id);
  });
});
