import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { NestFactory } from "@nestjs/core";
import type { INestApplication } from "@nestjs/common";
import { afterEach, describe, expect, it } from "vitest";
import { AppModule } from "../app.module.js";
import { createStoredProject } from "../projects/project.mapper.js";
import { LocalProjectRepository } from "../projects/projects.repository.js";
import { WorkflowState } from "@ai-animation-studio/shared";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
let root: string | undefined; let app: INestApplication | undefined; let previous: string | undefined; let previousSettingsRoot: string | undefined;
afterEach(async () => { await app?.close(); app = undefined; if (previous === undefined) delete process.env.LEARNING_DATA_ROOT; else process.env.LEARNING_DATA_ROOT = previous; previous = undefined; if (previousSettingsRoot === undefined) delete process.env.PROVIDER_SETTINGS_ROOT; else process.env.PROVIDER_SETTINGS_ROOT = previousSettingsRoot; previousSettingsRoot = undefined; if (root) await fs.rm(root, { recursive: true, force: true }); root = undefined; });

describe.sequential("Project Asset Mapping HTTP routes", () => {
  it("creates a mapping, snapshots it, and rejects approval before a review starts", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mapping-http-"));
    const projects = new LocalProjectRepository(path.join(root, "projects"));
    const project = createStoredProject("mapping_http", "Mapping HTTP", "2026-08-22T00:00:00.000Z"); project.workflow_state = WorkflowState.WaitingForAssetMappingReview; project.script_revision = 1; project.scenes = [1, 2, 3, 4, 5, 6].map((number) => ({ number, description: String(number) })); await projects.create(project);
    previous = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root; previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false }); await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;
    const form = new FormData(); form.append("image", new Blob([png], { type: "image/png" }), "mapping.png"); form.append("metadata", JSON.stringify({ assetType: "style", displayName: "Mapping Style" }));
    const assetResponse = await fetch(`${base}/assets`, { method: "POST", body: form }); expect(assetResponse.status).toBe(201); const asset = await assetResponse.json() as { asset: { assetId: string } };
    const createdResponse = await fetch(`${base}/projects/mapping_http/assets/mappings`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ assetId: asset.asset.assetId, usageRole: "style", sceneScope: { kind: "all" } }) });
    expect(createdResponse.status).toBe(201); const created = await createdResponse.json() as { mapping: { mappingId: string } };
    const snapshot = await fetch(`${base}/projects/mapping_http/assets/mappings/${created.mapping.mappingId}/snapshot`, { method: "POST" }); expect(snapshot.status).toBe(201); expect(await snapshot.json()).toMatchObject({ mapping: { snapshot: { relativePath: expect.stringMatching(/^asset_snapshots\//) } } });
    const getReview = await fetch(`${base}/projects/mapping_http/assets/mapping-review`); expect(getReview.status).toBe(200); expect(await getReview.json()).toMatchObject({ review: { status: "waiting" } });
    const badApproval = await fetch(`${base}/projects/mapping_http/assets/mapping-review/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scriptFingerprint: "0".repeat(64) }) }); expect(badApproval.status).toBe(409); expect(await badApproval.json()).toMatchObject({ code: "ASSET_MAPPING_FINGERPRINT_MISMATCH" });
    const currentReview = await fetch(`${base}/projects/mapping_http/assets/mapping-review`); const review = await currentReview.json() as { review: { scriptFingerprint: string } };
    const approved = await fetch(`${base}/projects/mapping_http/assets/mapping-review/approve`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scriptFingerprint: review.review.scriptFingerprint }) }); expect(approved.status).toBe(201);
    expect((await projects.findById("mapping_http")).workflow_state).toBe(WorkflowState.AssetMappingApproved);
  });

  it("migrates a real legacy reference file over real HTTP without a Provider call", async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "mapping-http-"));
    const projects = new LocalProjectRepository(path.join(root, "projects"));
    await projects.create(createStoredProject("legacy_http", "Legacy HTTP", "2026-08-22T00:00:00.000Z"));
    const legacyDirectory = path.join(root, "projects", "legacy_http", "reference_assets");
    await fs.mkdir(legacyDirectory, { recursive: true });
    await fs.writeFile(path.join(legacyDirectory, "RA-000000000001.png"), png);
    await fs.writeFile(path.join(legacyDirectory, "references.json"), JSON.stringify([{
      asset_id: "RA-000000000001", project_id: "legacy_http", stored_path: "reference_assets/RA-000000000001.png",
      original_filename: "legacy.png", display_name: "Legacy HTTP Reference", source: "manual_upload", reference_type: "style",
      enabled: true, scene_scope: { mode: "all" }, episode_scope: { mode: "all" }, notes: "", character_id: null, face_baseline: false, content_sha256: "",
    }]), "utf8");
    previous = process.env.LEARNING_DATA_ROOT; process.env.LEARNING_DATA_ROOT = root; previousSettingsRoot = process.env.PROVIDER_SETTINGS_ROOT; process.env.PROVIDER_SETTINGS_ROOT = root;
    app = await NestFactory.create(AppModule, { logger: false }); await app.listen(0, "127.0.0.1");
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as { port: number }).port}`;

    const response = await fetch(`${base}/assets/legacy-migration`, { method: "POST" });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ projectsScanned: 1, migratedAssets: 1, deduplicatedAssets: 0, failedAssets: 0 });

    const listed = await fetch(`${base}/assets`);
    const assetsList = await listed.json() as { assets: Array<{ displayName: string }> };
    expect(assetsList.assets).toHaveLength(1);
    expect(assetsList.assets[0]?.displayName).toBe("Legacy HTTP Reference");

    const mappingsList = await fetch(`${base}/projects/legacy_http/assets/mappings`);
    const mappingsResponse = await mappingsList.json() as { mappings: Array<{ assignmentSource: string; status: string }> };
    expect(mappingsResponse.mappings).toMatchObject([{ assignmentSource: "migrated", status: "confirmed" }]);

    const secondResponse = await fetch(`${base}/assets/legacy-migration`, { method: "POST" });
    expect(await secondResponse.json()).toEqual({ projectsScanned: 1, migratedAssets: 0, deduplicatedAssets: 0, failedAssets: 0 });
  });
});
