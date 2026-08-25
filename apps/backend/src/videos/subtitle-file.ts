const FONT_FAMILY = "Noto Sans KR";

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
export function sceneSubtitleAss(text: string, durationSeconds: number, width: number, height: number): string {
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
 * ffmpeg's `subtitles` filter parses its argument as a colon-separated option string, so both a literal `:`
 * (Windows drive letters) and `\` need escaping — and on Windows, `\` must become `/` first so it is not
 * itself read as an escape character before the `:` escaping runs.
 */
export function escapeForFfmpegFilterPath(filePath: string): string {
  return filePath.replaceAll("\\", "/").replaceAll(":", "\\:");
}
