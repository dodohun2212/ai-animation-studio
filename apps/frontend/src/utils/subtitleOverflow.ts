/** What the DOM reports about one drawn subtitle block, in frame pixels. */
export interface DrawnBlock {
  /** Where the block is centred — `\an5\pos`'s y, which the preview reproduces with translateY(-50%). */
  centerY: number;
  /** The block's laid-out height, however many lines it wrapped into. */
  height: number;
  /** Widest laid-out content, and the box it has to fit in. Equal unless something refused to break. */
  scrollWidth: number;
  clientWidth: number;
}

/**
 * Whether a subtitle block falls outside the frame.
 *
 * 🔴 Separated from the component that measures it because the measurement cannot be tested and this can.
 * jsdom has no layout engine — every `offsetHeight` there is 0 — so a test driving the preview would find a
 * block of no height sitting comfortably inside the frame no matter what it was given, and would pass while
 * saying nothing. That is the exact shape of a guard that protects itself instead of the product.
 *
 * So the DOM supplies the four numbers and this decides. The numbers themselves were checked against the real
 * render: at 1080x1920 the preview's block centre landed on 1498 against FFmpeg's ink centre of 1500, and its
 * three line widths came out 702/781/597 against the render's 687/767/588 — a consistent ~2% that is an
 * advance width measured against an ink bounding box, not a disagreement about where the text broke.
 *
 * Why it matters more here than on a photo card: a card is one line somebody typed and looked at, while a reel
 * is one layout applied to every scene's sentence, and the longest of them is the one that runs off. The
 * shared bounds cannot close this — a block's height depends on how much text there is, so a range can bound
 * the control and cannot promise the text stays inside the frame (SCENE_SUBTITLE_CENTER says so in its own
 * note). This is what closes it.
 */
export function blockOutsideFrame(block: DrawnBlock, frameHeight: number): boolean {
  const half = block.height / 2;
  if (block.centerY - half < 0) return true;
  if (block.centerY + half > frameHeight) return true;
  // Sideways too, and it is not hypothetical: `keep-all` refuses to break inside a Korean word, so one long
  // unbroken run is wider than the frame without the block ever being taller than it.
  return block.scrollWidth > block.clientWidth;
}
