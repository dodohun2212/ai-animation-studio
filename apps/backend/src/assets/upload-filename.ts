import * as path from "node:path";

/**
 * One multipart filename, repaired and checked - or `undefined` when it is not a usable filename.
 *
 * Busboy/Multer exposes RFC multipart filename bytes as Latin-1, so every non-ASCII name arrives as mojibake:
 * a Korean name's UTF-8 continuation bytes land in U+0080-U+009F, which is also where C1 control characters
 * live. A checker that only rejects control characters therefore rejects every Korean filename, and says
 * nothing about why. The repair below is the one the Asset Library has always done; the BGM library was written
 * with its own copy that had the check and not the repair, under a comment saying audio had no need for one.
 * Measured over HTTP: an MP3 named in Korean was refused as "Audio filename is invalid" (CLI Round 429).
 *
 * The repair is deliberately narrow. It fires only when every code point fits in a byte (so the string really is
 * a Latin-1 view of bytes), the bytes are exact UTF-8, and the decoded result is either clearly non-Latin or the
 * Latin-1 view held C1 controls. A legitimate ASCII or Latin-1 name never matches all three and is returned
 * untouched.
 *
 * Returns rather than throws because the two libraries owe the caller different codes for the same verdict: an
 * image upload and an audio upload are refused by different routes with different vocabularies.
 */
export function safeUploadFilename(value: string): string | undefined {
  let normalized = value;
  if ([...value].every((character) => character.codePointAt(0)! <= 0xff)) {
    const bytes = Buffer.from(value, "latin1");
    const decoded = bytes.toString("utf8");
    const exactUtf8 = !decoded.includes("\uFFFD") && Buffer.from(decoded, "utf8").equals(bytes);
    const clearlyEncoded = [...decoded].some((character) => character.codePointAt(0)! > 0x024f)
      || /[\u0080-\u009f]/u.test(value);
    if (exactUtf8 && clearlyEncoded) normalized = decoded;
  }
  // No path separators, no traversal, no control characters, not empty, not absurdly long, and no trailing dot
  // or space (Windows strips those silently, so the name on disk would stop matching the name in the index).
  if (!normalized || normalized.length > 255 || path.basename(normalized) !== normalized
    || normalized === "." || normalized === ".." || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
    || /[. ]$/u.test(normalized)) return undefined;
  return normalized;
}
