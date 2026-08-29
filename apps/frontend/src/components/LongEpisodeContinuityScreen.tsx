import { useEffect, useRef, useState } from "react";
import type { LongEpisodeContinuityMemory, LongEpisodeDetail, LongEpisodeOutline, SaveLongEpisodeContinuityRequest } from "@ai-animation-studio/shared";

import { getLongEpisode, getLongEpisodeContinuity, saveLongEpisodeContinuity, toLongProjectDisplayError } from "../api/longProjectsApi.js";
import { longEpisodeStatusLabel } from "../utils/longEpisodeLabels.js";
import { Spinner } from "./Spinner.js";

interface Props {
  projectId: string;
  episodeNumber: number;
  onBack: () => void;
  onOpenNextEpisode?: (projectId: string, episodeNumber: number) => void;
}

type DisplayError = { code: string; message: string };
type FormState = Omit<LongEpisodeContinuityMemory, "episodeNumber" | "updatedAt" | "characterChanges" | "itemChanges"> & { characterChanges: string; itemChanges: string };

/**
 * The two halves of this form, split by whether the next Episode's script prompt actually reads the field.
 *
 * `continuityContext()` in episode-scripts.service.ts carries exactly episode_summary, events,
 * character_changes and next_actions forward; a grep for the rest finds only the code that writes them to disk
 * and reads them back into this form. They are a person's own record, which is worth keeping — but the screen
 * used to present all thirteen boxes identically, so a blank one looked like a job left undone in every case.
 * Now the shape of the screen says which is which.
 */
const carriedListFields = [
  ["events", "에피소드에서 있었던 일"], ["nextActions", "다음 에피소드에서 할 일"],
] as const;
const recordOnlyListFields = [
  ["appearedCharacterIds", "등장한 캐릭터 ID"], ["appearedLocationIds", "등장한 장소 ID"],
  ["resolvedConflicts", "해결된 갈등"], ["newConflicts", "새로 생긴 갈등"], ["revealedSecretIds", "밝혀진 비밀 ID"],
  ["remainingSecretIds", "아직 남은 비밀 ID"], ["newForeshadowingIds", "새로 생긴 복선 ID"], ["resolvedForeshadowingIds", "회수된 복선 ID"],
  ["worldChanges", "세계관 변화"],
] as const;
const listFields = [...carriedListFields, ...recordOnlyListFields] as const;
type ListKey = (typeof listFields)[number][0];

const blankForm = (): FormState => ({
  episodeSummary: "", events: [], appearedCharacterIds: [], characterChanges: "[]", appearedLocationIds: [], itemChanges: "[]",
  resolvedConflicts: [], newConflicts: [], revealedSecretIds: [], remainingSecretIds: [], newForeshadowingIds: [], resolvedForeshadowingIds: [],
  nextActions: [], timeElapsed: "", worldChanges: [], userEdits: "",
});

/**
 * The four fields the next Episode's script prompt actually reads, filled from what this Episode was already
 * approved as — its own outline.
 *
 * Every one of these sentences was written and approved earlier in this same Episode's flow, and the screen
 * was asking for them again from a blank box. `episode-scripts.service.ts`'s continuityContext() carries
 * exactly summary/events/character_changes/next_actions forward, so those are what a prefill is worth doing
 * for; the rest are left blank rather than padded with guesses.
 *
 * Runs only when nothing has been saved yet. A memo that exists is a person's reviewed record and is never
 * written over — and nothing here is saved by appearing, which the header already promises.
 */
function prefillFromOutline(episode: LongEpisodeOutline): Partial<FormState> {
  const line = (value: string) => (value.trim() ? [value.trim()] : []);
  return {
    episodeSummary: episode.summary.trim(),
    events: line(episode.mainEvent),
    newConflicts: line(episode.conflict),
    nextActions: line(episode.nextEpisodeHook),
  };
}

const toLines = (value: string[]) => value.join("\n");
const fromLines = (value: string) => value.split("\n").map((item) => item.trim()).filter(Boolean);

