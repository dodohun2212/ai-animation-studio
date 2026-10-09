/**
 * 뉴스 릴: 「기사에서 못 찾은 것」을 **어디서 고칠지** 알려 주고, 따옴표만 빼 주는 도우미.
 *
 * 🔴 이 대조 자체(`checkNewsSummary`)는 서버도 같은 함수로 막는 안전장치라 여기서 약하게 만들지 않습니다. 여기서 하는 일은
 * 막힌 사람이 **붉은 줄이 가리키는 글을 찾아 고치게** 돕는 것뿐입니다 — 붉은 줄은 어느 칸의 글인지, 어떻게 고치는지 말하지
 * 않아서 사람이 못 만들고 서 있었습니다.
 * 따옴표 빼기는 「이 말을 기사의 인용으로 내세우지 않겠다」는 사람의 결정입니다 — 말 자체는 그대로 남고 따옴표만 사라집니다.
 * 숫자·날짜는 뜻이 바뀌므로 자동으로 고치지 않고, 어느 칸에 있는지만 알려 줍니다.
 */

export interface NewsFieldRef {
  /** 화면에 보이는 칸 이름 — 「첫 줄」「2번 장면 자막」 */
  label: string;
  value: string;
}

const QUOTE_MARKS = "“”‘’「」『』'\"";

const collapse = (value: string): string => value.replace(/[\s ​]+/g, " ").trim();
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 이 글이 들어 있는 칸들 — 공백 차이는 무시합니다. */
export function fieldsContaining(span: string, fields: readonly NewsFieldRef[]): NewsFieldRef[] {
  const needle = collapse(span);
  if (!needle) return [];
  return fields.filter((field) => collapse(field.value).includes(needle));
}

/** `「글」`·`“글”` 같이 따옴표로 감싼 `span` 의 따옴표만 걷어 냅니다. 따옴표가 없으면 그대로 돌려줍니다. */
export function removeQuoteMarks(value: string, span: string): string {
  const words = collapse(span).split(" ").filter((word) => word.length > 0).map(escapeRegExp);
  if (words.length === 0) return value;
  const body = words.join("[\\s\\u00a0\\u200b]+");
  const pattern = new RegExp(`[${escapeRegExp(QUOTE_MARKS)}]([\\s\\u00a0\\u200b]*${body}[\\s\\u00a0\\u200b]*)[${escapeRegExp(QUOTE_MARKS)}]`, "g");
  return value.replace(pattern, (_match, inner: string) => inner.trim());
}
