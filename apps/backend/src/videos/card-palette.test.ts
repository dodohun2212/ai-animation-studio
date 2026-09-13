import { describe, expect, it } from "vitest";

import { assColour, CARD_BAND_SAMPLE, cardSubtitleColors, contrastRatio, relativeLuminance, type Rgb } from "./card-palette.js";

const COUNT = CARD_BAND_SAMPLE.width * CARD_BAND_SAMPLE.height;

/** A band sample where `share` of the pixels are `a` and the rest `b`, interleaved. */
function band(a: Rgb, b: Rgb = a, share = 1): Uint8Array {
  const bytes = new Uint8Array(COUNT * 3);
  for (let index = 0; index < COUNT; index += 1) {
    const { r, g, b: blue } = index % 100 < share * 100 ? a : b;
    bytes.set([r, g, blue], index * 3);
  }
  return bytes;
}

const bandLuminance = (sample: Uint8Array) => {
  let sum = 0;
  for (let offset = 0; offset < sample.length; offset += 3) sum += relativeLuminance({ r: sample[offset]!, g: sample[offset + 1]!, b: sample[offset + 2]! });
  return sum / COUNT;
};

describe("a photo card's subtitle colours, from the picture under the text", () => {
  it("puts pale text with a tint of the picture's colour on a dark band, and a stronger accent on the first line", () => {
    const navy = band({ r: 20, g: 40, b: 110 });
    const colours = cardSubtitleColors(navy)!;
    expect(relativeLuminance(colours.body)).toBeGreaterThan(0.7);
    expect(colours.heading.b, "the accent takes the band's blue").toBeGreaterThan(colours.heading.r);
    expect(relativeLuminance(colours.outline)).toBeLessThan(0.05);
  });

  it("puts dark text on a bright band", () => {
    const yellow = band({ r: 250, g: 215, b: 60 });
    const colours = cardSubtitleColors(yellow)!;
    expect(relativeLuminance(colours.body)).toBeLessThan(0.1);
    expect(colours.heading.r, "the accent keeps the band's warm hue").toBeGreaterThan(colours.heading.b);
    expect(relativeLuminance(colours.outline)).toBeGreaterThan(0.8);
  });

  it("stays neutral when the band has no real colour, with the first line the same as the rest", () => {
    const colours = cardSubtitleColors(band({ r: 60, g: 60, b: 60 }))!;
    expect(colours.body.r).toBe(colours.body.g);
    expect(colours.body.g).toBe(colours.body.b);
    expect(colours.heading).toEqual(colours.body);
  });

  /*
   * The rule the colours must never trade away. Checked on bands made of two colours in varying shares — a sky and
   * its clouds, a field and its flowers — including the mid-greys where neither white nor black is comfortable.
   */
  it("always reads at 4.5:1 against the band, however pretty the colour", () => {
    let seed = 7;
    const next = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % 256; };
    for (let trial = 0; trial < 200; trial += 1) {
      const sample = band({ r: next(), g: next(), b: next() }, { r: next(), g: next(), b: next() }, (next() % 10) / 10);
      const colours = cardSubtitleColors(sample)!;
      const background = bandLuminance(sample);
      expect(contrastRatio(relativeLuminance(colours.body), background), `trial ${trial}`).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(relativeLuminance(colours.heading), background), `trial ${trial}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("answers nothing for a buffer that is not the sample it asked for, so the card keeps plain white", () => {
    expect(cardSubtitleColors(new Uint8Array(8))).toBeUndefined();
    expect(cardSubtitleColors(new Uint8Array(COUNT * 3 - 3))).toBeUndefined();
  });

  it("writes ASS colours blue-green-red, alpha first", () => {
    expect(assColour({ r: 0x12, g: 0x34, b: 0x56 })).toBe("&H00563412");
    expect(assColour({ r: 0, g: 0, b: 0 }, 0x80)).toBe("&H80000000");
  });
});
