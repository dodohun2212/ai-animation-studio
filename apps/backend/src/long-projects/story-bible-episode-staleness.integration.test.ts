import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { LocalProjectAssetMappingsRepository } from "../mappings/mappings.repository.js";
import { ProjectAssetMappingsService } from "../mappings/mappings.service.js";
import { OpenAiBudget } from "../providers/openai-budget.js";
import { ProviderSettingsRepository } from "../settings/provider-settings.repository.js";
import { ProviderSettingsService } from "../settings/provider-settings.service.js";
import { EpisodeImagesService } from "./episode-images.service.js";
import { storyBibleLinkDrift } from "./episode-story-bible-drift.js";
import { EpisodeMappingOwners, type EpisodeMappingKey } from "./episode-mapping-owner.js";
import { EpisodeScriptsService } from "./episode-scripts.service.js";
import { LongProjectsService } from "./long-projects.service.js";
import { StoryBibleService } from "./story-bible.service.js";

/**
 * Captain D's rule, driven end to end from the button a person actually presses.
 *
 * Both halves have their own tests — the seeding knows which Episodes to skip, and the staleness knows a
 * reference list changed — and neither says anything about the seam between them. That is the shape this
 * repository has a record for (D-031): both ends work and the middle does not exist. So this changes the
 * protagonist in the Story Bible, once, and asserts all three of the consequences the person was promised:
 * the Episode that has not drawn follows, the Episode that has does not, and the second one says so.
 */

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=";
const settings = { title: "Long story", logline: "A hero changes", overview: "", genre: "", tone: "", theme: "", episodeCount: 2, sceneCount: 6, clipDurationSeconds: 5, aspectRatio: "9:16" as const, audience: "", notes: "", startingState: "", midpoint: "", endingDirection: "", storyFlowSummary: "", narrationEnabled: false, subtitlesEnabled: false };

let root: string | undefined;
afterEach(async () => { vi.unstubAllGlobals(); if (root) await fs.rm(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 25 }); root = undefined; });

const jsonResponse = (status: number, body: unknown): Response =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body, headers: { get: () => null } } as unknown as Response);

/** The common ground the drift cases below need: a project whose outline is approved and whose two Episodes have scripts. */
async function setup() {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "bible-drift-"));
  const projectsRoot = path.join(root, "projects");
  const projects = new LongProjectsService(projectsRoot);
  await projects.create({ projectId: "long", settings });
  const preview = await projects.preview("long");
  await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });
  const scripts = new EpisodeScriptsService(projectsRoot);
  for (const episode of [1, 2]) {
    await scripts.generate("long", episode, { userRequestId: `bible-drift-script-${episode}` });
    await scripts.approve("long", episode, { approved: true });
  }
  const assets = new LocalAssetsRepository(root);
  const mappingStore = new LocalProjectAssetMappingsRepository(projectsRoot);
  const mappingOwners = new EpisodeMappingOwners(projectsRoot);
  return { root: root!, projectsRoot, assets, mappingStore, mappingOwners, bible: new StoryBibleService(projectsRoot, assets, mappingStore) };
}

