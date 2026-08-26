import { describe, expect, it } from "vitest";
import { buildEpisodeContext, EpisodeContextTooLargeError } from "./episode-context-builder.js";

const baseInput = {
  storyBible: { basic: { title: "t" }, world: {} },
  projectOverview: { title: "t", episode_count: 5 },
  episodeOutline: { number: 4, title: "Episode 4" },
  recentContinuity: [{ episode_number: 3, summary: "s3" }, { episode_number: 2, summary: "s2" }],
  olderCompressedSummaries: [{ episode_number: 1, summary: "s1" }],
  secrets: [
    { secret_id: "S1", reveal_available_episode: 2, content: "revealed by ep2" },
    { secret_id: "S2", reveal_available_episode: 5, content: "not yet" },
  ],
  foreshadowing: [
    { foreshadowing_id: "F1", status: "open", content: "open thread" },
    { foreshadowing_id: "F2", status: "planned", content: "planned thread" },
    { foreshadowing_id: "F3", status: "resolved", content: "already resolved" },
  ],
  episodeNumber: 4,
};

describe("buildEpisodeContext", () => {
  it("splits secrets by reveal_available_episode and keeps only open/planned foreshadowing", () => {
    const context = buildEpisodeContext(baseInput);
    expect(context.revealable_information).toEqual([{ secret_id: "S1", reveal_available_episode: 2, content: "revealed by ep2" }]);
    expect(context.forbidden_information).toEqual([{ secret_id: "S2", reveal_available_episode: 5, content: "not yet" }]);
    expect(context.unresolved_foreshadowing).toEqual([
      { foreshadowing_id: "F1", status: "open", content: "open thread" },
      { foreshadowing_id: "F2", status: "planned", content: "planned thread" },
    ]);
  });

  it("records which sections are actually present in included_sections, skipping empty ones", () => {
    const context = buildEpisodeContext({ ...baseInput, olderCompressedSummaries: [], userInstruction: "" });
    const included = context.included_sections as string[];
    expect(included).toContain("recent_continuity");
    expect(included).not.toContain("older_compressed_summaries");
    expect(included).not.toContain("user_instruction");
  });

  it("defaults a missing reveal_available_episode to 1, matching Python's field default", () => {
    const context = buildEpisodeContext({
      ...baseInput,
      secrets: [{ secret_id: "S3", content: "no reveal field" }],
    });
    expect(context.revealable_information).toEqual([{ secret_id: "S3", content: "no reveal field" }]);
    expect(context.forbidden_information).toEqual([]);
  });

  it("evicts oldest compressed summaries, then oldest recent continuity, then lowest-priority foreshadowing, in that order", () => {
    const bigOlder = Array.from({ length: 5 }, (_, i) => ({ episode_number: i + 1, summary: "x".repeat(3000) }));
    const context = buildEpisodeContext({ ...baseInput, olderCompressedSummaries: bigOlder, maxCharacters: 2_500 });
    expect((context.older_compressed_summaries as unknown[]).length).toBeLessThan(bigOlder.length);
    expect(context.excluded_sections).toContain("oldest_compressed_summary");
  });

  it("throws once every evictable section is gone and the payload still exceeds the limit", () => {
    expect(() => buildEpisodeContext({
      storyBible: { basic: {}, world: {} },
      projectOverview: {},
      episodeOutline: {},
      recentContinuity: [],
      olderCompressedSummaries: [],
      secrets: [],
      foreshadowing: [],
      episodeNumber: 1,
      userInstruction: "x".repeat(10_000),
      maxCharacters: 2_000,
    })).toThrow(EpisodeContextTooLargeError);
  });

  it("rejects a maxCharacters below Python's floor", () => {
    expect(() => buildEpisodeContext({ ...baseInput, maxCharacters: 1_000 })).toThrow("maxCharacters is too small");
  });

  it("dedupes identical entries the same way as Python's _dedupe", () => {
    const context = buildEpisodeContext({
      ...baseInput,
      characters: [{ character_id: "C1", name: "Hero" }, { character_id: "C1", name: "Hero" }],
    });
    expect(context.characters).toEqual([{ character_id: "C1", name: "Hero" }]);
  });
});
