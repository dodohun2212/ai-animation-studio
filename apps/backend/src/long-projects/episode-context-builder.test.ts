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

  /**
   * The one section eviction may never take.
   *
   * `forbidden_information` is not a nicety in the payload — it is the whole mechanism behind "이 비밀은 8화부터".
   * Every other section, dropped, costs the script some memory. This one, dropped, hands the model a prompt that
   * has never heard of the twist being off-limits, and the twist lands in episode 3. Nobody finds out from an
   * error: the script generates, reads fine, and is wrong about the one thing a long project is built around.
   *
   * Written because nothing measured it. Adding `forbidden_information` to the ladder — the obvious next move
   * for anyone whose payload is over the limit and who is looking for something else to drop — left all 1199
   * backend tests green. The eviction test above only checks the order of what *is* evicted, which an
   * implementation that also evicts this passes.
   *
   * The pair matters: the second half alone would pass an implementation that never evicts anything.
   */
  it("would rather fail than build a context whose not-yet list has been evicted", () => {
    const forbidden = Array.from({ length: 6 }, (_, index) => ({ secret_id: `S${index}`, reveal_available_episode: 9, content: "x".repeat(400) }));
    expect(() => buildEpisodeContext({
      ...baseInput, secrets: forbidden, foreshadowing: [], recentContinuity: [], olderCompressedSummaries: [], maxCharacters: 2_000,
    })).toThrow(EpisodeContextTooLargeError);
  });

  it("keeps every forbidden secret while evicting the sections it is allowed to evict", () => {
    const crowding = Array.from({ length: 4 }, (_, index) => ({ foreshadowing_id: `F${index}`, status: "open", content: "x".repeat(600) }));
    const forbidden = [{ secret_id: "S9", reveal_available_episode: 9, content: "the twist" }];
    const context = buildEpisodeContext({
      ...baseInput, secrets: forbidden, foreshadowing: crowding, recentContinuity: [], olderCompressedSummaries: [], maxCharacters: 2_500,
    });

    expect(context.excluded_sections).toContain("lower_priority_foreshadowing");
    expect((context.unresolved_foreshadowing as unknown[]).length).toBeLessThan(crowding.length);
    expect(context.forbidden_information).toEqual(forbidden);
    expect(context.excluded_sections).not.toContain("forbidden_information");
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
