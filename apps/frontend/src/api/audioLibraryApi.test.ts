import { afterEach, describe, expect, it, vi } from "vitest";

import { audioTrackContentUrl, getAudioLibrary, toAudioLibraryDisplayError, uploadAudioTrack } from "./audioLibraryApi.js";
import { jsonResponse } from "./testUtils.js";

function track(overrides: Record<string, unknown> = {}) {
  return {
    trackId: "t1",
    title: "기록관의 밤",
    durationSeconds: 95,
    bytes: 2_400_000,
    source: "upload",
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

    await uploadAudioTrack(new File(["bytes"], "night.mp3", { type: "audio/mpeg" }), { title: "  기록관의 밤  ", artist: "" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/audio/library/upload");
    expect(init.method).toBe("POST");
    expect(init.body).toBeInstanceOf(FormData);
    // Setting content-type by hand drops the multipart boundary and the server cannot parse the parts.
    expect(init.headers).toBeUndefined();
    const form = init.body as FormData;
    expect(form.get("title")).toBe("기록관의 밤");
    // An empty optional field is left out rather than sent blank, so the server's own fallback applies.
    expect(form.get("artist")).toBeNull();
  });

  it("maps a known backend code to a fixed message and never leaks the raw one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(413, { code: "AUDIO_FILE_TOO_LARGE", message: "raw backend detail" })));

    const caught = await uploadAudioTrack(new File(["x"], "big.wav")).catch((error: unknown) => error);
    const display = toAudioLibraryDisplayError(caught);

    expect(display.code).toBe("AUDIO_FILE_TOO_LARGE");
    expect(display.message).toContain("50MB");
    expect(display.message).not.toContain("raw backend detail");
  });

  it("reports a network failure as its own code rather than as a server answer", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const caught = await getAudioLibrary().catch((error: unknown) => error);
    expect(toAudioLibraryDisplayError(caught).code).toBe("CLIENT_NETWORK_ERROR");
  });

  it("builds a playback URL without fetching anything", () => {
    expect(audioTrackContentUrl("t 1")).toBe("/audio/library/t%201/content");
  });
});
