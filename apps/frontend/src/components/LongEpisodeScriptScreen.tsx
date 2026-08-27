import { useEffect, useRef, useState } from "react";
import { MAX_SCENE_COUNT, MIN_SCENE_COUNT, type LongEpisodeDetail, type LongEpisodeScript } from "@ai-animation-studio/shared";
import { approveLongEpisodeScript, generateLongEpisodeScript, getLongEpisode, toLongProjectDisplayError, updateLongEpisodeScript } from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";
import { STORY_ESTIMATED_COST_USD } from "@ai-animation-studio/shared";
import { longEpisodeStatusLabel } from "../utils/longEpisodeLabels.js";
import { longEpisodeFieldGroups } from "../utils/sceneFields.js";

interface Props { projectId: string; episodeNumber: number; onBack: () => void; onOpenMappingReview?: (projectId: string, episodeNumber: number) => void; }
type ErrorState = { code: string; message: string };

/**
 * The scene fields grouped by what editing them costs — the same definition the short project's scene editor
 * uses. This screen used to hand the user the stored script as raw JSON, which meant matching quotes and
 * commas by hand and no warning at all about which edits force a paid regeneration.
 */
const SCENE_GROUPS = longEpisodeFieldGroups();
/**
 * Every long-script scene key this screen edits, split by whether a stored script is allowed to omit it.
 * Derived from the shared definition rather than restated, so adding a field in one place cannot leave this
 * screen validating an outdated set. The split matters: `narration` arrived after Episodes already existed, so
 * requiring it would reject every script written before it and lock the user out of their own Episodes.
 */
const SCENE_FIELDS = SCENE_GROUPS.flatMap((group) => group.fields.filter((field) => !field.optional).map((field) => field.key));
const OPTIONAL_SCENE_FIELDS = SCENE_GROUPS.flatMap((group) => group.fields.filter((field) => field.optional).map((field) => field.key));

/**
 * Title, synopsis and ending describe the Episode, not a scene. The image and video prompt builders are handed
 * one scene at a time, so nothing typed here can reach a generated image or clip.
 */
const SCRIPT_FIELDS: { key: "title" | "synopsis" | "ending"; label: string }[] = [
  { key: "title", label: "에피소드 제목" },
  { key: "synopsis", label: "줄거리" },
  { key: "ending", label: "결말" },
];

function isScript(value: unknown): value is LongEpisodeScript { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const item = value as Record<string, unknown>; return typeof item.title === "string" && typeof item.synopsis === "string" && typeof item.ending === "string" && Array.isArray(item.scenes) && item.scenes.length >= MIN_SCENE_COUNT && item.scenes.length <= MAX_SCENE_COUNT && item.scenes.every((scene, index) => !!scene && typeof scene === "object" && !Array.isArray(scene) && (scene as Record<string, unknown>).number === index + 1 && SCENE_FIELDS.every((field) => typeof (scene as Record<string, unknown>)[field] === "string") && OPTIONAL_SCENE_FIELDS.every((field) => { const value = (scene as Record<string, unknown>)[field]; return value === undefined || typeof value === "string"; })); }

const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const primaryButton = "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const amberOutlineButton = "rounded-full border border-amber-400/40 px-4 py-2 text-sm text-amber-300 hover:bg-amber-500/10 disabled:opacity-50";
const violetOutlineButton = "rounded-full border border-violet-400/40 px-4 py-2 text-sm text-violet-200 hover:bg-violet-500/10";
const fieldClassName = "mt-1 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3 py-2 text-sm text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/20 disabled:opacity-50";
const cardSection = "space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

function SectionDot() {
  return <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />;
}

function sceneValue(script: LongEpisodeScript | null, sceneNumber: number, key: string): string {
  const scene = script?.scenes.find((item) => item.number === sceneNumber) as Record<string, unknown> | undefined;
  const value = scene?.[key];
  return typeof value === "string" ? value : "";
}

