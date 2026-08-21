import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type { CreateAssetMetadata, UpdateAssetMetadataRequest } from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { assetInUse, assetMutationUnsupported, assetNotFound, assetStorageError, invalidAssetData, malformedAssetIndex } from "./asset-api.error.js";
import { assertSafeAssetId } from "./asset-id.js";
import { parseAssetIndex, type StoredAsset } from "./asset-storage.js";
import { validateImage } from "./image-validation.js";

const PREFIX = { character: "CHAR", style: "STYLE", background: "BG", object: "OBJ", general_reference: "GENERAL" } as const;
const CHARACTER_ROLES = ["back", "expression", "front", "left45", "other", "right45", "side", "thumbnail"];
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);
const errorCode = (error: unknown) => typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
const terms = (values: string[] | undefined) => [...new Set((values ?? []).flatMap((value) => value.replaceAll(",", " ").split(/\s+/u)).map((value) => value.trim().toLocaleLowerCase()).filter(Boolean))].sort();

export class LocalAssetsRepository {
  private static readonly indexLocks = new Map<string, Promise<void>>();
  private readonly libraryRoot: string;
  private readonly indexPath: string;
  private readonly projectsRoot: string;
  private readonly lockPath: string;
  private readonly canonicalLockKey: string;

  constructor(private readonly learningDataRoot: string) {
    this.libraryRoot = path.resolve(learningDataRoot, "asset_library");
    this.indexPath = path.join(this.libraryRoot, "assets.json");
    this.projectsRoot = path.resolve(learningDataRoot, "projects");
    this.lockPath = path.join(this.libraryRoot, ".assets-json.lock");
    let canonicalLearningRoot: string;
    try { canonicalLearningRoot = fs.realpathSync.native(path.resolve(learningDataRoot)); } catch { canonicalLearningRoot = path.resolve(learningDataRoot); }
    const resolvedIndex = path.normalize(path.join(canonicalLearningRoot, "asset_library", "assets.json"));
    this.canonicalLockKey = process.platform === "win32" ? resolvedIndex.toLocaleLowerCase() : resolvedIndex;
  }

  async list(): Promise<StoredAsset[]> { return this.load(); }
  async get(assetId: string): Promise<StoredAsset> {
    assertSafeAssetId(assetId);
    const found = (await this.load()).find((asset) => asset.asset_id === assetId);
    if (!found) throw assetNotFound();
    return found;
  }

