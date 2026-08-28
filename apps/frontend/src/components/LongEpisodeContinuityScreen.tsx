import { useEffect, useRef, useState } from "react";
import type { LongEpisodeContinuityMemory, LongEpisodeDetail, SaveLongEpisodeContinuityRequest } from "@ai-animation-studio/shared";

import { getLongEpisodeContinuity, saveLongEpisodeContinuity, toLongProjectDisplayError } from "../api/longProjectsApi.js";
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

const listFields = [
  ["events", "에피소드에서 있었던 일"], ["appearedCharacterIds", "등장한 캐릭터 ID"], ["appearedLocationIds", "등장한 장소 ID"],
  ["resolvedConflicts", "해결된 갈등"], ["newConflicts", "새로 생긴 갈등"], ["revealedSecretIds", "밝혀진 비밀 ID"],
  ["remainingSecretIds", "아직 남은 비밀 ID"], ["newForeshadowingIds", "새로 생긴 복선 ID"], ["resolvedForeshadowingIds", "회수된 복선 ID"],
  ["nextActions", "다음 에피소드에서 할 일"], ["worldChanges", "세계관 변화"],
] as const;
type ListKey = (typeof listFields)[number][0];

const blankForm = (): FormState => ({
  episodeSummary: "", events: [], appearedCharacterIds: [], characterChanges: "[]", appearedLocationIds: [], itemChanges: "[]",
  resolvedConflicts: [], newConflicts: [], revealedSecretIds: [], remainingSecretIds: [], newForeshadowingIds: [], resolvedForeshadowingIds: [],
  nextActions: [], timeElapsed: "", worldChanges: [], userEdits: "",
});

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
  const busy = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true); setError(null); setSaved(undefined);
    getLongEpisodeContinuity(projectId, episodeNumber)
      .then((response) => { if (!cancelled) { setForm(toForm(response.memory)); setCanSave(response.canSave); } })
      .catch((caught) => { if (!cancelled) setError(toLongProjectDisplayError(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, episodeNumber]);

  function update(key: keyof FormState, value: string): void {
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
      {loading && <Spinner label="저장된 이어쓰기 메모를 불러오는 중..." />}
      {!loading && (
        <div className={cardSection}>
          <label className="block text-sm text-slate-300">
            에피소드 요약
            <textarea data-testid="continuity-summary" className={fieldClassName} value={form.episodeSummary} disabled={pending || !canSave} onChange={(event) => update("episodeSummary", event.target.value)} />
          </label>
          {listFields.map(([key, label]) => (
            <label key={key} className="block text-sm text-slate-300">
              {label}
              <textarea data-testid={`continuity-${key}`} className={fieldClassName} value={toLines(form[key])} disabled={pending || !canSave} placeholder="한 줄에 하나씩 입력" onChange={(event) => setForm((current) => ({ ...current, [key]: fromLines(event.target.value) }))} />
              {key.endsWith("Ids") && (
                <span className="mt-1 block text-xs text-slate-500">등장인물·설정집에 등록된 항목의 번호를 적는 칸입니다. 잘 모르겠으면 비워 두셔도 됩니다.</span>
              )}
            </label>
          ))}
          {/* These two are stored as free-form object arrays with no agreed key set, so there is no honest way
              to turn them into fixed fields without inventing a schema the prompt builder may not read. What is
              fixed here is that raw JSON is no longer the first thing a person meets: the fields are named in
              plain Korean, said to be optional, and folded away. */}
          <details className="text-sm">
            <summary className="cursor-pointer text-slate-400 hover:text-slate-300">이번 화에서 달라진 캐릭터·물건 (고급, 비워둬도 됩니다)</summary>
            <div className="mt-2 space-y-3">
              <p className="text-xs text-slate-500">
                자동으로 채워진 내용이 있으면 그대로 두시면 됩니다. 직접 적을 때는 아래 형식을 그대로 흉내 내 주세요 — 형식이 어긋나면 저장할 때 알려드립니다.
              </p>
              <label className="block text-sm text-slate-300">
                이번 화에서 달라진 캐릭터
                <textarea data-testid="continuity-character-changes" className={`${fieldClassName} font-mono text-xs`} value={form.characterChanges} disabled={pending || !canSave} onChange={(event) => update("characterChanges", event.target.value)} />
              </label>
              <label className="block text-sm text-slate-300">
                이번 화에서 달라진 물건
                <textarea data-testid="continuity-item-changes" className={`${fieldClassName} font-mono text-xs`} value={form.itemChanges} disabled={pending || !canSave} onChange={(event) => update("itemChanges", event.target.value)} />
              </label>
            </div>
          </details>
          <label className="block text-sm text-slate-300">
            경과 시간
            <input data-testid="continuity-time-elapsed" className={fieldClassName} value={form.timeElapsed} disabled={pending || !canSave} onChange={(event) => update("timeElapsed", event.target.value)} />
          </label>
          <label className="block text-sm text-slate-300">
            검토 메모
            <textarea data-testid="continuity-user-edits" className={fieldClassName} value={form.userEdits} disabled={pending || !canSave} onChange={(event) => update("userEdits", event.target.value)} />
          </label>
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
