import { describe, expect, it } from "vitest";

import { safeUploadFilename } from "./upload-filename.js";

/** What Busboy hands over: a UTF-8 filename's bytes, read back as Latin-1. */
const asMultipart = (name: string) => Buffer.from(name, "utf8").toString("latin1");

/**
 * The one place an uploaded filename is repaired and checked, and it had no test of its own.
 *
 * It does two jobs that pull in opposite directions. It has to accept a Korean name — which arrives as mojibake,
 * with UTF-8 continuation bytes sitting exactly where C1 control characters live, so a checker that only
 * rejects control characters rejects every Korean filename and says nothing about why (CLI Round 429: an MP3
 * refused as "Audio filename is invalid"). And it has to refuse a name that would write somewhere it should
 * not.
 *
 * The narrowness is the part worth holding. A repair that fires too eagerly corrupts legitimate Latin-1 names
 * instead of fixing anything, and both halves would still look like they work.
 */
describe("an uploaded filename, repaired and checked", () => {
  it("recovers a Korean name from the Latin-1 view multipart hands over", () => {
    expect(safeUploadFilename(asMultipart("가을 배경.png"))).toBe("가을 배경.png");
    expect(safeUploadFilename(asMultipart("이배드_주제가.mp3"))).toBe("이배드_주제가.mp3");
  });

  it("leaves a name that is genuinely Latin-1 alone", () => {
    // "café.png" cannot tell the two apart — its Latin-1 bytes are not valid UTF-8, so the repair never fires
    // either way. "Ã©.png" can: those bytes *are* valid UTF-8 and decode to "é", so a repair that asks only
    // "is this valid UTF-8" rewrites a name nobody asked it to touch. The extra condition — the decoded text
    // is clearly non-Latin, or the Latin-1 view held C1 controls — is what holds it back, and this is the
    // only fixture here that fails when it is dropped.
    expect(safeUploadFilename("Ã©.png")).toBe("Ã©.png");
    expect(safeUploadFilename("café.png")).toBe("café.png");
    expect(safeUploadFilename("scene1.png")).toBe("scene1.png");
  });

  it("refuses anything that would write outside the directory it was handed to", () => {
    expect(safeUploadFilename("../escape.png")).toBeUndefined();
    expect(safeUploadFilename("a/b.png")).toBeUndefined();
    expect(safeUploadFilename("a\\b.png")).toBeUndefined();
    expect(safeUploadFilename("..")).toBeUndefined();
    expect(safeUploadFilename(".")).toBeUndefined();
  });

  it("refuses control characters, an empty name, and an absurd length", () => {
    expect(safeUploadFilename("")).toBeUndefined();
    expect(safeUploadFilename("bad\u0000name.png")).toBeUndefined();
    expect(safeUploadFilename("bad\u007fname.png")).toBeUndefined();
    // And the mirror: an ordinary interior space is a perfectly good filename. A checker tightened until
    // nothing suspicious gets through starts refusing what people actually name their files.
    expect(safeUploadFilename("가을 배경 2.png")).toBe("가을 배경 2.png");
    expect(safeUploadFilename(`${"a".repeat(256)}.png`)).toBeUndefined();
  });

  it("refuses a trailing dot or space, which Windows would strip after the index was written", () => {
    // The name on disk would stop matching the name in the index — the file is there and nothing can find it.
    expect(safeUploadFilename("scene1.png ")).toBeUndefined();
    expect(safeUploadFilename("scene1.png.")).toBeUndefined();
  });
});
