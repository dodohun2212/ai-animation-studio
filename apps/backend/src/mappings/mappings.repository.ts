import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type { SceneNumber } from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { parseStoredProject, type StoredProject } from "../projects/project-storage.schema.js";
import { isSafeProjectId, resolveSafeProjectDirectory } from "../projects/project-id.js";
import { malformedMappings, malformedReview, mappingNotFound, mappingProjectNotFound, mappingStorageError, invalidMappings, invalidReview, snapshotInvalid } from "./mapping-api.error.js";
import type { MappingLocation } from "./mapping-owner.js";
import { parseMappings, parseReview, parseStoredReview, type StoredAssetMapping, type StoredMappingReview } from "./mapping-storage.js";

const errorCode = (error: unknown) => typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
// Python hashes a stable key-sorted JSON representation. Recursively sort it before stringifying.
const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value as Record<string, unknown>).sort().map((key) => [key, stable((value as Record<string, unknown>)[key])])) : value;
export const scriptFingerprint = (scenes: unknown[]): string => crypto.createHash("sha256").update(JSON.stringify(stable(scenes)), "utf8").digest("hex");

export class LocalProjectAssetMappingsRepository {
  constructor(private readonly projectsRoot: string) {}

  /**
   * A short project's own directory, as a location this repository can be pointed at.
   *
   * Built here rather than by callers so the validating resolver stays on the inside: a caller holding a
   * directory string could hand in one that was never checked, and there would be nothing to notice. An
   * Episode's location is built the same way by the module that owns that layout.
   */
  projectLocation(projectId: string): MappingLocation {
    const directory = resolveSafeProjectDirectory(this.projectsRoot, projectId);
    return { id: projectId, directory, ensureExists: async () => { await this.project(projectId); } };
  }

  private mappingsPath(location: MappingLocation): string { return path.join(location.directory, "asset_mappings.json"); }
  private reviewPath(location: MappingLocation): string { return path.join(location.directory, "asset_mapping_review.json"); }
  private snapshotDir(location: MappingLocation): string { return path.join(location.directory, "asset_snapshots"); }
  async project(projectId: string): Promise<StoredProject> {
    if (!isSafeProjectId(projectId)) return Promise.reject(mappingProjectNotFound());
    let raw: string;
    try { raw = await fsPromises.readFile(path.join(resolveSafeProjectDirectory(this.projectsRoot, projectId), "project.json"), "utf8"); } catch (error) { if (errorCode(error) === "ENOENT") throw mappingProjectNotFound(); throw mappingStorageError(); }
    try { return parseStoredProject(JSON.parse(raw)); } catch (error) { if (error instanceof Error && "getStatus" in error) throw error; throw mappingStorageError(); }
  }
  async load(location: MappingLocation): Promise<StoredAssetMapping[]> {
    await location.ensureExists();
    let raw: string;
    try { raw = await fsPromises.readFile(this.mappingsPath(location), "utf8"); } catch (error) { if (errorCode(error) === "ENOENT") return []; throw mappingStorageError(); }
    try { const data = parseMappings(JSON.parse(raw)); if (data.some((item) => item.project_id !== location.id)) throw new Error("project"); return data; } catch (error) { if (error instanceof SyntaxError) throw malformedMappings(); throw invalidMappings(); }
  }
  async save(location: MappingLocation, mappings: StoredAssetMapping[]): Promise<StoredMappingReview> {
    try { parseMappings(mappings); await atomicWriteUtf8File(this.mappingsPath(location), JSON.stringify(mappings, null, 2)); } catch (error) { if (error instanceof Error && "getStatus" in error) throw error; throw mappingStorageError(); }
    return this.invalidateReview(location);
  }
  async loadReview(location: MappingLocation): Promise<StoredMappingReview> {
    await location.ensureExists();
    let raw: string;
    try { raw = await fsPromises.readFile(this.reviewPath(location), "utf8"); } catch (error) { if (errorCode(error) === "ENOENT") return { project_id: location.id, mapping_revision: 0, script_revision: 0, script_fingerprint: "", status: "waiting", approved_at: "", approved_by: "", text_only_confirmed: false, legacy_confirmed: false, reviewed_scenes: [] }; throw mappingStorageError(); }
    try { const review = parseStoredReview(JSON.parse(raw), location.id); if (review.project_id !== location.id) throw new Error("project"); return review; } catch (error) { if (error instanceof SyntaxError) throw malformedReview(); throw invalidReview(); }
  }
  async saveReview(location: MappingLocation, review: StoredMappingReview): Promise<void> {
    if (review.project_id !== location.id) throw invalidReview();
    try { parseReview(review); await atomicWriteUtf8File(this.reviewPath(location), JSON.stringify(review, null, 2)); } catch (error) { if (error instanceof Error && "getStatus" in error) throw error; throw mappingStorageError(); }
  }
  async invalidateReview(location: MappingLocation): Promise<StoredMappingReview> {
    const previous = await this.loadReview(location);
    const review = { ...previous, mapping_revision: previous.mapping_revision + 1, status: "waiting" as const, approved_at: "", approved_by: "", reviewed_scenes: [] };
    await this.saveReview(location, review); return review;
  }
  async mapping(location: MappingLocation, mappingId: string): Promise<StoredAssetMapping> {
    const mapping = (await this.load(location)).find((item) => item.mapping_id === mappingId);
    if (!mapping) throw mappingNotFound(); return mapping;
  }
  async snapshot(location: MappingLocation, mapping: StoredAssetMapping, source: string, version: number): Promise<StoredAssetMapping> {
    const projectDir = location.directory; let stat: fs.Stats;
    try { stat = await fsPromises.stat(source); } catch { throw snapshotInvalid(); }
    if (!stat.isFile()) throw snapshotInvalid();
    const extension = path.extname(source).toLowerCase();
    if (!new Set([".png", ".jpg", ".jpeg", ".webp"]).has(extension)) throw snapshotInvalid();
    const snapshots = this.snapshotDir(location); const fileName = `${mapping.mapping_id}-v${version}${extension}`; const finalPath = path.join(snapshots, fileName);
    try { await fsPromises.mkdir(snapshots, { recursive: true }); const bytes = await fsPromises.readFile(source); await this.atomicBytes(finalPath, bytes); } catch (error) { if (error instanceof Error && "getStatus" in error) throw error; throw mappingStorageError(); }
    const relativePath = path.relative(projectDir, finalPath).replaceAll(path.sep, "/");
    if (!relativePath.startsWith("asset_snapshots/") || relativePath.includes("..")) throw snapshotInvalid();
    mapping.version_policy = "snapshot"; mapping.pinned_version = version; mapping.snapshot_path = relativePath; mapping.snapshot_sha256 = crypto.createHash("sha256").update(await fsPromises.readFile(finalPath)).digest("hex"); mapping.snapshot_source_version = version; mapping.updated_at = new Date().toISOString();
    return mapping;
  }
  private async atomicBytes(finalPath: string, bytes: Buffer): Promise<void> {
    const temp = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${crypto.randomUUID()}.tmp`); let renamed = false;
    try {
      await fsPromises.writeFile(temp, bytes);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try { await fsPromises.rename(temp, finalPath); renamed = true; return; } catch (error) {
          if (!new Set(["EPERM", "EBUSY", "EACCES"]).has(errorCode(error)) || attempt === 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
        }
      }
    } finally { if (!renamed) await fsPromises.unlink(temp).catch(() => undefined); }
  }
}
