import { describe, expect, it } from "vitest";

import { isSha256Hex } from "./domain.js";

/**
 * The shape of a digest, checked in one place instead of nine.
 *
 * Every caller is a gate on an identifier that arrived from disk or off the wire — a mapping's script
 * fingerprint, a stored snapshot's hash, a prompt's original digest. The way this check goes wrong is quiet:
 * drop the anchors from one copy and it starts accepting a digest with anything appended, which turns a
 * fingerprint comparison into one that can no longer fail.
 */
describe("what counts as a SHA-256 digest here", () => {
  const digest = "a".repeat(64);

  it("accepts exactly 64 lowercase hex characters", () => {
    expect(isSha256Hex(digest)).toBe(true);
    expect(isSha256Hex("0123456789abcdef".repeat(4))).toBe(true);
  });

  it("is anchored at both ends, so nothing may ride along with a digest", () => {
    // The failure an unanchored copy produces: a fingerprint that still matches its prefix and never reports a
    // mismatch again.
    expect(isSha256Hex(`${digest}extra`)).toBe(false);
    expect(isSha256Hex(` ${digest}`)).toBe(false);
    expect(isSha256Hex(`${digest}\n`)).toBe(false);
  });

  it("refuses a digest of the wrong length or the wrong case", () => {
    // Uppercase is refused rather than folded: this app writes its digests lowercase, and accepting both would
    // make two spellings of the same hash compare unequal wherever the comparison is a plain string one.
    expect(isSha256Hex("a".repeat(63))).toBe(false);
    expect(isSha256Hex("a".repeat(65))).toBe(false);
    expect(isSha256Hex("A".repeat(64))).toBe(false);
  });

  it("answers false for anything that is not a string, rather than throwing", () => {
    // Every caller hands it unparsed input, so a non-string is an ordinary answer here, not an error.
    expect(isSha256Hex(undefined)).toBe(false);
    expect(isSha256Hex(null)).toBe(false);
    expect(isSha256Hex(64)).toBe(false);
  });
});
