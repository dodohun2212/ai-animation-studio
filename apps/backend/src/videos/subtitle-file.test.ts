import { DEFAULT_SCENE_SUBTITLE_LAYOUT, SCENE_SUBTITLE_CENTER, SUBTITLE_SIDE_MARGIN_RATIO } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";
import { escapeForFfmpegFilterPath, sceneSubtitleAss } from "./subtitle-file.js";

describe("sceneSubtitleAss", () => {
  it("produces a single-cue ASS file spanning the whole scene duration at the output resolution", () => {
    const ass = sceneSubtitleAss("첫 번째 문장입니다.", 5, 1080, 1920);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("Style: Default,Noto Sans KR,");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,{\\an5\\pos(540,1498)}첫 번째 문장입니다.");
  });

  it("formats hour/minute-scale durations with correct zero-padded fields", () => {
    const ass = sceneSubtitleAss("문장", 65.5, 1920, 1080);
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:01:05.50,Default,,0,0,0,,{\\an5\\pos(960,842)}문장");
  });

  it("escapes literal braces (ASS override-tag syntax) and converts newlines to the format's own line break", () => {
    const ass = sceneSubtitleAss("문장 {강조} 하나\n둘째 줄", 5, 1080, 1920);
    expect(ass).toContain("문장 ｛강조｝ 하나\\N둘째 줄");
    expect(ass).not.toContain("{강조}");
  });

  /**
   * Text size follows the height and the side margin follows the width — two axes, not one.
   *
   * The margin used to be 0.042 of the HEIGHT, which is close enough to right on a portrait frame to look
   * correct and is not: on a 1920x1080 landscape it left 45px of air beside a 1920-wide line, so a sentence
   * ran to within 2% of the edge of the frame while the portrait version of the same text had 81px. The two
   * assertions below are the same fact read on each axis.
   */
  it("takes text size from the frame's height and the side margin from its width", () => {
    const portrait = sceneSubtitleAss("문장", 5, 1080, 1920);
    const landscape = sceneSubtitleAss("문장", 5, 1920, 1080);
    const styleOf = (ass: string) => /Style: Default,Noto Sans KR,(\d+),.*,(\d+),(\d+),(\d+),1$/m.exec(ass)!;
    expect(Number(styleOf(portrait)[1])).toBeGreaterThan(Number(styleOf(landscape)[1]));
    expect(Number(styleOf(portrait)[2])).toBe(Math.round(1080 * SUBTITLE_SIDE_MARGIN_RATIO));
    expect(Number(styleOf(landscape)[2])).toBe(Math.round(1920 * SUBTITLE_SIDE_MARGIN_RATIO));
    expect(Number(styleOf(landscape)[2])).toBeGreaterThan(Number(styleOf(portrait)[2]));
  });

  /**
   * 🔴 The defect 캡틴D reported, stated as the thing that must not come back.
   *
   * The block used to be bottom-aligned with a vertical margin of 0.042 of the height, which put all of it
   * inside the bottom eighth of the frame — under the caption, account name and buttons Reels draws there. The
   * card was moved off that position once already and the scene branch never got the change (Cowork Round 664).
   *
   * Asserted as "above the bottom 15%" rather than as the exact default, so choosing a different default does
   * not silently make this test pass for a video nobody can read. The published range enforces the same thing
   * for every value a person can pick, which is what the second half checks.
   */
  it("keeps the text out of the strip the platform covers with its own interface", () => {
    const ass = sceneSubtitleAss("첫 번째 문장입니다.", 5, 1080, 1920);
    const y = Number(/\\pos\(\d+,(\d+)\)/.exec(ass)![1]);
    expect(y).toBeLessThan(1920 * 0.85);
    expect(DEFAULT_SCENE_SUBTITLE_LAYOUT.center).toBeLessThanOrEqual(SCENE_SUBTITLE_CENTER.max);
    expect(SCENE_SUBTITLE_CENTER.max).toBeLessThanOrEqual(0.85);
  });

  /** The chosen layout reaches the file: a value from the far end of the range lands where it was asked for. */
  it("places the block at the chosen centre, not at a fixed one", () => {
    const high = sceneSubtitleAss("문장", 5, 1080, 1920, "scene", { scene: { scale: 0.033, center: SCENE_SUBTITLE_CENTER.min } });
    expect(high).toContain(`\\pos(540,${Math.round(1920 * SCENE_SUBTITLE_CENTER.min)})`);
  });
});

describe("escapeForFfmpegFilterPath", () => {
  it("converts backslashes to forward slashes and escapes colons, in that order", () => {
    expect(escapeForFfmpegFilterPath("C:\\Users\\test\\scene1.ass")).toBe("C\\:/Users/test/scene1.ass");
  });

  it("leaves an already-forward-slash path's non-colon characters untouched", () => {
    expect(escapeForFfmpegFilterPath("/home/user/scene1.ass")).toBe("/home/user/scene1.ass");
  });
});
