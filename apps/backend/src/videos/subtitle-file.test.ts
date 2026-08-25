import { describe, expect, it } from "vitest";
import { escapeForFfmpegFilterPath, sceneSubtitleAss } from "./subtitle-file.js";

describe("sceneSubtitleAss", () => {
  it("produces a single-cue ASS file spanning the whole scene duration at the output resolution", () => {
    const ass = sceneSubtitleAss("첫 번째 문장입니다.", 5, 1080, 1920);
    expect(ass).toContain("PlayResX: 1080");
    expect(ass).toContain("PlayResY: 1920");
    expect(ass).toContain("Style: Default,Noto Sans KR,");
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:00:05.00,Default,,0,0,0,,첫 번째 문장입니다.");
  });

  it("formats hour/minute-scale durations with correct zero-padded fields", () => {
    const ass = sceneSubtitleAss("문장", 65.5, 1920, 1080);
    expect(ass).toContain("Dialogue: 0,0:00:00.00,0:01:05.50,Default,,0,0,0,,문장");
  });

  it("escapes literal braces (ASS override-tag syntax) and converts newlines to the format's own line break", () => {
    const ass = sceneSubtitleAss("문장 {강조} 하나\n둘째 줄", 5, 1080, 1920);
    expect(ass).toContain("문장 ｛강조｝ 하나\\N둘째 줄");
    expect(ass).not.toContain("{강조}");
  });

  it("scales font size and margins with output height so a landscape frame doesn't get portrait-sized text", () => {
    const portrait = sceneSubtitleAss("문장", 5, 1080, 1920);
    const landscape = sceneSubtitleAss("문장", 5, 1920, 1080);
    const fontSizeOf = (ass: string) => Number(/Style: Default,Noto Sans KR,(\d+),/.exec(ass)![1]);
    expect(fontSizeOf(portrait)).toBeGreaterThan(fontSizeOf(landscape));
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
