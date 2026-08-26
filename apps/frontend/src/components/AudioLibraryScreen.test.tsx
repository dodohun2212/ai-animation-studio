import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { AudioLibraryScreen } from "./AudioLibraryScreen.js";

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

function renderScreen(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", fetchMock);
  return render(<AudioLibraryScreen onBack={() => {}} />);
}

describe("AudioLibraryScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("lists tracks with length and size", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { tracks: [track()] })));

    const row = await screen.findByTestId("audio-track-t1");
    expect(row.textContent).toContain("기록관의 밤");
    expect(row.textContent).toContain("1:35");
  });

  // Music is baked into a file the user then publishes, so the responsibility is theirs and it has to be said
  // here — not discovered after a reel is muted.
  it("states up front that the uploader is responsible for the rights", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { tracks: [] })));

    const notice = await screen.findByTestId("audio-license-notice");
    expect(notice.textContent).toContain("사용 권한");
    expect(notice.textContent).toContain("출처");
  });

  it("uploads the picked file as multipart and refreshes the list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { tracks: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { track: track() }))
      .mockResolvedValueOnce(jsonResponse(200, { tracks: [track()] }));
    renderScreen(fetchMock);

    await screen.findByTestId("audio-library-empty");
    const file = new File(["bytes"], "night.mp3", { type: "audio/mpeg" });
    fireEvent.change(screen.getByTestId("audio-file-input"), { target: { files: [file] } });
    fireEvent.change(screen.getByTestId("audio-title-input"), { target: { value: "기록관의 밤" } });
    fireEvent.click(screen.getByTestId("audio-upload-button"));

    await screen.findByTestId("audio-upload-success");
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/audio/library/upload");
    expect(init.body).toBeInstanceOf(FormData);
    // The browser writes the multipart boundary itself; setting content-type by hand breaks the parse.
    expect(init.headers).toBeUndefined();
    expect(await screen.findByTestId("audio-track-t1")).toBeTruthy();
  });

  it("keeps the upload button inert until a file is picked", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { tracks: [] })));
    expect(await screen.findByTestId("audio-upload-button")).toBeDisabled();
  });

  it("shows a rejected upload's reason without leaking the raw backend text", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { tracks: [] }))
      .mockResolvedValueOnce(jsonResponse(400, { code: "AUDIO_FORMAT_UNSUPPORTED", message: "raw backend detail" }));
    renderScreen(fetchMock);

    await screen.findByTestId("audio-library-empty");
    fireEvent.change(screen.getByTestId("audio-file-input"), {
      target: { files: [new File(["x"], "clip.flac", { type: "audio/flac" })] },
    });
    fireEvent.click(screen.getByTestId("audio-upload-button"));

    const error = await screen.findByTestId("audio-upload-error");
    expect(error.textContent).toContain("MP3");
    expect(error.textContent).not.toContain("raw backend detail");
  });

  it("flags only the tracks that actually need attribution", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, {
      tracks: [track({ attributionRequired: true }), track({ trackId: "t2", title: "직접 만든 곡" })],
    })));

    await waitFor(() => expect(screen.getByTestId("audio-track-attribution-t1")).toBeTruthy());
    expect(screen.queryByTestId("audio-track-attribution-t2")).toBeNull();
  });
});