  async create(file: { buffer: Buffer; originalname: string; mimetype?: string }, metadata: CreateAssetMetadata): Promise<StoredAsset> {
    return this.serialized(async () => {
      const validated = validateImage(file.buffer, file.originalname, file.mimetype);
      const assets = await this.load();
      const duplicate = assets.find((asset) => !asset.is_folder && asset.content_sha256 === validated.digest);
      if (duplicate) {
        duplicate.status = "manual";
        duplicate.approved = (metadata.approved ?? false) || duplicate.approved;
        duplicate.source_project_id = "_asset_library_manual";
        duplicate.updated_at = new Date().toISOString();
        await this.save(assets);
        return duplicate;
      }
      const now = new Date().toISOString();
      const assetId = `ASSET-${PREFIX[metadata.assetType]}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
      const manualRoot = path.join(this.projectsRoot, "_asset_library_manual", "images");
      const destination = path.join(manualRoot, `${validated.digest.slice(0, 16)}${validated.extension}`);
      await fsPromises.mkdir(manualRoot, { recursive: true }).catch(() => { throw assetStorageError(); });
      const createdOwnedFile = !fs.existsSync(destination);
      if (createdOwnedFile) await this.atomicWriteBytes(destination, file.buffer);
      const referenceImages = metadata.assetType === "character" ? [
        { role: "thumbnail", path: destination, content_sha256: validated.digest, original_filename: validated.originalFilename },
        { role: "front", path: destination, content_sha256: validated.digest, original_filename: validated.originalFilename },
      ] : [];
      const asset: StoredAsset = {
        asset_id: assetId, asset_type: metadata.assetType, display_name: metadata.displayName.trim(), description: metadata.description?.trim() ?? "",
        stored_path: destination, original_filename: validated.originalFilename, content_sha256: validated.digest,
        tags: terms(metadata.tags), aliases: terms(metadata.aliases), enabled: true, approved: metadata.approved ?? false,
        face_baseline: metadata.faceBaseline ?? false, character_key: metadata.characterKey?.trim() || null, version: 1,
        versions: [{ version: 1, stored_path: destination, content_sha256: validated.digest, created_at: now, notes: "" }],
        created_at: now, updated_at: now, notes: metadata.notes?.trim() ?? "", legacy_asset_ids: [], status: "manual",
        source_project_id: "_asset_library_manual", source_scene_number: null, reference_images: referenceImages,
        reference_roles: metadata.assetType === "character" ? CHARACTER_ROLES : [], is_folder: false, parent_folder_id: "",
        child_asset_ids: [], thumbnail_asset_id: "", role: "", sort_order: 0,
      };
      assets.push(asset);
      try { await this.save(assets); } catch (error) {
        if (createdOwnedFile) await fsPromises.unlink(destination).catch(() => undefined);
        throw error;
      }
      return asset;
    });
  }

  async update(assetId: string, changes: UpdateAssetMetadataRequest): Promise<StoredAsset> {
    assertSafeAssetId(assetId);
    return this.serialized(async () => {
      const assets = await this.load();
      const asset = assets.find((item) => item.asset_id === assetId);
      if (!asset) throw assetNotFound();
      if (asset.is_folder || asset.parent_folder_id) throw assetMutationUnsupported();
      if (changes.assetType !== undefined && changes.assetType !== "character" && asset.reference_images.length > 0) throw assetMutationUnsupported();
      if (changes.assetType === "character" && asset.asset_type !== "character") {
        asset.reference_images = ["thumbnail", "front"].map((role) => ({ role, path: asset.stored_path, content_sha256: asset.content_sha256, original_filename: asset.original_filename }));
        asset.reference_roles = CHARACTER_ROLES;
      }
      if (changes.assetType !== undefined) asset.asset_type = changes.assetType;
      if (changes.displayName !== undefined) asset.display_name = changes.displayName.trim();
      if (changes.description !== undefined) asset.description = changes.description.trim();
      if (changes.tags !== undefined) asset.tags = terms(changes.tags);
      if (changes.aliases !== undefined) asset.aliases = terms(changes.aliases);
      if (changes.approved !== undefined) asset.approved = changes.approved;
      if (changes.faceBaseline !== undefined) asset.face_baseline = changes.faceBaseline;
      if (changes.characterKey !== undefined) asset.character_key = changes.characterKey?.trim() || null;
      if (changes.notes !== undefined) asset.notes = changes.notes.trim();
      if (changes.role !== undefined) asset.role = changes.role.trim();
      if (asset.face_baseline && asset.asset_type !== "character") throw assetMutationUnsupported();
      asset.updated_at = new Date().toISOString();
      await this.save(assets);
      return asset;
    });
  }

  async remove(assetId: string): Promise<void> {
    assertSafeAssetId(assetId);
    return this.serialized(async () => {
      const assets = await this.load();
      const index = assets.findIndex((asset) => asset.asset_id === assetId);
      if (index < 0) throw assetNotFound();
      if (assets[index]!.is_folder || assets[index]!.parent_folder_id) throw assetMutationUnsupported();
      if ((await this.usageProjects(assetId)).length) throw assetInUse();
      assets.splice(index, 1);
      await this.save(assets);
    });
  }

  async usageProjects(assetId: string): Promise<string[]> {
    const used: string[] = [];
    let entries: fs.Dirent[];
    try { entries = await fsPromises.readdir(this.projectsRoot, { withFileTypes: true }); } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw assetStorageError();
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "_asset_library_manual") continue;
      try {
        const raw: unknown = JSON.parse(await fsPromises.readFile(path.join(this.projectsRoot, entry.name, "asset_mappings.json"), "utf8"));
        if (Array.isArray(raw) && raw.some((item) => typeof item === "object" && item !== null &&
          ((item as { asset_id?: unknown }).asset_id === assetId || (Array.isArray((item as { selected_child_asset_ids?: unknown }).selected_child_asset_ids) && (item as { selected_child_asset_ids: unknown[] }).selected_child_asset_ids.includes(assetId))))) used.push(entry.name);
      } catch { /* Python compatibility: damaged/missing mapping files do not break Library reads. */ }
    }
    return used.sort();
  }

  resolveContentPath(asset: StoredAsset): string | null {
    if (asset.is_folder || !asset.stored_path) return null;
    const candidate = path.isAbsolute(asset.stored_path) ? path.resolve(asset.stored_path) : path.resolve(this.libraryRoot, asset.stored_path);
    try {
      const safeRoot = fs.realpathSync(path.resolve(this.learningDataRoot));
      const realCandidate = fs.realpathSync(candidate);
      const relative = path.relative(safeRoot, realCandidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
      return fs.statSync(realCandidate).isFile() ? realCandidate : null;
    } catch { return null; }
  }

  /** Resolve a version recorded in the trusted Asset Library index for a local snapshot. */
  resolveVersionContentPath(asset: StoredAsset, version: number): string | null {
    const record = asset.versions.find((item) => item.version === version);
    if (!record) return null;
    const candidate = path.isAbsolute(record.stored_path) ? path.resolve(record.stored_path) : path.resolve(this.libraryRoot, record.stored_path);
    try {
      const safeRoot = fs.realpathSync(path.resolve(this.learningDataRoot));
      const realCandidate = fs.realpathSync.native(candidate);
      const relative = path.relative(safeRoot, realCandidate);
      if (relative.startsWith("..") || path.isAbsolute(relative)) return null;
      return fs.statSync(realCandidate).isFile() ? realCandidate : null;
    } catch { return null; }
  }

  async canDeleteOwnedFile(asset: StoredAsset): Promise<boolean> {
    if (asset.source_project_id !== "_asset_library_manual" || asset.is_folder) return false;
    const contentPath = this.resolveContentPath(asset);
    if (!contentPath) return false;
    try {
      const manualRoot = fs.realpathSync(path.join(this.projectsRoot, "_asset_library_manual", "images"));
      if (path.dirname(contentPath) !== manualRoot) return false;
      const assets = await this.load();
      return !assets.some((other) => other.asset_id !== asset.asset_id && (
        this.resolveContentPath(other) === contentPath
        || (other.stored_path && other.stored_path === asset.stored_path)
      ));
    } catch { return false; }
  }

  private async load(): Promise<StoredAsset[]> {
    let text: string;
    try { text = await fsPromises.readFile(this.indexPath, "utf8"); } catch (error) {
      if (errorCode(error) === "ENOENT") return [];
      throw assetStorageError();
    }
    let value: unknown;
    try { value = JSON.parse(text); } catch { throw malformedAssetIndex(); }
    try { return parseAssetIndex(value); } catch { throw invalidAssetData(); }
  }
  private async save(assets: StoredAsset[]): Promise<void> {
    try {
      await fsPromises.mkdir(this.libraryRoot, { recursive: true });
      await atomicWriteUtf8File(this.indexPath, JSON.stringify(assets, null, 2));
    } catch (error) { if (error instanceof Error && "getStatus" in error) throw error; throw assetStorageError(); }
  }
  private async atomicWriteBytes(finalPath: string, bytes: Buffer): Promise<void> {
    const temporary = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${crypto.randomUUID()}.tmp`);
    let renamed = false;
    try {
      await fsPromises.writeFile(temporary, bytes);
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try { await fsPromises.rename(temporary, finalPath); renamed = true; return; } catch (error) {
          if (!RETRYABLE.has(errorCode(error)) || attempt === 3) throw error;
          await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
        }
      }
    } catch { throw assetStorageError(); } finally { if (!renamed) await fsPromises.unlink(temporary).catch(() => undefined); }
  }
  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = LocalAssetsRepository.indexLocks.get(this.canonicalLockKey) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => { release = resolve; });
    LocalAssetsRepository.indexLocks.set(this.canonicalLockKey, current);
    await previous;
    let token = "";
    try {
      await fsPromises.mkdir(this.libraryRoot, { recursive: true });
      token = await this.acquireProcessLock();
      return await operation();
    } finally {
      if (token) await this.releaseProcessLock(token);
      release();
      if (LocalAssetsRepository.indexLocks.get(this.canonicalLockKey) === current) LocalAssetsRepository.indexLocks.delete(this.canonicalLockKey);
    }
  }
  private async acquireProcessLock(): Promise<string> {
    const token = `${process.pid}:${crypto.randomUUID()}`;
    const deadline = Date.now() + 12_000;
    while (true) {
      try {
        const handle = await fsPromises.open(this.lockPath, "wx");
        try {
          await handle.writeFile(token, "ascii");
        } catch {
          await handle.close().catch(() => undefined);
          await this.cleanupOwnedLock(token, true);
          throw assetStorageError();
        }
        await handle.close();
        return token;
      } catch (error) {
        if (errorCode(error) !== "EEXIST") throw assetStorageError();
        try {
          const [stat, owner] = await Promise.all([fsPromises.stat(this.lockPath), fsPromises.readFile(this.lockPath, "ascii")]);
          if (Date.now() - stat.mtimeMs > 60_000 && owner === await fsPromises.readFile(this.lockPath, "ascii")) {
            await fsPromises.unlink(this.lockPath);
            continue;
          }
        } catch (staleError) { if (errorCode(staleError) === "ENOENT") continue; }
        if (Date.now() >= deadline) throw assetStorageError();
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
  }
  private async releaseProcessLock(token: string): Promise<void> {
    await this.cleanupOwnedLock(token, false);
  }
  private async cleanupOwnedLock(token: string, allowPartialToken: boolean): Promise<void> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const owner = await fsPromises.readFile(this.lockPath, "ascii");
        if (owner !== token && !(allowPartialToken && token.startsWith(owner))) return;
        await fsPromises.unlink(this.lockPath);
        return;
      } catch (error) {
        const code = errorCode(error);
        if (code === "ENOENT") return;
        if (!RETRYABLE.has(code) || attempt === 3) return;
        await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
      }
    }
  }
}
