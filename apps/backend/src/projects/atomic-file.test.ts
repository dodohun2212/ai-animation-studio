import * as fsPromises from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { atomicWriteUtf8File, type AtomicWriteDeps } from "./atomic-file.js";

describe("atomicWriteUtf8File", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await fsPromises.mkdtemp(path.join(os.tmpdir(), "atomic-file-test-"));
  });

  afterEach(async () => {
    await fsPromises.rm(directory, { recursive: true, force: true });
  });

  it("writes content and leaves only the final file behind", async () => {
    const finalPath = path.join(directory, "project.json");
    await atomicWriteUtf8File(finalPath, '{"a":1}');

    expect(await fsPromises.readFile(finalPath, "utf8")).toBe('{"a":1}');
    const entries = await fsPromises.readdir(directory);
    expect(entries).toEqual(["project.json"]);
  });

  it("retries a bounded number of times on a transient lock error, then succeeds", async () => {
    const finalPath = path.join(directory, "project.json");
    let attempts = 0;
    const deps: AtomicWriteDeps = {
      writeFile: fsPromises.writeFile,
      unlink: fsPromises.unlink,
      rename: vi.fn(async (from, to) => {
        attempts += 1;
        if (attempts < 3) {
          const error = new Error("locked") as NodeJS.ErrnoException;
          error.code = "EBUSY";
          throw error;
        }
        await fsPromises.rename(from, to);
      }) as unknown as typeof fsPromises.rename,
    };

    await atomicWriteUtf8File(finalPath, '{"a":1}', deps);

    expect(attempts).toBe(3);
    expect(await fsPromises.readFile(finalPath, "utf8")).toBe('{"a":1}');
  });

  it("gives up after the bounded retry limit and removes the temp file, leaving no partial final file", async () => {
    const finalPath = path.join(directory, "project.json");
    const rename = vi.fn(async () => {
      const error = new Error("locked") as NodeJS.ErrnoException;
      error.code = "EBUSY";
      throw error;
    });
    const deps: AtomicWriteDeps = {
      writeFile: fsPromises.writeFile,
      unlink: fsPromises.unlink,
      rename: rename as unknown as typeof fsPromises.rename,
    };

    await expect(atomicWriteUtf8File(finalPath, '{"a":1}', deps)).rejects.toThrow();

    expect(rename).toHaveBeenCalledTimes(3);
    await expect(fsPromises.access(finalPath)).rejects.toThrow();
    expect(await fsPromises.readdir(directory)).toEqual([]);
  });

  it("does not retry a non-retryable error and still cleans up the temp file", async () => {
    const finalPath = path.join(directory, "project.json");
    const rename = vi.fn(async () => {
      const error = new Error("nope") as NodeJS.ErrnoException;
      error.code = "ENOSPC";
      throw error;
    });
    const deps: AtomicWriteDeps = {
      writeFile: fsPromises.writeFile,
      unlink: fsPromises.unlink,
      rename: rename as unknown as typeof fsPromises.rename,
    };

    await expect(atomicWriteUtf8File(finalPath, '{"a":1}', deps)).rejects.toThrow();

    expect(rename).toHaveBeenCalledTimes(1);
    expect(await fsPromises.readdir(directory)).toEqual([]);
  });

  it("cleans up a partially written temp file when writeFile itself fails mid-write", async () => {
    const finalPath = path.join(directory, "project.json");
    const writeFile = vi.fn(async (tempPath: unknown, content: unknown, encoding: unknown) => {
      // Simulate a writer that manages to flush some bytes to disk before failing.
      await fsPromises.writeFile(tempPath as string, content as string, encoding as BufferEncoding);
      const error = new Error("disk full mid-write") as NodeJS.ErrnoException;
      error.code = "ENOSPC";
      throw error;
    });
    const rename = vi.fn(fsPromises.rename);
    const deps: AtomicWriteDeps = {
      writeFile: writeFile as unknown as typeof fsPromises.writeFile,
      unlink: fsPromises.unlink,
      rename: rename as unknown as typeof fsPromises.rename,
    };

    await expect(atomicWriteUtf8File(finalPath, '{"a":1}', deps)).rejects.toThrow("disk full mid-write");

    expect(rename).not.toHaveBeenCalled();
    await expect(fsPromises.access(finalPath)).rejects.toThrow();
    expect(await fsPromises.readdir(directory)).toEqual([]);
  });

  it("never removes a successfully written final file", async () => {
    const finalPath = path.join(directory, "project.json");
    await atomicWriteUtf8File(finalPath, '{"a":1}');

    // A second, independent write to a different file must not disturb the first.
    const otherFinalPath = path.join(directory, "other.json");
    await atomicWriteUtf8File(otherFinalPath, '{"b":2}');

    expect(await fsPromises.readFile(finalPath, "utf8")).toBe('{"a":1}');
    expect(await fsPromises.readFile(otherFinalPath, "utf8")).toBe('{"b":2}');
    expect((await fsPromises.readdir(directory)).sort()).toEqual(["other.json", "project.json"]);
  });
});
