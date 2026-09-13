import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_VIDEO_MODEL, VIDEO_FRAME_SHAPES, VIDEO_MODEL_OPTIONS, videoSceneEstimatedCostUsd, type VideoModel, type VideoModelSetting } from "@ai-animation-studio/shared";

import { jsonResponse } from "../api/testUtils.js";
import { scrollList } from "./ui/surfaces.js";
import { VideoModelCard, videoModelPriceLine } from "./VideoModelCard.js";
import { visibleVideoModels } from "../utils/videoModelFacts.js";

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
const second = { id: "gen4_alt" as VideoModel, label: "다른 모델", pricePerSecondUsd: 0.12, ratios: ["720:1280"], maxDurationSeconds: 10, acceptsLastFrame: false, frameShape: "requested" as const };
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
/* 거르기·정렬은 목록이 길 때만 뜻이 있습니다 — 카탈로그 전체가 그 경우이고, 숫자를 적지 않고 카탈로그에서
   세는 것은 이 파일이 이미 쓰는 방식입니다(목록이 하나 → 셋 → 스물로 자라는 동안 아무 줄도 안 고쳐졌습니다). */
const everyOption: VideoModelSetting = { selected: DEFAULT_VIDEO_MODEL, isDefault: false, options: VIDEO_MODEL_OPTIONS };
const renderedModelIds = (): string[] =>
  Array.from(document.querySelectorAll("[data-testid^=\"video-model-option-\"]"))
    .map((node) => node.getAttribute("data-testid")!.replace("video-model-option-", ""));

