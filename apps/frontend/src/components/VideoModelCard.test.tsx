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
/*
 * `acceptsLastFrame` is here before the contract carries it, on purpose and by CLI's request: the field lands
 * in `VideoModelOption` next, and this fixture is a plain `const`, so writing it now costs nothing and means
 * the contract change does not pass through a moment where `main` is red. Same bet `ratios` made — see that
 * field's comment in domain.ts.
 *
 * `false` is the honest value for a second Runway model today. It is also the value that makes this fixture
 * worth having: the card will have to say that a model CANNOT take a last frame, and a picker whose only
 * sample says "yes" would never render that sentence.
 */
const second = { id: "gen4_alt" as VideoModel, label: "다른 모델", pricePerSecondUsd: 0.12, ratios: ["720:1280"], maxDurationSeconds: 10, acceptsLastFrame: false };
const twoOptions: VideoModelSetting = { selected: DEFAULT_VIDEO_MODEL, isDefault: false, options: [VIDEO_MODEL_OPTIONS[0]!, second] };
// One option by construction, not by the contract happening to list one — it lists three since H3 Max arrived.
const oneOption: VideoModelSetting = { selected: DEFAULT_VIDEO_MODEL, isDefault: false, options: VIDEO_MODEL_OPTIONS.slice(0, 1) };
/* No model on the contract takes a last frame yet, so the "can" sentence has no real sample to be drawn from —
   and a branch that never renders is a branch nobody knows works. This is the sample. */
const seamless = { ...second, id: "gen4_seam" as VideoModel, label: "이음새 되는 모델", acceptsLastFrame: true };
const mixedOptions: VideoModelSetting = { selected: DEFAULT_VIDEO_MODEL, isDefault: false, options: [VIDEO_MODEL_OPTIONS[0]!, seamless] };

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

  /*
   * 🔴 What a person is actually choosing between. Price is the easy half; this is the half that decides
   * whether a 꽃말 릴 cuts backwards — 캡틴D watched exactly that happen and the measurement matched a whole
   * clip's growth (00_NOW.md ③). A picker that prices two models identically well and says nothing about this
   * sends them to the cheaper one every time.
   *
   * Both branches are asserted because only one of them has a real model behind it today.
   */
  it("says, per model, whether it can continue from where the last clip ended", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<VideoModelCard setting={mixedOptions} onChange={() => {}} />);

    const cannot = screen.getByTestId(`video-model-option-${VIDEO_MODEL_OPTIONS[0]!.id}`);
    expect(cannot.textContent).toContain("이어받지 못합니다");
    expect(cannot.textContent).toContain("뒤로 돌아갈 수 있습니다");

    const can = screen.getByTestId("video-model-option-gen4_seam");
    expect(can.textContent).toContain("다음 클립을 시작할 수 있습니다");
    expect(can.textContent).not.toContain("이어받지 못합니다");
  });

  /*
   * 🔴 A model that states no aspect ratio. Runway's SDK types show models on the same endpoint with no ratio
   * field (h3_max uses `resolution`), so the contract's `ratios` can honestly be empty — and the previous line
   * joined it blindly into 「비율  · …」, a sentence with a hole in it.
   *
   * Asserted as an absence AND a presence: dropping the ratio half must not drop the length half with it.
   */
  it("says nothing about aspect ratio for a model that states none, and still gives its length", () => {
    vi.stubGlobal("fetch", vi.fn());
    /* 🔴 The label must not contain 「비율」. The assertion below is that the row does not mention aspect ratio,
       and a fixture whose own name carries the word makes that assertion fail for a reason that has nothing
       to do with the code — which is exactly what happened on the first attempt. */
    const noRatio = { ...second, id: "gen4_noratio" as VideoModel, label: "해상도로 정하는 모델", ratios: [] };
    render(<VideoModelCard setting={{ selected: DEFAULT_VIDEO_MODEL, isDefault: false, options: [VIDEO_MODEL_OPTIONS[0]!, noRatio] }} onChange={() => {}} />);

    const row = screen.getByTestId("video-model-option-gen4_noratio");
    expect(row.textContent).not.toContain("비율");
    expect(row.textContent).toContain(`한 장면 최대 ${noRatio.maxDurationSeconds}초`);
    // The model that does state ratios still states them — the fix is per option, not a blanket removal.
    expect(screen.getByTestId(`video-model-option-${VIDEO_MODEL_OPTIONS[0]!.id}`).textContent).toContain("비율");
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
