import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { Injectable } from "@nestjs/common";
import type {
  CreateLongStoryBibleItemRequest,
  CreateLongStoryBibleItemResponse,
  DeleteLongStoryBibleItemResponse,
  GetLongProjectStoryBibleResponse,
  LongStoryBible,
  LongStoryBibleCollection,
  LongStoryBibleItem,
  LongStoryBibleItemInput,
  UpdateLongStoryBibleItemRequest,
  UpdateLongStoryBibleItemResponse,
} from "@ai-animation-studio/shared";
import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { isSafeProjectId, resolveSafeProjectDirectory } from "../projects/project-id.js";
import { longInvalidData, longInvalidRequest, longMalformed, longNotFound, longStorageError, longUnsafeId, storyBibleItemExists, storyBibleItemNotFound } from "./long-project-api.error.js";

const collections = ["characters", "locations", "props", "secrets", "foreshadowing"] as const;
const idKeys = { characters: "character_id", locations: "location_id", props: "prop_id", secrets: "secret_id", foreshadowing: "foreshadowing_id" } as const;
const prefixes = { characters: "CHAR", locations: "LOC", props: "PROP", secrets: "SECRET", foreshadowing: "FORESHADOW" } as const;
const common = ["name", "status", "description"] as const;
const allowed: Record<LongStoryBibleCollection, readonly string[]> = {
  characters: [...common, "alive", "injured", "reference_id", "last_appearance", "emotional_state", "location_id", "owned_item_ids"],
  locations: [...common, "character_ids", "episode_ids", "reference_id"],
  props: [...common, "owner_id", "location_id", "episode_ids", "reference_id"],
  secrets: [...common, "planned_reveal_episode", "actual_reveal_episode", "character_ids", "location_ids", "event_ids", "truth", "reveal_available_episode", "content"],
  foreshadowing: [...common, "planned_reveal_episode", "actual_reveal_episode", "character_ids", "location_ids", "event_ids", "truth", "reveal_available_episode", "content"],
};
const camel: Record<string, string> = { reference_id: "referenceId", last_appearance: "lastAppearance", emotional_state: "emotionalState", location_id: "locationId", owner_id: "ownerId", owned_item_ids: "ownedItemIds", character_ids: "characterIds", location_ids: "locationIds", episode_ids: "episodeIds", event_ids: "eventIds", planned_reveal_episode: "plannedRevealEpisode", actual_reveal_episode: "actualRevealEpisode", reveal_available_episode: "revealAvailableEpisode" };
const snake: Record<string, string> = Object.fromEntries(Object.entries(camel).map(([key, value]) => [value, key]));
const safeItemId = /^[\p{L}\p{N}_-]+$/u;

type StoredBible = { basic: Record<string, unknown>; world: Record<string, unknown>; characters: Record<string, unknown>[]; locations: Record<string, unknown>[]; props: Record<string, unknown>[]; secrets: Record<string, unknown>[]; foreshadowing: Record<string, unknown>[]; summaries: Record<string, unknown>; updated_at: string };

const isCollection = (value: string): value is LongStoryBibleCollection => (collections as readonly string[]).includes(value);
function asObject(value: unknown, error = longInvalidData): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw error(); return value as Record<string, unknown>; }
function asText(value: unknown, error = longInvalidData): string { if (typeof value !== "string") throw error(); return value.trim(); }
function asStringArray(value: unknown, error = longInvalidData): string[] { if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw error(); return value.map((item) => item.trim()); }

@Injectable()
export class StoryBibleService {
  constructor(private readonly projectsRoot: string) {}

  private files(projectId: string): { project: string; bible: string } {
    if (!isSafeProjectId(projectId)) throw longUnsafeId();
    const root = path.join(resolveSafeProjectDirectory(this.projectsRoot, projectId), "long_story");
    return { project: path.join(root, "project.json"), bible: path.join(root, "story_bible.json") };
  }

