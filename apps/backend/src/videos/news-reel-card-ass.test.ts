import { newsReelCardGeometry, type NewsReelCard } from "@ai-animation-studio/shared";
import { describe, expect, it } from "vitest";

import { newsReelCardAss } from "./news-reel-card-ass.js";

const CARD: NewsReelCard = {
  publisher: "연합뉴스",
  headline: { line1: "검찰청 폐지 하루 만에", line2: "후속 법률 51건 통과" },
  captions: [{ line1: "9월 17일 국회 본회의", line2: "개정법은 10월 2일부터" }],
  creditRequired: false,
};

const WIDTH = 1080;
const HEIGHT = 1920;
const ass = (card: NewsReelCard = CARD) => newsReelCardAss(card, 0, 10, WIDTH, HEIGHT);
/**
 * 🔴 Each picture is its own scene and draws **its own** caption, under the same headline (캡틴D, 2026-09-22:
 * one caption held the same two lines for thirty seconds across three pictures).
 */
describe("a card with a caption per picture", () => {
  const three: NewsReelCard = {
    ...CARD,
    captions: [
      { line1: "9월 17일 국회 본회의", line2: null },
      { line1: "재석 289명 중 180명 찬성", line2: "여야 표결" },
      { line1: "개정법은 10월 2일부터", line2: null },
    ],
  };
  const dialogue = (scene: number) => newsReelCardAss(three, scene, 10, 1080, 1920).split("\n").filter((line) => line.startsWith("Dialogue:")).join("\n");

  it("draws each picture's own caption and no other", () => {
    expect(dialogue(1)).toContain("재석 289명 중 180명 찬성");
    expect(dialogue(1)).toContain("여야 표결");
    expect(dialogue(1)).not.toContain("9월 17일 국회 본회의");
    expect(dialogue(2)).toContain("개정법은 10월 2일부터");
  });

  it("keeps the headline the same on every picture", () => {
    for (const scene of [0, 1, 2]) expect(dialogue(scene)).toContain("검찰청 폐지 하루 만에");
  });

  it("refuses a picture the card has no caption for, rather than borrowing a neighbour's", () => {
    expect(() => newsReelCardAss(three, 3, 10, 1080, 1920)).toThrow(/picture 4 of 3/);
  });
});

const events = (text: string): string[] => text.split("\n").filter((line) => line.startsWith("Dialogue:"));
const styleRow = (text: string, name: string): string => text.split("\n").find((line) => line.startsWith(`Style: ${name},`))!;

