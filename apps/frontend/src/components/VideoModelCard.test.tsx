import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VIDEO_MODEL, VIDEO_MODEL_OPTIONS, type VideoModel, type VideoModelSetting } from "@ai-animation-studio/shared";

import { jsonResponse } from "../api/testUtils.js";
import { VideoModelCard } from "./VideoModelCard.js";

/**
 * The picker, exercised on a second model that does not exist yet.
 *
 * 캡틴D asked for the mechanism — "모델 교체는 내가 원할 때 가능하게 기능만 만들어놔" — and a mechanism nobody
 * has ever pressed is one nobody knows works. The first time it matters will be the day money moves with it.
 *
 * 🔴 The second option's id is cast, and that is the honest shape of this test rather than a shortcut: today's
 * contract has exactly one `VideoModel`, so a two-option list cannot be built through the client's own reader —
 * `isVideoModelOption` compares against `VIDEO_MODELS` and would refuse it, which is the behaviour we want. The
 * card takes its setting as a prop, so the rendering and the press can still be exercised here, and the save's
 * answer comes back as a real one-option setting — which is exactly the case this must get right: the card
 * renders what the server said, not what was clicked.
 */
const second = { id: "gen4_alt" as VideoModel, label: "다른 모델", pricePerSecondUsd: 0.12, ratios: ["720:1280"], maxDurationSeconds: 10 };
const twoOptions: VideoModelSetting = { selected: DEFAULT_VIDEO_MODEL, isDefault: false, options: [VIDEO_MODEL_OPTIONS[0]!, second] };
const oneOption: VideoModelSetting = { selected: DEFAULT_VIDEO_MODEL, isDefault: false, options: VIDEO_MODEL_OPTIONS };

describe("VideoModelCard", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it("prices every option from its own rate, not the selected one's", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<VideoModelCard setting={twoOptions} onChange={() => {}} />);

    expect(screen.getByText("1초당 $0.05 · 5초 장면 $0.25 · 10초 장면 $0.50")).toBeTruthy();
    expect(screen.getByText("1초당 $0.12 · 5초 장면 $0.60 · 10초 장면 $1.20")).toBeTruthy();
    // With something to choose between, the card does not tell anyone there is only one.
    expect(screen.queryByTestId("video-model-single")).toBeNull();
  });

  it("sends the pressed model and then renders the setting that came back", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { videoModel: oneOption }));
    vi.stubGlobal("fetch", fetchMock);
    const onChange = vi.fn();
    render(<VideoModelCard setting={twoOptions} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /다른 모델/ }));

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(oneOption));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/settings/video-model");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual({ model: "gen4_alt" });
  });

  /** A failed save changed nothing, and the card must not leave a person thinking otherwise. */
  it("says the model did not change when the save fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, { code: "PROVIDER_SETTINGS_STORAGE_ERROR", message: "raw" })));
    const onChange = vi.fn();
    render(<VideoModelCard setting={twoOptions} onChange={onChange} />);

    fireEvent.click(screen.getByRole("radio", { name: /다른 모델/ }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toContain("raw");
    expect(screen.getByText(/모델은 바뀌지 않았습니다/)).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
    expect((screen.getByRole("radio", { name: new RegExp(VIDEO_MODEL_OPTIONS[0]!.label) }) as HTMLInputElement).checked).toBe(true);
  });

  it("does not send anything when the model already in use is pressed", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<VideoModelCard setting={oneOption} onChange={() => {}} />);

    fireEvent.click(screen.getByRole("radio", { name: new RegExp(VIDEO_MODEL_OPTIONS[0]!.label) }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByTestId("video-model-single")).toBeTruthy();
  });
});
