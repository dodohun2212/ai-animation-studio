/**
 * Does this summary only say things the article says?
 *
 * 🔴 이 파일이 뉴스 요약 릴스 기능의 안전장치입니다. 나머지(목록·고르기·출처 칸)는 편의지만 이건 아닙니다.
 *
 * 요약을 AI 에게 시키면 원문에 없는 **숫자·날짜·따옴표**를 그럴듯하게 만들어 냅니다. 51건이 53건이 되고,
 * 10월 2일이 10월 12일이 되고, 아무도 하지 않은 말이 인용부호 안에 들어갑니다. 꽃말 릴이면 시시하지만
 * 뉴스는 다릅니다 — 틀린 사실이 **예쁘게 만들어져 퍼집니다.** 이 앱이 그걸 만드는 기계가 되면 안 됩니다.
 *
 * 그래서 규칙은 하나입니다: **요약이 말하는 딱딱한 사실은 전부 원문에 글자 그대로 있어야 한다.**
 * 하나라도 못 찾으면 화면이 만들기를 막습니다. 사람이 고치거나 다시 요약하는 것이지, 앱이 "아마 맞겠지"
 * 하고 넘어갈 자리가 아닙니다.
 *
 * 🟠 이 검사가 잡는 것과 못 잡는 것을 분명히 해 둡니다. 잡는 것: 없는 숫자·없는 날짜·없는 인용문.
 * **못 잡는 것: 있는 숫자를 틀린 곳에 붙이는 것**("예산이 51조"처럼 51 도 조도 원문에 있지만 붙여 쓴 적은
 * 없는 경우)과 뜻을 뒤집는 것("통과했다" → "부결됐다"). 그건 사람이 읽어야 합니다. 이 검사는 **바닥**이지
 * 천장이 아니고, 화면의 문구도 그렇게 말해야 합니다.
 *
 * 백엔드가 없어도 도는 순수 함수입니다 — 요약문과 원문 두 문자열만 받습니다. 그래서 요약을 어디서
 * 만들었든(사람이 쓰든, 나중에 서버가 만들든) 같은 검사가 붙습니다.
 */

/** 못 찾은 것 하나. `kind` 는 화면이 무엇을 고치라고 말할지 가릅니다. */
export interface UnverifiedClaim {
  kind: "number" | "date" | "quote";
  /** 요약에 나온 그대로 — 화면이 이 글자를 짚어 줍니다. */
  text: string;
}

export interface NewsSummaryCheck {
  /** 비어 있으면 통과. 하나라도 있으면 만들기를 막습니다. */
  unverified: UnverifiedClaim[];
  /** 검사한 항목 수 — 0 이면 「검사할 게 없었다」이지 「통과」가 아닙니다. 화면이 그 둘을 갈라 말합니다. */
  checked: number;
}

/**
 * 비교 전에 양쪽을 같은 모양으로 만듭니다.
 *
 * 🔴 이 정규화가 느슨하면 검사가 거짓으로 통과하고, 빡빡하면 멀쩡한 요약을 막습니다. 여기서 지우는 것은
 * **뜻을 바꾸지 않는 것**만입니다: 공백의 종류와 개수, 그리고 따옴표의 모양(곧은 것 · 둥근 것 · 낫표).
 * 숫자의 자릿점(1,000)은 **지웁니다** — 원문이 「1,000」이고 요약이 「1000」이면 같은 사실입니다.
 */
function normalize(text: string): string {
  return text
    .replace(/[\u201C\u201D\u2018\u2019\u300C\u300D\u300E\u300F]/g, '"')
    .replace(/(\d),(\d)/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 날짜처럼 생긴 것 — 한국어 표기와 숫자 표기 둘 다.
 *
 * 날짜를 숫자 여러 개로 쪼개 보면 못 잡습니다. 「10월 2일」의 `10` 과 `2` 는 긴 기사 어딘가에 거의 항상
 * 있어서, 쪼개서 검사하면 **지어낸 날짜가 통과합니다.** 붙은 덩어리째 찾아야 합니다.
 */
const DATE_PATTERNS: RegExp[] = [
  /\d{4}년\s*\d{1,2}월\s*\d{1,2}일/g,
  /\d{1,2}월\s*\d{1,2}일/g,
  /\d{4}년\s*\d{1,2}월/g,
  /\d{4}-\d{1,2}-\d{1,2}/g,
  /\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/g,
];

/** 숫자 + 바로 붙은 단위. 단위까지 같이 봐야 「51건」과 「51%」가 구별됩니다. */
const NUMBER_PATTERN = /\d+(?:\.\d+)?\s*(?:%|퍼센트|건|개|명|원|달러|조|억|만|천|년|월|일|주|시간|분|초|위|배|회|차|호|석|표|쪽)?/g;

/** 따옴표 안의 말. 정규화가 모든 따옴표를 `"` 로 바꿔 둡니다. */
const QUOTE_PATTERN = /"([^"]{2,})"/g;

