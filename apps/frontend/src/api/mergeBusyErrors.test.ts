import { describe, expect, it } from "vitest";

import { InstagramPublishApiError, toInstagramPublishDisplayError } from "./instagramPublishApi.js";
import { LongProjectsApiError, toLongProjectDisplayError } from "./longProjectsApi.js";
import { toVideoMergeDisplayError, VideoMergeApiError } from "./videoMergeApi.js";

/**
 * Three refusals that mean "wait", and must not read like "it broke".
 *
 * They exist because a photo card can be merged again, which put a publish reading the final video and a merge
 * rewriting it in reach of each other — one could have posted the previous cut while the disk held the new one,
 * on the only action in this app that cannot be undone (CLI Round 449 took the lock and added these). Nothing
 * is wrong when they arrive and nothing needs fixing: the same press works a moment later.
 */
describe("busy refusals", () => {
  it("tells the person to wait rather than that something failed", () => {
    const merge = toVideoMergeDisplayError(new VideoMergeApiError("VIDEO_MERGE_BUSY", "raw"));
    expect(merge.code).toBe("VIDEO_MERGE_BUSY");
    expect(merge.message).toContain("잠시 뒤");
    expect(merge.message).not.toContain("실패");
  });

  /**
   * Deliberately not INSTAGRAM_VIDEO_UNAVAILABLE's sentence.
   *
   * That one says "영상을 먼저 합쳐 주세요" — which, here, would tell someone to start the job that is already
   * running. Two codes, two sentences, because the move each asks for is different.
   */
  it("does not tell someone to start the render that is already running", () => {
    const rendering = toInstagramPublishDisplayError(new InstagramPublishApiError("INSTAGRAM_VIDEO_RENDERING", "raw"));
    const missing = toInstagramPublishDisplayError(new InstagramPublishApiError("INSTAGRAM_VIDEO_UNAVAILABLE", "raw"));
    expect(rendering.message).not.toBe(missing.message);
    expect(rendering.message).not.toContain("합쳐");
    expect(rendering.message).toContain("끝나면");
  });

  /**
   * The one refusal that has to carry a number.
   *
   * "그 숫자는 안 됩니다" leaves someone guessing which second would have worked. The server sends the track's
   * real length in `details` so the screen can say how long the song is instead (CLI Round 457) — and the same
   * code covers both merge routes, so both screens have to say the same sentence.
   */
  it("says how long the track actually is when the start point is past its end", () => {
    const short = toVideoMergeDisplayError(new VideoMergeApiError("AUDIO_START_OUT_OF_RANGE", "raw", { durationSeconds: 128.4 }));
    const episode = toLongProjectDisplayError(new LongProjectsApiError("AUDIO_START_OUT_OF_RANGE", "raw", { durationSeconds: 128.4 }));

    expect(short.message).toContain("2분 8초");
    expect(episode.message).toBe(short.message);
  });

  // A malformed or missing length must not print "NaN분" at someone. The sentence drops the number instead and
  // still names the move that works.
  it("drops the number rather than printing a broken one", () => {
    const message = toVideoMergeDisplayError(new VideoMergeApiError("AUDIO_START_OUT_OF_RANGE", "raw")).message;
    expect(message).not.toContain("NaN");
    expect(message).toContain("앞쪽");
  });

  // The fallback is what these messages exist to avoid: "잠시 후 다시 시도해 주세요" says nothing about which
  // of the two waits this is, and a code that falls through to it has effectively not been handled.
  it("gives each code its own message instead of the generic fallback", () => {
    const genericMerge = toVideoMergeDisplayError(new Error("unmapped"));
    const genericPublish = toInstagramPublishDisplayError(new Error("unmapped"));
    expect(toVideoMergeDisplayError(new VideoMergeApiError("VIDEO_MERGE_BUSY", "raw")).message).not.toBe(genericMerge.message);
    expect(toInstagramPublishDisplayError(new InstagramPublishApiError("INSTAGRAM_VIDEO_RENDERING", "raw")).message).not.toBe(genericPublish.message);
  });
});
