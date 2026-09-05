import { describe, expect, it } from "vitest";

import { errorsOf, toEpisodeDetail, toEpisodeInstagramPost, toEpisodePreviousInstagramPosts, toEpisodeUsedAudio } from "./episode-detail.js";

const post = {
  media_id: "media-1", ig_user_id: "178000", published_at: "2026-09-01T00:00:00.000Z", caption: "오늘의 영상",
};

const episode = (extra: Record<string, unknown> = {}) => ({
  number: 1, state: "completed" as const, approved: true, script_revision: 2,
  title: "t", summary: "s", core_event: "c", conflict: "x", cliffhanger: "y", next_connection: "z",
  updated_at: "2026-09-01T00:00:00.000Z", ...extra,
});

/**
 * The one mapper five Episode services share, and the four lenient reads inside it.
 *
 * Each of those reads answers the same shape of question — is this fact here or not — and each has a stated
 * consequence for getting it wrong. None of them had a test. They are the sort of code that is rewritten
 * "equivalently" during a tidy-up, and every one of the equivalences is subtly false.
 */
describe("what an Episode says about itself", () => {
  describe("the audio a merge used", () => {
    it("counts a half-written record as absent rather than as audio with no credit", () => {
      // The credit line is built from this and nothing else. A partial record read as present is the quiet
      // version of publishing a CC BY track uncredited — the same fact the publish gate refuses on.
      expect(toEpisodeUsedAudio({ track_id: "t1", attribution_required: true })).toBeUndefined();
      expect(toEpisodeUsedAudio({ mode: "not-a-mode" })).toBeUndefined();
      expect(toEpisodeUsedAudio(null)).toBeUndefined();
      expect(toEpisodeUsedAudio(["bgm"])).toBeUndefined();
    });

    it("carries the credit fields only when the record actually has them", () => {
      expect(toEpisodeUsedAudio({ mode: "bgm" })).toEqual({ mode: "bgm" });
      expect(toEpisodeUsedAudio({ mode: "bgm", track_id: "t1", attribution_required: false }))
        .toEqual({ mode: "bgm", trackId: "t1", attributionRequired: false });
    });
  });

  describe("the post that went out", () => {
    it("reads a record missing any of its four strings as no post at all", () => {
      // A half-read record of something public reads as knowledge. Absent is the honest answer: nobody can act
      // on a post this app cannot name.
      for (const key of ["media_id", "ig_user_id", "published_at", "caption"]) {
        expect(toEpisodeInstagramPost({ ...post, [key]: undefined })).toBeUndefined();
      }
    });

    it("keeps null and absent apart for the cover frame", () => {
      // null is "the publish asked for no cover"; absent is "this record predates the field". They produce the
      // same Reel and must not produce the same record.
      expect(toEpisodeInstagramPost({ ...post, thumb_offset_ms: null })).toMatchObject({ thumbOffsetMs: null });
      expect(toEpisodeInstagramPost({ ...post, thumb_offset_ms: 1200 })).toMatchObject({ thumbOffsetMs: 1200 });
      expect(toEpisodeInstagramPost(post)).not.toHaveProperty("thumbOffsetMs");
    });

    it("drops only the entries that do not hold together, never the whole history", () => {
      // This list exists so that clearing the live record does not erase the fact that something may still be
      // up on the account. Refusing to parse it would erase exactly what it is for.
      expect(toEpisodePreviousInstagramPosts([post, null, { media_id: "m" }, { ...post, media_id: "media-2" }]))
        .toHaveLength(2);
      expect(toEpisodePreviousInstagramPosts("not a list")).toEqual([]);
    });
  });

  describe("what an Episode admits went wrong", () => {
    it("says nothing rather than saying it checked and found nothing", () => {
      // `errors: []` on every healthy Episode reads as "we looked and it is fine", which is a stronger claim
      // than a field nobody ever wrote to.
      expect(errorsOf(episode())).toEqual([]);
      expect(toEpisodeDetail(episode())).not.toHaveProperty("errors");
      expect(toEpisodeDetail(episode({ errors: ["ffmpeg failed"] }))).toMatchObject({ errors: ["ffmpeg failed"] });
    });

    it("keeps only the strings, so one malformed entry does not take the rest with it", () => {
      expect(errorsOf(episode({ errors: ["real", 7, null, "also real"] }))).toEqual(["real", "also real"]);
    });
  });
});
