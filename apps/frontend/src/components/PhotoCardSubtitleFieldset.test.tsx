import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT, PHOTO_CARD_SUBTITLE_CSS_RATIO } from "@ai-animation-studio/shared";

import { PhotoCardSubtitleFieldset } from "./PhotoCardSubtitleFieldset.js";

const TWO_PART = "불광불급(不狂不及)\n미치도록 몰입한 사람만이,";

function renderFieldset(quote: string, layout = DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT, onChange = vi.fn()) {
  render(
    <PhotoCardSubtitleFieldset
      projectId="card_1"
      quote={quote}
      vertical
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

/** The renderer stacks lines by absolute top; reading it back is how a layout test says "where", not "how it looked". */
function tops(): number[] {
  const preview = screen.getByTestId("photo-card-subtitle-preview");
  const nodes = Array.from(preview.querySelectorAll("div[style*='top']")) as unknown as HTMLElement[];
  return nodes.map((node) => parseFloat(node.style.top));
}

describe("PhotoCardSubtitleFieldset", () => {
  /**
   * The split is the whole reason two styles exist: the first line is the 사자성어 and gets the serif face, the
   * rest is the meaning. A card written as one line has no 사자성어 — setting it in the quote face anyway would
   * be the preview claiming a distinction the renderer does not make.
   */
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
   * The weights have to be the ones the files actually are.
   *
   * Both faces used to be variable and both defaulted to their thinnest instance — Serif ExtraLight 200, Sans
   * Thin 100 — and nothing loaded them here at all, so `fontWeight: 700` and `400` measured identically and
   * the 사자성어 line looked thin on screen while the burned-in subtitle was already Bold. The repo now holds
   * one static file per family, Serif Bold and Sans Medium, and styles.css declares each at that weight. Asking
   * for a weight the file is not puts the browser back on nearest-match, which is the guess the render side
   * deliberately stopped relying on.
   */
  it("asks for the weights the two subtitle files actually are", () => {
    renderFieldset(TWO_PART);
    const nodes = Array.from(screen.getByTestId("photo-card-subtitle-preview").querySelectorAll("div")) as unknown as HTMLElement[];
    const quote = nodes.find((node) => node.style.fontFamily.includes("Serif"));
    const body = nodes.find((node) => node.style.fontFamily.includes("Sans"));
    expect(quote!.style.fontWeight).toBe("700");
    expect(body!.style.fontWeight).toBe("500");
  });
});