describe("news reel card overlay", () => {
  it("draws the frame it was given, not a default one", () => {
    const text = ass();
    expect(text).toContain(`PlayResX: ${WIDTH}`);
    expect(text).toContain(`PlayResY: ${HEIGHT}`);
  });

  /**
   * 🔴 두 줄이 **두 색**이라 두 큐다. 한 큐에 줄바꿈으로 넣으면 색을 둘로 못 준다 — 계약이 칸을 둘로 나눈
   * 것과 같은 이유다.
   */
  it("gives the second headline line its own colour", () => {
    const text = ass();
    const white = styleRow(text, "Headline");
    const accent = styleRow(text, "HeadlineAccent");

    expect(white).not.toBe(accent);
    expect(white, "첫 줄은 흰색입니다").toContain("&H00FFFFFF");
    expect(accent, "둘째 줄은 노란색입니다").toContain("&H0000D4FF");
    expect(events(text).filter((line) => line.includes(",HeadlineAccent,"))).toHaveLength(1);
  });

  it("puts every line where the shared geometry says, so a preview can agree with the render", () => {
    const g = newsReelCardGeometry(WIDTH, HEIGHT, 2);
    const text = ass();

    const at = (y: number, line: string) => String.raw`{\an5\pos(` + `${g.centerX},${y}` + String.raw`)}` + line;
    expect(text).toContain(at(g.headline1Y, "검찰청 폐지 하루 만에"));
    expect(text).toContain(at(g.headline2Y, "후속 법률 51건 통과"));
    expect(text).toContain(at(g.caption1Y, "9월 17일 국회 본회의"));
    expect(text).toContain(at(g.publisherY, "연합뉴스"));
  });

  it("takes its letter sizes from the geometry rather than naming any", () => {
    const g = newsReelCardGeometry(WIDTH, HEIGHT, 2);
    expect(styleRow(ass(), "Headline")).toContain(`,${g.headlineSize},`);
    expect(styleRow(ass(), "Caption")).toContain(`,${g.captionSize},`);
  });

  /**
   * 🔴 한도가 20 → 18 로 줄기 전에 만든 릴(`오늘의_뉴스` 는 여섯 자막이 전부 19~20자)을 다시 병합해도, 자막이
   * 폭을 넘어 띠 밖으로 접히지 않습니다. 크기는 릴 전체의 가장 긴 줄에서 — 그림마다 달라지지 않습니다.
   */
  it("sizes an older reel's captions by its longest line, the same on every picture", () => {
    const old: NewsReelCard = { ...CARD, captions: [{ line1: "가".repeat(20), line2: null }, { line1: "짧은 자막", line2: null }] };
    const expected = newsReelCardGeometry(WIDTH, HEIGHT, 1, 20).captionSize;

    expect(expected).toBeLessThan(newsReelCardGeometry(WIDTH, HEIGHT, 1).captionSize);
    expect(styleRow(newsReelCardAss(old, 0, 10, WIDTH, HEIGHT), "Caption")).toContain(`,${expected},`);
    expect(styleRow(newsReelCardAss(old, 1, 10, WIDTH, HEIGHT), "Caption"), "짧은 자막의 그림도 같은 크기").toContain(`,${expected},`);
  });

  /** 🟠 띠가 자막 글자 위에 오면 자막이 안 보인다. 층이 낮은 쪽이 먼저 깔린다. */
  it("draws both bands under everything else", () => {
    const drawn = events(ass()).filter((line) => line.includes(String.raw`\p1`));
    expect(drawn).toHaveLength(2);
    for (const line of drawn) expect(line.startsWith("Dialogue: 0,"), "띠는 층 0 입니다").toBe(true);
    for (const line of events(ass()).filter((one) => !one.includes(String.raw`\p1`))) {
      expect(line.startsWith("Dialogue: 1,"), "글자는 층 1 입니다").toBe(true);
    }
  });

  it("draws the bands at the geometry's own edges, right across the frame", () => {
    const g = newsReelCardGeometry(WIDTH, HEIGHT, 2);
    const text = ass();
    expect(text).toContain(`m 0 0 l ${WIDTH} 0 ${WIDTH} ${g.bandHeight} 0 ${g.bandHeight}`);
    expect(text).toContain(`m 0 ${g.captionBandY} l ${WIDTH} ${g.captionBandY} ${WIDTH} ${g.captionBandY + g.captionBandHeight} 0 ${g.captionBandY + g.captionBandHeight}`);
  });

  /**
   * 🟠 아래 띠는 **그림을 덜 가려야** 한다 — 프레임의 대부분이 그림이고, 바닥을 통째로 덮으면 자막 값어치보다
   * 잃는 것이 크다. 위 띠는 언론사 이름이 앉는 자리라 불투명하다.
   */
  it("lets the picture through the caption band but not the publisher band", () => {
    const text = ass();
    // 🟠 ASS 는 `&HAABBGGRR` 이라 색이 뒤집혀 적힙니다 — #0B1E3A 가 `3A1E0B` 입니다.
    expect(styleRow(text, "Band"), "위 띠는 불투명합니다").toContain("&H003A1E0B");
    expect(styleRow(text, "CaptionBand"), "아래 띠는 비칩니다").toContain("&H503A1E0B");
  });

  /** 🔴 한 줄짜리 자막은 **둘째 줄 큐가 아예 없어야** 한다 — 빈 큐는 띠 안에 빈 줄을 남긴다. */
  it("writes no second caption cue when there is no second caption line", () => {
    const oneLine = ass({ ...CARD, captions: [{ line1: "9월 17일 국회 본회의", line2: null }] });
    expect(events(oneLine).filter((line) => line.includes(",Caption,"))).toHaveLength(1);
    expect(events(ass()).filter((line) => line.includes(",Caption,"))).toHaveLength(2);
  });

  /** 🔴 중괄호는 ASS 에서 명령어다 — 기사에서 따라온 중괄호가 카드의 절반을 지울 수 있다. */
  it("keeps a brace in the text from being read as a command", () => {
    const text = ass({ ...CARD, headline: { line1: "{여기}", line2: "나" } });
    expect(text).toContain("｛여기｝");
    expect(text).not.toContain("{여기}");
  });

  it("holds every line for the whole card", () => {
    for (const line of events(ass())) expect(line).toContain("0:00:00.00,0:00:10.00");
  });
});
