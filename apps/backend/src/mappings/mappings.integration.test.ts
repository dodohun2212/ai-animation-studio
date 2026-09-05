import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { ProjectAssetMappingsService } from "./mappings.service.js";
import { ShortProjectMappingOwners } from "./short-project-mapping-owner.js";
import { LocalProjectAssetMappingsRepository } from "./mappings.repository.js";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
let root: string | undefined;
afterEach(async () => { if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

async function setup(sceneCount = 6) {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "asset-mapping-"));
  const projectsRoot = path.join(root, "projects"); const projects = new LocalProjectRepository(projectsRoot);
  const project = createStoredProject("short_mapping", "Asset mapping", "2026-08-22T00:00:00.000Z");
  project.script_revision = 1;
  project.scenes = Array.from({ length: sceneCount }, (_, index) => ({ number: index + 1, description: `scene ${index + 1}` }));
  // The settings are what the scene count is read from, and what create() validates a scope against. Setting the
  // scenes without them would build a project that cannot exist — approval refuses that pair outright.
  project.lore_context = { ...project.lore_context, scene_count: sceneCount };
  await projects.create(project);
  const assets = new LocalAssetsRepository(root);
  const asset = await assets.create({ buffer: png, originalname: "fixture.png", mimetype: "image/png" }, { assetType: "style", displayName: "Fixture style" });
  const mappings = new LocalProjectAssetMappingsRepository(projectsRoot);
  return { assets, asset, mappings, service: new ProjectAssetMappingsService(mappings, assets, new ShortProjectMappingOwners(mappings)), project };
}

