import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import type {
  CreateLongStoryBibleItemRequest,
  CreateLongStoryBibleItemResponse,
  DeleteLongStoryBibleItemResponse,
  GetLongProjectStoryBibleResponse,
  UpdateLongStoryBibleWorldRequest,
  UpdateLongStoryBibleWorldResponse,
  UpdateLongStoryBibleProtagonistAssetLinkRequest, UpdateLongStoryBibleProtagonistAssetLinkResponse,
  UpdateLongStoryBibleStyleAssetLinkRequest,
  UpdateLongStoryBibleStyleAssetLinkResponse,
  SearchLongStoryBibleItemsResponse,
  DuplicateLongStoryBibleItemResponse,
  LongStoryBible,
  LongStoryBibleCollection,
  LongStoryBibleItem,
  LongStoryBibleItemInput,
  UpdateLongStoryBibleItemRequest,
  UpdateLongStoryBibleItemResponse,
} from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId, storyBibleItemExists, storyBibleItemNotFound } from "./long-project-api.error.js";

import { longStoryRoot } from "./long-project-paths.js";
const collections = ["secrets", "foreshadowing"] as const;
const idKeys = { secrets: "secret_id", foreshadowing: "foreshadowing_id" } as const;
const prefixes = { secrets: "SECRET", foreshadowing: "FORESHADOW" } as const;
/**
 * What a secret is made of, and nothing else.
 *
 * The character, location and prop collections are gone: their text never reached a prompt, and the fields only
 * they used — relationship ids, `alive`/`injured`, `truth`, `content` and the rest — could not be set from
 * anywhere in the app. Keys that are still on disk are read and dropped (see `parseStoredItem`), so a Story
 * Bible written before this still opens.
 */
const allowed: Record<LongStoryBibleCollection, readonly string[]> = {
  secrets: ["name", "status", "description", "reveal_available_episode"],
  foreshadowing: ["name", "status", "description", "reveal_available_episode"],
};
const camel: Record<string, string> = { reveal_available_episode: "revealAvailableEpisode" };
const snake: Record<string, string> = Object.fromEntries(Object.entries(camel).map(([key, value]) => [value, key]));
const safeItemId = /^[\p{L}\p{N}_-]+$/u;
const stylePolicies = ["pinned_version", "follow_latest", "snapshot"] as const;

/**
 * `retired` carries the character/location/prop arrays of an older Story Bible through a save untouched.
 *
 * Those collections are no longer read, parsed or exposed, but they are somebody's typed notes and this service
 * rewrites the whole file on every save — dropping them from the in-memory shape would quietly empty them on
 * the next edit of anything else. Kept, never validated, never returned.
 */
type StoredBible = { basic: Record<string, unknown>; world: Record<string, unknown>; secrets: Record<string, unknown>[]; foreshadowing: Record<string, unknown>[]; summaries: Record<string, unknown>; updated_at: string; retired: Record<string, unknown> };

const isCollection = (value: string): value is LongStoryBibleCollection => (collections as readonly string[]).includes(value);
function asObject(value: unknown, error = longInvalidData): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw error(); return value as Record<string, unknown>; }
function asText(value: unknown, error = longInvalidData): string { if (typeof value !== "string") throw error(); return value.trim(); }
function asStringArray(value: unknown, error = longInvalidData): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw error(); return value.map((item) => item.trim()); }
function jsonValue(value: unknown, depth = 0): unknown {
  if (depth > 12) throw longInvalidRequest("Story Bible content is too deeply nested.");
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") { if (value.length > 16000) throw longInvalidRequest("Story Bible content is too large."); return value; }
  if (typeof value === "number") { if (!Number.isFinite(value)) throw longInvalidRequest("Story Bible content is invalid."); return value; }
  if (Array.isArray(value)) { if (value.length > 200) throw longInvalidRequest("Story Bible content is too large."); return value.map((item) => jsonValue(item, depth + 1)); }
  if (!value || typeof value !== "object") throw longInvalidRequest("Story Bible content is invalid.");
  const source = value as Record<string, unknown>; const keys = Object.keys(source);
  if (keys.length > 200) throw longInvalidRequest("Story Bible content is too large.");
  return Object.fromEntries(keys.map((key) => [key, jsonValue(source[key], depth + 1)]));
}