export function LongEpisodeScriptScreen({ projectId, episodeNumber, onBack, onOpenMappingReview }: Props) {
  const [episode, setEpisode] = useState<LongEpisodeDetail | null>(null);
  /** Working copy. Edits land here while the saved script stays on `episode`, so unsaved changes are visible. */
  const [draft, setDraft] = useState<LongEpisodeScript | null>(null);
  const [selectedScene, setSelectedScene] = useState(1);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ErrorState | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const busy = useRef(false);

  const apply = (next: LongEpisodeDetail) => {
    setEpisode(next);
    setDraft(next.script ? (JSON.parse(JSON.stringify(next.script)) as LongEpisodeScript) : null);
    setError(null);
  };

  useEffect(() => { let cancelled = false; setLoading(true); setJustSaved(false); getLongEpisode(projectId, episodeNumber).then((response) => { if (!cancelled) apply(response.episode); }).catch((caught) => { if (!cancelled) setError(toLongProjectDisplayError(caught)); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [projectId, episodeNumber]);

  async function run(action: () => Promise<{ episode: LongEpisodeDetail }>) { if (busy.current) return; busy.current = true; setPending(true); setError(null); try { apply((await action()).episode); } catch (caught) { setError(toLongProjectDisplayError(caught)); } finally { busy.current = false; setPending(false); } }

  function editScene(key: string, value: string): void {
    setJustSaved(false);
    setDraft((current) => (current ? { ...current, scenes: current.scenes.map((scene) => (scene.number === selectedScene ? { ...scene, [key]: value } : scene)) } : current));
  }

  function editScript(key: "title" | "synopsis" | "ending", value: string): void {
    setJustSaved(false);
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  const editable = episode?.status === "script_review";
  const dirty = Boolean(draft && episode?.script && JSON.stringify(draft) !== JSON.stringify(episode.script));

  function save(): void {
    if (!draft) return;
    if (!isScript(draft)) {
      setError({ code: "INVALID_REQUEST", message: "빈 항목이 있으면 저장할 수 없습니다. 모든 칸을 채워 주세요." });
      return;
    }
    void run(async () => {
      const response = await updateLongEpisodeScript(projectId, episodeNumber, { script: draft });
      setJustSaved(true);
      return response;
    });
  }

  const hasScript = Boolean(episode?.script);
  const sceneNumbers = draft?.scenes.map((scene) => scene.number) ?? [];

  return (
    <section className="mt-8 max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" className={outlineButton} onClick={onBack}>프로젝트로 돌아가기</button>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold"><SectionDot />{`에피소드 ${episodeNumber} 상세 대본`}</h2>
      </div>
      {loading && <Spinner label="불러오는 중..." />}
      {episode && (
        <p data-testid="episode-script-status" className="text-sm text-slate-400">
          상태: {longEpisodeStatusLabel(episode.status)} · 리비전 {episode.scriptRevision} · 이전 기록 {episode.scriptHistoryCount}개
        </p>
      )}
      {/* Without these two notices the screen rendered the header and then nothing at all: an Episode still in
          "planned" has no outline to assemble a script from (episode-scripts.service.ts refuses anything before
          outline_ready), so the button below was correctly withheld — and the person was left looking at an
          empty page with no way to learn that "회차 나누기(AI)" is the missing step. A withheld control has to
          say why it is withheld; otherwise a correct refusal is indistinguishable from a broken screen. */}
      {!hasScript && episode?.status === "planned" && (
        <p data-testid="episode-script-needs-outline" className="rounded-xl border border-sky-400/20 bg-sky-500/5 px-4 py-3 text-sm text-sky-200">
          아직 이 회차의 개요가 없어 대본을 만들 수 없습니다. 왼쪽 메뉴의 <span className="font-semibold">회차 나누기(AI)</span>를 먼저 실행하면 여기에 대본 초안 버튼이 나타납니다.
        </p>
      )}
      {!hasScript && episode && episode.status !== "planned" && episode.status !== "outline_ready" && (
        <p data-testid="episode-script-unavailable" className="rounded-xl border border-slate-400/20 bg-slate-500/5 px-4 py-3 text-sm text-slate-300">
          이 회차에는 저장된 대본이 없고, 현재 상태({longEpisodeStatusLabel(episode.status)})에서는 새로 만들 수 없습니다.
        </p>
      )}
      {!hasScript && episode?.status === "outline_ready" && (
        <div className="space-y-3">
          {/* This said "비용이 들지 않습니다", justified by EpisodeScriptsService taking only a projects root.
              It does not: long-projects.module.ts injects ProviderSettingsService and OpenAiBudget, and
              generate() calls callOpenAiStoryApi with a STORY_ESTIMATED_COST_USD preflight and record. The
              sentence outlived the wiring that made it true, and it is the second notice in this app to do so
              (LongProjectOutlineScreen's said the same thing for the same stale reason).

              Both were prose asserting a fact about backend construction, with nothing tying the two together
              — so the day the provider was injected, the screen kept its old answer and no test objected.
              Reading the cost from the shared constant closes half that gap: a rate change now reaches this
              sentence. The other half — a screen claiming "free" while its service holds a provider — is not
              expressible from here and is worth a backend-side guard. */}
          <p data-testid="episode-script-cost-notice" className="rounded-xl border border-amber-400/20 bg-amber-500/5 px-4 py-3 text-sm text-amber-300">
            이 단계는 <span className="font-semibold">비용이 발생합니다</span> — AI가 스토리 개요와 등장인물·설정집을 재료로 이 회차의 대본을 씁니다. 약 {`$${STORY_ESTIMATED_COST_USD.toFixed(2)}`}이 청구됩니다(추정치).
          </p>
          <button type="button" className={primaryButton} disabled={pending} onClick={() => void run(() => generateLongEpisodeScript(projectId, episodeNumber, {}))}>
            {pending ? "생성 중..." : "대본 초안 만들기"}
          </button>
        </div>
      )}
      {hasScript && draft && (
        <>
          <nav aria-label="장면 선택" data-testid="episode-scene-tabs" className="flex flex-wrap gap-2">
            {sceneNumbers.map((number) => (
              <button
                key={number}
                type="button"
                data-testid={`episode-scene-tab-${number}`}
                aria-pressed={number === selectedScene}
                className={number === selectedScene
                  ? "rounded-full bg-violet-500/20 px-3.5 py-1.5 text-sm font-semibold text-violet-100 ring-1 ring-violet-400/40"
                  : "rounded-full border border-white/10 px-3.5 py-1.5 text-sm text-slate-300 hover:bg-white/5"}
                onClick={() => setSelectedScene(number)}
              >
                {number}번 장면
              </button>
            ))}
          </nav>

          {SCENE_GROUPS.map((group) => (
            <section key={group.title} aria-label={group.title} data-testid={`episode-script-group-${group.title}`} className={cardSection}>
              <header className="space-y-1">
                <h3 className="text-base font-semibold text-slate-100">{group.title}</h3>
                <p className={`text-xs ${group.free ? "text-slate-400" : "text-amber-300"}`}>{group.impact}</p>
              </header>
              <div className="grid gap-3 sm:grid-cols-2">
                {group.fields.map((field) => (
                  <label
                    key={field.key}
                    className={`block text-sm text-slate-300 ${field.multiline ? "sm:col-span-2" : ""}`}
                    htmlFor={`episode-script-field-${field.key}`}
                  >
                    {field.label}
                    {field.multiline ? (
                      <textarea
                        id={`episode-script-field-${field.key}`}
                        data-testid={`episode-script-field-${field.key}`}
                        rows={3}
                        className={fieldClassName}
                        value={sceneValue(draft, selectedScene, field.key)}
                        disabled={pending || !editable}
                        onChange={(event) => editScene(field.key, event.target.value)}
                      />
                    ) : (
                      <input
                        id={`episode-script-field-${field.key}`}
                        data-testid={`episode-script-field-${field.key}`}
                        className={fieldClassName}
                        value={sceneValue(draft, selectedScene, field.key)}
                        disabled={pending || !editable}
                        onChange={(event) => editScene(field.key, event.target.value)}
                      />
                    )}
                  </label>
                ))}
              </div>
            </section>
          ))}

          <section aria-label="에피소드 정보" className={cardSection}>
            <header className="space-y-1">
              <h3 className="text-base font-semibold text-slate-100">에피소드 정보</h3>
              <p className="text-xs text-slate-400">장면 프롬프트에는 들어가지 않습니다 — 이 에피소드를 알아보기 위한 정보입니다.</p>
            </header>
            <div className="space-y-3">
              {SCRIPT_FIELDS.map((field) => (
                <label key={field.key} className="block text-sm text-slate-300" htmlFor={`episode-script-${field.key}`}>
                  {field.label}
                  <input
                    id={`episode-script-${field.key}`}
                    data-testid={`episode-script-${field.key}`}
                    className={fieldClassName}
                    value={draft[field.key]}
                    disabled={pending || !editable}
                    onChange={(event) => editScript(field.key, event.target.value)}
                  />
                </label>
              ))}
            </div>
          </section>

          <div className={cardSection}>
            {!editable && (
              <p data-testid="episode-script-readonly" className="text-sm text-slate-400">
                이 에피소드는 대본 검토 단계가 아니라 지금은 고칠 수 없습니다. 내용만 확인할 수 있습니다.
              </p>
            )}
            {editable && (
              <>
                <div className="flex flex-wrap gap-3">
                  <button type="button" data-testid="episode-script-save" className={outlineButton} disabled={pending || !dirty} onClick={save}>
                    {pending ? "저장 중..." : "수정 저장"}
                  </button>
                  <button type="button" className={amberOutlineButton} disabled={pending || dirty} onClick={() => setConfirming(true)}>대본 승인</button>
                  <button type="button" className={outlineButton} disabled={pending} onClick={() => void run(() => generateLongEpisodeScript(projectId, episodeNumber, { regenerate: true }))}>새로 생성</button>
                </div>
                {dirty && (
                  <p data-testid="episode-script-unsaved" className="text-xs text-amber-300">
                    저장하지 않은 수정이 있습니다. 저장해야 승인할 수 있습니다.
                  </p>
                )}
                {justSaved && !dirty && <p data-testid="episode-script-saved" className="text-xs text-emerald-400">수정을 저장했습니다.</p>}
              </>
            )}
            {confirming && (
              <div role="alertdialog" data-testid="episode-script-approve-confirm" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
                <p className="text-sm text-amber-300">이 대본을 승인할까요? 다음 참고 이미지 연결 단계는 아직 시작하지 않습니다.</p>
                <div className="flex gap-3">
                  <button type="button" className={outlineButton} disabled={pending} onClick={() => setConfirming(false)}>돌아가기</button>
                  <button type="button" className={primaryButton} disabled={pending} onClick={() => void run(async () => { const response = await approveLongEpisodeScript(projectId, episodeNumber, { approved: true }); setConfirming(false); return response; })}>최종 승인</button>
                </div>
              </div>
            )}
            {episode?.status === "script_approved" && (
              <div className="space-y-2">
                <p className="text-sm text-emerald-400">대본이 승인되었습니다.</p>
                {onOpenMappingReview && <button type="button" className={violetOutlineButton} onClick={() => onOpenMappingReview(projectId, episodeNumber)}>참고 이미지 연결 검토</button>}
              </div>
            )}
          </div>
        </>
      )}
      {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
    </section>
  );
}
