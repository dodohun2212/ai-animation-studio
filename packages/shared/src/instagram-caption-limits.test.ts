import { describe, expect, it } from "vitest";

import { instagramHashtagCount, INSTAGRAM_CAPTION_MAX, INSTAGRAM_HASHTAG_MAX } from "./domain.js";

/**
 * The two ceilings on a caption, and one way of counting the second.
 *
 * The publish service's own comment says why it checks the first at all: so a caller that skips the screen
 * cannot get a post rejected after the upload already happened. It held that up with a number of its own while
 * the screen held up another. The second ceiling was on the screen alone, so the case that comment describes
 * was open — the media goes up, and Instagram refuses the publish at the end.
 */
describe("Instagram's caption ceilings", () => {
  it("counts a tag wherever it sits in the caption, not only in the field it was typed into", () => {
    // The screen counted its own hashtag field. A tag written into the body counts against the same limit, so
    // that screen could show 29 for a caption Instagram reads as 31 — and the server, counting nothing, agreed.
    expect(instagramHashtagCount("가을이 왔다 #가을\n\n#fall2026 #ai_video")).toBe(3);
  });

  it("does not count a bare hash", () => {
    // "10 # 20" is arithmetic, not a tag, and refusing a caption over a character that starts no tag would be a
    // refusal a person cannot act on.
    expect(instagramHashtagCount("10 # 20 #")).toBe(0);
  });

  it("counts Korean tags, which are the ordinary case here", () => {
    // A counter that only recognised ASCII would report 0 for every caption this app actually writes and let a
    // caption past both checks with any number of tags in it.
    expect(instagramHashtagCount("#이배드 #기억도시 #단편애니")).toBe(3);
  });

  it("states the limits Instagram states", () => {
    expect(INSTAGRAM_CAPTION_MAX).toBe(2_200);
    expect(INSTAGRAM_HASHTAG_MAX).toBe(30);
  });
});
