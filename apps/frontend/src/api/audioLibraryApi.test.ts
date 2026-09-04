import { AUDIO_LICENSE_KINDS } from "@ai-animation-studio/shared";
import { afterEach, describe, expect, it, vi } from "vitest";

import { audioTrackContentUrl, deleteAudioTrack, getAudioLibrary, toAudioLibraryDisplayError, uploadAudioTrack } from "./audioLibraryApi.js";
import { jsonResponse } from "./testUtils.js";

function track(overrides: Record<string, unknown> = {}) {
  return {
    trackId: "t1",
    title: "기록관의 밤",
    durationSeconds: 95,
    bytes: 2_400_000,
    source: "upload",
    licenseKind: "cc0",
    attributionRequired: false,
    addedAt: "2026-08-26T18:00:00.000Z",
    ...overrides,
  };
}

describe("audioLibraryApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists tracks via GET /audio/library", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { tracks: [track()] }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await getAudioLibrary();

    expect(fetchMock).toHaveBeenCalledWith("/audio/library", undefined);
    expect(response.tracks[0]?.trackId).toBe("t1");
  });

  // A duration drives the "does this cover the whole video" judgement. Rendering "-1:00" or "NaN:00" next to a
  // real length would make the reader distrust both numbers, so a bad one fails the response instead.
  /**
   * The licence guard used to be a second copy of AUDIO_LICENSE_KINDS. That constant exists precisely because a
   * union in the contract and a list in a reader is what once made a written value unreadable (Cowork Round 436)
   * — and this reader was the second copy again. Every kind the contract allows has to come back through.
   */
  it("accepts every licence kind the contract allows", async () => {
    for (const licenseKind of AUDIO_LICENSE_KINDS) {
      const tracks = [track({ licenseKind })];
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { tracks })));
      await expect(getAudioLibrary(), licenseKind).resolves.toMatchObject({ tracks });
    }
  });

  it("rejects a track whose duration or size is not a usable number", async () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, "95", null]) {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { tracks: [track({ durationSeconds: bad })] })));
      await expect(getAudioLibrary()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
    }
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { tracks: [track({ bytes: -5 })] })));
    await expect(getAudioLibrary()).rejects.toMatchObject({ code: "CLIENT_MALFORMED_RESPONSE" });
  });

  it("uploads as multipart and lets the browser own the boundary", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { track: track() }));
    vi.stubGlobal("fetch", fetchMock);

    await uploadAudioTrack(new File(["bytes"], "night.mp3", { type: "audio/mpeg" }), {
      title: "  기록관의 밤  ", artist: "", licenseKind: "cc-by", attributionRequired: true, attributionText: " Music by ○○○ ", sourceUrl: "",
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/audio/library/upload");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    // Setting content-type by hand drops the multipart boundary and the server cannot parse the parts.
    expect(init.headers).toBeUndefined();
    const form = init.body as FormData;
    // The part the server actually reads. This assertion is the whole reason the upload was broken and nobody
    // saw it: every other field was checked here, the file's own part name was not, and the server reads it by
    // name — so the file never arrived and the failure looked like a bad file rather than a wrong label.
    expect(form.get("audio")).toBeInstanceOf(File);
    expect(form.get("file")).toBeNull();
    expect(form.get("title")).toBe("기록관의 밤");
    // An empty optional field is left out rather than sent blank, so the server's own fallback applies.
    expect(form.get("artist")).toBeNull();
    // Required by the server and by the point of the field: where a track came from is only knowable while the
    // person still has the file in hand.
    expect(form.get("licenseKind")).toBe("cc-by");
    expect(form.get("attributionRequired")).toBe("true");
    expect(form.get("attributionText")).toBe("Music by ○○○");
  });

  it("maps a known backend code to a fixed message and never leaks the raw one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code: "AUDIO_FILE_INVALID", message: "raw backend detail" })));

    const caught = await uploadAudioTrack(new File(["x"], "big.wav"), { licenseKind: "self-made", attributionRequired: false })
      .catch((error: unknown) => error);
    const display = toAudioLibraryDisplayError(caught);

    expect(display.code).toBe("AUDIO_FILE_INVALID");
    expect(display.message).toContain("50MB");
    expect(display.message).not.toContain("raw backend detail");
    // Not a retry: the same file is refused the same way next time, so this must not read as transient.
    expect(display.message).not.toContain("잠시 후");
  });

  it("reports a network failure as its own code rather than as a server answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const caught = await getAudioLibrary().catch((error: unknown) => error);
    expect(toAudioLibraryDisplayError(caught).code).toBe("CLIENT_NETWORK_ERROR");
  });

  it("deletes a track via DELETE and returns which one went", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { trackId: "t1" }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await deleteAudioTrack("t1");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/audio/library/t1");
    expect(init.method).toBe("DELETE");
    expect(response.trackId).toBe("t1");
  });

  it("builds a playback URL without fetching anything", () => {
    expect(audioTrackContentUrl("t 1")).toBe("/audio/library/t%201/content");
  });
});
