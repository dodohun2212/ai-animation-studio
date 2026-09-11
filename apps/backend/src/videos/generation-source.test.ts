import { describe, expect, it } from "vitest";

import { generationSourceOfVideoRecords, hasLocalFakeVideoRecord, storedGenerationSource } from "./generation-source.js";

/**
 * The pair for the reader three call sites now share.
 *
 * What it is really guarding is the asymmetry: "paid" needs every record to say so, while a single placeholder
 * is enough to make the whole merge one — because the merged file contains that clip. Everything else is
 * `unknown_legacy`, which means "no evidence", and no-evidence must never be read as paid. The publish gate is
 * built on that, and publishing is the one action in this app that cannot be walked back.
 */
const paid = (scene: number) => ({ scene_number: scene, job_id: "job", status: "succeeded", execution_mode: "runway" });
const placeholder = (scene: number) => ({ ...paid(scene), execution_mode: "local_fake_no_provider" });

describe("the origin of a final video, read off the records that produced it", () => {
  it("calls a run paid only when every record says so", () => {
    expect(generationSourceOfVideoRecords([paid(1), paid(2), paid(3)])).toBe("paid_provider");
  });

  it("calls the whole thing a placeholder when any single clip is one", () => {
    expect(generationSourceOfVideoRecords([paid(1), placeholder(2), paid(3)])).toBe("local_fake_no_provider");
  });

  it("does not treat missing evidence as paid", () => {
    // Each of these is a way the records can fail to prove anything: never written, written by an older build,
    // or written by a future one that learned a third mode this build has never heard of.
    expect(generationSourceOfVideoRecords([])).toBe("unknown_legacy");
    expect(generationSourceOfVideoRecords(undefined)).toBe("unknown_legacy");
    expect(generationSourceOfVideoRecords("not an array")).toBe("unknown_legacy");
    expect(generationSourceOfVideoRecords([{ scene_number: 1 }])).toBe("unknown_legacy");
    expect(generationSourceOfVideoRecords([paid(1), { ...paid(2), execution_mode: "some_future_provider" }])).toBe("unknown_legacy");
    expect(generationSourceOfVideoRecords([null, 7])).toBe("unknown_legacy");
  });

  it("answers the publish gate's narrower question without going through the classification", () => {
    // A future third mode must not be able to turn a mixed job into something publishable, which is why the
    // gate asks "is a placeholder in there" rather than "is this not paid".
    expect(hasLocalFakeVideoRecord([paid(1), placeholder(2)])).toBe(true);
    expect(hasLocalFakeVideoRecord([paid(1), { ...paid(2), execution_mode: "some_future_provider" }])).toBe(false);
    expect(hasLocalFakeVideoRecord([paid(1), paid(2)])).toBe(false);
    expect(hasLocalFakeVideoRecord(undefined)).toBe(false);
    expect(hasLocalFakeVideoRecord([])).toBe(false);
  });

  it("narrows what an Episode file claims about itself, defaulting to no evidence", () => {
    expect(storedGenerationSource("paid_provider")).toBe("paid_provider");
    expect(storedGenerationSource("local_fake_no_provider")).toBe("local_fake_no_provider");
    expect(storedGenerationSource("unknown_legacy")).toBe("unknown_legacy");
    expect(storedGenerationSource(undefined)).toBe("unknown_legacy");
    expect(storedGenerationSource("paid")).toBe("unknown_legacy");
    expect(storedGenerationSource({ execution_mode: "runway" })).toBe("unknown_legacy");
  });
});