describe("ProjectAssetMappingsService", () => {
  it("reports the owner's own scene count, so a scene picker offers only scenes the server will accept", async () => {
    // The screen listed 1..MAX_SCENE_COUNT and this project has four scenes, so it offered scene five and the
    // server refused it — the app proposing a choice it does not accept. Both halves are asserted together
    // because the value only means anything if it agrees with what create() allows; a constant six would satisfy
    // neither, and reporting a count nothing enforces would satisfy the first alone.
    const { service, asset } = await setup(4);
    expect((await service.review("short_mapping")).sceneCount).toBe(4);

    await expect(service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "scene", sceneNumber: 5 } }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    const withinRange = await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "scene", sceneNumber: 4 } });
    expect(withinRange.mapping.sceneScope).toEqual({ kind: "scene", sceneNumber: 4 });
  });

  /**
   * Where the empty fingerprint came from in the first place.
   *
   * loadReview answers a missing file with a fresh record whose fingerprint is "" — right as a read, and wrong
   * the moment it is written back. invalidateReview used to write it back on any mapping change, so an Episode
   * nobody had opened for review ended up with a persisted review saying "the baseline is the empty string".
   * The Story Bible seeding an auto_protagonist mapping is enough to trigger it, and that is why Episode 5 of
   * Captain D's project was already in that state before he ever pressed anything.
   *
   * Both directions matter: before a review exists there is nothing to invalidate, and after one exists a
   * mapping change still has to invalidate it — that is what stops an approved review outliving the mappings
   * it approved.
   */
  it("does not invent a review baseline when mappings change before any review exists", async () => {
    const { service, asset, mappings } = await setup();
    await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });

    const review = await mappings.loadReview(mappings.projectLocation("short_mapping"));

    expect(review.script_fingerprint, "an empty baseline must never be written down as one").toBe("");
    expect(review.mapping_revision).toBe(0);
  });

  it("still invalidates a review that had been begun, when the mappings change under it", async () => {
    const { service, asset, mappings } = await setup();
    await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });
    const begun = await service.beginReview("short_mapping", { scriptRevision: 1 });

    await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "character", sceneScope: { kind: "all" } });

    const after = await mappings.loadReview(mappings.projectLocation("short_mapping"));
    expect(after.mapping_revision, "the review no longer describes the mappings").toBeGreaterThan(begun.review.mappingRevision);
    expect(after.status).toBe("waiting");
  });

  /**
   * The way out of the block above, pinned because it is now the advice a person is given.
   *
   * 「지금 대본 기준으로 다시 맞추기」 is beginReview, and someone told to press it after connecting their
   * references has every reason to fear it throws that work away — the button's own description talks about
   * having edited the script. It does not: it writes the review record and never touches the mappings.
   */
  it("setting the check baseline again leaves the connections already made alone", async () => {
    const { service, asset } = await setup();
    const created = await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });

    const begun = await service.beginReview("short_mapping", { scriptRevision: 1 });

    expect(begun.review.scriptFingerprint, "the empty fingerprint that caused the block is now set").toMatch(/^[a-f0-9]{64}$/);
    const after = await service.list("short_mapping");
    expect(after.mappings.map((mapping) => mapping.mappingId)).toEqual([created.mapping.mappingId]);
    expect(after.mappings[0], "still confirmed, still the same asset").toMatchObject({ assetId: asset.asset_id, status: "confirmed" });

    // And the approval it was blocking now goes through.
    const approved = await service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint });
    expect(approved.review.status).toBe("approved");
  });

  /**
   * Captain D pressed 「연결 다 했음 · 다음 단계로」 and got "입력 내용을 확인해 주세요" — told he had mistyped
   * something, on a screen where he had typed nothing (Cowork Round 533).
   *
   * A project whose review file does not exist yet reads back a scriptFingerprint of "", the screen sends back
   * what this server just gave it, and this refusal rejects the server's own value. Four different failures left
   * here as one sentence, so the client had nothing to say but the most accusatory reading of it.
   *
   * The reason travels with the refusal now. `no_baseline` is not a malformed request at all — the check baseline
   * was never set, and the way out is to set it.
   */
  it("says which of the four things was wrong with an approval, so a screen need not guess", async () => {
    const { service } = await setup();

    // The one Captain D hit: never reviewed, so the fingerprint the server itself hands out is empty.
    await expect(service.approveReview("short_mapping", { scriptFingerprint: "" }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST", details: { reason: "no_baseline" } } });

    await expect(service.approveReview("short_mapping", { scriptFingerprint: "not-a-digest" }))
      .rejects.toMatchObject({ response: { details: { reason: "fingerprint_malformed" } } });

    const begun = await service.beginReview("short_mapping", { scriptRevision: 1 });
    await expect(service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint, approvedBy: "   " }))
      .rejects.toMatchObject({ response: { details: { reason: "approved_by_invalid" } } });

    await expect(service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint, whatIsThis: true }))
      .rejects.toMatchObject({ response: { details: { reason: "unexpected_fields" } } });
  });

  it("creates, lists, snapshots, reviews and reopens local project mappings", async () => {
    const { service, asset, mappings, assets } = await setup();
    const created = await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });
    expect(created.mapping).toMatchObject({ projectId: "short_mapping", assetId: asset.asset_id, status: "confirmed", versionPolicy: "pinned_version" });
    const snapshot = await service.snapshot("short_mapping", created.mapping.mappingId);
    expect(snapshot.mapping.snapshot).toMatchObject({ relativePath: expect.stringMatching(/^asset_snapshots\/MAP-/), sourceVersion: 1 });
    expect(snapshot.mapping.snapshot?.relativePath).not.toContain("\\");
    const listed = await service.list("short_mapping");
    expect(listed.mappings).toHaveLength(1);
    const begun = await service.beginReview("short_mapping", { scriptRevision: 1 });
    const approved = await service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint });
    expect(approved.review).toMatchObject({ status: "approved", reviewedScenes: [1, 2, 3, 4, 5, 6] });
    const reopened = await new ProjectAssetMappingsService(mappings, assets, new ShortProjectMappingOwners(mappings)).list("short_mapping");
    expect(reopened.mappings[0]?.snapshot?.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("maps a Folder Asset as follow_latest only, rejecting a pinned/snapshot policy since a Folder has no versions of its own", async () => {
    const { service, assets, project } = await setup();
    const folder = await assets.createFolder({ assetType: "style", displayName: "City moods" });
    const child = await assets.create({ buffer: png, originalname: "night.png", mimetype: "image/png" }, { assetType: "style", displayName: "Night mood" });
    await assets.setParentFolder(child.asset_id, folder.asset_id);

    const created = await service.create(project.project_id, { assetId: folder.asset_id, usageRole: "style", sceneScope: { kind: "all" } });
    expect(created.mapping).toMatchObject({ assetId: folder.asset_id, versionPolicy: "follow_latest" });

    await expect(service.create(project.project_id, { assetId: folder.asset_id, usageRole: "style", sceneScope: { kind: "all" }, versionPolicy: "pinned_version" }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
    await expect(service.update(project.project_id, created.mapping.mappingId, { versionPolicy: "pinned_version" }))
      .rejects.toMatchObject({ response: { code: "INVALID_REQUEST" } });
  });

  /**
   * Excluding and confirming again leaves the mapping switched on.
   *
   * `enabled` is read in exactly one place — the filter deciding which Assets the image model is shown
   * (image-reference-selection.ts) — and the screen draws its badge from `status`. So a mapping left
   * `confirmed` but not `enabled` reads as 연결됨 to the person and does not exist to the generator. 캡틴D
   * pressed exclude and then confirm from the review screen and paid for six Episode images whose stored
   * `reference_sources` are empty: the character was on screen as connected and no photograph of them was ever
   * sent (Cowork Round 469, who found it after their own toggle put the round trip behind one button).
   *
   * A confirmed mapping that is switched off is a state nothing in this app means. Turning it off stays
   * possible as its own explicit request, which is a different sentence.
   */
  it("switches a mapping back on when it is confirmed after being excluded", async () => {
    const { service, asset } = await setup();
    const created = await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });

    await service.update("short_mapping", created.mapping.mappingId, { decision: "exclude" });
    const restored = await service.update("short_mapping", created.mapping.mappingId, { decision: "confirm" });

    expect(restored.mapping).toMatchObject({ status: "confirmed", enabled: true });
    // And the stored record agrees — the screen reads one and generation reads the other.
    expect((await service.list("short_mapping")).mappings.find((mapping) => mapping.mappingId === created.mapping.mappingId))
      .toMatchObject({ status: "confirmed", enabled: true });
  });

  // Turning it off deliberately still works, and still says so: this is the sentence "confirmed but not
  // enabled" was pretending to be.
  it("still lets a mapping be switched off on purpose", async () => {
    const { service, asset } = await setup();
    const created = await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });

    const off = await service.update("short_mapping", created.mapping.mappingId, { enabled: false });

    expect(off.mapping).toMatchObject({ status: "confirmed", enabled: false });
  });

  it("invalidates review on mapping changes and on script fingerprint changes", async () => {
    const { service, asset, project } = await setup();
    const created = await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });
    const begun = await service.beginReview("short_mapping", { scriptRevision: 1 });
    await service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint });
    const updated = await service.update("short_mapping", created.mapping.mappingId, { decision: "exclude" });
    expect(updated.review.status).toBe("waiting");
    const startedAgain = await service.beginReview("short_mapping", { scriptRevision: 1 });
    project.scenes[5] = { number: 6, description: "changed" };
    await fs.writeFile(path.join(root!, "projects", "short_mapping", "project.json"), JSON.stringify(project), "utf8");
    await expect(service.approveReview("short_mapping", { scriptFingerprint: startedAgain.review.scriptFingerprint })).rejects.toMatchObject({ response: { code: "ASSET_MAPPING_FINGERPRINT_MISMATCH" } });
    expect((await service.review("short_mapping")).review.status).toBe("waiting");
  });

  /**
   * A review record that can no longer be read must not close the screen that rewrites it.
   *
   * It used to throw from `review()` and from `beginReview()` both — so the mapping screen would not open and
   * the button whose whole job is to discard the old baseline could not run either. One unreadable file, no way
   * out from inside the app: the same dead end as D-035, reached from the other direction.
   *
   * Safe because this record is derived. Counters, a fingerprint and a status, all of which `beginReview`
   * rewrites from the owner and the scenes. The approval assertion is the important half of this test: falling
   * back to `waiting` must not let anything through, and it does not — approval still compares the record
   * against the current script and refuses, so a lost approval is redone rather than assumed.
   */
  it("opens on a review record it cannot read, and lets the re-baseline button repair it", async () => {
    const { service, asset, project } = await setup();
    await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });
    const begun = await service.beginReview("short_mapping", {});
    await service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint });
    await fs.writeFile(path.join(root!, "projects", project.project_id, "asset_mapping_review.json"), "{ nope", "utf8");

    expect((await service.review("short_mapping")).review).toMatchObject({ status: "waiting", scriptFingerprint: "" });
    await expect(service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint }))
      .rejects.toMatchObject({ response: { code: "ASSET_MAPPING_FINGERPRINT_MISMATCH" } });

    const rebuilt = await service.beginReview("short_mapping", {});
    expect(rebuilt.review.scriptFingerprint).toBe(begun.review.scriptFingerprint);
    await expect(service.approveReview("short_mapping", { scriptFingerprint: rebuilt.review.scriptFingerprint }))
      .resolves.toMatchObject({ review: { status: "approved" } });
  });

  /**
   * The counterpart, and the line the fallback stops at.
   *
   * `asset_mappings.json` is not derived — it is the references a person chose. Reading an unreadable one as
   * "none chosen" would send the next paid image request without them and say nothing, so this one still
   * refuses. Without this assertion, an implementation that swallowed every unreadable file would pass the test
   * above.
   */
  it("still refuses to read the person's own mapping choices as an empty list", async () => {
    const { service, asset, project } = await setup();
    await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });
    await fs.writeFile(path.join(root!, "projects", project.project_id, "asset_mappings.json"), "{ nope", "utf8");

    await expect(service.list("short_mapping")).rejects.toMatchObject({ response: { code: "ASSET_MAPPING_JSON_MALFORMED" } });
  });

  it("blocks approval on a suggested mapping carried over from the Python baseline", async () => {
    // Nothing this port writes produces `suggested` — every mapping it creates is confirmed or excluded — so
    // this condition looks dead from the TypeScript side alone. It is not. `app/services/project_asset_mapping.py`
    // wrote `suggested` and `ambiguous` from its auto-matcher and `unmatched` from mark_scene_unmatched, and
    // parseStored defaults an absent status to `suggested` besides. A file from before the migration therefore
    // still arrives with one, and approving it would send the image model a reference nobody ever confirmed.
    // Written to disk rather than through the API on purpose: the API is exactly what cannot produce this.
    const { service, asset, project } = await setup();
    const now = "2026-08-30T00:00:00.000Z";
    // No `status` field at all, which is how the oldest of those files look — parseStored fills in `suggested`.
    await fs.writeFile(path.join(root!, "projects", project.project_id, "asset_mappings.json"), JSON.stringify([{
      mapping_id: "MAP-LEGACY", project_id: project.project_id, asset_id: asset.asset_id, usage_role: "style",
      scene_scope: { mode: "all" }, assignment_source: "auto", created_at: now, updated_at: now,
    }]), "utf8");

    const begun = await service.beginReview("short_mapping", { scriptRevision: 1, textOnlyConfirmed: true });
    await expect(service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint }))
      .rejects.toMatchObject({ response: { code: "ASSET_MAPPING_APPROVAL_BLOCKED", details: { mappingIds: ["MAP-LEGACY"] } } });

    // And it clears the ordinary way: confirming the suggestion.
    await service.update("short_mapping", "MAP-LEGACY", { decision: "confirm" });
    await expect(service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint }))
      .resolves.toMatchObject({ review: { status: "approved" } });
  });

  it("blocks approval when no mapping is explicitly text-only or legacy-confirmed", async () => {
    const { service } = await setup();
    const begun = await service.beginReview("short_mapping", { scriptRevision: 1 });
    await expect(service.approveReview("short_mapping", { scriptFingerprint: begun.review.scriptFingerprint })).rejects.toMatchObject({ response: { code: "ASSET_MAPPING_APPROVAL_BLOCKED" } });
    const textOnly = await service.beginReview("short_mapping", { scriptRevision: 1, textOnlyConfirmed: true });
    await expect(service.approveReview("short_mapping", { scriptFingerprint: textOnly.review.scriptFingerprint })).resolves.toMatchObject({ review: { status: "approved" } });
  });

  it("rejects snapshot sources whose legacy version path or junction escapes learning_data", async () => {
    const { service, asset } = await setup();
    const created = await service.create("short_mapping", { assetId: asset.asset_id, usageRole: "style", sceneScope: { kind: "all" } });
    const indexPath = path.join(root!, "asset_library", "assets.json"); const records = JSON.parse(await fs.readFile(indexPath, "utf8")) as Array<Record<string, unknown>>;
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "mapping-outside-"));
    try {
      const outsideFile = path.join(outside, "outside.png"); await fs.writeFile(outsideFile, png);
      records[0]!.stored_path = outsideFile; (records[0]!.versions as Array<Record<string, unknown>>)[0]!.stored_path = outsideFile;
      await fs.writeFile(indexPath, JSON.stringify(records), "utf8");
      await expect(service.snapshot("short_mapping", created.mapping.mappingId)).rejects.toMatchObject({ response: { code: "ASSET_MAPPING_SNAPSHOT_INVALID" } });
      const linked = path.join(root!, "linked-outside"); await fs.symlink(outside, linked, "junction");
      records[0]!.stored_path = path.join(linked, "outside.png"); (records[0]!.versions as Array<Record<string, unknown>>)[0]!.stored_path = path.join(linked, "outside.png");
      await fs.writeFile(indexPath, JSON.stringify(records), "utf8");
      await expect(service.snapshot("short_mapping", created.mapping.mappingId)).rejects.toMatchObject({ response: { code: "ASSET_MAPPING_SNAPSHOT_INVALID" } });
    } finally { await fs.rm(outside, { recursive: true, force: true }); }
  });
});
