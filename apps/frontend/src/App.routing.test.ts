import { describe, expect, it } from "vitest";

import { hashFromScreen, screenFromHash } from "./App.js";

/**
 * Screen position lives in the address bar so a reload lands where the person was. It used to live only in
 * React state: every refresh dropped it and the app reopened on the project list, mid-task.
 *
 * These test the two pure halves. The wiring (Back/Forward, reload) is exercised in App.test.tsx.
 */
describe("screen addresses", () => {
  it("round-trips every screen shape it can carry", () => {
    const screens = [
      { name: "list" },
      { name: "assets", initialQuery: "이배드" },
      { name: "detail", projectId: "12" },
      { name: "videoWorkflow", projectId: "12", jobId: "JOB-1" },
      { name: "longEpisodeMappingReview", projectId: "12", episodeNumber: 1 },
      { name: "longEpisodeSettings", projectId: "design-preview-long-1", episodeNumber: 7 },
    ] as const;
    for (const screen of screens) {
      expect(screenFromHash(hashFromScreen(screen))).toEqual(screen);
    }
  });

  it("keeps the address readable rather than encoding an opaque blob", () => {
    // The address is pasted into a chat when something is wrong with a particular screen, so it has to say
    // which screen and which project without being decoded first.
    expect(hashFromScreen({ name: "longEpisodeMappingReview", projectId: "12", episodeNumber: 1 }))
      .toBe("#/longEpisodeMappingReview?projectId=12&episodeNumber=1");
  });

  it("sends an address that does not resolve to the project list instead of a broken screen", () => {
    // A URL is typed, edited, bookmarked and followed months later. Every one of these would otherwise reach a
    // screen that fetches by a value it does not have and renders its own storage error — a worse answer than
    // simply not going there.
    const bad = [
      "#/notAScreen",
      "#/detail",                                        // required projectId missing
      "#/longEpisodeScript?projectId=12",                // required episodeNumber missing
      "#/longEpisodeScript?projectId=12&episodeNumber=0",    // Episodes count from 1
      "#/longEpisodeScript?projectId=12&episodeNumber=-3",
      "#/longEpisodeScript?projectId=12&episodeNumber=abc",
      "#/longEpisodeScript?projectId=&episodeNumber=1",  // empty is not an id
      "",
    ];
    for (const hash of bad) {
      expect(screenFromHash(hash)).toEqual({ name: "list" });
    }
  });

  it("omits an optional field rather than writing it empty", () => {
    expect(hashFromScreen({ name: "assets" })).toBe("#/assets");
    expect(screenFromHash("#/assets")).toEqual({ name: "assets" });
  });

  it("never puts justCreated in the address", () => {
    // It marks the one moment just after creation and changes the finish button's wording. Restoring it from a
    // URL would show a first-run affordance on a project made last week — and a bookmark would show it forever.
    const hash = hashFromScreen({ name: "settings", projectId: "12", justCreated: true });
    expect(hash).not.toContain("justCreated");
    expect(screenFromHash(hash)).toEqual({ name: "settings", projectId: "12" });
  });

  it("normalizes a hand-typed address to the form it will write back", () => {
    // The two sync effects settle only because this holds: decode, re-encode, and the next pass finds them
    // equal. Without it the address and the state would push each other back and forth.
    const typed = "#/longEpisodeScript?episodeNumber=2&projectId=12&stray=x";
    const screen = screenFromHash(typed);
    expect(hashFromScreen(screen)).toBe("#/longEpisodeScript?projectId=12&episodeNumber=2");
    expect(screenFromHash(hashFromScreen(screen))).toEqual(screen);
  });
});
