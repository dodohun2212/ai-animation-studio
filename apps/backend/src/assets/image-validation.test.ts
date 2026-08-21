import { describe, expect, it } from "vitest";
import { normalizeUploadFilename, validateImage } from "./image-validation.js";

const png = () => {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlSAAAAAASUVORK5CYII=", "base64");
};

describe("validateImage", () => {
  it("accepts PNG bytes and returns a SHA-256 digest", () => {
    expect(validateImage(png(), "한글_참고이미지.png", "image/png").digest).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each(["photo.exe", "photo.jpg", "../photo.png"])("rejects mismatched or unsafe image input %s", (name) => {
    expect(() => validateImage(png(), name)).toThrow();
  });
  it("rejects oversized input", () => expect(() => validateImage(Buffer.alloc(25 * 1024 * 1024 + 1), "large.png")).toThrow());
  it("rejects invalid dimensions and MIME mismatch", () => {
    const zero = png(); zero.writeUInt32BE(0, 16);
    const huge = png(); huge.writeUInt32BE(50_000, 16); huge.writeUInt32BE(50_000, 20);
    expect(() => validateImage(zero, "zero.png", "image/png")).toThrow();
    expect(() => validateImage(huge, "huge.png", "image/png")).toThrow();
    expect(() => validateImage(png(), "image.png", "image/jpeg")).toThrow();
  });
  it("rejects truncated chunks and PNG files without IDAT/IEND", () => {
    const truncated = png().subarray(0, 60);
    const noIdat = Buffer.concat([png().subarray(0, 33), png().subarray(56)]);
    expect(() => validateImage(truncated, "truncated.png", "image/png")).toThrow();
    expect(() => validateImage(noIdat, "no-idat.png", "image/png")).toThrow();
  });
  it("parses bounded JPEG and extended WebP dimensions structurally", () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 11, 8, 0, 3, 0, 2, 1, 1, 0x11, 0, 0xff, 0xd9]);
    const webp = Buffer.alloc(30); webp.write("RIFF", 0, "ascii"); webp.writeUInt32LE(22, 4); webp.write("WEBP", 8, "ascii");
    webp.write("VP8X", 12, "ascii"); webp.writeUInt32LE(10, 16); webp.writeUIntLE(1, 24, 3); webp.writeUIntLE(2, 27, 3);
    expect(validateImage(jpeg, "사진.jpeg", "image/jpeg").extension).toBe(".jpeg");
    expect(validateImage(webp, "참고.webp", "image/webp").extension).toBe(".webp");
    jpeg[5] = 100;
    expect(() => validateImage(jpeg, "손상.jpg", "image/jpeg")).toThrow();
  });
});

describe("normalizeUploadFilename", () => {
  it("recovers exact Korean UTF-8 bytes interpreted as Latin-1", () => {
    const mojibake = Buffer.from("검증고양이.png", "utf8").toString("latin1");
    expect(normalizeUploadFilename(mojibake)).toBe("검증고양이.png");
  });
  it.each(["cat.png", "café.png", "cafÃ©.png"])("preserves legitimate ASCII/Latin filename %s", (filename) => {
    expect(normalizeUploadFilename(filename)).toBe(filename);
  });
  it("preserves malformed non-UTF bytes without introducing replacement characters", () => {
    const malformed = `${String.fromCharCode(0xc3)}(.png`;
    const normalized = normalizeUploadFilename(malformed);
    expect(normalized).toBe(malformed);
    expect(normalized).not.toContain("\uFFFD");
  });
  it.each([
    "../escape.png", "folder\\escape.png", "control\n.png",
    Buffer.from("검증/escape.png", "utf8").toString("latin1"),
    Buffer.from("\u0080escape.png", "utf8").toString("latin1"),
  ])("rejects traversal/control before or after decoding", (filename) => {
    expect(() => normalizeUploadFilename(filename)).toThrow();
  });
});
