import { useEffect, useRef, useState } from "react";

import { getLongProjectStoryBible, toLongStoryBibleDisplayError, updateLongStoryBibleContent } from "../api/longStoryBibleApi.js";

interface Props { projectId: string; }
type DisplayError = { code: string; message: string };
export type BibleRow = { key: string; value: string };

/**
 * `world` is a free-form string map, and the Story Bible screen used to hand it to the user as a raw JSON
 * textarea — brackets, quotes and commas to get right, with "JSON 객체 형식이어야 합니다" as the only feedback.
 * A person writing down their world cannot author that. These two translate between the stored JSON text and a
 * plain 이름 / 내용 table, so the same data is editable without typing punctuation.
 *
 * `rowsFrom` returns null when the object holds anything but strings (nested objects, arrays, numbers). That
 * data is real and must not be flattened away, so those projects keep the JSON editor as their only surface —
 * never silently rewritten into a shape the table cannot express.
 */
export function rowsFrom(draft: string): BibleRow[] | null {
  try {
    const parsed: unknown = JSON.parse(draft);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const entries = Object.entries(parsed as Record<string, unknown>);
    if (entries.some(([, value]) => typeof value !== "string")) return null;
    return entries.map(([key, value]) => ({ key, value: value as string }));
  } catch { return null; }
}

/**
 * Empty names are dropped on the way out — they are not valid keys.
 *
 * That is why the rows are state and not derived from this string. Deriving them is what the screen used to do,
 * and it made "항목 추가" do nothing at all: the new row has an empty name, this function dropped it, the JSON
 * came back unchanged, and re-deriving produced the rows from before. The button appeared broken because,
 * visibly, it was.
 */
export function draftFromRows(rows: BibleRow[]): string {
  const record: Record<string, string> = {};
  for (const row of rows) if (row.key.trim()) record[row.key.trim()] = row.value;
  return JSON.stringify(record, null, 2);
}

const fieldClassName =
  "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const jsonFieldClassName =
  "mt-1.5 min-h-28 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 font-mono text-xs text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";

/**
 * 세계관 설명 — moved here from 등장인물·설정집.
 *
 * It is a property of the work, not of any one character or Episode: script generation reads it once per
 * prompt alongside title/logline/genre, which are all edited on this screen. It sat on a screen about
 * characters only because the server happens to store it in the same file, and storage is not a reason for a
 * control to live somewhere.
 */
