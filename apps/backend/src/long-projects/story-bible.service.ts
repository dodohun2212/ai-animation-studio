import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import type {
  CreateLongStoryBibleItemRequest,
  CreateLongStoryBibleItemResponse,
  DeleteLongStoryBibleItemResponse,
  GetLongProjectStoryBibleResponse,
  UpdateLongStoryBibleContentRequest,
  UpdateLongStoryBibleContentResponse,
  UpdateLongStoryBibleStyleAssetLinkRequest,
  UpdateLongStoryBibleStyleAssetLinkResponse,
  GetLongStoryBibleRelationshipAuditResponse,
  SearchLongStoryBibleItemsResponse,
  DuplicateLongStoryBibleItemResponse,
  LongStoryBible,
  LongStoryBibleCollection,
  LongStoryBibleItem,
  LongStoryBibleRelationshipIssue,
  LongStoryBibleItemInput,
  UpdateLongStoryBibleItemRequest,
  UpdateLongStoryBibleItemResponse,
} from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isSafeProjectId, resolveSafeProjectDirectory } from "../projects/project-id.js";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId, storyBibleItemExists, storyBibleItemNotFound } from "./long-project-api.error.js";

const collections = ["characters", "locations", "props", "secrets", "foreshadowing"] as const;
const idKeys = { characters: "character_id", locations: "location_id", props: "prop_id", secrets: "secret_id", foreshadowing: "foreshadowing_id" } as const;
const prefixes = { characters: "CHAR", locations: "LOC", props: "PROP", secrets: "SECRET", foreshadowing: "FORESHADOW" } as const;
const common = ["name", "status", "description"] as const;
const allowed: Record<LongStoryBibleCollection, readonly string[]> = {
  characters: [...common, "alive", "injured", "reference_id", "last_appearance", "emotional_state", "location_id", "owned_item_ids", "asset_link"],
  locations: [...common, "character_ids", "episode_ids", "reference_id", "asset_link"],
  props: [...common, "owner_id", "location_id", "episode_ids", "reference_id", "asset_link"],
  secrets: [...common, "planned_reveal_episode", "actual_reveal_episode", "character_ids", "location_ids", "event_ids", "truth", "reveal_available_episode", "content"],
  foreshadowing: [...common, "planned_reveal_episode", "actual_reveal_episode", "character_ids", "location_ids", "event_ids", "truth", "reveal_available_episode", "content"],
};
const camel: Record<string, string> = { reference_id: "referenceId", last_appearance: "lastAppearance", emotional_state: "emotionalState", location_id: "locationId", owner_id: "ownerId", owned_item_ids: "ownedItemIds", character_ids: "characterIds", location_ids: "locationIds", episode_ids: "episodeIds", event_ids: "eventIds", planned_reveal_episode: "plannedRevealEpisode", actual_reveal_episode: "actualRevealEpisode", reveal_available_episode: "revealAvailableEpisode", asset_link: "assetLink" };
const snake: Record<string, string> = Object.fromEntries(Object.entries(camel).map(([key, value]) => [value, key]));
const safeItemId = /^[\p{L}\p{N}_-]+$/u;
const stylePolicies = ["pinned_version", "follow_latest", "snapshot"] as const;

