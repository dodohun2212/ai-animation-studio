import * as crypto from "node:crypto";
import * as path from "node:path";
import { invalidAssetFile } from "./asset-api.error.js";

const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PIXELS = 40_000_000;
export interface ValidatedImage { digest: string; extension: ".png" | ".jpg" | ".jpeg" | ".webp"; originalFilename: string }

/**
 * Busboy/Multer commonly exposes RFC multipart filename bytes as Latin-1.
 * Recover UTF-8 only when the byte sequence is exact UTF-8 and the result is
 * clearly non-Latin (or the Latin-1 view contains C1 controls). This repairs
 * Korean/CJK/emoji mojibake without changing legitimate ASCII/Latin names.
 */
export function normalizeUploadFilename(value: string): string {
  let normalized = value;
  if ([...value].every((character) => character.codePointAt(0)! <= 0xff)) {
    const bytes = Buffer.from(value, "latin1");
    const decoded = bytes.toString("utf8");
    const exactUtf8 = !decoded.includes("\uFFFD") && Buffer.from(decoded, "utf8").equals(bytes);
    const clearlyEncoded = [...decoded].some((character) => character.codePointAt(0)! > 0x024f)
      || /[\u0080-\u009f]/u.test(value);
    if (exactUtf8 && clearlyEncoded) normalized = decoded;
  }
  if (!normalized || normalized.length > 255 || path.basename(normalized) !== normalized
    || normalized === "." || normalized === ".." || /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
    || /[. ]$/u.test(normalized)) throw invalidAssetFile("Image filename is invalid.");
  return normalized;
}

function pngDimensions(bytes: Buffer): [number, number] | null {
  if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return null;
  let offset = 8; let dimensions: [number, number] | null = null; let sawIdat = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset); const end = offset + 12 + length;
    if (end > bytes.length) return null;
    const type = bytes.subarray(offset + 4, offset + 8).toString("ascii");
    if (dimensions === null) {
      if (type !== "IHDR" || length !== 13) return null;
      dimensions = [bytes.readUInt32BE(offset + 8), bytes.readUInt32BE(offset + 12)];
    } else if (type === "IHDR") return null;
    if (type === "IDAT") sawIdat = true;
    if (type === "IEND") return length === 0 && sawIdat && end === bytes.length ? dimensions : null;
    offset = end;
  }
  return null;
}

function jpegDimensions(bytes: Buffer): [number, number] | null {
  if (bytes.length < 12 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) return null;
  let position = 2;
  while (position + 4 <= bytes.length - 2) {
    if (bytes[position] !== 0xff) { position += 1; continue; }
    while (bytes[position] === 0xff) position += 1;
    const marker = bytes[position++]!;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda || position + 2 > bytes.length) break;
    const length = bytes.readUInt16BE(position);
    if (length < 2 || position + length > bytes.length) return null;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return null;
      return [bytes.readUInt16BE(position + 5), bytes.readUInt16BE(position + 3)];
    }
    position += length;
  }
  return null;
}

function webpDimensions(bytes: Buffer): [number, number] | null {
  if (bytes.length < 30 || bytes.subarray(0, 4).toString("ascii") !== "RIFF" || bytes.subarray(8, 12).toString("ascii") !== "WEBP"
    || bytes.readUInt32LE(4) + 8 > bytes.length) return null;
  const kind = bytes.subarray(12, 16).toString("ascii");
  if (kind === "VP8X") return [1 + bytes.readUIntLE(24, 3), 1 + bytes.readUIntLE(27, 3)];
  if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return [bytes.readUInt16LE(26) & 0x3fff, bytes.readUInt16LE(28) & 0x3fff];
  }
  if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    return [1 + bytes[21]! + ((bytes[22]! & 0x3f) << 8), 1 + (bytes[22]! >> 6) + (bytes[23]! << 2) + ((bytes[24]! & 0x0f) << 10)];
  }
  return null;
}

export function validateImage(bytes: Buffer, filename: string, mimeType?: string): ValidatedImage {
  const originalFilename = normalizeUploadFilename(filename);
  if (bytes.length <= 16 || bytes.length > MAX_BYTES) throw invalidAssetFile(bytes.length > MAX_BYTES ? "Image file exceeds 25 MB." : undefined);
  const extension = path.extname(originalFilename).toLowerCase();
  const expectedMime = extension === ".png" ? "image/png" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "";
  const normalizedMime = mimeType?.trim().toLowerCase() ?? "";
  if (!expectedMime || (normalizedMime && normalizedMime !== "application/octet-stream" && normalizedMime !== expectedMime)) throw invalidAssetFile("Image MIME type or extension is unsupported.");
  const dimensions = extension === ".png" ? pngDimensions(bytes) : extension === ".webp" ? webpDimensions(bytes) : jpegDimensions(bytes);
  if (!dimensions) throw invalidAssetFile("Image cannot be decoded or its structure is invalid.");
  if (dimensions[0] <= 0 || dimensions[1] <= 0 || dimensions[0] * dimensions[1] > MAX_PIXELS) throw invalidAssetFile("Image dimensions are invalid.");
  return { digest: crypto.createHash("sha256").update(bytes).digest("hex"), extension: extension as ValidatedImage["extension"], originalFilename };
}
