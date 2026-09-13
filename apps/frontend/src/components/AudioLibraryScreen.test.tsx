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

/** A File that claims a size without allocating it — 50MB of real bytes in a test is not worth the memory. */
function sizedFile(bytes: number, name = "long.mp3"): File {
  const file = new File(["x"], name, { type: "audio/mpeg" });
  Object.defineProperty(file, "size", { value: bytes });
  return file;
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

  /**
   * 🔴 화면이 「50MB 이하」라고 적어 두고 그 규칙을 적용하지 않으면, 300MB 파일이 통째로 올라간 뒤에야 거절됩니다.
   * 여기서 막는 편이 기다림도 없고, 무엇을 해야 하는지도 말해 줄 수 있습니다.
   */
  it("refuses a file larger than the limit it states, before anything is uploaded", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { tracks: [] }));
    renderScreen(fetchMock);

    await screen.findByTestId("audio-library-empty");
    fireEvent.change(screen.getByTestId("audio-file-input"), { target: { files: [sizedFile(60 * 1024 * 1024)] } });
    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "cc0" } });

    const tooBig = screen.getByTestId("audio-file-too-big");
    expect(tooBig.textContent, "실제 크기를 말해 줍니다").toContain("60.0 MB");
    expect(tooBig.textContent, "무엇을 하면 되는지도").toContain("다시 내보낸");
    expect(screen.getByTestId("audio-upload-button")).toBeDisabled();
    expect(fetchMock.mock.calls.some((call) => (call[1] as RequestInit | undefined)?.method === "POST")).toBe(false);
  });

  /** 반대쪽: 상한 안쪽 파일은 아무 말 없이 그대로 올라갑니다 — 없음/있음을 한 갈래에서만 재면 조건을 뒤집어도 안 잡힙니다. */
  it("says nothing about size for a file inside the limit", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { tracks: [] })));

    await screen.findByTestId("audio-library-empty");
    fireEvent.change(screen.getByTestId("audio-file-input"), { target: { files: [sizedFile(50 * 1024 * 1024)] } });
    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "cc0" } });

    expect(screen.queryByTestId("audio-file-too-big"), "정확히 상한이면 서버가 받습니다").toBeNull();
    expect(screen.getByTestId("audio-upload-button")).not.toBeDisabled();
  });

  /**
   * 🔴 화면에 보이지 않는 값을 보내고 있었습니다. 「그 밖의 경우」로 문구를 적은 뒤 라이선스를 바꾸면
   * attributionRequired 는 false 가 되지만 문구는 상태에 남아 그대로 올라갔고, 출처를 적을 필요가 없는 음원에
   * 남의 조건이 붙었습니다.
   */
  it("does not send a caption line for a licence that needs no credit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { tracks: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { track: track() }))
      .mockResolvedValueOnce(jsonResponse(200, { tracks: [track()] }));
    renderScreen(fetchMock);

    await screen.findByTestId("audio-library-empty");
    fireEvent.change(screen.getByTestId("audio-file-input"), {
      target: { files: [new File(["x"], "night.mp3", { type: "audio/mpeg" })] },
    });
    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "cc-by" } });
    fireEvent.change(screen.getByTestId("audio-attribution-text"), { target: { value: "Music: 「밤」 by ○○○ (CC BY 4.0)" } });
    // 마음을 바꿔 「직접 만든 음원」으로. 문구 칸은 사라지지만 값은 상태에 남아 있습니다.
    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "self-made" } });
    expect(screen.queryByTestId("audio-attribution-text")).toBeNull();

    fireEvent.click(screen.getByTestId("audio-upload-button"));
    await screen.findByTestId("audio-upload-success");

    const form = (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as FormData;
    expect(form.get("attributionRequired")).toBe("false");
    expect(form.get("attributionText"), "보이지 않는 값은 보내지 않습니다").toBeNull();
  });

  /** 반대쪽: 정말 필요한 음원의 문구는 그대로 갑니다. */
  it("sends the caption line for a licence that does need credit", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { tracks: [] }))
      .mockResolvedValueOnce(jsonResponse(200, { track: track({ attributionRequired: true }) }))
      .mockResolvedValueOnce(jsonResponse(200, { tracks: [track({ attributionRequired: true })] }));
    renderScreen(fetchMock);

    await screen.findByTestId("audio-library-empty");
    fireEvent.change(screen.getByTestId("audio-file-input"), {
      target: { files: [new File(["x"], "night.mp3", { type: "audio/mpeg" })] },
    });
    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "cc-by" } });
    fireEvent.change(screen.getByTestId("audio-attribution-text"), { target: { value: "Music: 「밤」 by ○○○ (CC BY 4.0)" } });
    fireEvent.click(screen.getByTestId("audio-upload-button"));
    await screen.findByTestId("audio-upload-success");

    const form = (fetchMock.mock.calls[1] as [string, RequestInit])[1].body as FormData;
    expect(form.get("attributionRequired")).toBe("true");
    expect(form.get("attributionText")).toBe("Music: 「밤」 by ○○○ (CC BY 4.0)");
  });

  /** 출처를 표시해야 하는데 문구가 비어 있으면 지금 말합니다 — 막지는 않습니다(계약상 선택 항목입니다). */
  it("points out an empty caption line while the source is still known, without blocking the upload", async () => {
    renderScreen(vi.fn().mockResolvedValue(jsonResponse(200, { tracks: [] })));

    await screen.findByTestId("audio-library-empty");
    fireEvent.change(screen.getByTestId("audio-file-input"), {
      target: { files: [new File(["x"], "night.mp3", { type: "audio/mpeg" })] },
    });
    fireEvent.change(screen.getByTestId("audio-license-select"), { target: { value: "cc-by" } });

    expect(screen.getByTestId("audio-attribution-text-missing").textContent).toContain("비어 있습니다");
    expect(screen.getByTestId("audio-upload-button"), "경고이지 금지가 아닙니다").not.toBeDisabled();

    fireEvent.change(screen.getByTestId("audio-attribution-text"), { target: { value: "Music: 「밤」 by ○○○" } });
    expect(screen.queryByTestId("audio-attribution-text-missing")).toBeNull();
  });

  /** 예전에 올려 둔 음원에 문구만 남아 있을 수 있습니다 — 필요 없는 음원에 남의 조건을 붙여 보이지 않습니다. */
  it("shows a caption line only on tracks that actually need one", async () => {
    renderScreen(
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          tracks: [
            track({ attributionRequired: true, attributionText: "Music: A by B (CC BY 4.0)" }),
            track({ trackId: "t2", title: "직접 만든 곡", attributionText: "Music: A by B (CC BY 4.0)" }),
          ],
        }),
      ),
    );

    await waitFor(() => expect(screen.getByTestId("audio-track-attribution-text-t1")).toBeTruthy());
    expect(screen.queryByTestId("audio-track-attribution-text-t2")).toBeNull();
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
