import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import type { AssetFileAuditEntry, CharacterFolderReferenceSetRequest, CreateAssetFolderRequest, CreateAssetMetadata, UpdateAssetMetadataRequest } from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { assetInUse, assetMutationUnsupported, assetNotFound, assetStorageError, assetVersionDuplicate, badAssetRequest, invalidAssetData, malformedAssetIndex } from "./asset-api.error.js";
import { assertSafeAssetId } from "./asset-id.js";
import { parseAssetIndex, type StoredAsset } from "./asset-storage.js";
import { validateImage } from "./image-validation.js";

const PREFIX = { character: "CHAR", style: "STYLE", background: "BG", object: "OBJ", general_reference: "GENERAL" } as const;
const CHARACTER_ROLES = ["back", "expression", "front", "left45", "other", "right45", "side", "thumbnail"];
const RETRYABLE = new Set(["EPERM", "EBUSY", "EACCES"]);
const errorCode = (error: unknown) => typeof error === "object" && error !== null && "code" in error ? String((error as { code?: unknown }).code) : "";
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const terms = (values: string[] | undefined) => [...new Set((values ?? []).flatMap((value) => value.replaceAll(",", " ").split(/\s+/u)).map((value) => value.trim().toLocaleLowerCase()).filter(Boolean))].sort();
const GENERATED_IMAGE_NOTE = "Automatically indexed project image";
const GENERATED_FOLDER_NOTE = "Automatically grouped generated project images";

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
      // A folder itself may only have its display name, description, and tags edited here — the description in
      // particular feeds every child image's generation prompt, so it is not a cosmetic field. Fields that only
      // make sense for a standalone asset (type, versions, character-reference wiring, ...) stay blocked.
      if (asset.is_folder) {
        const allowedFolderKeys = new Set(["displayName", "description", "tags"]);
        if (Object.keys(changes).some((key) => !allowedFolderKeys.has(key))) throw assetMutationUnsupported();
      }
      // A folder child (Character Reference Set member) may only have its per-child role and description edited
      // here — every other field belongs to the standalone-asset flow and stays blocked, same as before.
      if (asset.parent_folder_id) {
        const allowedChildKeys = new Set(["role", "description"]);
        if (Object.keys(changes).some((key) => !allowedChildKeys.has(key))) throw assetMutationUnsupported();
      }
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

  /** Creates an empty Folder of the given type — no image, no file. Children are linked into it afterward via `setParentFolder`. */
  async createFolder(metadata: CreateAssetFolderRequest): Promise<StoredAsset> {
    const displayName = metadata.displayName.trim();
    if (!displayName) throw badAssetRequest("displayName is required.");
    return this.serialized(async () => {
      const assets = await this.load();
      const now = new Date().toISOString();
      const folder: StoredAsset = {
        asset_id: `FOLDER-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
        asset_type: metadata.assetType, display_name: displayName, description: metadata.description?.trim() ?? "",
        stored_path: "", original_filename: "", content_sha256: "", tags: [], aliases: [], enabled: true,
        approved: false, face_baseline: false, character_key: null, version: 1, versions: [],
        created_at: now, updated_at: now, notes: metadata.notes?.trim() ?? "", legacy_asset_ids: [], status: "manual",
        source_project_id: "_asset_library_manual", source_scene_number: null, reference_images: [], reference_roles: [],
        is_folder: true, parent_folder_id: "", child_asset_ids: [], thumbnail_asset_id: "", role: "", sort_order: 0,
      };
      assets.push(folder);
      await this.save(assets);
      return folder;
    });
  }

  /**
   * Converts a child Asset to match its (new) parent Folder's type. For a character Folder this also mirrors
   * Python's `update_folder`: children get the local reference-role set and lose any face-baseline flag. For any
   * other Folder type, only `asset_type` is changed — the character-specific reference-image/role scaffolding
   * does not apply.
   */
  private convertToFolderChild(item: StoredAsset, folder: StoredAsset): void {
    item.asset_type = folder.asset_type;
    if (folder.asset_type !== "character") return;
    item.face_baseline = false;
    item.reference_roles = [...CHARACTER_ROLES];
    if (item.reference_images.length === 0 && item.stored_path) {
      item.reference_images = ["thumbnail", "front"].map((role) => ({
        role, path: item.stored_path, content_sha256: item.content_sha256, original_filename: item.original_filename,
      }));
    }
    if (!CHARACTER_ROLES.includes(item.role)) item.role = "other";
  }

  /**
   * Links (`parentFolderId` set) or unlinks (`parentFolderId: null`) one existing, non-folder Asset as a Folder
   * child — the add/remove counterpart to `updateCharacterFolderReferenceSet`, which only reorders a folder's
   * already-linked children. Linking converts the Asset to match its new folder's type (see
   * `convertToFolderChild`). Re-linking into a different folder first detaches it from its previous one.
   */
  async setParentFolder(assetId: string, parentFolderId: string | null): Promise<{ asset: StoredAsset; folder: StoredAsset | null }> {
    assertSafeAssetId(assetId);
    if (parentFolderId !== null) assertSafeAssetId(parentFolderId);
    return this.serialized(async () => {
      const assets = await this.load();
      const asset = assets.find((item) => item.asset_id === assetId);
      if (!asset) throw assetNotFound();
      if (asset.is_folder) throw assetMutationUnsupported();
      const now = new Date().toISOString();
      const previousFolder = asset.parent_folder_id ? assets.find((item) => item.asset_id === asset.parent_folder_id) : undefined;

      const detachFromPrevious = () => {
        if (!previousFolder) return;
        previousFolder.child_asset_ids = previousFolder.child_asset_ids.filter((id) => id !== assetId);
        if (previousFolder.thumbnail_asset_id === assetId) previousFolder.thumbnail_asset_id = previousFolder.child_asset_ids[0] ?? "";
        previousFolder.updated_at = now;
      };

      if (parentFolderId === null) {
        detachFromPrevious();
        asset.parent_folder_id = ""; asset.sort_order = 0; asset.updated_at = now;
        await this.save(assets);
        return { asset, folder: previousFolder ?? null };
      }

      if (parentFolderId === assetId) throw badAssetRequest("An Asset cannot be its own Folder parent.");
      const folder = assets.find((item) => item.asset_id === parentFolderId);
      if (!folder) throw assetNotFound();
      if (!folder.is_folder) throw assetMutationUnsupported();

      if (previousFolder && previousFolder.asset_id !== folder.asset_id) detachFromPrevious();
      asset.parent_folder_id = folder.asset_id;
      asset.sort_order = folder.child_asset_ids.length;
      this.convertToFolderChild(asset, folder);
      asset.updated_at = now;

      if (!folder.child_asset_ids.includes(assetId)) folder.child_asset_ids = [...folder.child_asset_ids, assetId];
      if (!folder.thumbnail_asset_id) folder.thumbnail_asset_id = assetId;
      folder.updated_at = now;

      await this.save(assets);
      return { asset, folder };
    });
  }

  /**
   * Reorder an existing Character Folder's reference children and select its
   * representative image.  This deliberately does not add or remove links:
   * Python keeps those lifecycle operations separate from reference-set edits.
   */
  async updateCharacterFolderReferenceSet(folderId: string, request: CharacterFolderReferenceSetRequest): Promise<{ folder: StoredAsset; children: StoredAsset[] }> {
    assertSafeAssetId(folderId);
    return this.serialized(async () => {
      const assets = await this.load();
      const folder = assets.find((item) => item.asset_id === folderId);
      if (!folder) throw assetNotFound();
      if (!folder.is_folder) throw assetMutationUnsupported();
      const requestedIds = request.childAssetIds;
      if (new Set(requestedIds).size !== requestedIds.length
        || requestedIds.length !== folder.child_asset_ids.length
        || requestedIds.some((assetId) => !folder.child_asset_ids.includes(assetId))
        || !requestedIds.includes(request.thumbnailAssetId)) {
        throw badAssetRequest("Folder reference children must be an exact unique ordering of its current children.");
      }
      const children = requestedIds.map((assetId) => assets.find((item) => item.asset_id === assetId));
      if (children.some((child) => !child || child.is_folder)) throw badAssetRequest("Folder reference children are invalid.");
      const now = new Date().toISOString();
      for (const [sortOrder, child] of children.entries()) {
        const item = child!;
        if (item.parent_folder_id !== folder.asset_id) throw badAssetRequest("Folder reference children are invalid.");
        item.parent_folder_id = folder.asset_id;
        item.sort_order = sortOrder;
        this.convertToFolderChild(item, folder);
        item.updated_at = now;
      }
      folder.child_asset_ids = [...requestedIds];
      folder.thumbnail_asset_id = request.thumbnailAssetId;
      folder.updated_at = now;
      await this.save(assets);
      return { folder, children: children as StoredAsset[] };
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

  /**
   * Remove a Folder's own metadata and, when requested, its children's index entries and owned files, matching
   * Python's `delete_folder`. `deleteManualFiles` implies `removeChildIndexes`. Never deletes a project-owned image.
   */
  async removeFolder(folderId: string, options: { removeChildIndexes?: boolean; deleteManualFiles?: boolean } = {}): Promise<{ removedChildAssetIds: string[]; deletedFiles: number }> {
    assertSafeAssetId(folderId);
    const removeChildIndexes = Boolean(options.removeChildIndexes) || Boolean(options.deleteManualFiles);
    const deleteManualFiles = Boolean(options.deleteManualFiles);
    return this.serialized(async () => {
      if ((await this.usageProjects(folderId)).length) throw assetInUse();
      const assets = await this.load();
      const folder = assets.find((item) => item.asset_id === folderId);
      if (!folder) throw assetNotFound();
      if (!folder.is_folder) throw assetMutationUnsupported();
      const childIds = new Set([...folder.child_asset_ids, ...assets.filter((item) => item.parent_folder_id === folderId).map((item) => item.asset_id)]);
      if (removeChildIndexes) {
        for (const childId of childIds) {
          if ((await this.usageProjects(childId)).length) throw assetInUse();
        }
      }
      let manualRoot = "";
      const filesToDelete = new Set<string>();
      if (deleteManualFiles) {
        try { manualRoot = fs.realpathSync(path.join(this.projectsRoot, "_asset_library_manual", "images")); } catch { throw assetStorageError(); }
        for (const child of assets) {
          if (!childIds.has(child.asset_id)) continue;
          if (child.source_project_id !== "_asset_library_manual") throw assetMutationUnsupported();
          const resolved = this.resolveContentPath(child);
          if (!resolved || path.dirname(resolved) !== manualRoot) throw assetMutationUnsupported();
          filesToDelete.add(resolved);
        }
      }
      const retained: StoredAsset[] = [];
      for (const asset of assets) {
        if (asset.asset_id === folderId) continue;
        if (removeChildIndexes && childIds.has(asset.asset_id)) continue;
        if (childIds.has(asset.asset_id)) { asset.parent_folder_id = ""; asset.sort_order = 0; }
        retained.push(asset);
      }
      await this.save(retained);
      let deletedFiles = 0;
      if (deleteManualFiles) {
        const retainedPaths = new Set(retained.filter((item) => !item.is_folder && item.stored_path).map((item) => this.resolveContentPath(item)).filter((value): value is string => value !== null));
        for (const file of filesToDelete) {
          if (retainedPaths.has(file)) continue;
          await fsPromises.unlink(file).catch(() => undefined);
          deletedFiles += 1;
        }
      }
      return { removedChildAssetIds: removeChildIndexes ? [...childIds] : [], deletedFiles };
    });
  }

  /** Point a new immutable metadata revision at freshly uploaded bytes, matching Python's add_version. */
  async addVersion(assetId: string, file: { buffer: Buffer; originalname: string; mimetype?: string }, notes: string): Promise<StoredAsset> {
    assertSafeAssetId(assetId);
    return this.serialized(async () => {
      const validated = validateImage(file.buffer, file.originalname, file.mimetype);
      const assets = await this.load();
      const asset = assets.find((item) => item.asset_id === assetId);
      if (!asset) throw assetNotFound();
      if (asset.is_folder) throw assetMutationUnsupported();
      if (asset.versions.some((version) => version.content_sha256 === validated.digest)) throw assetVersionDuplicate();
      const { destination, createdOwnedFile } = await this.storeManualBytes(validated.digest, validated.extension, file.buffer);
      const now = new Date().toISOString();
      const number = Math.max(...asset.versions.map((version) => version.version)) + 1;
      asset.versions.push({ version: number, stored_path: destination, content_sha256: validated.digest, created_at: now, notes: notes.trim() });
      asset.version = number; asset.stored_path = destination; asset.content_sha256 = validated.digest; asset.updated_at = now;
      try { await this.save(assets); } catch (error) {
        if (createdOwnedFile) await fsPromises.unlink(destination).catch(() => undefined);
        throw error;
      }
      await this.invalidateDependents(assetId, "follow_latest");
      return asset;
    });
  }

  /** Safely repoint an Asset's current version at replacement bytes while preserving its stable identity, matching Python's relink_file. */
  async relink(assetId: string, file: { buffer: Buffer; originalname: string; mimetype?: string }): Promise<StoredAsset> {
    assertSafeAssetId(assetId);
    return this.serialized(async () => {
      const validated = validateImage(file.buffer, file.originalname, file.mimetype);
      const assets = await this.load();
      const asset = assets.find((item) => item.asset_id === assetId);
      if (!asset) throw assetNotFound();
      if (asset.is_folder) throw assetMutationUnsupported();
      const version = asset.versions.find((item) => item.version === asset.version);
      if (!version) throw assetStorageError();
      const { destination, createdOwnedFile } = await this.storeManualBytes(validated.digest, validated.extension, file.buffer);
      version.stored_path = destination; version.content_sha256 = validated.digest;
      asset.stored_path = destination; asset.content_sha256 = validated.digest;
      asset.status = asset.source_project_id === "_asset_library_manual" ? "manual" : "generated";
      asset.updated_at = new Date().toISOString();
      try { await this.save(assets); } catch (error) {
        if (createdOwnedFile) await fsPromises.unlink(destination).catch(() => undefined);
        throw error;
      }
      await this.invalidateDependents(assetId);
      return asset;
    });
  }

  /** Classify every indexed non-folder file without changing Library metadata, matching Python's audit_files. */
  async auditFiles(): Promise<AssetFileAuditEntry[]> {
    const results: AssetFileAuditEntry[] = [];
    for (const asset of await this.load()) {
      if (asset.is_folder) continue;
      const sourceKind = asset.source_project_id === "_asset_library_manual" ? "manual" : "project";
      const resolved = this.resolveContentPath(asset);
      if (!resolved) {
        results.push({ assetId: asset.asset_id, displayName: asset.display_name, classification: "missing", sourceKind, message: "파일이 존재하지 않습니다" });
        continue;
      }
      try {
        validateImage(await fsPromises.readFile(resolved), path.basename(resolved));
        results.push({ assetId: asset.asset_id, displayName: asset.display_name, classification: "healthy", sourceKind, message: "" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "이미지 파일을 확인할 수 없습니다";
        results.push({ assetId: asset.asset_id, displayName: asset.display_name, classification: "damaged", sourceKind, message });
      }
    }
    return results;
  }

  /** Delete an unused manual Asset and its owned file, never a project-owned image, matching Python's delete_manual_file. */
  async removeOwnedFile(assetId: string): Promise<void> {
    assertSafeAssetId(assetId);
    return this.serialized(async () => {
      if ((await this.usageProjects(assetId)).length) throw assetInUse();
      const assets = await this.load();
      const index = assets.findIndex((item) => item.asset_id === assetId);
      if (index < 0) throw assetNotFound();
      const asset = assets[index]!;
      if (asset.is_folder || asset.parent_folder_id || asset.source_project_id !== "_asset_library_manual") throw assetMutationUnsupported();
      const resolved = this.resolveContentPath(asset);
      if (!resolved) throw assetStorageError();
      let manualRoot: string;
      try { manualRoot = fs.realpathSync(path.join(this.projectsRoot, "_asset_library_manual", "images")); } catch { throw assetStorageError(); }
      if (path.dirname(resolved) !== manualRoot) throw assetMutationUnsupported();
      assets.splice(index, 1);
      const shared = assets.some((item) => !item.is_folder && this.resolveContentPath(item) === resolved);
      await this.save(assets);
      if (!shared) await fsPromises.unlink(resolved).catch(() => undefined);
    });
  }

  /**
   * Import a legacy project Reference image without copying it twice on repeated runs, matching Python's
   * `AssetLibrary.import_file` as used by `LegacyReferenceMigrator`. Never throws on a single bad reference —
   * callers decide whether to count a failure.
   */
  async importLegacyReference(sourcePath: string, options: {
    assetType: StoredAsset["asset_type"]; displayName: string; description?: string; approved?: boolean;
    faceBaseline?: boolean; characterKey?: string | null; notes?: string; legacyAssetId: string;
  }): Promise<StoredAsset> {
    return this.serialized(async () => {
      const bytes = await fsPromises.readFile(sourcePath).catch(() => { throw assetStorageError(); });
      const validated = validateImage(bytes, path.basename(sourcePath));
      const assets = await this.load();
      const duplicate = assets.find((asset) => !asset.is_folder && asset.content_sha256 === validated.digest);
      if (duplicate) {
        duplicate.status = "manual";
        duplicate.approved = (options.approved ?? false) || duplicate.approved;
        duplicate.source_project_id = duplicate.source_project_id || "_asset_library_manual";
        duplicate.updated_at = new Date().toISOString();
        if (!duplicate.legacy_asset_ids.includes(options.legacyAssetId)) duplicate.legacy_asset_ids.push(options.legacyAssetId);
        await this.save(assets);
        return duplicate;
      }
      const { destination, createdOwnedFile } = await this.storeManualBytes(validated.digest, validated.extension, bytes);
      const now = new Date().toISOString();
      const assetId = `ASSET-${PREFIX[options.assetType]}-${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
      const referenceImages = options.assetType === "character" ? ["thumbnail", "front"].map((role) => ({
        role, path: destination, content_sha256: validated.digest, original_filename: validated.originalFilename,
      })) : [];
      const asset: StoredAsset = {
        asset_id: assetId, asset_type: options.assetType, display_name: options.displayName.trim(), description: (options.description ?? "").trim(),
        stored_path: destination, original_filename: validated.originalFilename, content_sha256: validated.digest,
        tags: [], aliases: [], enabled: true, approved: options.approved ?? false, face_baseline: options.faceBaseline ?? false,
        character_key: options.characterKey ?? null, version: 1,
        versions: [{ version: 1, stored_path: destination, content_sha256: validated.digest, created_at: now, notes: "" }],
        created_at: now, updated_at: now, notes: (options.notes ?? "").trim(), legacy_asset_ids: [options.legacyAssetId], status: "manual",
        source_project_id: "_asset_library_manual", source_scene_number: null, reference_images: referenceImages,
        reference_roles: options.assetType === "character" ? CHARACTER_ROLES : [], is_folder: false, parent_folder_id: "",
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

  private async storeManualBytes(digest: string, extension: string, bytes: Buffer): Promise<{ destination: string; createdOwnedFile: boolean }> {
    const manualRoot = path.join(this.projectsRoot, "_asset_library_manual", "images");
    const destination = path.join(manualRoot, `${digest.slice(0, 16)}${extension}`);
    await fsPromises.mkdir(manualRoot, { recursive: true }).catch(() => { throw assetStorageError(); });
    const createdOwnedFile = !fs.existsSync(destination);
    if (createdOwnedFile) await this.atomicWriteBytes(destination, bytes);
    return { destination, createdOwnedFile };
  }

  /** Invalidate persisted project/Episode mapping approvals after a Library Asset's content changes, matching Python's _invalidate_dependents. */
  private async invalidateDependents(assetId: string, versionPolicyFilter?: "follow_latest"): Promise<void> {
    let entries: fs.Dirent[];
    try { entries = await fsPromises.readdir(this.projectsRoot, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "_asset_library_manual") continue;
      const projectDir = path.join(this.projectsRoot, entry.name);
      await this.invalidateMappingReview(projectDir, assetId, versionPolicyFilter, "workflow_state", "WAITING_FOR_ASSET_MAPPING_REVIEW", "ASSET_MAPPING_APPROVED");
      let episodeEntries: fs.Dirent[];
      try { episodeEntries = await fsPromises.readdir(path.join(projectDir, "long_story"), { withFileTypes: true }); } catch { continue; }
      for (const episodeEntry of episodeEntries) {
        if (!episodeEntry.isDirectory() || !/^Episode\d+$/.test(episodeEntry.name)) continue;
        await this.invalidateMappingReview(path.join(projectDir, "long_story", episodeEntry.name), assetId, versionPolicyFilter, "state", "waiting_for_asset_mapping_review", "asset_mapping_approved");

      }
    }
  }

  private referencesAsset(item: unknown, assetId: string, versionPolicyFilter?: "follow_latest"): boolean {
    if (!isObject(item)) return false;
    const matches = item.asset_id === assetId
      || (Array.isArray(item.selected_child_asset_ids) && item.selected_child_asset_ids.includes(assetId));
    return matches && (!versionPolicyFilter || item.version_policy === versionPolicyFilter);
  }

  /**
   * Reopens one owner's approved mapping review because an Asset it points at has changed underneath it.
   *
   * One function for both owners, because they now keep their mappings the same way: `asset_mappings.json`
   * beside `asset_mapping_review.json`. They did not always — an Episode used to carry its mappings inline in
   * the review as `candidates`, and when that was torn down this cascade kept reading the old shape for
   * Episodes only. It found no `candidates` and returned, so **an Episode's approved review was never reopened
   * when an Asset gained a version**, while the short project's was. Its test passed throughout: the test
   * wrote `candidates` by hand, so it was proving the old file shape rather than the one the app produces.
   *
   * Silent at every step on purpose. A version was already added successfully by the time this runs; a project
   * whose files cannot be read must not turn that into a failure, and the review it could not reopen is a
   * staleness this app has other ways to show.
   */
  private async invalidateMappingReview(directory: string, assetId: string, versionPolicyFilter: "follow_latest" | undefined, stateKey: "workflow_state" | "state", waitingValue: string, approvedValue: string): Promise<void> {
    let mappings: unknown;
    try { mappings = JSON.parse(await fsPromises.readFile(path.join(directory, "asset_mappings.json"), "utf8")); } catch { return; }
    if (!Array.isArray(mappings) || !mappings.some((item) => this.referencesAsset(item, assetId, versionPolicyFilter))) return;
    let review: unknown;
    try { review = JSON.parse(await fsPromises.readFile(path.join(directory, "asset_mapping_review.json"), "utf8")); } catch { return; }
    if (!isObject(review)) return;
    const nextRevision = (typeof review.mapping_revision === "number" ? review.mapping_revision : 0) + 1;
    const next = { ...review, status: "waiting", approved_at: "", approved_by: "", mapping_revision: nextRevision };
    try { await atomicWriteUtf8File(path.join(directory, "asset_mapping_review.json"), JSON.stringify(next, null, 2)); } catch { return; }
    await this.invalidateOwnerState(path.join(directory, "project.json"), stateKey, waitingValue, approvedValue);
  }

  private async invalidateOwnerState(statePath: string, key: "workflow_state" | "state", waitingValue: string, approvedValue: string): Promise<void> {
    let raw: unknown;
    try { raw = JSON.parse(await fsPromises.readFile(statePath, "utf8")); } catch { return; }
    if (!isObject(raw) || raw[key] !== approvedValue) return;
    try { await atomicWriteUtf8File(statePath, JSON.stringify({ ...raw, [key]: waitingValue }, null, 2)); } catch { /* best-effort, matches Python's silent skip */ }
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

  /** Resolve only the selected representative of a Folder, never an arbitrary child. */
  async resolveFolderRepresentativeContentPath(folder: StoredAsset): Promise<string | null> {
    if (!folder.is_folder || !folder.thumbnail_asset_id) return null;
    const child = (await this.load()).find((asset) => asset.asset_id === folder.thumbnail_asset_id);
    if (!child || child.is_folder || child.parent_folder_id !== folder.asset_id) return null;
    return this.resolveContentPath(child);
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

  /**
   * Index the project's generated scene images (one per entry in `descriptions`, not a fixed six — see
   * docs/02_MIGRATION_PLAN.md's scene-count generalization) without copying them. This is an internal migration
   * hook; public Asset mutations intentionally remain unchanged. Reopening or resuming a project updates the
   * same records.
   */
  async indexGeneratedProjectImages(projectId: string, topic: string, descriptions: string[]): Promise<void> {
    await this.serialized(async () => {
      const assets = await this.load();
      const now = new Date().toISOString();
      const childIds: string[] = [];
      const scenes = Array.from({ length: descriptions.length }, (_, index) => index + 1);
      for (const scene of scenes) {
        const storedPath = path.join(this.projectsRoot, projectId, "images", `scene${scene}.png`);
        const bytes = await fsPromises.readFile(storedPath).catch(() => { throw assetStorageError(); });
        let validated: ReturnType<typeof validateImage>;
        try { validated = validateImage(bytes, `scene${scene}.png`, "image/png"); } catch { throw assetStorageError(); }
        let asset = assets.find((item) => !item.is_folder && item.source_project_id === projectId
          && item.source_scene_number === scene && item.notes === GENERATED_IMAGE_NOTE);
        if (!asset) {
          asset = {
            asset_id: `ASSET-GENERAL-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
            asset_type: "general_reference", display_name: `${projectId} Scene ${scene}`,
            description: descriptions[scene - 1]?.trim() || topic.trim(), stored_path: storedPath,
            original_filename: `scene${scene}.png`, content_sha256: validated.digest,
            tags: terms(["generated image", "short project", projectId, `scene ${scene}`]), aliases: [], enabled: true,
            approved: false, face_baseline: false, character_key: null, version: 1,
            versions: [{ version: 1, stored_path: storedPath, content_sha256: validated.digest, created_at: now, notes: "" }],
            created_at: now, updated_at: now, notes: GENERATED_IMAGE_NOTE, legacy_asset_ids: [], status: "generated",
            source_project_id: projectId, source_scene_number: scene, reference_images: [], reference_roles: [],
            is_folder: false, parent_folder_id: "", child_asset_ids: [], thumbnail_asset_id: "", role: "", sort_order: scene - 1,
          };
          assets.push(asset);
        } else {
          // Generation resume must never create another Asset for a scene. A
          // regenerated image goes through replaceGeneratedProjectSceneImage.
          asset.display_name = `${projectId} Scene ${scene}`;
          asset.description = descriptions[scene - 1]?.trim() || topic.trim();
          asset.updated_at = now;
        }
        childIds.push(asset.asset_id);
      }
      let folder = assets.find((item) => item.is_folder && item.source_project_id === projectId && item.notes === GENERATED_FOLDER_NOTE);
      if (!folder) {
        folder = {
          asset_id: `FOLDER-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
          asset_type: "general_reference", display_name: `${projectId} generated images`, description: topic.trim(),
          stored_path: "", original_filename: "", content_sha256: "", tags: terms(["generated image", "short project", projectId]),
          aliases: [], enabled: true, approved: false, face_baseline: false, character_key: null, version: 1, versions: [],
          created_at: now, updated_at: now, notes: GENERATED_FOLDER_NOTE, legacy_asset_ids: [], status: "generated",
          source_project_id: projectId, source_scene_number: null, reference_images: [], reference_roles: [], is_folder: true,
          parent_folder_id: "", child_asset_ids: childIds, thumbnail_asset_id: childIds[0]!, role: "", sort_order: 0,
        };
        assets.push(folder);
      } else {
        folder.child_asset_ids = childIds;
        folder.thumbnail_asset_id = childIds[0]!;
        folder.display_name = `${projectId} generated images`;
        folder.description = topic.trim();
        folder.approved = false;
        folder.updated_at = now;
      }
      for (const [index, assetId] of childIds.entries()) {
        const child = assets.find((item) => item.asset_id === assetId)!;
        child.parent_folder_id = folder.asset_id;
        child.sort_order = index;
      }
      await this.save(assets);
    });
  }

  async approveGeneratedProjectImage(projectId: string, scene: number, allApproved: boolean): Promise<void> {
    await this.serialized(async () => {
      const assets = await this.load();
      const child = assets.find((item) => !item.is_folder && item.source_project_id === projectId
        && item.source_scene_number === scene && item.notes === GENERATED_IMAGE_NOTE);
      const folder = assets.find((item) => item.is_folder && item.source_project_id === projectId && item.notes === GENERATED_FOLDER_NOTE);
      if (!child || !folder) throw assetStorageError();
      child.status = "approved"; child.approved = true; child.updated_at = new Date().toISOString();
      folder.approved = allApproved; folder.updated_at = child.updated_at;
      await this.save(assets);
    });
  }

  async replaceGeneratedProjectSceneImage(projectId: string, scene: number, currentPath: string, archivedPath: string): Promise<void> {
    await this.serialized(async () => {
      const assets = await this.load();
      const child = assets.find((item) => !item.is_folder && item.source_project_id === projectId
        && item.source_scene_number === scene && item.notes === GENERATED_IMAGE_NOTE);
      if (!child) throw assetStorageError();
      const [currentBytes, archivedBytes] = await Promise.all([
        fsPromises.readFile(currentPath), fsPromises.readFile(archivedPath),
      ]).catch(() => { throw assetStorageError(); });
      let current: ReturnType<typeof validateImage>; let archived: ReturnType<typeof validateImage>;
      try {
        current = validateImage(currentBytes, `scene${scene}.png`, "image/png");
        archived = validateImage(archivedBytes, path.basename(archivedPath), "image/png");
      } catch { throw assetStorageError(); }
      const active = child.versions.find((version) => version.version === child.version);
      if (!active) throw assetStorageError();
      active.stored_path = archivedPath;
      active.content_sha256 = archived.digest;
      const next = Math.max(...child.versions.map((version) => version.version)) + 1;
      child.versions.push({ version: next, stored_path: currentPath, content_sha256: current.digest, created_at: new Date().toISOString(), notes: "Regenerated scene image" });
      child.version = next; child.stored_path = currentPath; child.original_filename = path.basename(currentPath);
      child.content_sha256 = current.digest; child.status = "generated"; child.approved = false; child.updated_at = new Date().toISOString();
      const folder = assets.find((item) => item.is_folder && item.source_project_id === projectId && item.notes === GENERATED_FOLDER_NOTE);
      if (folder) { folder.approved = false; folder.updated_at = child.updated_at; }
      await this.save(assets);
    });
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
          // A minute untouched means the holder died. That reading only holds because everything serialized()
          // wraps is local index and file work that finishes in well under a minute — nothing here waits on a
          // provider. videos/project-lock.ts had the same constant over calls that do, where it silently became
          // a cap on how long the work may take and handed the lock away mid-call (D-029); it needed a heartbeat
          // to keep meaning what this one still means. Wrapping anything slow in serialized() breaks that.
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
