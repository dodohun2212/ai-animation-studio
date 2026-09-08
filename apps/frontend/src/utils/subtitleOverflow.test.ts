import { describe, expect, it } from "vitest";

import { blockOutsideFrame } from "./subtitleOverflow.js";

const FRAME = 1920;
const fits = { centerY: 1498, height: 166, scrollWidth: 928, clientWidth: 928 };

describe("blockOutsideFrame", () => {
  it("passes the block the render actually produced", () => {
    // 0.78 / 0.033 with 빨간 장미's two-sentence narration: FFmpeg put the ink at 1417-1583 and the preview
    // measured a 166px block centred on 1498. Both are comfortably inside, and the warning must stay quiet.
    expect(blockOutsideFrame(fits, FRAME)).toBe(false);
  });

  it("catches the bottom, which is the case the bounds cannot", () => {
    /*
     * 🔴 The measurement that made this control necessary. At the largest size a four-line block at centre 0.85
     * clears the bottom by 109px, and a SIX-line block at the same 0.85 has ink on the last row of the picture.
     * Same centre, same size, different sentence — so no pair of bounds can decide it and only the drawn block
     * can (CLI Round 667 corrected my reading of exactly this).
     */
    expect(blockOutsideFrame({ ...fits, centerY: 1632, height: 400 }, FRAME)).toBe(false);
    expect(blockOutsideFrame({ ...fits, centerY: 1632, height: 620 }, FRAME)).toBe(true);
  });

  it("catches the top, which takes a block twice as tall as the highest centre the slider reaches", () => {
    /*
     * 🟠 Constructed, not measured — said plainly rather than dressed as an observation. The centre cannot go
     * above 0.30 (576px), so the top is breached only by a block taller than 1152px, which at the largest size
     * is about twice the tallest wrapped narration this project has rendered. The branch is asserted because
     * the check is symmetric and cheap, not because a reel has ever run off the top; the case that made this
     * control necessary is the one above.
     */
    expect(blockOutsideFrame({ ...fits, centerY: 576, height: 1100 }, FRAME)).toBe(false);
    expect(blockOutsideFrame({ ...fits, centerY: 576, height: 1300 }, FRAME)).toBe(true);
  });

  it("catches a line too wide to break, which is never too tall", () => {
    // keep-all leaves one long Korean run unbroken; it runs off both edges while fitting vertically.
    expect(blockOutsideFrame({ ...fits, scrollWidth: 1160 }, FRAME)).toBe(true);
  });

  /**
   * 🔴 The reason this function exists at all, asserted so it cannot be quietly re-inlined.
   *
   * jsdom reports 0 for every laid-out height. A test that drove the preview component would hand this a
   * zero-height block, get `false`, and pass — while the browser was drawing text off the bottom of the frame.
   * A guard that only ever sees zeros is a guard that agrees with everything.
   */
  it("treats a zero-height block as inside, which is what jsdom would always report", () => {
    expect(blockOutsideFrame({ centerY: 1632, height: 0, scrollWidth: 0, clientWidth: 0 }, FRAME)).toBe(false);
  });
});
