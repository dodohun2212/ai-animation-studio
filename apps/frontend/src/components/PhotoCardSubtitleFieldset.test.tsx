import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PhotoCardSubtitleLayout } from "@ai-animation-studio/shared";
import { API_ROUTES, DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT, PHOTO_CARD_SUBTITLE_CSS_RATIO } from "@ai-animation-studio/shared";

import { jsonResponse } from "../api/testUtils.js";
import { PhotoCardSubtitleFieldset } from "./PhotoCardSubtitleFieldset.js";

const TWO_PART = "불광불급(不狂不及)\n미치도록 몰입한 사람만이,";

function renderFieldset(quote: string, layout = DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT, onChange = vi.fn()) {
  render(
    <PhotoCardSubtitleFieldset
      projectId="card_1"
      quote={quote}
      aspectRatio="9:16"
      layout={layout}
      onChange={onChange}
    />,
  );
  return onChange;
}

/**
 * jsdom lays nothing out — every element reports 0 — so the overflow check has nothing to read unless the two
 * measurements it uses are supplied. `top` comes from the style the component wrote, which is real; the line
 * height is the one number a browser would have computed and is given here.
 */
function withMeasuredLines(lineHeight: number, body: () => void, textWidth = 0): void {
  const proto = HTMLElement.prototype;
  const saved = (["offsetTop", "offsetHeight", "scrollWidth", "clientWidth"] as const)
    .map((name) => [name, Object.getOwnPropertyDescriptor(proto, name)] as const);
  Object.defineProperty(proto, "offsetTop", { configurable: true, get(this: HTMLElement) { return parseFloat(this.style.top || "0"); } });
  Object.defineProperty(proto, "offsetHeight", { configurable: true, get: () => lineHeight });
  // A line wider than its box is the sideways half of the same failure; 0/0 means "fits", which is what the
  // cases about vertical overflow want.
  Object.defineProperty(proto, "scrollWidth", { configurable: true, get: () => textWidth });
  Object.defineProperty(proto, "clientWidth", { configurable: true, get: () => 0 });
  try {
    body();
  } finally {
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(proto, name, descriptor); else Reflect.deleteProperty(proto, name);
    }
  }
}

/**
 * The colour lookup (CLI Round 888), with the clock in this file's hands.
 *
 * The component waits for the slider to settle before asking, so a real-timer test would either sleep or race.
 * Fake timers make "the drag ended" a thing the test states rather than waits for, and `advanceTimersByTimeAsync`
 * also drains the promise the answer arrives on — the reason for it rather than `advanceTimersByTime`.
 */
const COLORS = { body: "#ffe9b0", heading: "#ffc14d", outline: "#1a1206" };
const SETTLE_MS = 400;

