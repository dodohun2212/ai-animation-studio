import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VIDEO_MODEL, VIDEO_MODEL_OPTIONS, type VideoModel, type VideoModelSetting } from "@ai-animation-studio/shared";

import { jsonResponse } from "../api/testUtils.js";
import { scrollList } from "./ui/surfaces.js";
import { VideoModelCard } from "./VideoModelCard.js";

/**
 * The picker, exercised on a second model that does not exist yet.
 *
 * 캡틴D asked for the mechanism — "모델 교체는 내가 원할 때 가능하게 기능만 만들어놔" — and a mechanism nobody
 * has ever pressed is one nobody knows works. The first time it matters will be the day money moves with it.
 *
 * 🔴 The second option's id is cast. That was once a necessity — the contract had exactly one `VideoModel`, so
 * a two-option list could not be built through the client's own reader. The contract now lists sixteen, so the
 * cast is no longer load-bearing for the multi-option cases; it is kept only where a fixture must hold a shape
 * no real model has (see `seamless` below), and the real catalogue is used everywhere else. The card takes its
 * setting as a prop, so the rendering and the press are exercised here, and the save's answer comes back as a
 * real setting — which is exactly the case this must get right: the card renders what the server said, not
 * what was clicked.
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
// One option by construction, not by the contract happening to list one — it lists sixteen.
const oneOption: VideoModelSetting = { selected: DEFAULT_VIDEO_MODEL, isDefault: false, options: VIDEO_MODEL_OPTIONS.slice(0, 1) };
/* 🔴 This comment used to read "No model on the contract takes a last frame yet". That stopped being true the
   moment the aggregator models landed: twelve of the sixteen take one, and the cheapest that does (H3 Max 480p,
   $0.05/s) costs the same as the one that does not. That is the whole answer to 「전혀 안 이어지잖아」, so a
   comment saying the opposite is worse than none. The fixture stays — not because no real sample exists, but
   because a hand-made pair is what isolates the two branches from whatever the catalogue happens to hold. The
   catalogue-wide check below is what keeps this honest as the list changes. */
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

  /**
   * The fixtures above are hand-made pairs, which is right for isolating one branch at a time — and wrong for
   * the question the catalogue actually asks now. The settings service hands this card `VIDEO_MODEL_OPTIONS`
   * entire, so what reaches a person is sixteen rows carrying twelve distinct rates, and the failure that
   * matters is one row quoting another row's price. A two-option fixture cannot see that; this renders what
   * the server really sends.
   *
   * Nothing here retypes a model, a price, or a count — it all comes from the contract, so the day a model is
   * added or repriced this test follows it without being edited.
   */
  describe("the whole catalogue, as the server actually sends it", () => {
    const everyModel: VideoModelSetting = { selected: DEFAULT_VIDEO_MODEL, isDefault: false, options: VIDEO_MODEL_OPTIONS };

    it("draws every model the server sent, and drops none of them", () => {
      vi.stubGlobal("fetch", vi.fn());
      render(<VideoModelCard setting={everyModel} onChange={() => {}} />);

      expect(screen.getAllByRole("radio")).toHaveLength(VIDEO_MODEL_OPTIONS.length);
      for (const option of VIDEO_MODEL_OPTIONS) {
        expect(screen.getByTestId(`video-model-option-${option.id}`), option.id).toBeTruthy();
      }
      // Sixteen rows is not "only one".
      expect(screen.queryByTestId("video-model-single")).toBeNull();
    });

    /**
     * 🔴 돈. The rates span 13.6× ($0.05/s … $0.68/s), so a row drawn at another row's rate is not a rounding
     * difference — it is a person picking a $3.40 scene off a card that said $0.25. The earlier pair test
     * pinned two literal strings; at sixteen rows the assertion has to be the shape, not the strings: as many
     * distinct price lines on screen as there are distinct rates in the contract.
     */
    /**
     * 🔴 포함이 아니라 정확히 같아야 합니다. 처음 이 목록에 천장을 달 때 `${scrollList} space-y-2` 로
     * 썼고, `scrollList` 이 이미 `space-y-1` 을 가지고 있어서 한 엘리먼트에 간격 유틸리티가 둘이 됐습니다.
     * 어느 쪽이 이기는지는 Tailwind 가 CSS 를 내보낸 순서가 정합니다 — 파일을 읽어서는 알 수 없고
     * 리팩토링 한 번에 바뀔 수 있습니다. 정확히 같은지를 보면 「여기에 클래스를 더 붙인다」가 조용히
     * 일어나지 않고 반드시 결정이 됩니다 — 천장 자체가 사라졌는지도 같은 줄이 잡습니다.
     */
    it("bounds the list with the shared list token and nothing else", () => {
      vi.stubGlobal("fetch", vi.fn());
      const { container } = render(<VideoModelCard setting={everyModel} onChange={() => {}} />);

      const list = container.querySelector("ul");
      expect(list).toBeTruthy();
      expect(list!.className).toBe(scrollList);
    });

    it("gives each rate its own price line, so no row can be drawn at another row's rate", () => {
      vi.stubGlobal("fetch", vi.fn());
      render(<VideoModelCard setting={everyModel} onChange={() => {}} />);

      const priceLines = VIDEO_MODEL_OPTIONS.map((option) => {
        const row = screen.getByTestId(`video-model-option-${option.id}`).textContent ?? "";
        const line = `1초당 $${option.pricePerSecondUsd.toFixed(2)} · 5초 장면 $${(option.pricePerSecondUsd * 5).toFixed(2)} · 10초 장면 $${(option.pricePerSecondUsd * 10).toFixed(2)}`;
        expect(row, option.id).toContain(line);
        return line;
      });

      const distinctRates = new Set(VIDEO_MODEL_OPTIONS.map((option) => option.pricePerSecondUsd));
      expect(new Set(priceLines).size).toBe(distinctRates.size);
    });

    /**
     * 캐프틴D 가 직접 본 문제(「전혀 안 이어지잖아」)의 답이 이 카드 위에 있어야 합니다. 이어받는 모델과
     * 못 받는 모델이 지금 카탈로그에 둘 다 있으므로, 두 문장이 둘 다 실제 모델에서 떠야 합니다 —
     * 한쪽만 뜨면 고를 수 있는 것처럼 보이는 카드가 실제로는 한 가지만 말하고 있는 것입니다.
     */
    it("says both continuity answers, because the catalogue now holds both kinds", () => {
      vi.stubGlobal("fetch", vi.fn());
      render(<VideoModelCard setting={everyModel} onChange={() => {}} />);

      const canModel = VIDEO_MODEL_OPTIONS.find((option) => option.acceptsLastFrame);
      const cannotModel = VIDEO_MODEL_OPTIONS.find((option) => !option.acceptsLastFrame);
      expect(canModel, "catalogue has no model that accepts a last frame").toBeTruthy();
      expect(cannotModel, "catalogue has no model that refuses a last frame").toBeTruthy();

      expect(screen.getByTestId(`video-model-option-${canModel!.id}`).textContent).toContain("다음 클립을 시작할 수 있습니다");
      expect(screen.getByTestId(`video-model-option-${cannotModel!.id}`).textContent).toContain("이어받지 못합니다");
    });
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
