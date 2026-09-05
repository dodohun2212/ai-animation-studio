import { describe, expect, it } from "vitest";

import { isPlaceholderClip, isUsableClip, PLACEHOLDER_MP4, wasPaidRun } from "./placeholder-clip.js";

const file = (size: number) => ({ isFile: () => true, size });

/**
 * The two questions every clip route asks before serving or merging a file.
 *
 * They were written out at six call sites between them, and the copies had already stopped agreeing: the
 * Episode merge tested a record with a bare cast, `(item as VideoRecord).execution_mode`, where the short
 * project guarded the shape first. One malformed entry therefore threw a TypeError out of a merge on one side
 * and read as "not a paid run" on the other.
 *
 * Neither question fails loudly when it drifts. Answering "not paid" moves a run to the lenient file test, and
 * the lenient test is the one that let six stubbed clips pass for paid ones.
 */
describe("what a clip route asks before it serves a file", () => {
  describe("whether the run reached a provider", () => {
    it("is true when any record says runway, false when none does", () => {
      expect(wasPaidRun([{ execution_mode: "local_fake_no_provider" }, { execution_mode: "runway" }])).toBe(true);
      expect(wasPaidRun([{ execution_mode: "local_fake_no_provider" }])).toBe(false);
      expect(wasPaidRun([])).toBe(false);
    });

    it("reads a malformed record as not paid rather than throwing", () => {
      // The divergence this replaced: a bare cast turned one bad entry into a TypeError thrown out of a merge.
      // "We cannot tell from this record" is an answer; a crash in the middle of a merge is not.
      expect(wasPaidRun([null, undefined, "runway", 7, { execution_mode: 3 }])).toBe(false);
      expect(wasPaidRun([null, { execution_mode: "runway" }])).toBe(true);
    });
  });

  describe("whether the file can stand in for the clip", () => {
    it("holds a paid run to a real clip and lets the local fake path serve its own placeholder", () => {
      // The fake path writes placeholders deliberately; refusing them there would break a flow that has no
      // provider and nothing wrong with it.
      expect(isUsableClip(file(PLACEHOLDER_MP4.length), false)).toBe(true);
      expect(isUsableClip(file(PLACEHOLDER_MP4.length), true)).toBe(false);
      expect(isUsableClip(file(PLACEHOLDER_MP4.length + 1), true)).toBe(true);
    });

    it("refuses an empty file and anything that is not a file, whoever the run belongs to", () => {
      // A directory named scene1.mp4 stats fine and has a size; two of the call sites only destructured `size`
      // and would have passed it through to ffmpeg.
      expect(isUsableClip(file(0), false)).toBe(false);
      expect(isUsableClip({ isFile: () => false, size: 5_000 }, false)).toBe(false);
    });

    it("agrees with isPlaceholderClip about where the line is", () => {
      // One length, not two: the boundary is the placeholder's own size, so a change to those bytes moves both.
      expect(isPlaceholderClip(PLACEHOLDER_MP4.length)).toBe(true);
      expect(isUsableClip(file(PLACEHOLDER_MP4.length), true)).toBe(false);
    });
  });
});
