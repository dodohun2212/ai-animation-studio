import { LONG_EPISODE_STATUSES } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";

import { LONG_EPISODE_STATUS_ORDER, isLongEpisodeStatusBefore, longEpisodeStatusLabel } from "./longEpisodeLabels.js";

/**
 * The order used to be sixteen of the eighteen statuses written out by hand.
 *
 * The backend forbids that shape in its own sources and says why: a copy that misses the next status added is a
 * defect waiting to happen, and it had already happened once — a list that stopped at `interrupted` made a
 * finished Episode answer 500 on both of its mapping routes. The frontend had no equivalent guard, so its copy
 * was invisible. It is derived now, and these pin both halves of what derivation cannot check by itself.
 */
describe("Long Episode status order", () => {
  it("covers every status except the two that are not points on the line", () => {
    expect([...LONG_EPISODE_STATUS_ORDER].sort()).toEqual(
      LONG_EPISODE_STATUSES.filter((status) => status !== "interrupted" && status !== "failed").slice().sort(),
    );
  });

  /**
   * Written out here on purpose, and the only place it is.
   *
   * Deriving guarantees the order is complete; it cannot guarantee a new status was inserted where it belongs
   * rather than appended. This is what makes a move visible: changing the workflow reddens one assertion that
   * names the sequence, instead of screens quietly starting to name the wrong next step.
   */
  it("runs in the order the work actually happens", () => {
    expect(LONG_EPISODE_STATUS_ORDER).toEqual([
      "planned", "outline_ready", "script_review", "script_approved", "waiting_for_asset_mapping_review",
      "asset_mapping_approved", "generating_images", "images_ready", "images_review",
      "waiting_for_video_confirmation", "videos_generating", "videos_ready", "videos_review", "videos_approved",
      "rendering", "completed",
    ]);
  });

  it("answers 'before' by that order, and never for a status that is off it", () => {
    expect(isLongEpisodeStatusBefore("outline_ready", "asset_mapping_approved")).toBe(true);
    expect(isLongEpisodeStatusBefore("images_review", "asset_mapping_approved")).toBe(false);
    // Same status is not before itself — the boundary the screens sit on.
    expect(isLongEpisodeStatusBefore("asset_mapping_approved", "asset_mapping_approved")).toBe(false);
    // A stopped run is nowhere on the line, so it must not read as "you still have steps left".
    expect(isLongEpisodeStatusBefore("interrupted", "images_review")).toBe(false);
    expect(isLongEpisodeStatusBefore("failed", "images_review")).toBe(false);
    expect(isLongEpisodeStatusBefore(undefined, "images_review")).toBe(false);
  });

  it("has a Korean label for every status, including the two off the line", () => {
    for (const status of LONG_EPISODE_STATUSES) {
      expect(longEpisodeStatusLabel(status), status).not.toBe(status);
    }
  });
});