describe("VideoModelCard", () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  /**
   * 🔴 이 카드가 쓰였을 때 목록은 한 줄이었습니다. 지금은 스물이고, 「지금 쓰는 게 뭔지」조차 스크롤해야
   * 보입니다. 2026-09-13 에 캡틴D 는 이어지는 릴에 쓸 모델을 스무 줄에서 눈으로 골랐고, 비율을 안 받는
   * 모델을 골라 완성본에 띠가 붙었습니다 — 조작 줄은 그 고르기를 이름으로 부르는 자리입니다.
   *
   * 기본값이 지금과 같아야 하는 이유: 거르기가 기본으로 켜져 있으면 사람은 자기가 **못 보는 모델이 있다는
   * 사실조차** 모릅니다. 목록에서 빠진 것은 없는 것으로 읽힙니다.
   */
  it("shows every model until someone asks for fewer", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<VideoModelCard setting={everyOption} onChange={() => {}} />);

    expect(renderedModelIds().length).toBe(VIDEO_MODEL_OPTIONS.length);
    expect(screen.getByTestId("video-model-count").textContent)
      .toBe(`${VIDEO_MODEL_OPTIONS.length}개 중 ${VIDEO_MODEL_OPTIONS.length}개`);
    expect(screen.getByTestId("video-model-filter-all")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("video-model-sort-catalogue")).toHaveAttribute("aria-pressed", "true");
  });

  /**
   * 🔴 거르기가 지금 쓰는 모델을 숨기면 라디오 묶음에서 켜진 칸이 사라지고, 사람은 화면에서 「내가 뭘 쓰고
   * 있는지」를 잃습니다. 고른 것은 조건에 안 맞아도 남습니다 — 안 맞는다는 말은 그 줄에 이미 적혀 있습니다.
   */
  it("keeps the chosen model visible even when it fails the filter", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<VideoModelCard setting={everyOption} onChange={() => {}} />);
    // 기본값 gen4_turbo 는 끝 그림을 못 받습니다 — 이 거르기에서 빠져야 할 쪽입니다.
    expect(VIDEO_MODEL_OPTIONS.find((option) => option.id === DEFAULT_VIDEO_MODEL)!.acceptsLastFrame).toBe(false);

    fireEvent.click(screen.getByTestId("video-model-filter-last_frame"));

    const ids = renderedModelIds();
    expect(ids, "지금 쓰는 모델은 조건에 안 맞아도 남습니다").toContain(DEFAULT_VIDEO_MODEL);
    for (const option of VIDEO_MODEL_OPTIONS) {
      if (option.id === DEFAULT_VIDEO_MODEL) continue;
      expect(ids.includes(option.id), `${option.label}`).toBe(option.acceptsLastFrame);
    }
    expect(screen.getByTestId("video-model-count").textContent).toBe(`${VIDEO_MODEL_OPTIONS.length}개 중 ${ids.length}개`);
  });

  /**
   * 🔴 초당 요율로 세우면 안 됩니다. 최소 청구액이 붙는 모델과 장면당 요금이 붙는 모델은 요율 순서와 실제
   * 값 순서가 다릅니다 — 요율로 세운 「싼 것부터」는 첫 줄이 제일 싸지 않은 목록이고, 값을 보라고 만든
   * 목록이 값에 대해 거짓말하는 꼴입니다.
   */
  it("orders by what a scene actually costs, not by the per-second rate", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<VideoModelCard setting={everyOption} onChange={() => {}} />);

    fireEvent.click(screen.getByTestId("video-model-sort-price"));

    const ids = renderedModelIds();
    const costs = ids.map((id) => videoSceneEstimatedCostUsd(5, VIDEO_MODEL_OPTIONS.find((option) => option.id === id)!));
    expect(costs, "싼 값부터").toEqual([...costs].sort((a, b) => a - b));
    // 되돌릴 수 있어야 합니다 — 한 번 누르면 끝인 정렬은 정렬이 아니라 덫입니다.
    fireEvent.click(screen.getByTestId("video-model-sort-catalogue"));
    expect(renderedModelIds()).toEqual(VIDEO_MODEL_OPTIONS.map((option) => option.id));

    // 🔴 오늘 카탈로그에는 5초에서 두 순서가 갈리는 짝이 없습니다(최소 청구액이 5초에선 안 걸림) — 그래서 위만으로는
    // 요율로 세워도 초록이었습니다(CLI Round 811 깨기). 두 순서가 실제로 갈리는 두 줄로 따로 묻습니다.
    const floor = { ...VIDEO_MODEL_OPTIONS[0]!, id: "floor_model" as VideoModel, pricePerSecondUsd: 0.05, minimumChargeUsd: 1 };
    const flat = { ...VIDEO_MODEL_OPTIONS[0]!, id: "flat_model" as VideoModel, pricePerSecondUsd: 0.1 };
    expect(visibleVideoModels([floor, flat], "none", "all", "price").map((option) => option.id), "요율은 floor 가 싸도 한 장면은 flat 이 쌉니다")
      .toEqual(["flat_model", "floor_model"]);
  });

  /** 고를 것이 하나면 순서도 거르기도 할 일이 없습니다 — 아무것도 안 하는 단추는 눌러 보게 만듭니다. */
  it("offers no controls when there is nothing to order or filter", () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<VideoModelCard setting={oneOption} onChange={() => {}} />);

    expect(screen.queryByTestId("video-model-controls")).toBeNull();
  });

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
    // With its condition: it is true only for a project that draws its scenes as a chain (Cowork Round 791).
    expect(can.textContent).toContain("다음 클립이 시작합니다");
    expect(can.textContent).toContain("장면 이어 그리기");
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
        // Composed by the card's own helper, not rebuilt here — a test that re-types the format agrees with a
        // card that has stopped saying half of it. The pairs below check the CONTENT of that format; this one
        // checks the row actually carries it.
        const line = videoModelPriceLine(option);
        expect(row, option.id).toContain(line);
        return line;
      });

      /* Models that price alike may read alike; models that price differently must not.
         🔴 The basis has to name everything the line shows, or it drifts from the line it is judging. It once held
         only rate · 5s · 10s, and that was right until the line started naming the floor and the per-scene charge:
         `wan3_1080p` and `seedance2_5_480p` price identically at both lengths and differ only by a minimum, so
         the basis said 15 where the screen showed 17. Composed from the contract's fields rather than from
         `videoModelPriceLine` — using the line itself would make this a tautology that passes however the card
         renders. */
      const distinctPrices = new Set(VIDEO_MODEL_OPTIONS.map((option) => [
        option.pricePerSecondUsd,
        option.perGenerationUsd ?? "",
        videoSceneEstimatedCostUsd(5, option),
        videoSceneEstimatedCostUsd(10, option),
        option.minimumChargeUsd ?? "",
      ].join("|")));
      expect(new Set(priceLines).size).toBe(distinctPrices.size);
    });

    /**
     * 🔴 돈 — 숫자가 아니라 **설명**이 빠져 있던 곳입니다. 견적은 계약이 칸을 가진 순간부터 맞았지만
     * (`videoSceneEstimatedCostUsd` 이 둘 다 접음), 카드는 그 이유를 안 말했습니다. 「1초당 $0.10」 옆에
     * 「5초 장면 $0.51」이 있으면 사람은 계산기를 두드리고, 틀렸다고 생각하고, 그 뒤로 이 카드의 숫자를
     * 안 믿습니다. 모델 이름은 적지 않고 목록에서 찾아 검사합니다.
     */
    it("names the per-scene charge on the models that have one, and nowhere else", () => {
      vi.stubGlobal("fetch", vi.fn());
      render(<VideoModelCard setting={everyModel} onChange={() => {}} />);

      const withCharge = VIDEO_MODEL_OPTIONS.filter((option) => option.perGenerationUsd !== undefined);
      expect(withCharge.length, "catalogue has no model with a per-scene charge").toBeGreaterThan(0);

      for (const option of withCharge) {
        const row = screen.getByTestId(`video-model-option-${option.id}`).textContent ?? "";
        expect(row, option.id).toContain(`장면당 $${option.perGenerationUsd!.toFixed(2)}`);
      }
      for (const option of VIDEO_MODEL_OPTIONS.filter((o) => o.perGenerationUsd === undefined)) {
        expect(screen.getByTestId(`video-model-option-${option.id}`).textContent, option.id).not.toContain("장면당");
      }
    });

    /**
     * 🔴 이 숫자는 옆의 두 합계 어디에도 안 나타납니다 — 지금 앱이 주는 길이 5·10초가 모든 바닥을 이미
     * 넘기 때문입니다. 그래서 더더욱 써 있어야 합니다: 누가 길이 목록에 3·4초를 넣는 날 바닥은 조용히
     * 물리고, 화면에 한 번도 나온 적 없는 수가 청구서에 먼저 나타납니다.
     */
    it("names the floor on the models that have one, and nowhere else", () => {
      vi.stubGlobal("fetch", vi.fn());
      render(<VideoModelCard setting={everyModel} onChange={() => {}} />);

      const withFloor = VIDEO_MODEL_OPTIONS.filter((option) => option.minimumChargeUsd !== undefined);
      expect(withFloor.length, "catalogue has no model with a minimum charge").toBeGreaterThan(0);

      for (const option of withFloor) {
        const row = screen.getByTestId(`video-model-option-${option.id}`).textContent ?? "";
        expect(row, option.id).toContain(`최소 $${option.minimumChargeUsd!.toFixed(2)}`);
      }
      for (const option of VIDEO_MODEL_OPTIONS.filter((o) => o.minimumChargeUsd === undefined)) {
        expect(screen.getByTestId(`video-model-option-${option.id}`).textContent, option.id).not.toContain("최소 $");
      }
    });

    /**
     * 🔴 「확인 안 됨」이 자기 문장을 갖는지가 핵심입니다. 침묵하면 행을 비교하는 사람에게 「괜찮다」로
     * 읽히고, 그건 안심시키는 방향으로 틀리는 겁니다 — 하필 그 값을 가진 모델(H3 Max)이 첫 릴을
     * 돌리려는 모델입니다. 세 값 전부를 계약에서 찾아 각각 확인합니다.
     */
    it("warns where the clip keeps the picture's shape, admits where it is unconfirmed, and is silent otherwise", () => {
      vi.stubGlobal("fetch", vi.fn());
      render(<VideoModelCard setting={everyModel} onChange={() => {}} />);

      const sample = (shape: string) => VIDEO_MODEL_OPTIONS.find((option) => option.frameShape === shape);
      for (const shape of VIDEO_FRAME_SHAPES) {
        expect(sample(shape), `catalogue has no model with frameShape ${shape}`).toBeTruthy();
      }

      const follows = screen.getByTestId(`video-model-frame-${sample("follows_first_frame")!.id}`).textContent ?? "";
      expect(follows).toContain("그림의 비율을 그대로");
      expect(follows).toContain("띠");

      const unconfirmed = screen.getByTestId(`video-model-frame-${sample("unconfirmed")!.id}`).textContent ?? "";
      expect(unconfirmed).toContain("확인되지 않았습니다");
      /* 두 문장이 같은 단어로 끝나는데 이 짝은 한 쪽만 보고 있었고, 그래서 둘 다 「띠」 였는데 한 개만
         잡혔습니다. 같은 것을 말하는 두 문장이면 둘 다 물어야 합니다 — 한 쪽만 물으면 나머지는 짝이
         없는 문장이고, 오타는 짝이 없는 쪽에 남습니다. */
      expect(unconfirmed).toContain("띠");
      // 모르는 것을 안다고 말하지 않습니다.
      expect(unconfirmed).not.toContain("그림의 비율을 그대로");

      expect(screen.queryByTestId(`video-model-frame-${sample("requested")!.id}`)).toBeNull();
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

      /* 🔴 조건이 붙어 있어야 합니다. 이 문장이 조건 없이 「할 수 있습니다」였을 때, 앱은 끝 프레임을 한 장도
         안 보내고 있었고 저는 그 줄을 근거로 캡틴D 께 H3 Max 를 권했습니다. 지금은 「장면 이어 그리기」를 켠
         프로젝트에서만 참이라, 조건이 빠지면 다시 거짓이 됩니다. */
      expect(screen.getByTestId(`video-model-option-${canModel!.id}`).textContent).toContain("다음 클립이 시작합니다");
      expect(screen.getByTestId(`video-model-option-${canModel!.id}`).textContent).toContain("장면 이어 그리기");
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