function renderWithColors(answer: unknown | "fails", layout: PhotoCardSubtitleLayout = DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
    if (String(input).startsWith("/projects/card_1/photo-card/subtitle-colors")) {
      if (answer === "fails") return jsonResponse(409, { code: "INVALID_REQUEST", message: "raw backend detail" });
      return jsonResponse(200, answer);
    }
    throw new Error(`unexpected fetch: ${String(input)}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  const { rerender } = render(
    <PhotoCardSubtitleFieldset projectId="card_1" quote={TWO_PART} aspectRatio="9:16" layout={layout} onChange={vi.fn()} />,
  );
  return {
    fetchMock,
    move: (center: number) => rerender(
      <PhotoCardSubtitleFieldset projectId="card_1" quote={TWO_PART} aspectRatio="9:16" layout={{ ...layout, center }} onChange={vi.fn()} />,
    ),
    resize: (scale: number) => rerender(
      <PhotoCardSubtitleFieldset projectId="card_1" quote={TWO_PART} aspectRatio="9:16" layout={{ ...layout, scale }} onChange={vi.fn()} />,
    ),
  };
}

/** Lets the settle window pass and the answer land, in one step the test can point at. */
async function settle(ms = SETTLE_MS): Promise<void> {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

/** `[heading, ...body]` as the browser resolved them — jsdom normalises every colour to `rgb(...)`. */
function drawnColors(): string[] {
  const preview = screen.getByTestId("photo-card-subtitle-preview");
  return (Array.from(preview.querySelectorAll("div[style*='top']")) as unknown as HTMLElement[]).map((node) => node.style.color);
}

/**
 * The edge, read back without betting on how jsdom stores `text-shadow`.
 *
 * It is not one of the properties jsdom parses, so depending on the version it either normalises the colours
 * into the `style` attribute or keeps the string as written on the style object. Both are read, and the colour
 * is looked for in either spelling — the assertion is about which colour is drawn, and a test that turned red
 * over `#1a1206` versus `rgb(26, 18, 6)` would be about jsdom instead.
 */
function shadowOf(index: number): string {
  const preview = screen.getByTestId("photo-card-subtitle-preview");
  const node = (Array.from(preview.querySelectorAll("div[style*='top']")) as unknown as HTMLElement[])[index]!;
  return `${node.style.textShadow ?? ""} ${node.getAttribute("style") ?? ""}`;
}

function mentionsColor(shadow: string, hex: string): boolean {
  const value = Number.parseInt(hex.slice(1), 16);
  return shadow.includes(hex)
    || shadow.includes(`rgb(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255})`);
}

/** The renderer stacks lines by absolute top; reading it back is how a layout test says "where", not "how it looked". */
function tops(): number[] {
  const preview = screen.getByTestId("photo-card-subtitle-preview");
  const nodes = Array.from(preview.querySelectorAll("div[style*='top']")) as unknown as HTMLElement[];
  return nodes.map((node) => parseFloat(node.style.top));
}

describe("PhotoCardSubtitleFieldset", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  /**
   * The split is the whole reason two styles exist: the first line is the 사자성어 and gets the serif face, the
   * rest is the meaning. A card written as one line has no 사자성어 — setting it in the quote face anyway would
   * be the preview claiming a distinction the renderer does not make.
   */
  // Item 6: the preview is the merge's real frame for the card's shape — a 4:5 card's text wraps on 1080 x 1350,
  // not on the 9:16 frame a `vertical` switch used to draw for anything that was not 16:9.
  it("draws the card's text on the merge's own frame for its shape", () => {
    const frameOf = (aspectRatio: "9:16" | "16:9" | "1:1" | "4:5") => {
      const { unmount } = render(<PhotoCardSubtitleFieldset projectId="card_1" quote="한 줄" aspectRatio={aspectRatio} layout={DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT} onChange={vi.fn()} />);
      const inner = screen.getByTestId("photo-card-subtitle-preview").firstElementChild as HTMLElement;
      const size = `${inner.style.width} ${inner.style.height}`;
      unmount();
      return size;
    };
    expect(frameOf("9:16")).toBe("1080px 1920px");
    expect(frameOf("16:9")).toBe("1920px 1080px");
    expect(frameOf("1:1")).toBe("1080px 1080px");
    expect(frameOf("4:5")).toBe("1080px 1350px");
  });

  it("gives the first line the quote face only when there is a second line", () => {
    renderFieldset(TWO_PART);
    const preview = screen.getByTestId("photo-card-subtitle-preview");
    const nodes = Array.from(preview.querySelectorAll("div")) as unknown as HTMLElement[];
    const serif = nodes.filter((node) => node.style.fontFamily.includes("Serif"));
    expect(serif).toHaveLength(1);
    expect(serif[0]!.textContent).toBe("불광불급(不狂不及)");
  });

  it("sets a one-line card entirely in the body face", () => {
    renderFieldset("천천히 서두르라");
    const preview = screen.getByTestId("photo-card-subtitle-preview");
    const nodes = Array.from(preview.querySelectorAll("div")) as unknown as HTMLElement[];
    expect(nodes.filter((node) => node.style.fontFamily.includes("Serif"))).toHaveLength(0);
    expect(preview.textContent).toContain("천천히 서두르라");
  });

  // The control that was actually wrong on the published card. Raising `center` has to move the text down the
  // frame — if the preview did not track it, it would be a picture rather than a preview.
  it("moves the whole block down as the position rises", () => {
    renderFieldset(TWO_PART, { scale: 0.027, center: 0.3 });
    const high = tops();
    screen.getByTestId("photo-card-subtitle-preview").remove();
    renderFieldset(TWO_PART, { scale: 0.027, center: 0.7 });
    const low = tops();

    expect(high).toHaveLength(2);
    expect(low).toHaveLength(2);
    expect(low[0]!).toBeGreaterThan(high[0]!);
    expect(low[1]!).toBeGreaterThan(high[1]!);
  });

  // Both numbers travel together: a slider that reported only its own value would let a caller keep half of a
  // layout and default the other half without meaning to.
  it("reports the full layout when one slider moves", () => {
    const onChange = renderFieldset(TWO_PART, { scale: 0.03, center: 0.4 });
    fireEvent.change(screen.getByTestId("photo-card-subtitle-scale"), { target: { value: "0.045" } });
    expect(onChange).toHaveBeenCalledWith({ scale: 0.045, center: 0.4 });
  });

  /**
   * The size CSS is set to is not the size the renderer is told.
   *
   * libass sizes a font by its own vertical metrics, so drawing `font-size: 52px` puts about half again as
   * much ink across the frame as `Fontsize 52` does. The preview did exactly that and reported the largest
   * size as overflowing when the video is fine at it (CLI Round 447 measured both faces off real frames).
   */
  it("draws at the measured CSS size rather than the renderer's own number", () => {
    renderFieldset(TWO_PART, { scale: 0.027, center: 0.4 });
    const preview = screen.getByTestId("photo-card-subtitle-preview");
    const nodes = Array.from(preview.querySelectorAll("div")) as unknown as HTMLElement[];
    const serif = nodes.find((node) => node.style.fontFamily.includes("Serif"));
    const sans = nodes.find((node) => node.style.fontFamily.includes("Sans"));

    // 1920 * 0.027 = 52 body, heading 1.4x that = 73; each scaled by its own measured ratio.
    expect(parseFloat(sans!.style.fontSize)).toBeCloseTo(52 * PHOTO_CARD_SUBTITLE_CSS_RATIO.body, 3);
    expect(parseFloat(serif!.style.fontSize)).toBeCloseTo(73 * PHOTO_CARD_SUBTITLE_CSS_RATIO.heading, 3);
    // The two faces measure differently; one shared ratio would be wrong for one of them.
    expect(PHOTO_CARD_SUBTITLE_CSS_RATIO.heading).not.toBe(PHOTO_CARD_SUBTITLE_CSS_RATIO.body);
  });

  /**
   * Where the line breaks, which the size ratio above does not settle.
   *
   * 캡틴D read 불요불굴 off the finished video and off this preview and got different line breaks. The width was
   * right; the breaking was wrong in two independent ways. CSS breaks Korean between any two syllables, so the
   * preview split 마라. into 마 and 라.; and CSS fills a line greedily while libass's WrapStyle 0 evens the
   * lines out, so a two-line card previewed as 916px + 118px where the render drew 491 + 515.
   *
   * The five finished cards were rendered through the real FFmpeg with the real font files and measured against
   * the same texts in a browser: with these two properties the preview picks the render's break in all five,
   * without them it picks a different one in all five. jsdom does no line breaking at all, so this pair can only
   * check that the rules are asked for — the measurement itself lives in the round that made the change.
   */
  it("asks for the renderer's own breaking rules: only at spaces, and evened out", () => {
    renderFieldset(TWO_PART);
    const preview = screen.getByTestId("photo-card-subtitle-preview");
    const nodes = Array.from(preview.querySelectorAll("div")) as unknown as HTMLElement[];
    const drawn = nodes.filter((node) => node.style.fontFamily.includes("Noto"));

    expect(drawn.length).toBeGreaterThan(0);
    for (const node of drawn) {
      // Korean has no spaces inside a word; without this the browser breaks mid-word and libass never does.
      expect(node.style.wordBreak).toBe("keep-all");
      // WrapStyle 0 is "smart" wrapping — the renderer evens the lines rather than filling the first one.
      expect(node.style.textWrap).toBe("balance");
    }
  });

  // The bounds come from the shared constants the server refuses by, so a slider cannot reach a value the
  // merge would reject. Hard-coding them here is how they drift apart.
  it("cannot be dragged outside the range the server accepts", () => {
    renderFieldset(TWO_PART);
    const scale = screen.getByTestId("photo-card-subtitle-scale") as HTMLInputElement;
    const center = screen.getByTestId("photo-card-subtitle-center") as HTMLInputElement;
    expect(scale.min).toBe("0.02");
    expect(scale.max).toBe("0.05");
    expect(center.min).toBe("0.15");
    expect(center.max).toBe("0.85");
  });

  /**
   * The failure the preview could not show until the frame was drawn at its real size.
   *
   * Measured on 1080x1920: thirty body lines at the default size run off both ends, and ten at the largest run
   * off the top (CLI Round 445). A preview laid out in a 236px box wraps a long line somewhere else, so it
   * counts a different number of lines — and shows those cards fitting. The server does not clamp and does not
   * refuse, both deliberately, which leaves saying so here as the only place it can be said.
   */
  it("warns when the text runs off the frame", () => {
    withMeasuredLines(120, () => {
      renderFieldset(`불광불급(不狂不及)\n${Array.from({ length: 30 }, (_, index) => `${index}번째 줄`).join("\n")}`, { scale: 0.05, center: 0.4 });
      expect(screen.getByTestId("photo-card-subtitle-overflow").textContent).toContain("화면 밖으로");
    });
  });

  /**
   * Sideways, which is a different failure and was invisible until the frame was drawn at 1080.
   *
   * 불광불급(不狂不及) at the largest size measures wider than the frame and runs off both edges while never
   * being taller than it — so a check that only looked up and down called that card fine.
   */
  it("warns when a line is wider than the frame", () => {
    withMeasuredLines(120, () => {
      renderFieldset(TWO_PART, { scale: 0.05, center: 0.4 });
      expect(screen.getByTestId("photo-card-subtitle-overflow")).toBeTruthy();
    }, 1400);
  });

  it("stays quiet when it fits", () => {
    withMeasuredLines(120, () => {
      renderFieldset(TWO_PART, { scale: 0.027, center: 0.4 });
      expect(screen.queryByTestId("photo-card-subtitle-overflow")).toBeNull();
    });
  });

  // Said rather than implied: the browser is not ffmpeg, and a preview that quietly claims to be exact is
  // worse than one that names the one thing it cannot promise.
  it("says the letterforms may differ from the finished video", () => {
    renderFieldset(TWO_PART);
    expect(screen.getByTestId("photo-card-subtitle-approximate").textContent).toContain("글꼴");
  });

  /**
   * The rule: the preview asks for the weight the RENDER's own file actually is.
   *
   * 🔴 The rule is the durable part; the answer is not. Both faces used to be variable and defaulted to their
   * thinnest instance — Serif ExtraLight 200, Sans Thin 100 — and nothing loaded them here at all, so
   * `fontWeight: 700` and `400` measured identically and the 사자성어 line looked thin on screen while the
   * burned-in subtitle was already Bold. That was fixed by shipping static files and declaring each at the
   * weight it is. This assertion then hard-coded the answer of the day (Sans Medium 500) and went stale the
   * moment `3a56577` set the card's `Body` style to `Bold: -1` and libass began drawing NotoSansKR-Bold.ttf.
   *
   * So: `fonts/` now holds TWO Sans faces, 500 and 700, and styles.css declares both. The card body is drawn
   * from the 700 one — it had to move together with the reel's subtitle, because SCENE_SUBTITLE_CSS_RATIO is
   * derived from PHOTO_CARD_SUBTITLE_CSS_RATIO.body and one number cannot describe two layouts drawn from
   * different files. Asking for a weight no declared face has puts the browser back on nearest-match, which is
   * the guess the render side deliberately stopped relying on.
   *
   * If a face is ever added or a `Bold` flag flipped again, change these numbers — but keep the rule.
   */
  /**
   * 🔴 CLI Round 886 → 888. 병합은 그림에서 색을 뽑아 굽는데 미리보기는 흰 글씨만 그렸습니다. 그러면
   * 「병합하고, 보고, 다시 병합」이 색 때문에 그대로 돌아옵니다 — 이 미리보기가 없애려고 만들어진 바로 그것이.
   * 조회는 병합과 **같은 함수**를 돌리므로, 여기서 보이는 두 색이 곧 ASS 에 들어가는 두 색입니다.
   */
  it("paints the merge's own colours — heading, body, and the outline behind both", async () => {
    vi.useFakeTimers();
    renderWithColors({ colors: COLORS });
    await settle();

    const [heading, ...body] = drawnColors();
    expect(heading).toBe("rgb(255, 193, 77)");
    for (const line of body) expect(line).toBe("rgb(255, 233, 176)");
    // 그림자는 테두리 색의 절반 — 미리보기가 따로 정한 검정이 아니라 렌더러의 그 관계입니다.
    expect(mentionsColor(shadowOf(0), COLORS.outline)).toBe(true);
    expect(shadowOf(0)).toContain("rgba(26, 18, 6, 0.5)");
  });

  /**
   * 🔴 띠가 옮겨지면 색이 바뀌므로 다시 물어야 하지만, 드래그 한 번은 수십 걸음입니다. 걸음마다 물으면
   * 사용자 컴퓨터에서 그림을 수십 번 훑습니다(무료지만 즉시는 아닙니다). 멈춘 뒤 **한 번**입니다.
   */
  it("asks once after the slider settles, not once per step of the drag", async () => {
    vi.useFakeTimers();
    const { fetchMock, move } = renderWithColors({ colors: COLORS });

    for (const center of [0.4, 0.45, 0.5, 0.55, 0.6]) {
      move(center);
      await settle(50);
    }
    expect(fetchMock).not.toHaveBeenCalled();

    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(API_ROUTES.photoCardSubtitleColors("card_1", 0.6));
  });

  /** 글자 크기는 띠를 옮기지 않습니다 — 색이 바뀔 이유가 없으니 그림을 다시 훑을 이유도 없습니다. */
  it("does not re-read the picture when only the text size changes", async () => {
    vi.useFakeTimers();
    const { fetchMock, resize } = renderWithColors({ colors: COLORS });
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resize(DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT.scale + 0.01);
    await settle();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * `colors: null` 은 실패가 아니라 **답**입니다 — 그림을 못 읽었고, 병합도 흰 글씨 + 검은 테두리로 굽습니다.
   * 그러면 미리보기가 맞는 것이므로 경고를 붙이면 안 됩니다.
   */
  it("draws white on black for a picture the server could not read, and says nothing — that is what the merge burns", async () => {
    vi.useFakeTimers();
    renderWithColors({ colors: null });
    await settle();

    for (const line of drawnColors()) expect(line).toBe("rgb(255, 255, 255)");
    expect(mentionsColor(shadowOf(0), "#000000")).toBe(true);
    expect(screen.queryByTestId("photo-card-subtitle-colors-unavailable")).toBeNull();
  });

  /**
   * 🔴 조회 자체가 실패한 것은 다른 사실입니다. 흰 글씨가 아무 말 없이 앉아 있으면 그게 결과라고 읽히는데,
   * 그건 886 이 만들고 888 이 닫으려던 바로 그 어긋남입니다. 그래서 여기서만 소리를 냅니다.
   */
  it("admits it is showing white when the lookup itself failed", async () => {
    vi.useFakeTimers();
    renderWithColors("fails");
    await settle();

    for (const line of drawnColors()) expect(line).toBe("rgb(255, 255, 255)");
    const note = screen.getByTestId("photo-card-subtitle-colors-unavailable");
    expect(note.textContent).toContain("불러오지 못해");
    expect(note.textContent).not.toContain("raw backend detail");
  });

  /**
   * 🔴 색은 그림의 **한 띠**에 속합니다. 슬라이더가 떠난 자리의 답을 그대로 칠하면, 미리보기가 다른 곳의
   * 색을 이 자리의 색이라고 말하는 셈입니다. 그래서 실패하면 마지막 답을 지키지 않고 흰색으로 떨어집니다.
   */
  it("drops a stale answer rather than keeping colours that belong to a band the slider has left", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
      if (String(input).endsWith(`center=${0.6}`)) return jsonResponse(500, {});
      return jsonResponse(200, { colors: COLORS });
    });
    vi.stubGlobal("fetch", fetchMock);
    const { rerender } = render(
      <PhotoCardSubtitleFieldset projectId="card_1" quote={TWO_PART} aspectRatio="9:16" layout={DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT} onChange={vi.fn()} />,
    );
    await settle();
    expect(drawnColors()[0]).toBe("rgb(255, 193, 77)");

    rerender(
      <PhotoCardSubtitleFieldset projectId="card_1" quote={TWO_PART} aspectRatio="9:16" layout={{ ...DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT, center: 0.6 }} onChange={vi.fn()} />,
    );
    await settle();

    for (const line of drawnColors()) expect(line).toBe("rgb(255, 255, 255)");
    expect(screen.getByTestId("photo-card-subtitle-colors-unavailable")).toBeTruthy();
  });

  it("asks for the weights the two subtitle files actually are", () => {
    renderFieldset(TWO_PART);
    const nodes = Array.from(screen.getByTestId("photo-card-subtitle-preview").querySelectorAll("div")) as unknown as HTMLElement[];
    const quote = nodes.find((node) => node.style.fontFamily.includes("Serif"));
    const body = nodes.find((node) => node.style.fontFamily.includes("Sans"));
    expect(quote!.style.fontWeight).toBe("700");
    expect(body!.style.fontWeight).toBe("700");
  });
});