  private async read(projectId: string): Promise<StoredBible> {
    const files = this.files(projectId);
    try { await fs.access(files.project); } catch { throw longNotFound(); }
    let raw: unknown;
    try { raw = JSON.parse(await fs.readFile(files.bible, "utf8")); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") throw longNotFound(); if (error instanceof SyntaxError) throw longMalformed(); throw longStorageError(); }
    const bible = asObject(raw);
    const known = new Set(["basic", "world", "characters", "locations", "props", "secrets", "foreshadowing", "summaries", "updated_at"]);
    if (Object.keys(bible).some((key) => !known.has(key))) throw longInvalidData();
    const result: StoredBible = { basic: asObject(bible.basic), world: asObject(bible.world), characters: [], locations: [], props: [], secrets: [], foreshadowing: [], summaries: asObject(bible.summaries), updated_at: asText(bible.updated_at) };
    for (const collection of collections) {
      if (!Array.isArray(bible[collection])) throw longInvalidData();
      result[collection] = bible[collection].map((item) => this.parseStoredItem(collection, item));
    }
    return result;
  }

  private parseStoredItem(collection: LongStoryBibleCollection, value: unknown): Record<string, unknown> {
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
    for (const key of allowed[collection]) if (stored[key] !== undefined) result[camel[key] ?? key] = stored[key];
    return result as unknown as LongStoryBibleItem;
  }

  private toApi(bible: StoredBible): LongStoryBible {
    return { basic: bible.basic, world: bible.world, characters: bible.characters.map((item) => this.toApiItem("characters", item)), locations: bible.locations.map((item) => this.toApiItem("locations", item)), props: bible.props.map((item) => this.toApiItem("props", item)), secrets: bible.secrets.map((item) => this.toApiItem("secrets", item)), foreshadowing: bible.foreshadowing.map((item) => this.toApiItem("foreshadowing", item)), updatedAt: bible.updated_at };
  }

  private async save(projectId: string, bible: StoredBible): Promise<void> {
    bible.updated_at = new Date().toISOString();
    try { await atomicWriteUtf8File(this.files(projectId).bible, JSON.stringify(bible, null, 2)); } catch { throw longStorageError(); }
  }

  async get(projectId: string): Promise<GetLongProjectStoryBibleResponse> { return { storyBible: this.toApi(await this.read(projectId.trim())) }; }

  async create(projectId: string, collectionName: string, request: CreateLongStoryBibleItemRequest): Promise<CreateLongStoryBibleItemResponse> {
    if (!isCollection(collectionName)) throw longInvalidRequest("Unknown Story Bible collection.");
    const bible = await this.read(projectId.trim()); const item = this.inputItem(collectionName, request?.item, false); const idKey = idKeys[collectionName];
    if (item[idKey] === undefined) item[idKey] = `${prefixes[collectionName]}-${crypto.randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase()}`;
    if (bible[collectionName].some((existing) => existing[idKey] === item[idKey])) throw storyBibleItemExists();
    bible[collectionName].push(item); await this.save(projectId.trim(), bible); return { item: this.toApiItem(collectionName, item), storyBible: this.toApi(bible) };
  }

  async update(projectId: string, collectionName: string, itemId: string, request: UpdateLongStoryBibleItemRequest): Promise<UpdateLongStoryBibleItemResponse> {
    if (!isCollection(collectionName) || !safeItemId.test(itemId)) throw longInvalidRequest();
    const bible = await this.read(projectId.trim()); const idKey = idKeys[collectionName]; const current = bible[collectionName].find((item) => item[idKey] === itemId);
    if (!current) throw storyBibleItemNotFound(); const changes = this.inputItem(collectionName, request?.item, false);
    if (changes[idKey] !== undefined && changes[idKey] !== itemId) throw longInvalidRequest("Story Bible item ID cannot be changed.");
    delete changes[idKey]; Object.assign(current, changes);
    await this.save(projectId.trim(), bible); return { item: this.toApiItem(collectionName, current), storyBible: this.toApi(bible) };
  }

  async delete(projectId: string, collectionName: string, itemId: string): Promise<DeleteLongStoryBibleItemResponse> {
    if (!isCollection(collectionName) || !safeItemId.test(itemId)) throw longInvalidRequest();
    const bible = await this.read(projectId.trim()); const idKey = idKeys[collectionName]; const index = bible[collectionName].findIndex((item) => item[idKey] === itemId);
    if (index < 0) throw storyBibleItemNotFound(); bible[collectionName].splice(index, 1); await this.save(projectId.trim(), bible); return { storyBible: this.toApi(bible) };
  }
}
