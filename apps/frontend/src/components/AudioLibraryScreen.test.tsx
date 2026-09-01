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
    licenseKind: "cc0",
    attributionRequired: false,
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
    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "cc0" } });
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
      .mockResolvedValueOnce(jsonResponse(400, { code: "AUDIO_FILE_INVALID", message: "raw backend detail" }));
    renderScreen(fetchMock);

    await screen.findByTestId("audio-library-empty");
    fireEvent.change(screen.getByTestId("audio-file-input"), {
      target: { files: [new File(["x"], "clip.flac", { type: "audio/flac" })] },
    });
    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "purchased" } });
    fireEvent.click(screen.getByTestId("audio-upload-button"));

    const error = await screen.findByTestId("audio-upload-error");
    expect(error.textContent).toContain("MP3");
    expect(error.textContent).not.toContain("raw backend detail");
  });

  // The upload moment is the only time the person still knows where the file came from — a licence left blank
  // now cannot be reconstructed six months later, which is exactly when it starts to matter.
  it("will not upload until the source of the track is stated", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { tracks: [] })));

    await screen.findByTestId("audio-library-empty");
    fireEvent.change(screen.getByTestId("audio-file-input"), {
      target: { files: [new File(["x"], "night.mp3", { type: "audio/mpeg" })] },
    });

    expect(screen.getByTestId("audio-upload-button")).toBeDisabled();
    expect(screen.getByTestId("audio-license-required").textContent).toContain("출처");

    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "cc0" } });
    expect(screen.getByTestId("audio-upload-button")).not.toBeDisabled();
  });

  it("fills the attribution answer in for licences that decide it, and only asks for the one that does not", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { tracks: [] })));

    await screen.findByTestId("audio-library-empty");
    // CC BY always needs credit, so the caption field appears without asking a question whose answer is fixed.
    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "cc-by" } });
    expect(screen.queryByTestId("audio-attribution-required")).toBeNull();
    expect(screen.getByTestId("audio-attribution-text")).toBeTruthy();

    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "cc0" } });
    expect(screen.queryByTestId("audio-attribution-text")).toBeNull();

    // "그 밖의 경우" is the one the label cannot answer, so that is the one that asks.
    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "other" } });
    expect(screen.getByTestId("audio-attribution-required")).toBeTruthy();
  });

  it("asks before removing a track and says the original file is untouched", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { tracks: [track()] }))
      .mockResolvedValueOnce(jsonResponse(200, { trackId: "t1" }))
      .mockResolvedValueOnce(jsonResponse(200, { tracks: [] }));
    renderScreen(fetchMock);

    fireEvent.click(await screen.findByTestId("audio-track-delete-t1"));
    const panel = await screen.findByTestId("audio-track-delete-confirm-t1");
    expect(panel.textContent).toContain("원본 파일은 컴퓨터에 그대로");

    fireEvent.click(screen.getByTestId("audio-track-delete-confirm-button-t1"));
    await screen.findByTestId("audio-library-empty");
    expect((fetchMock.mock.calls[1] as [string, RequestInit])[1].method).toBe("DELETE");
  });

  it("flags only the tracks that actually need attribution", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, {
      tracks: [track({ attributionRequired: true }), track({ trackId: "t2", title: "직접 만든 곡" })],
    })));

    await waitFor(() => expect(screen.getByTestId("audio-track-attribution-t1")).toBeTruthy());
    expect(screen.queryByTestId("audio-track-attribution-t2")).toBeNull();
  });
});
