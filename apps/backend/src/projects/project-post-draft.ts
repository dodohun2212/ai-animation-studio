import type { GetPostDraftResponse, PutPostDraftRequest } from "@ai-animation-studio/shared";

import { invalidRequest } from "./project-api.error.js";
import type { StoredProject } from "./project-storage.schema.js";

const MAX_BODY_LENGTH = 2200; // Same cap InstagramPostScreen.tsx enforces on the composed caption.
const MAX_HASHTAGS_LENGTH = 500;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Reads `lore_context.post_draft` — same free-form-field pattern project-asset-references.ts uses, so no schema/Python-compat change is needed for a field this narrow. */
export function toPostDraft(stored: StoredProject): GetPostDraftResponse {
  const raw = stored.lore_context.post_draft;
  if (!isObject(raw)) return {};
  const { body, hashtags, ai_notice } = raw as Record<string, unknown>;
  return {
    ...(typeof body === "string" && body ? { body } : {}),
    ...(typeof hashtags === "string" && hashtags ? { hashtags } : {}),
    ...(typeof ai_notice === "boolean" ? { aiNotice: ai_notice } : {}),
  };
}

export function parsePostDraft(value: unknown): PutPostDraftRequest {
  if (!isObject(value) || Object.keys(value).some((key) => !["body", "hashtags", "aiNotice"].includes(key))) {
    throw invalidRequest("Request body must contain only body, hashtags, and aiNotice.", { field: "body" });
  }
  if (value.body !== undefined && (typeof value.body !== "string" || value.body.length > MAX_BODY_LENGTH)) {
    throw invalidRequest(`body must be a string up to ${MAX_BODY_LENGTH} characters.`, { field: "body" });
  }
  if (value.hashtags !== undefined && (typeof value.hashtags !== "string" || value.hashtags.length > MAX_HASHTAGS_LENGTH)) {
    throw invalidRequest(`hashtags must be a string up to ${MAX_HASHTAGS_LENGTH} characters.`, { field: "hashtags" });
  }
  if (value.aiNotice !== undefined && typeof value.aiNotice !== "boolean") {
    throw invalidRequest("aiNotice must be a boolean.", { field: "aiNotice" });
  }
  return {
    ...(value.body !== undefined ? { body: value.body as string } : {}),
    ...(value.hashtags !== undefined ? { hashtags: value.hashtags as string } : {}),
    ...(value.aiNotice !== undefined ? { aiNotice: value.aiNotice as boolean } : {}),
  };
}

/** A PUT is a full replace, not a merge — an omitted field means "cleared", matching how the screen itself always saves its whole current state at once. */
export function applyPostDraft(stored: StoredProject, draft: PutPostDraftRequest, updatedAt: string): StoredProject {
  return {
    ...stored,
    updated_at: updatedAt,
    lore_context: {
      ...stored.lore_context,
      post_draft: { body: draft.body ?? "", hashtags: draft.hashtags ?? "", ai_notice: draft.aiNotice ?? true },
    },
  };
}
