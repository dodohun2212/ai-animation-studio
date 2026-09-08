import { DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT, DEFAULT_SCENE_SUBTITLE_LAYOUT, PHOTO_CARD_SUBTITLE_OUTLINE, PHOTO_CARD_SUBTITLE_SHADOW, SCENE_SUBTITLE_OUTLINE, SCENE_SUBTITLE_SHADOW, photoCardSubtitleGeometry, sceneSubtitleGeometry, splitPhotoCardSubtitle, type PhotoCardSubtitleLayout, type SceneSubtitleLayout } from "@ai-animation-studio/shared";

/**
 * The families the subtitles name, exported so the guard that checks `fonts/` reads them from here rather than
 * keeping its own list — a list that would go on validating a family nothing names any more, and leave the new
 * one unwatched, on the day one of these changes.
 */
export const FONT_FAMILY = "Noto Sans KR";
/**
 * The photo card's first line only. Named here, matched by libass against the file in `fonts/` — so the name
 * and the file's own internal family name have to agree exactly, and a disagreement is silent: libass falls
 * back to whatever the machine has installed, which renders on the author's computer and differently on every
 * other one. subtitle-file.photo-card.test.ts reads the family out of the file itself for that reason.
 */
export const QUOTE_FONT_FAMILY = "Noto Serif KR";

/**
 * The numbers live in packages/shared because the screen that offers the control and the render that obeys it
 * have to agree about them — including the bounds, which are refusals here and a slider's ends there.
 */

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
export function sceneSubtitleAss(
  text: string,
  durationSeconds: number,
  width: number,
  height: number,
  layout: SubtitleLayout = "scene",
  layouts: SubtitleLayouts = {},
): string {
  if (layout === "photo-card") return photoCardSubtitleAss(text, durationSeconds, width, height, layouts.card ?? DEFAULT_PHOTO_CARD_SUBTITLE_LAYOUT);
  // Every number comes from the shared geometry, which the screen offering the slider previews from too.
  const { size, y, centerX, margin } = sceneSubtitleGeometry(width, height, layouts.scene ?? DEFAULT_SCENE_SUBTITLE_LAYOUT);
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
    // Alignment 5 and MarginV 0, like the card's: the cue carries its own `\pos`, and a positioned line takes
    // no vertical margin. Leaving Alignment 2 here would make the file say two different things about where
    // the text goes, and only one of them would be obeyed.
    `Style: Default,${FONT_FAMILY},${size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,${SCENE_SUBTITLE_OUTLINE},${SCENE_SUBTITLE_SHADOW},5,${margin},${margin},0,1`,
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    `Dialogue: 0,${timestamp(0)},${timestamp(durationSeconds)},Default,,0,0,0,,{\\an5\\pos(${centerX},${y})}${escapeDialogueText(text)}`,
    "",
  ].join("\n");
}


/**
 * Which of the two subtitle looks a scene gets.
 *
 * A photo card is one still picture with one line of text over it, read at a glance; a scene is a moving shot
 * whose subtitle must stay out of the action. Raising the scene subtitle to the middle of the frame would put
 * it over the very thing the shot is showing, so this stays a branch rather than a new default.
 *
 * 🟠 The two branches now place text the same WAY — `\an5\pos` on a block centre, from a shared geometry — and
 * that is not the same as being one layout. What still differs is what each is placing: a card splits its text
 * into a serif heading and a sans body and positions two cues; a scene is one cue, one face, wrapped
 * automatically, at a centre far enough down to leave the shot alone. The old scene branch used bottom
 * alignment with a vertical margin, which put the block inside the fifth of the frame Reels covers with its
 * own caption and buttons — the defect the card had already been moved off (Cowork Round 664 ①).
 */
export type SubtitleLayout = "scene" | "photo-card";

/**
 * The chosen numbers for whichever branch runs, by name.
 *
 * 🔴 Named keys rather than two more positional parameters, and this is the whole defence. `SceneSubtitleLayout`
 * and `PhotoCardSubtitleLayout` are both `{ scale, center }`, so TypeScript accepts either in either position —
 * two trailing arguments of the same shape could be swapped and nothing would be red. What it would produce is
 * not a subtle difference: a card's 0.40 on a scene puts the narration across the middle of the shot, which is
 * the one place subtitle-file.ts has always refused to put it. Under this shape a mix-up has to be written as
 * the wrong property name, which is checked (Cowork Round 664 ⑤ asked for the separation and gave this reason).
 *
 * Both optional: each branch reads only its own, and an absent one means that layout's published default.
 */
export interface SubtitleLayouts {
  scene?: SceneSubtitleLayout;
  card?: PhotoCardSubtitleLayout;
}

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
function photoCardSubtitleAss(text: string, durationSeconds: number, width: number, height: number, card: PhotoCardSubtitleLayout): string {
  const { heading, body } = splitPhotoCardSubtitle(text);
  // Every number comes from the shared geometry, which the preview screen draws from too — a second copy of
  // this arithmetic is a preview that can disagree with the video without anything saying so.
  const { bodySize, headSize, headingY, bodyY, centerX, margin } = photoCardSubtitleGeometry(width, height, card, body.length, heading !== undefined);
  const style = (name: string, font: string, size: number, bold: 0 | -1) =>
    `Style: ${name},${font},${size},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,${bold},0,0,0,100,100,0,0,1,${PHOTO_CARD_SUBTITLE_OUTLINE},${PHOTO_CARD_SUBTITLE_SHADOW},5,${margin},${margin},0,1`;
  const cue = (styleName: string, y: number, content: string) =>
    `Dialogue: 0,${timestamp(0)},${timestamp(durationSeconds)},${styleName},,0,0,0,,{\\an5\\pos(${centerX},${y})}${escapeDialogueText(content)}`;
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
    ...(heading !== undefined ? [cue("Quote", headingY, heading)] : []),
    ...(body.length > 0 ? [cue("Body", bodyY, body.join("\n"))] : []),
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