type StoredBible = { basic: Record<string, unknown>; world: Record<string, unknown>; characters: Record<string, unknown>[]; locations: Record<string, unknown>[]; props: Record<string, unknown>[]; secrets: Record<string, unknown>[]; foreshadowing: Record<string, unknown>[]; summaries: Record<string, unknown>; updated_at: string };

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
    if (!isSafeProjectId(projectId)) throw longUnsafeId();
    const root = path.join(resolveSafeProjectDirectory(this.projectsRoot, projectId), "long_story");
    return { project: path.join(root, "project.json"), bible: path.join(root, "story_bible.json") };
  }

  private async read(projectId: string): Promise<StoredBible> {
    const files = this.files(projectId);
    const episodeCount = await this.episodeCount(files.project);
    let raw: unknown;
    try { raw = JSON.parse(await fs.readFile(files.bible, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); }
    const bible = asObject(raw);
    const known = new Set(["basic", "world", "characters", "locations", "props", "secrets", "foreshadowing", "summaries", "updated_at"]);
    if (Object.keys(bible).some((key) => !known.has(key))) throw longInvalidData();
    const basic = asObject(bible.basic); if (basic.style_asset_link !== undefined) this.styleAssetLink(basic.style_asset_link);
    const result: StoredBible = { basic, world: asObject(bible.world), characters: [], locations: [], props: [], secrets: [], foreshadowing: [], summaries: asObject(bible.summaries), updated_at: asText(bible.updated_at) };
    for (const collection of collections) {
      if (!Array.isArray(bible[collection])) throw longInvalidData();
      result[collection] = bible[collection].map((item) => this.parseStoredItem(collection, item, episodeCount));
    }
    return result;
  }

  private async episodeCount(project: string): Promise<number> {
    let stored: unknown;
    try { stored = JSON.parse(await fs.readFile(project, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); }
    const value = asObject(stored).episode_count;
    if (!Number.isInteger(value) || (value as number) < 1) throw longInvalidData();
    return value as number;
  }

  private assetLink(value: unknown, episodeCount: number, error = longInvalidData): Record<string, unknown> {
    const link = asObject(value, error);
    if (Object.keys(link).length !== 4 || !["asset_id", "version_policy", "pinned_version", "episode_scope"].every((key) => key in link)) throw error();
    const assetId = asText(link.asset_id, error);
    if (link.version_policy !== "pinned_version" && link.version_policy !== "follow_latest") throw error();
    const pinnedVersion = link.pinned_version;
    if (link.version_policy === "pinned_version" && (!Number.isInteger(pinnedVersion) || (pinnedVersion as number) < 1)) throw error();
    if (link.version_policy === "follow_latest" && pinnedVersion !== null) throw error();
    const scope = asObject(link.episode_scope, error);
    if (scope.mode === "all" && Object.keys(scope).length === 1) return { asset_id: assetId, version_policy: link.version_policy, pinned_version: pinnedVersion, episode_scope: { mode: "all" } };
    if (scope.mode === "episode" && Object.keys(scope).length === 2 && Number.isInteger(scope.episode) && (scope.episode as number) >= 1 && (scope.episode as number) <= episodeCount) return { asset_id: assetId, version_policy: link.version_policy, pinned_version: pinnedVersion, episode_scope: { mode: "episode", episode: scope.episode } };
    throw error();
  }

  private styleAssetLink(value: unknown, error = longInvalidData): Record<string, unknown> {
    const link = asObject(value, error);
    if (Object.keys(link).length !== 3 || !["asset_id", "version_policy", "pinned_version"].every((key) => key in link)
      || !stylePolicies.includes(link.version_policy as typeof stylePolicies[number]) || !Number.isInteger(link.pinned_version) || Number(link.pinned_version) < 1) throw error();
    return { asset_id: asText(link.asset_id, error), version_policy: link.version_policy, pinned_version: link.pinned_version };
  }

  private parseStoredItem(collection: LongStoryBibleCollection, value: unknown, episodeCount: number): Record<string, unknown> {
    const item = asObject(value);
    const idKey = idKeys[collection];
    const known = new Set([idKey, ...allowed[collection]]);
    if (Object.keys(item).some((key) => !known.has(key))) throw longInvalidData();
    const id = asText(item[idKey]);
    if (!safeItemId.test(id)) throw longInvalidData();
    const result: Record<string, unknown> = { [idKey]: id };
    for (const key of allowed[collection]) {
      const valueAtKey = item[key];
      if (valueAtKey === undefined) continue;
      if (key === "asset_link") result[key] = this.assetLink(valueAtKey, episodeCount);
      else if (key === "alive" || key === "injured") { if (typeof valueAtKey !== "boolean") throw longInvalidData(); result[key] = valueAtKey; }
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
      if (key === "asset_link") result[key] = entry;
      else if (key === "alive" || key === "injured") { if (typeof entry !== "boolean") throw longInvalidRequest(); result[key] = entry; }
      else if (key.endsWith("_ids")) result[key] = asStringArray(entry, longInvalidRequest);
      else if (key.endsWith("_episode")) { if (!Number.isInteger(entry) || (entry as number) < 1) throw longInvalidRequest(); result[key] = entry; }
      else result[key] = asText(entry, longInvalidRequest);
    }
    return result;
  }

  private async validateAssetLink(collection: LongStoryBibleCollection, item: Record<string, unknown>, episodeCount: number, allowUnlink = false): Promise<boolean> {
    if (item.asset_link === undefined) return false;
    if (item.asset_link === null) {
      if (!allowUnlink || (collection !== "characters" && collection !== "locations" && collection !== "props")) throw longInvalidRequest("Story Bible Asset link is invalid.");
      return true;
    }
    if (collection !== "characters" && collection !== "locations" && collection !== "props") throw longInvalidRequest("Asset links are only supported for characters, locations, and props.");
    const apiLink = asObject(item.asset_link, longInvalidRequest);
    if (Object.keys(apiLink).length !== 4 || !["assetId", "versionPolicy", "pinnedVersion", "episodeScope"].every((key) => key in apiLink)) throw longInvalidRequest("Story Bible Asset link is invalid.");
    const link = this.assetLink({ asset_id: apiLink.assetId, version_policy: apiLink.versionPolicy, pinned_version: apiLink.pinnedVersion, episode_scope: apiLink.episodeScope }, episodeCount, longInvalidRequest);
    let asset;
    try { asset = await this.assets.get(link.asset_id as string); } catch { throw longInvalidRequest("Story Bible Asset link is unavailable."); }
    const expectedType = collection === "characters" ? "character" : collection === "locations" ? "background" : "object";
    if (asset.asset_type !== expectedType || asset.is_folder || !asset.enabled || !asset.approved) throw longInvalidRequest("Story Bible Asset link is unavailable.");
    if (link.version_policy === "pinned_version" && !asset.versions.some((version) => version.version === link.pinned_version)) throw longInvalidRequest("Story Bible Asset link version is unavailable.");
    item.asset_link = link;
    return false;
  }

  private toApiItem(collection: LongStoryBibleCollection, stored: Record<string, unknown>): LongStoryBibleItem {
    const result: Record<string, unknown> = { id: stored[idKeys[collection]] };
    for (const key of allowed[collection]) if (stored[key] !== undefined) {
      if (key === "asset_link") {
        const link = stored[key] as Record<string, unknown>; const scope = link.episode_scope as Record<string, unknown>;
        result.assetLink = { assetId: link.asset_id, versionPolicy: link.version_policy, pinnedVersion: link.pinned_version, episodeScope: scope.mode === "all" ? { mode: "all" } : { mode: "episode", episode: scope.episode } };
      } else result[camel[key] ?? key] = stored[key];
    }
    return result as unknown as LongStoryBibleItem;
  }

  private toApi(bible: StoredBible): LongStoryBible {
    const { style_asset_link: storedStyle, ...basic } = bible.basic;
    const style = storedStyle === undefined ? undefined : this.styleAssetLink(storedStyle);
    return { basic, world: bible.world, ...(style ? { styleAssetLink: { assetId: style.asset_id as string, versionPolicy: style.version_policy as "pinned_version" | "follow_latest" | "snapshot", pinnedVersion: style.pinned_version as number } } : {}), characters: bible.characters.map((item) => this.toApiItem("characters", item)), locations: bible.locations.map((item) => this.toApiItem("locations", item)), props: bible.props.map((item) => this.toApiItem("props", item)), secrets: bible.secrets.map((item) => this.toApiItem("secrets", item)), foreshadowing: bible.foreshadowing.map((item) => this.toApiItem("foreshadowing", item)), updatedAt: bible.updated_at };
  }

  private async save(projectId: string, bible: StoredBible): Promise<void> {
    bible.updated_at = new Date().toISOString();
    try { await atomicWriteUtf8File(this.files(projectId).bible, JSON.stringify(bible, null, 2)); } catch { throw longStorageError(); }
  }

  async get(projectId: string): Promise<GetLongProjectStoryBibleResponse> { return { storyBible: this.toApi(await this.read(projectId.trim())) }; }

  async updateContent(projectId: string, request: UpdateLongStoryBibleContentRequest): Promise<UpdateLongStoryBibleContentResponse> {
    if (!request || typeof request !== "object" || Object.keys(request).length !== 2 || !("basic" in request) || !("world" in request)) throw longInvalidRequest("Story Bible content request is invalid.");
    const basic = asObject(request.basic, longInvalidRequest); const world = asObject(request.world, longInvalidRequest);
    if ("style_asset_link" in basic || "styleAssetLink" in basic) throw longInvalidRequest("Use the global style Asset link endpoint.");
    const id = projectId.trim(); const bible = await this.read(id);
    const preservedStyle = bible.basic.style_asset_link;
    bible.basic = jsonValue(basic) as Record<string, unknown>; bible.world = jsonValue(world) as Record<string, unknown>;
    if (preservedStyle !== undefined) bible.basic.style_asset_link = preservedStyle;
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
  async relationshipAudit(projectId: string): Promise<GetLongStoryBibleRelationshipAuditResponse> {
    const bible = await this.read(projectId.trim());
    const ids = {
      characters: new Set(bible.characters.map((item) => item.character_id as string)),
      locations: new Set(bible.locations.map((item) => item.location_id as string)),
      props: new Set(bible.props.map((item) => item.prop_id as string)),
    };
    const issues: LongStoryBibleRelationshipIssue[] = [];
    const report = (collection: LongStoryBibleCollection, item: Record<string, unknown>, itemId: string, storedField: string, field: LongStoryBibleRelationshipIssue["field"], target: Set<string>) => {
      const value = item[storedField];
      if (value === undefined) return;
      const referencedIds = Array.isArray(value) ? value as string[] : [value as string];
      const missingIds = [...new Set(referencedIds.filter((reference) => !target.has(reference)))].sort();
      if (missingIds.length) issues.push({ collection, itemId, field, missingIds });
    };
    for (const item of bible.characters) {
      const itemId = item.character_id as string;
      report("characters", item, itemId, "location_id", "locationId", ids.locations);
      report("characters", item, itemId, "owned_item_ids", "ownedItemIds", ids.props);
    }
    for (const item of bible.locations) report("locations", item, item.location_id as string, "character_ids", "characterIds", ids.characters);
    for (const item of bible.props) {
      const itemId = item.prop_id as string;
      report("props", item, itemId, "owner_id", "ownerId", ids.characters);
      report("props", item, itemId, "location_id", "locationId", ids.locations);
    }
    for (const collection of ["secrets", "foreshadowing"] as const) for (const item of bible[collection]) {
      const itemId = item[idKeys[collection]] as string;
      report(collection, item, itemId, "character_ids", "characterIds", ids.characters);
      report(collection, item, itemId, "location_ids", "locationIds", ids.locations);
    }
    const compare = (left: string, right: string) => left === right ? 0 : left < right ? -1 : 1;
    const collectionOrder = new Map(collections.map((collection, index) => [collection, index]));
    const fieldOrder = new Map(["locationId", "ownerId", "ownedItemIds", "characterIds", "locationIds"].map((field, index) => [field, index]));
    issues.sort((left, right) => collectionOrder.get(left.collection)! - collectionOrder.get(right.collection)! || compare(left.itemId, right.itemId) || fieldOrder.get(left.field)! - fieldOrder.get(right.field)!);
    return { issues };
  }

  async create(projectId: string, collectionName: string, request: CreateLongStoryBibleItemRequest): Promise<CreateLongStoryBibleItemResponse> {
    if (!isCollection(collectionName)) throw longInvalidRequest("Unknown Story Bible collection.");
    const id = projectId.trim(); const bible = await this.read(id); const item = this.inputItem(collectionName, request?.item, false); await this.validateAssetLink(collectionName, item, await this.episodeCount(this.files(id).project)); const idKey = idKeys[collectionName];
    if (item[idKey] === undefined) item[idKey] = `${prefixes[collectionName]}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    if (bible[collectionName].some((existing) => existing[idKey] === item[idKey])) throw storyBibleItemExists();
    bible[collectionName].push(item); await this.save(id, bible); return { item: this.toApiItem(collectionName, item), storyBible: this.toApi(bible) };
  }

  async update(projectId: string, collectionName: string, itemId: string, request: UpdateLongStoryBibleItemRequest): Promise<UpdateLongStoryBibleItemResponse> {
    if (!isCollection(collectionName) || !safeItemId.test(itemId)) throw longInvalidRequest();
    const id = projectId.trim(); const bible = await this.read(id); const idKey = idKeys[collectionName]; const current = bible[collectionName].find((item) => item[idKey] === itemId);
    if (!current) throw storyBibleItemNotFound(); const changes = this.inputItem(collectionName, request?.item, false);
    if (changes[idKey] !== undefined && changes[idKey] !== itemId) throw longInvalidRequest("Story Bible item ID cannot be changed.");
    delete changes[idKey]; const unlink = await this.validateAssetLink(collectionName, changes, await this.episodeCount(this.files(id).project), true); if (unlink) delete changes.asset_link; Object.assign(current, changes); if (unlink) delete current.asset_link;
    await this.save(id, bible); return { item: this.toApiItem(collectionName, current), storyBible: this.toApi(bible) };
  }

  async delete(projectId: string, collectionName: string, itemId: string): Promise<DeleteLongStoryBibleItemResponse> {
    if (!isCollection(collectionName) || !safeItemId.test(itemId)) throw longInvalidRequest();
    const bible = await this.read(projectId.trim()); const idKey = idKeys[collectionName]; const index = bible[collectionName].findIndex((item) => item[idKey] === itemId);
    if (index < 0) throw storyBibleItemNotFound(); bible[collectionName].splice(index, 1); await this.save(projectId.trim(), bible); return { storyBible: this.toApi(bible) };
  }
}
