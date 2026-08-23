import type { ShortProjectCastMember } from "@ai-animation-studio/shared";

import { invalidRequest } from "./project-api.error.js";
import type { StoredProject } from "./project-storage.schema.js";

const MAX_CAST_SIZE = 12;
const MAX_ROLE_LENGTH = 80;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads Python's `character_profile.cast` array, tolerant of legacy or partially-shaped entries. */
export function toShortProjectCast(stored: StoredProject): ShortProjectCastMember[] {
  const cast = stored.character_profile.cast;
  if (!Array.isArray(cast)) return [];
  return cast
    .filter(isObject)
    .map((item) => ({
      assetId: typeof item.asset_id === "string" ? item.asset_id : "",
      castRole: typeof item.cast_role === "string" && item.cast_role.trim() ? item.cast_role : "supporting",
      storyRole: typeof item.story_role === "string" && item.story_role.trim() ? item.story_role : "서브 캐릭터",
    }))
    .filter((item) => item.assetId);
}

export function parseShortProjectCast(value: unknown): ShortProjectCastMember[] {
  if (!isObject(value) || Object.keys(value).length !== 1 || !("cast" in value) || !Array.isArray(value.cast)) {
    throw invalidRequest("Request body must contain only a cast array.", { field: "cast" });
  }
  if (value.cast.length > MAX_CAST_SIZE) {
    throw invalidRequest(`cast must contain at most ${MAX_CAST_SIZE} members.`, { field: "cast" });
  }
  const seen = new Set<string>();
  return value.cast.map((item, index) => {
    if (!isObject(item) || Object.keys(item).some((key) => !["assetId", "castRole", "storyRole"].includes(key))) {
      throw invalidRequest(`cast[${index}] must contain only assetId, castRole and storyRole.`, { field: `cast[${index}]` });
    }
    const assetId = item.assetId;
    const castRole = item.castRole;
    const storyRole = item.storyRole;
    if (typeof assetId !== "string" || !assetId.trim()) {
      throw invalidRequest(`cast[${index}].assetId is required.`, { field: `cast[${index}].assetId` });
    }
    if (typeof castRole !== "string" || !castRole.trim() || castRole.trim().length > MAX_ROLE_LENGTH) {
      throw invalidRequest(`cast[${index}].castRole must be a non-empty string up to ${MAX_ROLE_LENGTH} characters.`, { field: `cast[${index}].castRole` });
    }
    if (typeof storyRole !== "string" || !storyRole.trim() || storyRole.trim().length > MAX_ROLE_LENGTH) {
      throw invalidRequest(`cast[${index}].storyRole must be a non-empty string up to ${MAX_ROLE_LENGTH} characters.`, { field: `cast[${index}].storyRole` });
    }
    if (seen.has(assetId)) {
      throw invalidRequest(`cast[${index}].assetId is a duplicate.`, { field: `cast[${index}].assetId` });
    }
    seen.add(assetId);
    return { assetId: assetId.trim(), castRole: castRole.trim(), storyRole: storyRole.trim() };
  });
}

export function applyShortProjectCast(stored: StoredProject, cast: ShortProjectCastMember[], updatedAt: string): StoredProject {
  return {
    ...stored,
    updated_at: updatedAt,
    character_profile: {
      ...stored.character_profile,
      cast: cast.map((item) => ({ asset_id: item.assetId, cast_role: item.castRole, story_role: item.storyRole })),
    },
  };
}