/**
 * 날짜 덩어리는 공백이 달라도 같은 날짜입니다 — 「10월 2일」과 「10월2일」.
 *
 * 🔴 이걸 정규식으로 풀려다 두 번 틀렸습니다. 처음엔 공백을 `\s*` 로 바꾼 뒤 특수문자를 escape 해서 방금
 * 넣은 `*` 까지 escape 됐고(모든 날짜가 빨개짐), 고친 뒤에도 **요약 쪽에만 공백이 없는 경우**를 못 찾았습니다
 * — 요약의 공백을 느슨하게 만들어 봐야 원문 쪽 공백은 그대로라서요. 양쪽에서 공백을 빼고 비교하면 두 방향이
 * 한 번에 풀립니다. 날짜는 숫자와 년·월·일이 붙은 모양이라, 공백을 빼서 생기는 엉뚱한 일치가 사실상 없습니다.
 */
function dateFoundIn(source: string, date: string): boolean {
  const squeeze = (text: string): string => text.replace(/\s+/g, "");
  return squeeze(source).includes(squeeze(date));
}

/**
 * 숫자는 **양옆에 다른 숫자가 없을 때만** 찾은 것으로 칩니다.
 *
 * 🔴 그냥 부분 문자열로 찾으면 **지어낸 숫자가 통과합니다.** 원문이 「4,000」이면(정규화 뒤 `4000`) 요약의
 * 「40」이 그 안에 들어 있어서 맞은 것으로 처리됩니다 — 없는 숫자가, 진짜 큰 숫자와 앞자리가 같다는 이유로
 * 통과하는 것입니다. 이 검사가 절대 틀리면 안 되는 방향이 바로 그쪽입니다. CLI Round 910 이 자기 대조기에서
 * 같은 결함을 먼저 잡았고, 제 것도 같은 모양이었습니다.
 *
 * 소수점과 자릿점도 경계로 칩니다 — 「3.5」를 「3」이 통과시키면 안 되므로.
 */
function numberFoundIn(source: string, token: string): boolean {
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  try {
    return new RegExp(`(?<![\\d.])${escaped}(?![\\d.])`).test(source);
  } catch {
    return source.includes(token);
  }
}

/**
 * 요약이 원문 안에서만 말하고 있는지 봅니다.
 *
 * 🔴 순서가 중요합니다. 날짜를 **먼저** 뽑아 그 자리를 가려 둔 뒤 숫자를 뽑습니다. 안 그러면 「10월 2일」이
 * 숫자 `10` 과 `2` 로도 잡혀서, 날짜 검사를 통과 못 해도 숫자 검사는 통과하는 어긋난 결과가 나옵니다.
 */
export function checkNewsSummary(summary: string, articleText: string): NewsSummaryCheck {
  const source = normalize(articleText);
  let rest = normalize(summary);
  const unverified: UnverifiedClaim[] = [];
  const seen = new Set<string>();
  let checked = 0;

  const add = (kind: UnverifiedClaim["kind"], text: string): void => {
    const key = `${kind}:${text}`;
    if (seen.has(key)) return;
    seen.add(key);
    unverified.push({ kind, text });
  };

  for (const [quoted, inner] of [...rest.matchAll(QUOTE_PATTERN)].map((m) => [m[0], m[1]!] as const)) {
    checked += 1;
    if (!source.includes(inner.trim())) add("quote", inner.trim());
    rest = rest.replace(quoted, " ");
  }

  for (const pattern of DATE_PATTERNS) {
    for (const match of [...rest.matchAll(pattern)].map((m) => m[0])) {
      checked += 1;
      if (!dateFoundIn(source, match)) add("date", match);
      rest = rest.replace(match, " ");
    }
  }

  for (const match of [...rest.matchAll(NUMBER_PATTERN)].map((m) => m[0].trim())) {
    if (!match) continue;
    checked += 1;
    // 단위가 붙은 채로 먼저 찾고, 없으면 숫자만으로 한 번 더 — 원문이 「51개」인데 요약이 「51건」인 경우를
    // 지어낸 숫자와 같이 취급하면, 멀쩡한 요약이 막힙니다. 숫자 자체가 없으면 그때 진짜로 못 찾은 것입니다.
    const digits = match.replace(/[^\d.]/g, "");
    if (!numberFoundIn(source, match) && !numberFoundIn(source, digits)) add("number", match);
  }

  return { unverified, checked };
}