function toForm(memory: LongEpisodeContinuityMemory | null): FormState {
  if (!memory) return blankForm();
  const { episodeNumber: _episodeNumber, updatedAt: _updatedAt, characterChanges, itemChanges, ...form } = memory;
  return { ...form, characterChanges: JSON.stringify(characterChanges, null, 2), itemChanges: JSON.stringify(itemChanges, null, 2) };
}

function parseRecordArray(value: string): Array<Record<string, unknown>> | null {
  try {
    const parsed: unknown = JSON.parse(value || "[]");
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "object" && item !== null && !Array.isArray(item)) ? parsed as Array<Record<string, unknown>> : null;
  } catch { return null; }
}

function toRequest(form: FormState): SaveLongEpisodeContinuityRequest | null {
  if (!form.episodeSummary.trim()) return null;
  const characterChanges = parseRecordArray(form.characterChanges);
  const itemChanges = parseRecordArray(form.itemChanges);
  if (!characterChanges || !itemChanges) return null;
  return { memory: { ...form, characterChanges, itemChanges } };
}

const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const primaryButton = "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const fieldClassName = "mt-1.5 w-full rounded-xl border border-white/10 bg-slate-900/70 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const cardSection = "space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

/** A user-reviewed, explicit save point before the next Episode is opened. */
export function LongEpisodeContinuityScreen({ projectId, episodeNumber, onBack, onOpenNextEpisode }: Props) {
  const [form, setForm] = useState<FormState>(blankForm);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<DisplayError | null>(null);
  const [saved, setSaved] = useState<LongEpisodeDetail | null | undefined>(undefined);
  /**
   * Whether the server would accept a save right now, answered by the server itself.
   *
   * These notes describe how an Episode ended, so saving is only allowed once its video work has started — a
   * correct rule. What was wrong was the timing: the screen opened, took everything the person typed, and
   * refused at the end. The refusal is the same either way; the only thing that could change is when it
   * arrives, so it arrives first now.
   *
   * Starts true so nothing is disabled while the answer is still in flight — the fields are only taken away on
   * a definite "no", never on "not known yet". A failed load leaves it true and the old 409 path remains, which
   * is the honest outcome when the screen could not learn the answer.
   */
  const [canSave, setCanSave] = useState(true);
  /** True while the boxes still hold what this screen put there from the outline and nothing has been saved. */
  const [prefilled, setPrefilled] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setSaved(undefined);
    setPrefilled(false);
    getLongEpisodeContinuity(projectId, episodeNumber)
      .then(async (response) => {
        if (cancelled) return;
        setCanSave(response.canSave);
        if (response.memory) { setForm(toForm(response.memory)); return; }
        // Only a memo that does not exist yet gets one. The outline is a convenience, so a failure to read it
        // leaves the blank form the screen always had rather than failing the screen.
        const outline = await getLongEpisode(projectId, episodeNumber).then((one) => one.episode).catch(() => null);
        if (cancelled || !outline) return;
        const suggested = prefillFromOutline(outline);
        if (!suggested.episodeSummary && !suggested.events?.length && !suggested.newConflicts?.length && !suggested.nextActions?.length) return;
        setForm((current) => ({ ...current, ...suggested }));
        setPrefilled(true);
      })
      .catch((caught) => { if (!cancelled) setError(toLongProjectDisplayError(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, episodeNumber]);

  function update(key: keyof FormState, value: string): void {
    setPrefilled(false);
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function save(): Promise<void> {
    const request = toRequest(form);
    if (!request) { setError({ code: "INVALID_REQUEST", message: "에피소드 요약을 입력하고, 캐릭터·아이템 변화는 객체로 이루어진 JSON 배열 형식으로 입력하세요." }); return; }
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try {
      const response = await saveLongEpisodeContinuity(projectId, episodeNumber, request);
      setForm(toForm(response.memory));
      setSaved(response.nextEpisode);
    } catch (caught) { setError(toLongProjectDisplayError(caught)); }
    finally { busy.current = false; setPending(false); }
  }

  return (
    <section className="mt-8 space-y-5" data-testid="episode-continuity-screen">
      <button type="button" className={outlineButton} onClick={onBack}>최종 에피소드 영상으로</button>
      <header className="space-y-1">
        <h2 className="flex items-center gap-2.5 text-lg font-semibold"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />{`에피소드 ${episodeNumber} 이어쓰기 메모`}</h2>
        <p className="text-sm text-slate-400">다음 에피소드를 준비하기 전에 이 내용을 검토하고 직접 저장하세요. 이 화면을 여는 것만으로는 아무것도 저장되지 않습니다.</p>
      </header>
      {!loading && !canSave && (
        <p data-testid="continuity-not-saveable" className="rounded-xl border border-amber-400/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-200">
          이어쓰기 메모는 이 회차의 <span className="font-semibold">영상 작업이 시작된 뒤</span>에 저장할 수 있습니다 —
          회차가 어떻게 끝났는지를 적는 곳이라서요. 지금은 예전에 저장한 내용을 읽어볼 수만 있습니다.
        </p>
      )}
      {!loading && prefilled && (
        <p data-testid="continuity-prefilled" className="rounded-xl border border-white/10 bg-slate-900/70 px-4 py-3 text-sm text-slate-300">
          아직 저장된 메모가 없어서 <span className="font-semibold text-slate-100">이 회차의 개요</span>로 미리 채워 뒀습니다 — 요약, 있었던 일, 다음에서 할 일, 그리고 아래 기록용 칸의 새로 생긴 갈등.
          고쳐 쓰셔도 되고, 그대로 두셔도 됩니다. <span className="font-semibold text-slate-100">저장을 눌러야 저장됩니다.</span>
        </p>
      )}
      {loading && <Spinner label="저장된 이어쓰기 메모를 불러오는 중..." />}
      {!loading && (
        <div className={cardSection}>
          {/* The four the next Episode actually reads, first and unfolded. */}
          <p className="text-xs text-slate-400">
            여기 네 칸이 <span className="font-semibold text-slate-200">다음 화 대본을 쓸 때 읽히는</span> 내용입니다.
          </p>
          <label className="block text-sm text-slate-300">
            에피소드 요약
            <textarea data-testid="continuity-summary" className={fieldClassName} value={form.episodeSummary} disabled={pending || !canSave} onChange={(event) => update("episodeSummary", event.target.value)} />
          </label>
          {carriedListFields.map(([key, label]) => (
            <label key={key} className="block text-sm text-slate-300">
              {label}
              <textarea data-testid={`continuity-${key}`} className={fieldClassName} value={toLines(form[key])} disabled={pending || !canSave} placeholder="한 줄에 하나씩 입력" onChange={(event) => { setPrefilled(false); setForm((current) => ({ ...current, [key]: fromLines(event.target.value) })); }} />
            </label>
          ))}
          {/* Stored as a free-form object array with no agreed key set, so there is no honest way to turn it
              into fixed fields without inventing a schema the prompt builder may not read. Folded away so raw
              JSON is not the first thing a person meets — but inside the carried half, because it is carried. */}
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-400 hover:text-slate-300">이번 화에서 달라진 캐릭터 (고급, 비워둬도 됩니다)</summary>
            <div className="mt-2 space-y-3">
              <p className="text-xs text-slate-500">
                자동으로 채워진 내용이 있으면 그대로 두시면 됩니다. 직접 적을 때는 아래 형식을 그대로 흉내 내 주세요 — 형식이 어긋나면 저장할 때 알려드립니다.
              </p>
              <label className="block text-sm text-slate-300">
                이번 화에서 달라진 캐릭터
                <textarea data-testid="continuity-character-changes" className={`${fieldClassName} font-mono text-xs`} value={form.characterChanges} disabled={pending || !canSave} onChange={(event) => update("characterChanges", event.target.value)} />
              </label>
            </div>
          </details>

          {/* Everything below is written to disk and read back here, and goes nowhere else. Saying so is the
              point: these boxes looked exactly like the four above, so every blank one read as an unfinished
              job. The secrets/foreshadowing line is here because "then where?" is the immediate next question
              and it has a real answer. */}
          <details data-testid="continuity-record-only" className="rounded-xl border border-white/10 bg-slate-950/40 p-4 text-sm">
            <summary className="cursor-pointer text-slate-300 hover:text-slate-100">기록용 칸 (저장은 되지만 다음 화 대본에는 들어가지 않습니다)</summary>
            <div className="mt-3 space-y-4">
              <p className="text-xs text-slate-400">
                나중에 이 회차가 어땠는지 찾아보려고 남기는 칸입니다. 비워 두셔도 다음 화에는 아무 영향이 없습니다.
                <br />
                <span className="text-slate-500">
                  비밀이나 복선을 다음 화가 알게 하려면 여기가 아니라 <span className="font-semibold text-slate-300">설정집(Story Bible)</span>에서 그 항목을 고치셔야 합니다 — 다음 화 대본은 설정집의 상태와 공개 가능 화수를 읽습니다.
                </span>
              </p>
              {recordOnlyListFields.map(([key, label]) => (
                <label key={key} className="block text-sm text-slate-300">
                  {label}
                  <textarea data-testid={`continuity-${key}`} className={fieldClassName} value={toLines(form[key])} disabled={pending || !canSave} placeholder="한 줄에 하나씩 입력" onChange={(event) => { setPrefilled(false); setForm((current) => ({ ...current, [key]: fromLines(event.target.value) })); }} />
                  {/* The screen these numbers could be read off no longer exists — the character and location
                      collections were removed from the Story Bible. Naming a deleted screen is worse than
                      saying nothing: a person goes looking for it, does not find it, and reads the whole field
                      as broken. */}
                  {key.endsWith("Ids") && (
                    <span className="mt-1 block text-xs text-slate-500">이 회차에 나온 항목의 번호를 적는 칸입니다. 번호를 모르면 비워 두셔도 됩니다.</span>
                  )}
                </label>
              ))}
              <label className="block text-sm text-slate-300">
                이번 화에서 달라진 물건
                <textarea data-testid="continuity-item-changes" className={`${fieldClassName} font-mono text-xs`} value={form.itemChanges} disabled={pending || !canSave} onChange={(event) => update("itemChanges", event.target.value)} />
              </label>
              <label className="block text-sm text-slate-300">
                경과 시간
                <input data-testid="continuity-time-elapsed" className={fieldClassName} value={form.timeElapsed} disabled={pending || !canSave} onChange={(event) => update("timeElapsed", event.target.value)} />
              </label>
              <label className="block text-sm text-slate-300">
                검토 메모
                <textarea data-testid="continuity-user-edits" className={fieldClassName} value={form.userEdits} disabled={pending || !canSave} onChange={(event) => update("userEdits", event.target.value)} />
              </label>
            </div>
          </details>
          <button type="button" data-testid="continuity-save" className={primaryButton} disabled={pending || !canSave} onClick={() => void save()}>{pending ? "저장하는 중..." : "검토한 내용 저장"}</button>
        </div>
      )}
      {saved !== undefined && (
        <div data-testid="continuity-save-success" className="space-y-2 rounded-2xl border border-emerald-400/30 bg-emerald-500/5 p-5">
          <p className="text-sm text-emerald-400">{saved ? `에피소드 ${saved.episodeNumber}(으)로 이어서 진행할 수 있습니다 (${longEpisodeStatusLabel(saved.status)}).` : "마지막 에피소드였습니다. 다음 에피소드가 없습니다."}</p>
          {saved && onOpenNextEpisode && <button type="button" data-testid="continuity-open-next-episode" className={outlineButton} onClick={() => onOpenNextEpisode(projectId, saved.episodeNumber)}>에피소드 {saved.episodeNumber} 열기</button>}
        </div>
      )}
      {error && <p role="alert" data-testid="continuity-error" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
    </section>
  );
}