export function StoryWorldCard({ projectId }: Props) {
  const [rows, setRows] = useState<BibleRow[] | null>(null);
  const [draft, setDraft] = useState("{}");
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLongProjectStoryBible(projectId)
      .then(({ storyBible }) => {
        if (cancelled) return;
        const text = JSON.stringify(storyBible.world, null, 2);
        setDraft(text); setRows(rowsFrom(text)); setError(null);
      })
      .catch((caught: unknown) => { if (!cancelled) setError(toLongStoryBibleDisplayError(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId]);

  async function save(): Promise<void> {
    if (busy.current) return;
    let world: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(draft);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error();
      world = parsed as Record<string, unknown>;
    } catch { setValidationError("세계관 설정은 JSON 객체 형식이어야 합니다."); return; }
    setValidationError(null); busy.current = true; setPending(true); setJustSaved(false);
    try {
      // `basic` is sent back unchanged: this endpoint replaces both halves, and omitting it would clear
      // whatever the project has stored there — including 전체 그림체 and 주인공, which live inside it.
      const current = await getLongProjectStoryBible(projectId);
      const response = await updateLongStoryBibleContent(projectId, { basic: current.storyBible.basic, world });
      const text = JSON.stringify(response.storyBible.world, null, 2);
      setDraft(text); setRows(rowsFrom(text)); setError(null); setJustSaved(true);
    } catch (caught) { setError(toLongStoryBibleDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }

  function change(next: BibleRow[]): void {
    setRows(next); setDraft(draftFromRows(next)); setValidationError(null); setJustSaved(false);
  }

  // A row with no name is dropped on save (draftFromRows), so one blank line costs nothing and means the first
  // thing anyone can do here is start typing. An empty editor that showed only a button read as broken — which
  // is exactly how it was reported.
  const shown = rows === null ? [] : rows.length === 0 ? [{ key: "", value: "" }] : rows;

  return (
    <section aria-label="세계관 설명" data-testid="story-world-card" className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <h3 className="text-base font-semibold text-slate-100">세계관 설명</h3>
      <p className="text-sm text-slate-400">
        작품 전체에 걸쳐 <strong className="text-slate-300">꼭 지켜야 하는 것</strong>만 적으면 됩니다.
        저장해도 대본·이미지·영상은 만들어지지 않습니다.
      </p>
      {/* When this is read is the whole story, and the screen never said it. It goes into the prompt at two
          moments — 회차 나누기 and each Episode's script generation — so anything written after an Episode's
          script exists does not reach that Episode. */}
      <p data-testid="story-world-timing" className="rounded-xl border border-violet-400/25 bg-violet-500/[0.06] p-3 text-sm text-slate-300">
        여기 적은 내용은 <strong className="text-slate-100">회차 나누기</strong>와 <strong className="text-slate-100">각 회차 대본 생성</strong> 때 AI에게 전달됩니다.
        그래서 <strong className="text-slate-100">대본을 만들기 전에</strong> 적어야 합니다 — 이미 대본이 있는 회차에는 안 들어가고,
        아직 만들지 않은 회차부터 반영됩니다. 이미 만든 회차에 넣으려면 그 회차 대본을 <strong className="text-slate-100">다시 만들어야</strong> 합니다.
        {" "}
        {/* Empty is a complete answer here, and nothing said so. The prompt already treats a blank field this
            way — the outline request literally sends "자율" for one — but the section read as a form to fill
            in, so a person with nothing particular in mind had no way to know they could just move on. */}
        <strong className="text-slate-100">비워 둬도 됩니다</strong> — 정해 둔 것이 없으면 AI가 알아서 정합니다.
      </p>
      {loading && <p className="text-sm text-slate-400">불러오는 중...</p>}
      {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
      {validationError && <p role="alert" data-testid="story-world-validation-error" className="text-sm text-rose-400">{validationError}</p>}
      {!loading && rows === null && (
        <p data-testid="story-world-unsupported" className="rounded-xl border border-white/10 bg-slate-950/40 p-3 text-sm text-slate-400">
          이 프로젝트의 세계관에는 표로 보여줄 수 없는 형태의 내용이 들어 있습니다. 아래 "고급 편집"에서 확인해 주세요.
        </p>
      )}
      {!loading && rows !== null && (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">
            왼쪽은 무엇에 대한 설명인지, 오른쪽은 그 내용입니다 — AI가 왼쪽을 이름표로 읽습니다. 예: 시대 → 20년 뒤 미래 / 지역 → 바다 위 도시
          </p>
          {shown.map((row, index) => (
            <div key={index} className="flex flex-wrap items-start gap-2">
              <label className="flex flex-col gap-1 text-xs text-slate-400">
                무엇에 대한 설명인지
                <input
                  aria-label="무엇에 대한 설명인지"
                  className={fieldClassName}
                  value={row.key}
                  disabled={pending}
                  onChange={(event) => change(shown.map((item, position) => position === index ? { ...item, key: event.target.value } : item))}
                />
              </label>
              <label className="flex flex-1 flex-col gap-1 text-xs text-slate-400">
                내용
                <input
                  aria-label="세계관 내용"
                  className={fieldClassName}
                  value={row.value}
                  disabled={pending}
                  onChange={(event) => change(shown.map((item, position) => position === index ? { ...item, value: event.target.value } : item))}
                />
              </label>
              <button
                type="button"
                className="mt-5 rounded-full border border-rose-400/30 px-3 py-1.5 text-xs text-rose-300 hover:bg-rose-500/10 disabled:opacity-50"
                disabled={pending}
                onClick={() => change(shown.filter((_, position) => position !== index))}
              >
                지우기
              </button>
            </div>
          ))}
          <button
            type="button"
            className="rounded-full border border-white/10 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/5 disabled:opacity-50"
            disabled={pending}
            onClick={() => change([...shown, { key: "", value: "" }])}
          >
            세계관 설명에 항목 추가
          </button>
        </div>
      )}
      {/* The raw text stays reachable — it is still the stored form, and the table cannot express nested data.
          Folded, so it is available without being the thing a person is first asked to type into. */}
      <details className="text-sm">
        <summary className="cursor-pointer text-slate-400 hover:text-slate-300">고급 편집 (직접 수정)</summary>
        <label className="mt-2 block text-sm text-slate-300">
          세계관 설정 JSON
          <textarea
            aria-label="세계관 설정 JSON"
            value={draft}
            disabled={pending}
            // Editing the stored form directly is the one place rows follow the JSON rather than lead it.
            onChange={(event) => { setDraft(event.target.value); setRows(rowsFrom(event.target.value)); setValidationError(null); setJustSaved(false); }}
            className={jsonFieldClassName}
          />
        </label>
      </details>
      {justSaved && !error && (
        <p role="status" data-testid="story-world-saved-notice" className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3.5 py-2 text-sm text-emerald-300">
          세계관 설명이 저장되었습니다.
        </p>
      )}
      <button type="button" className={outlineButton} onClick={() => void save()} disabled={pending || loading}>
        {pending ? "저장하는 중..." : "세계관 설명 저장"}
      </button>
    </section>
  );
}
