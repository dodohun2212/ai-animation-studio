const FONT_FAMILY = "Noto Sans KR";
/**
 * The photo card's first line only. Named here, matched by libass against the file in `fonts/` — so the name
 * and the file's own internal family name have to agree exactly, and a disagreement is silent: libass falls
 * back to whatever the machine has installed, which renders on the author's computer and differently on every
 * other one. subtitle-font.test.ts reads the family out of the file itself for that reason.
 */
const QUOTE_FONT_FAMILY = "Noto Serif KR";

/** Where a photo card's text sits and how big it is. Both are ratios of the frame height, so they hold at any output size. */
export const PHOTO_CARD_SUBTITLE_SCALE = 0.027;
/**
 * The vertical centre of the whole text block, as a fraction of frame height.
 *
 * Not the middle, and not the bottom. The bottom is where subtitles were (`MarginV` at 0.042 of height), and on
 * Reels the bottom fifth is covered by the caption, the account name and the buttons — the text was simply not
 * visible where it was. 0.40 is the closest point to the picture's own focus that the app's overlay does not
 * reach; dead centre put the last line under the right-hand button column. It is "not covered, and near the
 * focus", not a measured optimum — vertical-video gaze studies agree on centre-and-above and not on a number
 * (Cowork Round 434, who rendered the drafts and had 캡틴D choose between them).
 */
export const PHOTO_CARD_SUBTITLE_CENTER = 0.40;

/** ASS timestamp: H:MM:SS.CC (centiseconds), per the format's fixed field widths. */
function timestamp(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const hours = Math.floor(clamped / 3600);
  const minutes = Math.floor((clamped % 3600) / 60);
  const wholeSeconds = Math.floor(clamped % 60);
  const centiseconds = Math.round((clamped - Math.floor(clamped)) * 100);
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(wholeSeconds).padStart(2, "0")}.${String(centiseconds).padStart(2, "0")}`;
}

/** ASS Dialogue text escaping: literal newlines become the format's own line-break token, braces would otherwise be read as inline override tags. */
function escapeDialogueText(text: string): string {
  return text.replaceAll("{", "｛").replaceAll("}", "｝").replaceAll("\n", "\\N");
}

/**
 * One scene's single-cue subtitle file, burned into that scene's own normalized clip before concatenation —
 * the same per-scene approach ffmpeg-merge.service.ts already uses for narration audio, so a subtitle only
 * ever needs a 0-based timestamp against its own clip's duration rather than a cumulative offset across the
 * whole video. `PlayResX`/`PlayResY` are set to the actual output frame size (from outputSize(ratio) — the
 * same numbers passed to the `scale`/`pad` normalize filter) so the style's pixel sizes/margins land at the
 * true resolution regardless of aspect ratio. References {@link FONT_FAMILY} by name only; the actual font
 * FILE is supplied at burn time via the `subtitles` filter's `fontsdir` option (see ffmpeg-merge.service.ts),
 * not embedded here.
 */
export function sceneSubtitleAss(text: string, durationSeconds: number, width: number, height: number, layout: SubtitleLayout = "scene"): string {
  if (layout === "photo-card") return photoCardSubtitleAss(text, durationSeconds, width, height);
  const fontSize = Math.round(height * 0.033); // ~64px at a 1920-tall portrait frame, scales with resolution
  const margin = Math.round(height * 0.042);
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Default,${FONT_FAMILY},${fontSize},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,3,1,2,${margin},${margin},${margin},1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,${timestamp(0)},${timestamp(durationSeconds)},Default,,0,0,0,,${escapeDialogueText(text)}`,
    "",
  ].join("\n");
}


/**
 * Which of the two subtitle looks a scene gets.
 *
 * A photo card is one still picture with one line of text over it, read at a glance; a scene is a moving shot
 * whose subtitle must stay out of the action. Raising the scene subtitle to the middle of the frame would put
 * it over the very thing the shot is showing, so this stays a branch rather than a new default.
 */
export type SubtitleLayout = "scene" | "photo-card";

/**
 * A photo card's text: an optional first line in a serif face, the rest below it, the block centred on
 * {@link PHOTO_CARD_SUBTITLE_CENTER}.
 *
 * The first line is treated as the quote's own heading only when there is a line after it. The text is typed by
 * the person, so a card with no line break has no heading — assuming two parts renders a one-line card entirely
 * in serif, which is not what any of it asked for (Cowork Round 434).
 *
 * Sizes are ratios of frame height and the heading is derived from the body rather than set on its own: one
 * handle cannot produce a pair that does not fit together, and two can (0.027 * 1.4 is the 73/52 pair 캡틴D
 * picked at 1920). `n5\pos` places each line by its own centre, so the block's position does not depend on
 * how many lines wrapped.
 */
function photoCardSubtitleAss(text: string, durationSeconds: number, width: number, height: number): string {
  const lines = text.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const hasQuote = lines.length >= 2;
  const bodyLines = hasQuote ? lines.slice(1) : lines;
  const bodySize = Math.round(height * PHOTO_CARD_SUBTITLE_SCALE);
  const headSize = Math.round(bodySize * 1.4);
  const headGap = Math.round(headSize * 1.6);
  const lineGap = Math.round(bodySize * 1.5);
  const blockHeight = (hasQuote ? headGap : 0) + lineGap * Math.max(0, bodyLines.length - 1);
  const top = Math.round(height * PHOTO_CARD_SUBTITLE_CENTER) - Math.round(blockHeight / 2);
  const bodyY = top + (hasQuote ? headGap : 0) + Math.round((lineGap * Math.max(0, bodyLines.length - 1)) / 2);
  // `\pos` overrides the margins for placement but not for wrapping, so these still keep a long line off the
  // edges of the frame.
  const margin = Math.round(width * 0.07);
  const centre = Math.round(width / 2);
  const style = (name: string, font: string, size: number, bold: 0 | -1) =>
    `Style: ${name},${font},${size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,${bold},0,0,0,100,100,0,0,1,4,2,5,${margin},${margin},0,1`;
  const cue = (styleName: string, y: number, content: string) =>
    `Dialogue: 0,${timestamp(0)},${timestamp(durationSeconds)},${styleName},,0,0,0,,{\\an5\\pos(${centre},${y})}${escapeDialogueText(content)}`;
  return [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${width}`,
    `PlayResY: ${height}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    style("Quote", QUOTE_FONT_FAMILY, headSize, -1),
    style("Body", FONT_FAMILY, bodySize, 0),
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ...(hasQuote ? [cue("Quote", top, lines[0]!)] : []),
    ...(bodyLines.length > 0 ? [cue("Body", bodyY, bodyLines.join("\n"))] : []),
    "",
  ].join("\n");
}

/**
 * ffmpeg's `subtitles` filter parses its argument as a colon-separated option string, so both a literal `:`
 * (Windows drive letters) and `\` need escaping — and on Windows, `\` must become `/` first so it is not
 * itself read as an escape character before the `:` escaping runs.
 */
export function escapeForFfmpegFilterPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replaceAll(":", "\\:");
}
