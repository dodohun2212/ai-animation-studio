/** 폴더 이름을 사람이 짓지 않아도 되게 — 글자·숫자·_·- 만 남깁니다. */
export function autoStoryProjectId(title: string, now: Date): string {
  const base = title.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "").slice(0, 30) || "story";
  const pad = (value: number) => String(value).padStart(2, "0");
  return `이야기_${base}_${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}
