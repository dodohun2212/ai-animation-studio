import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT } from "@ai-animation-studio/shared";

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

  // Said rather than implied: the browser is not ffmpeg, and a preview that quietly claims to be exact is
  // worse than one that names the one thing it cannot promise.
  it("says the letterforms may differ from the finished video", () => {
    renderFieldset(TWO_PART);
    expect(screen.getByTestId("photo-card-subtitle-approximate").textContent).toContain("글꼴");
  });
});
