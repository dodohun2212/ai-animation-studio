import { useEffect, useRef, useState } from "react";
import type { LongEpisodeDetail } from "@ai-animation-studio/shared";
import { getLongEpisode, toLongProjectDisplayError, updateLongEpisodeOutline } from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";
import { longEpisodeStatusLabel } from "../utils/longEpisodeLabels.js";

interface Props {
  projectId: string;
  episodeNumber: number;
  onBack: () => void;
  onOpenScript?: (projectId: string, episodeNumber: number) => void;
}
type ErrorState = { code: string; message: string };
type OutlineKey = "title" | "summary" | "mainEvent" | "conflict" | "cliffhanger" | "nextEpisodeHook";

/**
 * The six fields the outline-approval step assigns to each Episode and the only six this endpoint accepts —
 * `EpisodeTimelineService.outlineFieldMap`. Labels are what a person calls them, not the field names: nobody
 * building an animation thinks in "cliffhangers" and "hooks", they think about how the episode ends and what
 * pulls the viewer into the next one.
 */
const OUTLINE_FIELDS: { key: OutlineKey; label: string; hint: string; multiline: boolean }[] = [
  { key: "title", label: "회차 제목", hint: "이 회차를 부르는 이름입니다.", multiline: false },
  { key: "summary", label: "이 회차 줄거리", hint: "이 회차에서 무슨 일이 일어나는지 한두 문단으로 적습니다.", multiline: true },
  { key: "mainEvent", label: "핵심 사건", hint: "이 회차에서 반드시 일어나야 하는 사건 하나입니다.", multiline: true },
  { key: "conflict", label: "갈등", hint: "누가 무엇 때문에 부딪히는지 적습니다.", multiline: true },
  { key: "cliffhanger", label: "회차 끝맺음", hint: "이 회차가 어떤 장면에서 끊기는지 적습니다.", multiline: true },
  { key: "nextEpisodeHook", label: "다음 회차로 넘기는 것", hint: "다음 회차를 계속 보게 만드는 실마리입니다.", multiline: true },
];

/**
 * The statuses the backend still lets this endpoint edit (`draftStates`). Gated on this one Episode's own
 * status, deliberately — not the whole project's — so Episode 5's plan stays editable after Episode 1's script
 * has moved on. The screen reads the same rule so it can explain the block instead of only reporting it.
 */
const EDITABLE_STATUSES = new Set(["planned", "outline_ready"]);

const backButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const primaryButton = "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const violetOutlineButton = "rounded-full border border-violet-400/40 px-4 py-2 text-sm text-violet-200 hover:bg-violet-500/10 disabled:opacity-50";
const fieldClassName = "mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50";
const cardSection = "space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

function draftFrom(episode: LongEpisodeDetail): Record<OutlineKey, string> {
  return {
    title: episode.title,
    summary: episode.summary,
    mainEvent: episode.mainEvent,
    conflict: episode.conflict,
    cliffhanger: episode.cliffhanger,
    nextEpisodeHook: episode.nextEpisodeHook,
  };
}

/**
 * Per-Episode plan editing. The whole-project outline approval hands every Episode a title, a summary and four
 * story beats; until this screen existed there was no way to change any of them afterwards — clicking an
 * Episode went straight to its script, so the only way to alter the plan was to influence it indirectly through
 * generated text. This is that missing "what happens in this episode" screen.
 *
 * Costs nothing: no provider is called from here. It writes the same local `episode_outlines.json` the outline
 * approval wrote.
 */
