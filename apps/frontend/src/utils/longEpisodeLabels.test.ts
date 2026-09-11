import { LONG_EPISODE_OUTLINE_STATUSES, LONG_EPISODE_STATUSES } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";

import {
  LONG_EPISODE_OUTLINE_STATUS_LABEL,
  LONG_EPISODE_STATUS_ORDER,
  isLongEpisodeStatusBefore,
  longEpisodeOutlineStatusLabel,
  longEpisodeStatusLabel,
} from "./longEpisodeLabels.js";

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

/**
 * The long project list used to translate `outlineStatus` with the eighteen-value table, and it worked only
 * because both outline names happen to be in that list. The compile error is the real guard — a third outline
 * status cannot be added without writing its Korean here — but a type error is invisible to a suite, so these
 * pin what a reader can check: the two vocabularies are kept apart, and neither table answers for the other.
 */
describe("Long Project outline status labels", () => {
  it("has a Korean label for every outline status, and no entry for anything else", () => {
    expect(Object.keys(LONG_EPISODE_OUTLINE_STATUS_LABEL).sort()).toEqual([...LONG_EPISODE_OUTLINE_STATUSES].sort());
    for (const status of LONG_EPISODE_OUTLINE_STATUSES) {
      expect(longEpisodeOutlineStatusLabel(status), status).not.toBe(status);
    }
  });

  // Not a style preference: the eighteen-value table is the one that falls back to `?? status`, so if the list
  // ever goes back to it, an outline status it does not know reaches the screen as a raw enum name.
  it("does not borrow the episode table, whose fallback would print the raw enum", () => {
    expect(longEpisodeOutlineStatusLabel("planned")).toBe("계획됨");
    expect(longEpisodeOutlineStatusLabel("outline_ready")).toBe("스토리 개요 완료");
    // The episode table answers for a name it does not have by echoing it back. That is the behaviour the
    // outline table must never inherit.
    expect(longEpisodeStatusLabel("in_progress")).toBe("in_progress");
  });
});
