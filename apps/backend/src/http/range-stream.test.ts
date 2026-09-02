import { describe, expect, it } from "vitest";

import { parseByteRange } from "./range-stream.js";

describe("parseByteRange", () => {
  it("asks for the whole file when nothing was requested", () => {
    expect(parseByteRange(undefined, 100)).toBeUndefined();
    expect(parseByteRange("", 100)).toBeUndefined();
  });

  it("reads a closed range", () => {
    expect(parseByteRange("bytes=100-200", 1000)).toEqual({ start: 100, end: 200 });
  });

  it("reads an open range as everything from here to the end — what a player sends to seek", () => {
    expect(parseByteRange("bytes=500-", 1000)).toEqual({ start: 500, end: 999 });
  });

  it("clamps an end past the file instead of refusing it, per RFC 7233", () => {
    expect(parseByteRange("bytes=900-5000", 1000)).toEqual({ start: 900, end: 999 });
  });

  it("reads a suffix range as the last N bytes, and a too-long suffix as the whole file", () => {
    expect(parseByteRange("bytes=-200", 1000)).toEqual({ start: 800, end: 999 });
    expect(parseByteRange("bytes=-5000", 1000)).toEqual({ start: 0, end: 999 });
  });

  // Ignoring is the safe direction: the full body answers the question correctly, a guessed partial does not.
  it("ignores a range it does not serve rather than guessing at one", () => {
    expect(parseByteRange("bytes=0-10,20-30", 1000)).toBeUndefined();
    expect(parseByteRange("items=0-10", 1000)).toBeUndefined();
    expect(parseByteRange("bytes=abc-def", 1000)).toBeUndefined();
    expect(parseByteRange("bytes=-", 1000)).toBeUndefined();
    expect(parseByteRange(["bytes=0-1"], 1000)).toBeUndefined();
  });

  // The one case that must not come back with bytes in it.
  it("refuses a first byte at or past the end, and any range into an empty file", () => {
    expect(parseByteRange("bytes=1000-1010", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=500-100", 1000)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=0-10", 0)).toBe("unsatisfiable");
    expect(parseByteRange("bytes=-0", 1000)).toBe("unsatisfiable");
  });
});
