import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * What the shipped font files themselves say, read straight out of their tables.
 *
 * Two guards need this and neither can take the answer from anywhere else. libass matches a style's `Fontname`
 * against the family names inside the files in `fontsdir` and a miss is silent — it falls back to a system font,
 * so a card renders on the author's machine and differently on every other one. And the preview's size ratio is
 * only correct if it accounts for how wide the face actually draws a Hangul syllable, which is a number that
 * lives in the file and changes the day the file does.
 *
 * Hand-rolled rather than a font library: three numbers and a string list, from a format that has not moved in
 * thirty years, against files this repository ships and controls. `subtitle-file.photo-card.test.ts` already
 * read two of these this way; this is that code with the third added, in one place because a second copy is a
 * second answer to "what does this file say".
 */

function tableOffset(file: Buffer, tag: string): number {
  const tableCount = file.readUInt16BE(4);
  for (let index = 0; index < tableCount; index += 1) {
    const record = 12 + index * 16;
    if (file.toString("ascii", record, record + 4) === tag) return file.readUInt32BE(record + 8);
  }
  throw new Error(`no ${tag} table`);
}

/** Family names (nameID 1 and the typographic family 16), in whichever encodings the file carries them. */
export function familyNames(file: Buffer): string[] {
  const nameTable = tableOffset(file, "name");
  const count = file.readUInt16BE(nameTable + 2);
  const storage = nameTable + file.readUInt16BE(nameTable + 4);
  const found: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const record = nameTable + 6 + index * 12;
    const platform = file.readUInt16BE(record);
    const nameId = file.readUInt16BE(record + 6);
    const length = file.readUInt16BE(record + 8);
    const at = storage + file.readUInt16BE(record + 10);
    if (nameId !== 1 && nameId !== 16) continue;
    const raw = file.subarray(at, at + length);
    found.push(platform === 3 ? Buffer.from(raw).swap16().toString("utf16le") : raw.toString("ascii"));
  }
  return found;
}

/** OS/2 usWeightClass — 100 Thin to 900 Black. */
export function usWeightClass(file: Buffer): number {
  return file.readUInt16BE(tableOffset(file, "OS/2") + 4);
}

/** The glyph a character maps to, through the file's BMP (format 4) cmap subtable. */
function glyphId(file: Buffer, codePoint: number): number {
  const cmap = tableOffset(file, "cmap");
  const subtableCount = file.readUInt16BE(cmap + 2);
  let format4: number | undefined;
  for (let index = 0; index < subtableCount; index += 1) {
    const record = cmap + 4 + index * 8;
    const at = cmap + file.readUInt32BE(record + 4);
    if (file.readUInt16BE(at) === 4) format4 = at;
  }
  if (format4 === undefined) throw new Error("no format 4 cmap subtable");

  const segCount = file.readUInt16BE(format4 + 6) / 2;
  const endCodes = format4 + 14;
  const startCodes = endCodes + segCount * 2 + 2;
  const idDeltas = startCodes + segCount * 2;
  const idRangeOffsets = idDeltas + segCount * 2;
  for (let segment = 0; segment < segCount; segment += 1) {
    if (codePoint > file.readUInt16BE(endCodes + segment * 2)) continue;
    const start = file.readUInt16BE(startCodes + segment * 2);
    if (codePoint < start) return 0;
    const delta = file.readInt16BE(idDeltas + segment * 2);
    const rangeOffset = file.readUInt16BE(idRangeOffsets + segment * 2);
    if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
    const at = idRangeOffsets + segment * 2 + rangeOffset + (codePoint - start) * 2;
    const glyph = file.readUInt16BE(at);
    return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
  }
  return 0;
}

/**
 * How wide this face draws 가, as a fraction of the em.
 *
 * 🔴 It is not 1.0, and assuming it was is what made the preview draw 8% narrow for a year: Noto Sans KR Medium
 * advances a Hangul syllable 0.920 em and Noto Serif KR Bold 0.966 em. A ratio derived without this term is off
 * by exactly this factor, and it is off silently — the video wraps a line the preview showed as fitting
 * (Cowork Round 598; 캡틴D saw it as "영상 병합하면 자막이 이렇게 안 나와").
 *
 * 가 (U+AC00) rather than an average: it is the syllable these cards are actually full of, and Hangul in these
 * faces is monospaced within the script, so one syllable answers for all of them.
 */
export function hangulEmAdvance(file: Buffer): number {
  const unitsPerEm = file.readUInt16BE(tableOffset(file, "head") + 18);
  const numberOfHMetrics = file.readUInt16BE(tableOffset(file, "hhea") + 34);
  const glyph = glyphId(file, 0xac00);
  if (glyph === 0) throw new Error("this face has no 가");
  // Past the last long metric every glyph keeps that entry's advance; the table only stops repeating it.
  const entry = Math.min(glyph, numberOfHMetrics - 1);
  return file.readUInt16BE(tableOffset(file, "hmtx") + entry * 4) / unitsPerEm;
}

/**
 * The weight an ASS style asks the font files for, which is the style's `Bold` field and nothing else.
 *
 * A subtitle style names a family and says bold or not; the file that draws it is chosen from those two facts
 * together. Written here rather than in subtitle-file.ts because it is a statement about matching FILES.
 */
export const ASS_WEIGHT = { regular: 400, bold: 700 } as const;

/**
 * The file in `fonts/` that libass will resolve a family name and a Bold flag to.
 *
 * 🟠 Two files claiming one family used to be refused outright, on the ground that the choice between them was
 * fontconfig's weight proximity — "which this app neither controls nor can test". Half of that is now measured
 * and false: with a 500 and a 700 shipped under one family name, a non-bold style renders byte-identically to
 * the 500 alone and a bold style byte-identically to the 700 alone, with no synthetic emboldening
 * (subtitle-font-weight.test.ts renders all four and compares the frames). That is the arrangement 캡틴D's bold
 * scene subtitle needs, and it is the only one available: the shipped Noto Sans KR Medium declares "Noto Sans
 * KR" as both its family (nameID 1) and its typographic family (nameID 16), so a Bold of the same face cannot
 * introduce a name nothing else claims. Weight, not a second family name, is what tells the two apart.
 *
 * What stays refused is the half that is still true. Nothing claiming the family is the silent fallback to
 * whatever the machine has installed; two files equally far from the requested weight is a choice this code
 * would be guessing at, and the render would be guessing with it.
 */
export async function fontFileForFamily(directory: string, family: string, weight: number = ASS_WEIGHT.regular): Promise<Buffer> {
  const names = (await fs.readdir(directory)).filter((name) => name.toLowerCase().endsWith(".ttf"));
  const matches: { bytes: Buffer; distance: number }[] = [];
  for (const name of names) {
    const bytes = await fs.readFile(path.join(directory, name));
    if (familyNames(bytes).includes(family)) matches.push({ bytes, distance: Math.abs(usWeightClass(bytes) - weight) });
  }
  if (matches.length === 0) throw new Error(`${family} is shipped by no file, expected exactly 1`);
  const nearest = Math.min(...matches.map((match) => match.distance));
  const closest = matches.filter((match) => match.distance === nearest);
  if (closest.length !== 1) throw new Error(`${family} at weight ${weight} is answered by ${closest.length} files, expected exactly 1`);
  return closest[0]!.bytes;
}
