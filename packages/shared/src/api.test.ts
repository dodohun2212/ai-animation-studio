import { describe, expect, it } from "vitest";

import { LONG_EPISODE_STATUSES, assertVideoGenerationApproval, type StartVideoGenerationRequest } from "./api.js";
import { LONG_EPISODE_OUTLINE_STATUSES } from "./domain.js";

function approvedRequest(): StartVideoGenerationRequest {
  return {
    approved: true,
    confirmationId: "confirmation-1",
    userRequestId: "request-1",
    prompts: [1, 2, 3, 4, 5, 6].map((sceneNumber) => ({
      sceneNumber: sceneNumber as 1 | 2 | 3 | 4 | 5 | 6,
      prompt: `Prompt ${sceneNumber}`,
    })),
  };
}

describe("video generation approval", () => {
  it("accepts one explicitly approved prompt per scene", () => {
    expect(() => assertVideoGenerationApproval(approvedRequest())).not.toThrow();
  });

  it("rejects a gap in the scene sequence, too few/too many prompts, or missing request identity", () => {
    const gapped = approvedRequest();
    gapped.prompts.splice(2, 1);
    expect(() => assertVideoGenerationApproval(gapped)).toThrow();

    const tooFew = approvedRequest();
    tooFew.prompts = tooFew.prompts.slice(0, 1);
    expect(() => assertVideoGenerationApproval(tooFew)).toThrow();

    const tooMany = approvedRequest();
    tooMany.prompts = Array.from({ length: 13 }, (_, index) => ({ sceneNumber: index + 1, prompt: `Prompt ${index + 1}` }));
    expect(() => assertVideoGenerationApproval(tooMany)).toThrow();

    const unidentified = approvedRequest();
    unidentified.userRequestId = "";
    expect(() => assertVideoGenerationApproval(unidentified)).toThrow();
  });

  it("accepts a prompt count anywhere in the supported 2-12 range, not just six", () => {
    const request = approvedRequest();
    request.prompts = Array.from({ length: 4 }, (_, index) => ({ sceneNumber: index + 1, prompt: `Prompt ${index + 1}` }));
    expect(() => assertVideoGenerationApproval(request)).not.toThrow();
  });
});

/**
 * A Long Project's `outlineStatus` is a `LongEpisodeOutlineStatus` (two values), but the only Korean label table
 * in the app is keyed by `LongEpisodeStatus` (eighteen), and its signature takes `| string` — so the screen
 * compiles either way and today's two labels come out right only because both names happen to appear in the
 * larger list.
 *
 * 🔴 The failure is silent, which is why it gets a tripwire instead of a comment. That table falls back to
 * `?? status`, so a third outline status whose name is not in the eighteen would put the raw enum on screen —
 * `in_progress` where a person expects Korean — with nothing thrown and nothing red. Found by Cowork
 * (Round 715) while replacing that row's chip; they left it deliberately, because the real repair is an
 * outline-specific label table and that is a frontend decision, not a contract one.
 *
 * What this side can do is make the coincidence stop being silent. If the two lists ever part, the contract
 * suite says so here, naming the screen that breaks — the day the third status is added, not the day someone
 * notices English on the list.
 */
describe("the two long-episode status vocabularies", () => {
  it("keeps every outline status inside the status list the label table is keyed by", () => {
    const statuses = LONG_EPISODE_STATUSES as readonly string[];
    const missing = LONG_EPISODE_OUTLINE_STATUSES.filter((status) => !statuses.includes(status));

    expect(missing, [
      "An outline status is not in LONG_EPISODE_STATUSES, so longEpisodeStatusLabel() has no Korean for it and",
      "returns the raw enum name. The screen that still calls it with an outlineStatus is:",
      "  apps/frontend/src/components/LongProjectDetail.tsx  (the 「스토리 개요 상태」 row)",
      "Point it at longEpisodeOutlineStatusLabel, the way LongProjectList already does, and then delete this",
      "test. Do NOT add the name to the eighteen instead — widening the bigger vocabulary to cover the smaller",
      "one restores the same coincidence, and the next third value is silent again.",
    ].join("\n")).toEqual([]);
  });
});