@Injectable()
export class StoryBibleService {
  constructor(private readonly projectsRoot: string, private readonly assets = new LocalAssetsRepository(path.dirname(projectsRoot))) {}

  private files(projectId: string): { project: string; bible: string } {
    const root = longStoryRoot(this.projectsRoot, projectId);
    return { project: path.join(root, "project.json"), bible: path.join(root, "story_bible.json") };
  }

  private async read(projectId: string): Promise<StoredBible> {
    const files = this.files(projectId);
    let raw: unknown;
    try { raw = JSON.parse(await fs.readFile(files.bible, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); }
    const bible = asObject(raw);
    const known = new Set(["basic", "world", "characters", "locations", "props", "secrets", "foreshadowing", "summaries", "updated_at"]);
    if (Object.keys(bible).some((key) => !known.has(key))) throw longInvalidData();
    const basic = asObject(bible.basic);
    if (basic.style_asset_link !== undefined) this.styleAssetLink(basic.style_asset_link);
    if (basic.protagonist_asset_link !== undefined) this.protagonistLink(basic.protagonist_asset_link);
    const retired: Record<string, unknown> = {};
    for (const gone of ["characters", "locations", "props"]) if (bible[gone] !== undefined) retired[gone] = bible[gone];
    const result: StoredBible = { basic, world: asObject(bible.world), secrets: [], foreshadowing: [], summaries: asObject(bible.summaries), updated_at: asText(bible.updated_at), retired };
    for (const collection of collections) {
      if (!Array.isArray(bible[collection])) throw longInvalidData();
      result[collection] = bible[collection].map((item) => this.parseStoredItem(collection, item));
    }
    return result;
  }

  private protagonistLink(value: unknown, error = longInvalidData): Record<string, unknown> {
    const link = asObject(value, error);
    if (Object.keys(link).length !== 3 || !["asset_id", "version_policy", "pinned_version"].every((key) => key in link)) throw error();
    if (link.version_policy !== "pinned_version" && link.version_policy !== "follow_latest") throw error();
    if (link.version_policy === "pinned_version" && (!Number.isInteger(link.pinned_version) || Number(link.pinned_version) < 1)) throw error();
    if (link.version_policy === "follow_latest" && link.pinned_version !== null) throw error();
    return { asset_id: asText(link.asset_id, error), version_policy: link.version_policy, pinned_version: link.pinned_version };
  }

  private styleAssetLink(value: unknown, error = longInvalidData): Record<string, unknown> {
    const link = asObject(value, error);
    if (Object.keys(link).length !== 3 || !["asset_id", "version_policy", "pinned_version"].every((key) => key in link)
      || !stylePolicies.includes(link.version_policy as typeof stylePolicies[number]) || !Number.isInteger(link.pinned_version) || Number(link.pinned_version) < 1) throw error();
    return { asset_id: asText(link.asset_id, error), version_policy: link.version_policy, pinned_version: link.pinned_version };
  }

  private parseStoredItem(collection: LongStoryBibleCollection, value: unknown): Record<string, unknown> {
    const item = asObject(value);
    const idKey = idKeys[collection];
    // Everything the collections used to accept is still on disk in older projects, and refusing an unknown key
    // here would make those Story Bibles impossible to open. They are read and dropped — the same lenient-read /
    // strict-write split `platform` uses in long-projects.service.ts. New writes carry only `allowed` above.
    const legacy = ["asset_link", "alive", "injured", "reference_id", "last_appearance", "emotional_state",
      "location_id", "owner_id", "owned_item_ids", "character_ids", "location_ids", "episode_ids", "event_ids",
      "planned_reveal_episode", "actual_reveal_episode", "truth", "content"];
    const known = new Set([idKey, ...allowed[collection], ...legacy]);
    if (Object.keys(item).some((key) => !known.has(key))) throw longInvalidData();
    const id = asText(item[idKey]);
    if (!safeItemId.test(id)) throw longInvalidData();
    const result: Record<string, unknown> = { [idKey]: id };
    for (const key of allowed[collection]) {
      const valueAtKey = item[key];
      if (valueAtKey === undefined) continue;
      if (key === "alive" || key === "injured") { if (typeof valueAtKey !== "boolean") throw longInvalidData(); result[key] = valueAtKey; }
      else if (key.endsWith("_ids")) result[key] = asStringArray(valueAtKey);
      else if (key.endsWith("_episode")) { if (!Number.isInteger(valueAtKey) || (valueAtKey as number) < 1) throw longInvalidData(); result[key] = valueAtKey; }
      else result[key] = asText(valueAtKey);
    }
    return result;
  }

  private inputItem(collection: LongStoryBibleCollection, value: unknown, includeId: boolean): Record<string, unknown> {
    const input = asObject(value, longInvalidRequest);
    const known = new Set(["id", ...allowed[collection].map((key) => camel[key] ?? key)]);
    if (Object.keys(input).some((key) => !known.has(key))) throw longInvalidRequest("Unknown Story Bible item field.");
    const result: Record<string, unknown> = {};
    if (input.id !== undefined) { const id = asText(input.id, longInvalidRequest); if (!safeItemId.test(id)) throw longInvalidRequest("Story Bible item ID is unsafe."); result[idKeys[collection]] = id; }
    else if (includeId) throw longInvalidRequest("Story Bible item ID is required.");
    for (const key of allowed[collection]) {
      const apiKey = camel[key] ?? key;
      const entry = input[apiKey];
      if (entry === undefined) continue;
      if (key === "alive" || key === "injured") { if (typeof entry !== "boolean") throw longInvalidRequest(); result[key] = entry; }
      else if (key.endsWith("_ids")) result[key] = asStringArray(entry, longInvalidRequest);
      else if (key.endsWith("_episode")) { if (!Number.isInteger(entry) || (entry as number) < 1) throw longInvalidRequest(); result[key] = entry; }
      else result[key] = asText(entry, longInvalidRequest);
    }
    return result;
  }

  private toApiItem(collection: LongStoryBibleCollection, stored: Record<string, unknown>): LongStoryBibleItem {
    const result: Record<string, unknown> = { id: stored[idKeys[collection]] };
    for (const key of allowed[collection]) if (stored[key] !== undefined) {
      result[camel[key] ?? key] = stored[key];
    }
    return result as unknown as LongStoryBibleItem;
  }

  private toApi(bible: StoredBible): LongStoryBible {
    const { style_asset_link: storedStyle, protagonist_asset_link: storedProtagonist, ...basic } = bible.basic;
    const style = storedStyle === undefined ? undefined : this.styleAssetLink(storedStyle);
    const protagonist = storedProtagonist === undefined ? undefined : this.protagonistLink(storedProtagonist);
    return { basic, world: bible.world, ...(style ? { styleAssetLink: { assetId: style.asset_id as string, versionPolicy: style.version_policy as "pinned_version" | "follow_latest" | "snapshot", pinnedVersion: style.pinned_version as number } } : {}), ...(protagonist ? { protagonistAssetLink: { assetId: protagonist.asset_id as string, versionPolicy: protagonist.version_policy as "pinned_version" | "follow_latest", pinnedVersion: protagonist.pinned_version as number | null } } : {}), secrets: bible.secrets.map((item) => this.toApiItem("secrets", item)), foreshadowing: bible.foreshadowing.map((item) => this.toApiItem("foreshadowing", item)), updatedAt: bible.updated_at };
  }

  private async save(projectId: string, bible: StoredBible): Promise<void> {
    bible.updated_at = new Date().toISOString();
    const { retired, ...rest } = bible;
    try { await atomicWriteUtf8File(this.files(projectId).bible, JSON.stringify({ ...rest, ...retired }, null, 2)); } catch { throw longStorageError(); }
  }

  async get(projectId: string): Promise<GetLongProjectStoryBibleResponse> { return { storyBible: this.toApi(await this.read(projectId.trim())) }; }

  /**
   * Writes the world notes and nothing else.
   *
   * It used to replace `basic` too, which is where the protagonist and style links live. A caller that only
   * wanted to save world notes had to read `basic` back and hand it in unchanged, and any caller that forgot
   * cleared the project's lead. Now the request has no way to say `basic`, so no caller can get that wrong.
   */
  async updateWorld(projectId: string, request: UpdateLongStoryBibleWorldRequest): Promise<UpdateLongStoryBibleWorldResponse> {
    if (!request || typeof request !== "object" || Object.keys(request).length !== 1 || !("world" in request)) throw longInvalidRequest("Story Bible world request is invalid.");
    const world = asObject(request.world, longInvalidRequest);
    const id = projectId.trim(); const bible = await this.read(id);
    bible.world = jsonValue(world) as Record<string, unknown>;
    await this.save(id, bible); return { storyBible: this.toApi(bible) };
  }

  async updateStyleAssetLink(projectId: string, request: UpdateLongStoryBibleStyleAssetLinkRequest): Promise<UpdateLongStoryBibleStyleAssetLinkResponse> {
    if (!request || typeof request !== "object" || Object.keys(request).length !== 1 || !("assetLink" in request)) throw longInvalidRequest("Story Bible style Asset link request is invalid.");
    const id = projectId.trim(); const bible = await this.read(id);
    if (request.assetLink === null) delete bible.basic.style_asset_link;
    else {
      const api = asObject(request.assetLink, longInvalidRequest);
      if (Object.keys(api).length !== 3 || !["assetId", "versionPolicy", "pinnedVersion"].every((key) => key in api)) throw longInvalidRequest("Story Bible style Asset link is invalid.");
      const link = this.styleAssetLink({ asset_id: api.assetId, version_policy: api.versionPolicy, pinned_version: api.pinnedVersion }, longInvalidRequest);
      let asset; try { asset = await this.assets.get(link.asset_id as string); } catch { throw longInvalidRequest("Story Bible style Asset link is unavailable."); }
      if (asset.asset_type !== "style" || asset.is_folder || !asset.enabled || !asset.approved) throw longInvalidRequest("Story Bible style Asset link is unavailable.");
      if (!asset.versions.some((version) => version.version === link.pinned_version)) throw longInvalidRequest("Story Bible style Asset link version is unavailable.");
      bible.basic.style_asset_link = link;
    }
    await this.save(id, bible); return { storyBible: this.toApi(bible) };
  }

  /**
   * The protagonist is a Folder, and that is the one place this rule is inverted.
   *
   * A Story Bible item's link refused Folders; this one requires them. A character is a set of angles of one
   * person, so a single drawing is a pose, not the lead — and the per-child descriptions are what an image
   * prompt has any use for. Episode Asset mapping already resolves Folders, so nothing downstream is new here.
   */
  async updateProtagonistAssetLink(projectId: string, request: UpdateLongStoryBibleProtagonistAssetLinkRequest): Promise<UpdateLongStoryBibleProtagonistAssetLinkResponse> {
    if (!request || typeof request !== "object" || Object.keys(request).length !== 1 || !("assetLink" in request)) throw longInvalidRequest("Story Bible protagonist Asset link request is invalid.");
    const id = projectId.trim(); const bible = await this.read(id);
    if (request.assetLink === null) delete bible.basic.protagonist_asset_link;
    else {
      const api = asObject(request.assetLink, longInvalidRequest);
      if (Object.keys(api).length !== 3 || !["assetId", "versionPolicy", "pinnedVersion"].every((key) => key in api)) throw longInvalidRequest("Story Bible protagonist Asset link is invalid.");
      const link = this.protagonistLink({ asset_id: api.assetId, version_policy: api.versionPolicy, pinned_version: api.pinnedVersion }, longInvalidRequest);
      let asset; try { asset = await this.assets.get(link.asset_id as string); } catch { throw longInvalidRequest("Story Bible protagonist Asset link is unavailable."); }
      if (asset.asset_type !== "character" || !asset.is_folder || !asset.enabled) throw longInvalidRequest("Story Bible protagonist Asset link is unavailable.");
      if (link.version_policy === "pinned_version" && !asset.versions.some((version) => version.version === link.pinned_version)) throw longInvalidRequest("Story Bible protagonist Asset link version is unavailable.");
      bible.basic.protagonist_asset_link = link;
    }
    await this.save(id, bible); return { storyBible: this.toApi(bible) };
  }

  /** Mirrors BibleCollectionManager.search: a blank normalized query returns every item in storage order. */
  async search(projectId: string, collectionName: string, query: unknown): Promise<SearchLongStoryBibleItemsResponse> {
    if (!isCollection(collectionName) || typeof query !== "string") throw longInvalidRequest();
    const bible = await this.read(projectId.trim());
    const normalized = query.trim().toLowerCase();
    return {
      items: bible[collectionName]
        .filter((item) => {
          const name = String(item.name ?? "").toLowerCase();
          const description = String(item.description ?? "").toLowerCase();
          return name.includes(normalized) || description.includes(normalized);
        })
        .map((item) => this.toApiItem(collectionName, item)),
    };
  }

  async duplicate(projectId: string, collectionName: string, itemId: string): Promise<DuplicateLongStoryBibleItemResponse> {
    if (!isCollection(collectionName) || !safeItemId.test(itemId)) throw longInvalidRequest();
    const id = projectId.trim();
    const bible = await this.read(id);
    const idKey = idKeys[collectionName];
    const source = bible[collectionName].find((item) => item[idKey] === itemId);
    if (!source) throw storyBibleItemNotFound();
    const clone = structuredClone(source);
    let cloneId: string;
    do {
      cloneId = `${prefixes[collectionName]}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    } while (bible[collectionName].some((item) => item[idKey] === cloneId));
    clone[idKey] = cloneId;
    clone.name = `${String(clone.name ?? "항목")} 복사본`;
    bible[collectionName].push(clone);
    await this.save(id, bible);
    return { item: this.toApiItem(collectionName, clone), storyBible: this.toApi(bible) };
  }

  /** Reports legacy dangling links without changing or rejecting the Story Bible. */
  async create(projectId: string, collectionName: string, request: CreateLongStoryBibleItemRequest): Promise<CreateLongStoryBibleItemResponse> {
    if (!isCollection(collectionName)) throw longInvalidRequest("Unknown Story Bible collection.");
    const id = projectId.trim(); const bible = await this.read(id); const item = this.inputItem(collectionName, request?.item, false); const idKey = idKeys[collectionName];
    if (item[idKey] === undefined) item[idKey] = `${prefixes[collectionName]}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    if (bible[collectionName].some((existing) => existing[idKey] === item[idKey])) throw storyBibleItemExists();
    bible[collectionName].push(item); await this.save(id, bible); return { item: this.toApiItem(collectionName, item), storyBible: this.toApi(bible) };
  }

  async update(projectId: string, collectionName: string, itemId: string, request: UpdateLongStoryBibleItemRequest): Promise<UpdateLongStoryBibleItemResponse> {
    if (!isCollection(collectionName) || !safeItemId.test(itemId)) throw longInvalidRequest();
    const id = projectId.trim(); const bible = await this.read(id); const idKey = idKeys[collectionName]; const current = bible[collectionName].find((item) => item[idKey] === itemId);
    if (!current) throw storyBibleItemNotFound(); const changes = this.inputItem(collectionName, request?.item, false);
    if (changes[idKey] !== undefined && changes[idKey] !== itemId) throw longInvalidRequest("Story Bible item ID cannot be changed.");
    delete changes[idKey]; Object.assign(current, changes);
    await this.save(id, bible); return { item: this.toApiItem(collectionName, current), storyBible: this.toApi(bible) };
  }

  async delete(projectId: string, collectionName: string, itemId: string): Promise<DeleteLongStoryBibleItemResponse> {
    if (!isCollection(collectionName) || !safeItemId.test(itemId)) throw longInvalidRequest();
    const bible = await this.read(projectId.trim()); const idKey = idKeys[collectionName]; const index = bible[collectionName].findIndex((item) => item[idKey] === itemId);
    if (index < 0) throw storyBibleItemNotFound(); bible[collectionName].splice(index, 1); await this.save(projectId.trim(), bible); return { storyBible: this.toApi(bible) };
  }
}