describe("changing the Story Bible protagonist after some Episodes have drawn", () => {
  it("moves the Episode that has not drawn, leaves the one that has, and marks it behind", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "bible-staleness-"));
    const projectsRoot = path.join(root, "projects");
    const projects = new LongProjectsService(projectsRoot);
    await projects.create({ projectId: "long", settings });
    const preview = await projects.preview("long");
    await projects.approve("long", { approved: true, prompt: preview.preview.prompt, promptSha256: preview.preview.promptSha256 });

    const scripts = new EpisodeScriptsService(projectsRoot);
    for (const episode of [1, 2]) {
      await scripts.generate("long", episode, { userRequestId: `bible-staleness-script-${episode}` });
      await scripts.approve("long", episode, { approved: true });
    }

    const assets = new LocalAssetsRepository(root);
    const mappingStore = new LocalProjectAssetMappingsRepository(projectsRoot);
    const mappingOwners = new EpisodeMappingOwners(projectsRoot);
    const bible = new StoryBibleService(projectsRoot, assets, mappingStore);

    // Folders with a representative child, which is what a character Asset actually is — a Folder with no
    // child resolves to no bytes, and then swapping one empty Folder for another would prove nothing.
    const folderWithChild = async (name: string, file: string) => {
      const folder = await assets.createFolder({ assetType: "character", displayName: name });
      const child = await assets.create({ buffer: PNG, originalname: file, mimetype: "image/png" }, { assetType: "character", displayName: `${name} 정면`, approved: true });
      await assets.setParentFolder(child.asset_id, folder.asset_id);
      return folder;
    };
    const hero = await folderWithChild("이배드", "ibad.png");
    const rival = await folderWithChild("민재", "minjae.png");

    // A second character, mapped by hand for this Episode alone, before the protagonist is ever chosen — so it
    // sits ahead of the seeded one in storage. It is not the protagonist link disagreeing with itself; it is a
    // second character, which is an ordinary thing for an Episode to have, and the report has to tell them apart.
    const extra = await folderWithChild("시장", "mayor.png");
    const mappings = new ProjectAssetMappingsService<EpisodeMappingKey>(mappingStore, assets, mappingOwners);
    const key: EpisodeMappingKey = { projectId: "long", episodeNumber: 1 };
    await mappings.create(key, { assetId: extra.asset_id, usageRole: "character", sceneScope: { kind: "all" } });

    // The person picks the protagonist. Both Episodes are still at script_approved, so both follow.
    await bible.updateProtagonistAssetLink("long", { assetLink: { assetId: hero.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    const mappingsOf = async (episodeNumber: number) => (await mappingStore.load(await mappingOwners.get({ projectId: "long", episodeNumber }))).map((mapping) => mapping.asset_id);
    expect(await mappingsOf(1)).toEqual([extra.asset_id, hero.asset_id]);
    expect(await mappingsOf(2)).toEqual([hero.asset_id]);

    // Episode 1 buys its pictures.
    const providerSettings = new ProviderSettingsService(new ProviderSettingsRepository(root));
    await providerSettings.save("openai", { value: "sk-test-key-1234567890" });
    const images = new EpisodeImagesService(projectsRoot, assets, mappingStore, mappingOwners, providerSettings, new OpenAiBudget(root, 10));
    const begun = await mappings.beginReview(key, { scriptRevision: (await mappingOwners.get(key)).scriptRevision, textOnlyConfirmed: true });
    await mappings.approveReview(key, { scriptFingerprint: begun.review.scriptFingerprint });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { data: [{ b64_json: PNG_BASE64 }] })));
    await images.generate("long", 1, { approved: true });
    const drawn = await images.get("long", 1);
    expect(drawn.staleness.referenceStale).toEqual([]);
    // Agreeing says nothing. A field that reported the current protagonist as "different" would put a warning
    // on every Episode ever drawn.
    expect(drawn.storyBibleLinkDrift).toEqual([]);

    // And now the person changes their mind about the protagonist.
    await bible.updateProtagonistAssetLink("long", { assetLink: { assetId: rival.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });

    // Episode 2 has drawn nothing, so it follows.
    expect(await mappingsOf(2)).toEqual([rival.asset_id]);
    // Episode 1 has pictures of 이배드 on disk. Its mapping is left saying 이배드, because that is what the
    // pictures are — moving it would make the record disagree with the files, and the pictures do not redraw.
    // The character added by hand is untouched too: automatic seeding never overrules a person's own mapping.
    expect(await mappingsOf(1)).toEqual([extra.asset_id, hero.asset_id]);
    // And is told so, on the screen that shows those pictures.
    const after = await images.get("long", 1);
    expect(after.storyBibleLinkDrift).toEqual([{
      link: "protagonist",
      storyBibleAssetId: rival.asset_id, storyBibleAssetName: "민재",
      episodeAssetId: hero.asset_id, episodeAssetName: "이배드",
    }]);

    // Told by the right field, which is the whole reason there are two. Leaving this Episode's mapping alone is
    // the rule, so nothing about the Episode moved — recorded references still equal current ones, and neither
    // the picture nor the script comparison has anything to report. A marker built on either of those would be
    // silent here by construction, and this is the case it exists for.
    expect(after.staleness.referenceStale).toEqual([]);
    expect(after.staleness.imageStale).toEqual([]);
  });

  /**
   * The protagonist connected by hand is the protagonist.
   *
   * Generation never asks who attached a mapping — confirmed, enabled and in scope is the whole filter — so a
   * hand-linked character is in the pictures that were paid for. The drift report asked a narrower question,
   * "is the mapping this link owns the same asset", and answered "made with 연결 없음" for every Episode whose
   * protagonist was connected from the screen. 캡틴D read that after four Episodes of pictures with 이배드 in
   * them (Cowork Round 468).
   *
   * Before automatic seeding existed there was no `auto` mapping to find at all, so this was every project with
   * a protagonist link.
   */
  it("says nothing when the Story Bible's protagonist is in the Episode, however it was connected", async () => {
    const { root, projectsRoot, assets, bible, mappingStore, mappingOwners } = await setup();
    const hero = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    const mappings = new ProjectAssetMappingsService<EpisodeMappingKey>(mappingStore, assets, mappingOwners);
    const key: EpisodeMappingKey = { projectId: "long", episodeNumber: 1 };

    // Connected from the screen: assignment_source "manual", match_reason "manual_assignment".
    await mappings.create(key, { assetId: hero.asset_id, usageRole: "character", sceneScope: { kind: "all" } });
    await bible.updateProtagonistAssetLink("long", { assetLink: { assetId: hero.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });

    const stored = await mappingStore.load(await mappingOwners.get(key));
    expect(stored.map((mapping) => mapping.assignment_source)).toContain("manual");
    // Empty *and* readable: two different answers now, and only this pair means "they agree".
    expect(await storyBibleLinkDrift(projectsRoot, assets, "long", stored)).toEqual({ links: [], unreadable: false });
    void root;
  });

  // The counterpart, so "says nothing" is not simply "says nothing ever": a protagonist the Episode does not
  // have is still reported, and the Episode's side of the sentence stays the mapping the link owns rather than
  // whichever character happens to be there by hand.
  it("still reports a protagonist the Episode does not have", async () => {
    const { projectsRoot, assets, bible, mappingStore, mappingOwners } = await setup();
    const hero = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    const mayor = await assets.createFolder({ assetType: "character", displayName: "시장" });
    const rival = await assets.createFolder({ assetType: "character", displayName: "민재" });
    const mappings = new ProjectAssetMappingsService<EpisodeMappingKey>(mappingStore, assets, mappingOwners);
    const key: EpisodeMappingKey = { projectId: "long", episodeNumber: 1 };

    await mappings.create(key, { assetId: mayor.asset_id, usageRole: "character", sceneScope: { kind: "all" } });
    await bible.updateProtagonistAssetLink("long", { assetLink: { assetId: hero.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    // Past the point where seeding follows: this Episode's pictures exist, so its mappings are frozen — which
    // is the only way a real difference can arise.
    const episodeFile = path.join(projectsRoot, "long", "long_story", "Episode01", "project.json");
    const stored = JSON.parse(await fs.readFile(episodeFile, "utf8")) as Record<string, unknown>;
    await fs.writeFile(episodeFile, JSON.stringify({ ...stored, state: "images_ready" }), "utf8");

    await bible.updateProtagonistAssetLink("long", { assetLink: { assetId: rival.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });

    const drift = await storyBibleLinkDrift(projectsRoot, assets, "long", await mappingStore.load(await mappingOwners.get(key)));
    expect(drift).toEqual({ unreadable: false, links: [{
      link: "protagonist",
      storyBibleAssetId: rival.asset_id, storyBibleAssetName: "민재",
      // 이배드, not 시장: the hand-added character is in the Episode but is not what the protagonist link owns.
      episodeAssetId: hero.asset_id, episodeAssetName: "이배드",
    }] });
  });

  /**
   * A Story Bible nobody can read is not a Story Bible everybody agrees with.
   *
   * Both used to come back as the same empty list, and the review screen renders an empty list as silence. That
   * silence sits directly above the paid regenerate button, and this list is the only thing able to say an
   * Episode was drawn with a different character than the story now has — the sentence 캡틴D needed this week.
   * A malformed story_bible.json therefore switched that warning off without telling anyone.
   *
   * A missing Story Bible stays an empty, readable answer: a project that has none has nothing for its Episodes
   * to disagree with, which is an ordinary thing to report rather than a failure to look.
   */
  it("says it could not read the Story Bible rather than reporting no drift", async () => {
    const { projectsRoot, assets, bible, mappingStore, mappingOwners } = await setup();
    const hero = await assets.createFolder({ assetType: "character", displayName: "이배드" });
    const mappings = new ProjectAssetMappingsService<EpisodeMappingKey>(mappingStore, assets, mappingOwners);
    const key: EpisodeMappingKey = { projectId: "long", episodeNumber: 1 };
    await mappings.create(key, { assetId: hero.asset_id, usageRole: "character", sceneScope: { kind: "all" } });
    await bible.updateProtagonistAssetLink("long", { assetLink: { assetId: hero.asset_id, versionPolicy: "follow_latest", pinnedVersion: null } });
    const stored = await mappingStore.load(await mappingOwners.get(key));
    const bibleFile = path.join(projectsRoot, "long", "long_story", "story_bible.json");

    await fs.writeFile(bibleFile, "{ not json", "utf8");
    expect(await storyBibleLinkDrift(projectsRoot, assets, "long", stored)).toEqual({ links: [], unreadable: true });

    await fs.rm(bibleFile);
    // Gone is an answer, not a failure to answer.
    expect(await storyBibleLinkDrift(projectsRoot, assets, "long", stored)).toEqual({ links: [], unreadable: false });
  });

});
