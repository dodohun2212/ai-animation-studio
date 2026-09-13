/**
 * A photo card's subtitle colours, chosen from the picture under the text (Cowork Rounds 879/880 — 캡틴D asked for
 * text that suits its picture, 「좀 더 예쁘게」, instead of the fixed white every card had).
 *
 * The picture's text band is read as a small grid of pixels (ffmpeg samples it — see FfmpegMergeEngine), the band's
 * own colours are grouped, and the most vivid group lends its hue to the text: a pale tint of it over a dark band,
 * a deep shade of it over a bright one, and a stronger version of it for the quote's first line. Legibility is not
 * left to taste — each text colour is pushed toward white or black until it reaches WCAG's 4.5:1 against the band,
 * so a pretty colour never wins over a readable one.
 *
 * Deliberately no image library: the backend has none, the sampling is ffmpeg's (already required to merge), and
 * what is left is arithmetic on a few hundred pixels. `node-vibrant` (Cowork's suggestion) would have brought an
 * image decoder with it for the same answer.
 */

export interface Rgb { r: number; g: number; b: number }

export interface CardSubtitleColors {
  /** The body text. */
  body: Rgb;
  /** The quote's first line, when the card has one — the accent. */
  heading: Rgb;
  /** Outline, and the shadow at half opacity. */
  outline: Rgb;
}

/** The sample grid the engine asks ffmpeg for. A buffer of any other size is treated as no sample at all. */
export const CARD_BAND_SAMPLE = { width: 48, height: 16 } as const;

/** WCAG AA for normal text. */
const MIN_CONTRAST = 4.5;

const channel = (value: number) => { const c = value / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export const relativeLuminance = ({ r, g, b }: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
export const contrastRatio = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

function toHsl({ r, g, b }: Rgb): { h: number; s: number; l: number } {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn); const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rn ? ((gn - bn) / d + (gn < bn ? 6 : 0)) : max === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return { h: h / 6, s, l };
}

function fromHsl(h: number, s: number, l: number): Rgb {
  if (s === 0) { const v = Math.round(l * 255); return { r: v, g: v, b: v }; }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s; const p = 2 * l - q;
  const hue = (t: number) => {
    const u = t < 0 ? t + 1 : t > 1 ? t - 1 : t;
    return u < 1 / 6 ? p + (q - p) * 6 * u : u < 1 / 2 ? q : u < 2 / 3 ? p + (q - p) * (2 / 3 - u) * 6 : p;
  };
  return { r: Math.round(hue(h + 1 / 3) * 255), g: Math.round(hue(h) * 255), b: Math.round(hue(h - 1 / 3) * 255) };
}

/** Four groups, seeded at the band's luminance quartiles so the same picture always gives the same answer. */
function groups(pixels: readonly Rgb[]): Array<{ centre: Rgb; weight: number }> {
  const sorted = [...pixels].sort((a, b) => relativeLuminance(a) - relativeLuminance(b));
  let centres = [0.125, 0.375, 0.625, 0.875].map((q) => ({ ...sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]! }));
  let members: Rgb[][] = [];
  for (let round = 0; round < 10; round += 1) {
    members = centres.map(() => []);
    for (const pixel of pixels) {
      let best = 0; let bestDistance = Infinity;
      centres.forEach((centre, index) => {
        const distance = (centre.r - pixel.r) ** 2 + (centre.g - pixel.g) ** 2 + (centre.b - pixel.b) ** 2;
        if (distance < bestDistance) { bestDistance = distance; best = index; }
      });
      members[best]!.push(pixel);
    }
    centres = members.map((group, index) => group.length === 0 ? centres[index]! : {
      r: group.reduce((sum, p) => sum + p.r, 0) / group.length,
      g: group.reduce((sum, p) => sum + p.g, 0) / group.length,
      b: group.reduce((sum, p) => sum + p.b, 0) / group.length,
    });
  }
  return centres.map((centre, index) => ({ centre, weight: members[index]!.length / pixels.length }));
}

/** Moves `l` toward the far end until the colour reads against `background`, or the end is reached. */
function legible(h: number, s: number, l: number, background: number, light: boolean): Rgb {
  let lightness = l;
  let colour = fromHsl(h, s, lightness);
  while (contrastRatio(relativeLuminance(colour), background) < MIN_CONTRAST && (light ? lightness < 1 : lightness > 0)) {
    lightness = light ? Math.min(1, lightness + 0.02) : Math.max(0, lightness - 0.02);
    colour = fromHsl(h, s, lightness);
  }
  return contrastRatio(relativeLuminance(colour), background) >= MIN_CONTRAST ? colour : light ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
}

/**
 * The colours for a band sampled as rgb24 at {@link CARD_BAND_SAMPLE}, or `undefined` when the buffer is not
 * such a sample — the caller then keeps the plain white text, so a styling step can never fail a merge.
 */
export function cardSubtitleColors(sample: Uint8Array): CardSubtitleColors | undefined {
  if (sample.length !== CARD_BAND_SAMPLE.width * CARD_BAND_SAMPLE.height * 3) return undefined;
  const pixels: Rgb[] = [];
  for (let offset = 0; offset < sample.length; offset += 3) pixels.push({ r: sample[offset]!, g: sample[offset + 1]!, b: sample[offset + 2]! });

  const background = pixels.reduce((sum, pixel) => sum + relativeLuminance(pixel), 0) / pixels.length;
  // White or black text, whichever reads better against the band — the crossover sits near a luminance of 0.18.
  const light = contrastRatio(1, background) >= contrastRatio(0, background);

  // The most vivid group that is really there; a band with none (grey sky, black-and-white photo) stays neutral.
  const vivid = groups(pixels)
    .filter((group) => group.weight >= 0.08)
    .map((group) => ({ ...toHsl(group.centre), weight: group.weight }))
    .filter((group) => group.l > 0.12 && group.l < 0.9)
    .sort((a, b) => b.s * Math.sqrt(b.weight) - a.s * Math.sqrt(a.weight))[0];
  const hue = vivid && vivid.s >= 0.15 ? vivid.h : 0;
  const saturation = vivid && vivid.s >= 0.15 ? vivid.s : 0;

  const body = legible(hue, Math.min(saturation, 0.3), light ? 0.94 : 0.12, background, light);
  const heading = saturation === 0
    ? body
    : legible(hue, Math.min(Math.max(saturation, 0.45), 0.8), light ? 0.8 : 0.26, background, light);
  const outline = fromHsl(hue, Math.min(saturation, light ? 0.45 : 0.25), light ? 0.08 : 0.96);
  return { body, heading, outline };
}

/** ASS colour: `&HAABBGGRR`, alpha 00 opaque. */
export function assColour({ r, g, b }: Rgb, alpha = 0): string {
  const hex = (value: number) => Math.round(value).toString(16).toUpperCase().padStart(2, "0");
  return `&H${hex(alpha)}${hex(b)}${hex(g)}${hex(r)}`;
}