export function LongEpisodeOutlineScreen({ projectId, episodeNumber, onBack, onOpenScript }: Props) {
  const [episode, setEpisode] = useState<LongEpisodeDetail | null>(null);
  /** Working copy, so unsaved edits stay visible next to what is actually stored. */
  const [draft, setDraft] = useState<Record<OutlineKey, string> | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getLongEpisode(projectId, episodeNumber)
      .then((response) => {
        if (cancelled) return;
        setEpisode(response.episode);
        setDraft(draftFrom(response.episode));
        setError(null);
      })
      .catch((caught: unknown) => { if (!cancelled) setError(toLongProjectDisplayError(caught)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [projectId, episodeNumber]);

  const editable = episode !== null && EDITABLE_STATUSES.has(episode.status);
  /**
   * Only what actually changed is sent. The server rejects an empty map, an unknown key, and a blank value —
   * so sending the whole form back would turn "I only fixed the title" into a request that fails the moment any
   * other field happens to be empty.
   */
  const changed: OutlineKey[] = episode && draft
    ? OUTLINE_FIELDS.map((field) => field.key).filter((key) => draft[key] !== draftFrom(episode)[key])
    : [];

  async function save(): Promise<void> {
    if (!episode || !draft || savingRef.current || changed.length === 0) return;
    const blank = changed.find((key) => !draft[key].trim());
    if (blank) {
      setValidationError(`${OUTLINE_FIELDS.find((field) => field.key === blank)!.label} 칸은 비워 둘 수 없습니다. 내용을 적거나 원래 내용으로 되돌려 주세요.`);
      return;
    }
    setValidationError(null);
    savingRef.current = true; setSaving(true); setSaved(false);
    try {
      const outline = Object.fromEntries(changed.map((key) => [key, draft[key].trim()]));
      const response = await updateLongEpisodeOutline(projectId, episodeNumber, { outline });
      // The response carries the outline only; keep this Episode's script-side fields as they were.
      setEpisode((current) => (current ? { ...current, ...response.episode } : current));
      setDraft(draftFrom({ ...episode, ...response.episode }));
      setError(null); setSaved(true);
    } catch (caught) {
      setError(toLongProjectDisplayError(caught));
    } finally { savingRef.current = false; setSaving(false); }
  }

  function reset(): void {
    if (!episode) return;
    setDraft(draftFrom(episode)); setValidationError(null); setSaved(false);
  }

  return (
    <section aria-label="회차 설정" className="space-y-5">
      <button type="button" className={backButton} onClick={onBack}>
        목록으로
      </button>
      <h2 className="flex items-center gap-2.5 text-lg font-semibold">
        <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />
        {episodeNumber}화 설정
      </h2>
      <p className="text-sm text-slate-400">
        이 회차가 어떤 이야기인지 직접 적는 자리입니다. 개요를 승인하면 AI가 회차마다 이 칸들을 채워 두는데, 여기서 마음에 안 드는
        부분을 고칠 수 있습니다. 저장해도 AI를 부르지 않아 비용이 들지 않습니다.
      </p>

      {error && (
        <p role="alert" data-testid="episode-outline-error" data-error-code={error.code} className="text-sm text-rose-400">
          {error.code === "LONG_EPISODE_TIMELINE_NOT_ALLOWED"
            ? "이 회차는 이미 대본 작업이 시작돼서 회차 설정을 고칠 수 없습니다."
            : error.message}
        </p>
      )}

      {loading && !episode && <Spinner label="회차를 불러오는 중..." />}

      {episode && draft && (
        <section aria-label="회차 정보" className={cardSection}>
          <p className="text-sm text-slate-400">
            현재 상태: <span className="text-slate-200">{longEpisodeStatusLabel(episode.status)}</span>
          </p>
          {!editable && (
            <p data-testid="episode-outline-locked" className="text-sm text-amber-300">
              이 회차는 대본 작업이 시작돼서 더 고칠 수 없습니다. 회차 설정은 대본을 만들기 전까지만 고칠 수 있습니다 — 다른 회차는
              그대로 고칠 수 있으니, 아직 시작 안 한 회차를 선택해 주세요.
            </p>
          )}
          {validationError && (
            <p role="alert" data-testid="episode-outline-validation-error" className="text-sm text-rose-400">
              {validationError}
            </p>
          )}
          {saved && changed.length === 0 && (
            <p data-testid="episode-outline-saved" className="text-sm text-emerald-300">
              저장했습니다.
            </p>
          )}

          {OUTLINE_FIELDS.map((field) => (
            <label key={field.key} className="block text-sm text-slate-300">
              {field.label}
              <span className="ml-2 text-xs text-slate-500">{field.hint}</span>
              {field.multiline ? (
                <textarea
                  className={fieldClassName}
                  rows={3}
                  value={draft[field.key]}
                  disabled={!editable || saving}
                  onChange={(event) => { setDraft({ ...draft, [field.key]: event.target.value }); setSaved(false); }}
                />
              ) : (
                <input
                  className={fieldClassName}
                  value={draft[field.key]}
                  disabled={!editable || saving}
                  onChange={(event) => { setDraft({ ...draft, [field.key]: event.target.value }); setSaved(false); }}
                />
              )}
            </label>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={primaryButton} disabled={!editable || saving || changed.length === 0} onClick={() => void save()}>
              {saving ? "저장하는 중…" : "회차 설정 저장"}
            </button>
            <button type="button" className={backButton} disabled={!editable || saving || changed.length === 0} onClick={reset}>
              고친 것 되돌리기
            </button>
            {changed.length > 0 && (
              <span data-testid="episode-outline-changed-count" className="text-xs text-amber-300">
                고친 칸 {changed.length}개 — 아직 저장 전입니다.
              </span>
            )}
          </div>

          {onOpenScript && (
            <div className="border-t border-white/10 pt-4">
              <p className="text-xs text-slate-400">
                이 회차 내용이 정해졌으면 대본으로 넘어갑니다. 대본을 만들고 나면 위 칸들은 더 고칠 수 없습니다.
              </p>
              <button type="button" className={`${violetOutlineButton} mt-2`} disabled={changed.length > 0} onClick={() => onOpenScript(projectId, episodeNumber)}>
                {changed.length > 0 ? "먼저 저장해 주세요" : "이 회차 대본으로 이동"}
              </button>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
