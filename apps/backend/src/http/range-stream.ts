import * as fs from "node:fs/promises";
import { HttpException, StreamableFile } from "@nestjs/common";

/** Only what this helper reads off the request, so a test can hand it a plain object and a controller can pass Express's. */
export interface RangeRequest { headers: Record<string, string | string[] | undefined> }
/** Only what this helper writes. `status` is needed for 206 and 416, which Nest's passthrough mode leaves to the handler. */
export interface RangeResponse {
  type(value: string): void;
  setHeader(name: string, value: string): void;
  status(code: number): unknown;
}

export type ByteRange = { start: number; end: number };

/**
 * What `Range: bytes=...` asks for, against a file of a known size.
 *
 * `undefined` means "send the whole thing" - that covers no header at all and also a header this app does not
 * serve (multiple ranges, a unit other than bytes, or syntax it cannot parse). RFC 7233 allows ignoring a Range
 * it does not understand, and answering the full body is always correct where a partial answer is not.
 * `"unsatisfiable"` is the one case that must not be answered with bytes: a first byte at or past the end of the
 * file, which is 416.
 */
export function parseByteRange(header: unknown, size: number): ByteRange | undefined | "unsatisfiable" {
  if (typeof header !== "string") return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return undefined;
  const [, rawStart, rawEnd] = match;
  if (rawStart === "" && rawEnd === "") return undefined;
  if (size === 0) return "unsatisfiable";
  if (rawStart === "") {
    // A suffix range: the last N bytes. Asking for more than the file has is legal and means the whole file.
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    return { start: Math.max(0, size - suffix), end: size - 1 };
  }
  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return "unsatisfiable";
  const end = rawEnd === "" ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return "unsatisfiable";
  return { start, end };
}

/**
 * Streams one stored file, honouring `Range`.
 *
 * Twelve routes had a copy of this and not one of them sent `Accept-Ranges` or read `Range`, so every player in
 * the app could start a file and never move inside it: audio previews, scene videos, the final Reel. The
 * publish screen's "use this frame as the cover" reads `element.currentTime`, which means choosing a moment -
 * and there was no way to choose one (Cowork Rounds 430/431; 캡틴D asked for it directly on the publish screen).
 * A player is told seeking is possible by `Accept-Ranges` alone; without it the browser has no way to ask, so
 * this was a missing header rather than a missing player feature.
 *
 * One implementation for all twelve, because the defect was twelve copies agreeing: fixing the audio route
 * alone would have left video review - the screen this app exists to get through - exactly as stuck.
 *
 * `unavailable` stays per-route: each library refuses a missing file in its own vocabulary, and collapsing those
 * into one code would tell the screen less than it knows now.
 */
export async function streamStoredFile(options: {
  path: string;
  contentType: string;
  /** Sent as `Content-Disposition: inline; filename="..."` when given. */
  filename?: string;
  request: RangeRequest;
  response: RangeResponse;
  unavailable: () => HttpException;
}): Promise<StreamableFile> {
  const { path, contentType, filename, request, response, unavailable } = options;
  let handle: fs.FileHandle;
  try {
    handle = await fs.open(path, "r");
  } catch {
    throw unavailable();
  }
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw unavailable();
    response.type(contentType);
    if (filename) response.setHeader("Content-Disposition", `inline; filename="${filename}"`);
    response.setHeader("X-Content-Type-Options", "nosniff");
    // Said on every response, including the 200: it is how a player learns it may ask for a range at all.
    response.setHeader("Accept-Ranges", "bytes");

    const range = parseByteRange(request.headers.range, stat.size);
    if (range === "unsatisfiable") {
      response.setHeader("Content-Range", `bytes */${stat.size}`);
      response.setHeader("Content-Length", "0");
      response.status(416);
      await handle.close();
      return new StreamableFile(Buffer.alloc(0));
    }
    if (range) {
      response.setHeader("Content-Range", `bytes ${range.start}-${range.end}/${stat.size}`);
      response.setHeader("Content-Length", String(range.end - range.start + 1));
      response.status(206);
      return new StreamableFile(handle.createReadStream({ start: range.start, end: range.end }));
    }
    response.setHeader("Content-Length", String(stat.size));
    return new StreamableFile(handle.createReadStream());
  } catch (error) {
    await handle.close().catch(() => undefined);
    if (error instanceof HttpException) throw error;
    throw unavailable();
  }
}
