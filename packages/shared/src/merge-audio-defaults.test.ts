import { describe, expect, it } from "vitest";

import { AUDIO_MODES, DEFAULT_BGM_VOLUME, defaultBgmVolume, usesBgm } from "./domain.js";

/**
 * What a merge does about music when the request says nothing, stated once.
 *
 * Both merges answered this separately and identically — two copies of 0.25, two spellings of "which modes
 * carry a track", two of "bgm alone plays at full". They agreed, the way every copy in this repository agreed
 * until one did not. A drift here is audible and lands in a finished video, and neither screen says which
 * mixing a person is hearing.
 */
describe("the merge's audio defaults", () => {
  it("keeps music under a voice, and gets out of its own way when there is no voice", () => {
    // 0.25 exists for a reason that only applies when something else is speaking. Applying it to a person's
    // own upload playing alone would make it quiet for a cause no screen mentions.
    expect(defaultBgmVolume("narration+bgm")).toBe(DEFAULT_BGM_VOLUME);
    expect(defaultBgmVolume("bgm")).toBe(1);
  });

  it("names every mode that carries a track, and only those", () => {
    // The list is derived from the contract's own modes rather than retyped, so a fifth mode arriving without
    // a decision here fails instead of quietly counting as no-track.
    expect(AUDIO_MODES.filter(usesBgm)).toEqual(["narration+bgm", "bgm"]);
  });
});
