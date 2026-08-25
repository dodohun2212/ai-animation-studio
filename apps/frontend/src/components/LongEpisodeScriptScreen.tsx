import { useEffect, useRef, useState } from "react";
import type { LongEpisodeDetail, LongEpisodeScript } from "@ai-animation-studio/shared";
import { approveLongEpisodeScript, generateLongEpisodeScript, getLongEpisode, toLongProjectDisplayError, updateLongEpisodeScript } from "../api/longProjectsApi.js";
import { Spinner } from "./Spinner.js";
import { longEpisodeStatusLabel } from "../utils/longEpisodeLabels.js";

interface Props { projectId: string; episodeNumber: number; onBack: () => void; onOpenMappingReview?: (projectId: string, episodeNumber: number) => void; }
type ErrorState = { code: string; message: string };
const fields = ["description", "visualAction", "startMotion", "mainMotion", "endMotion", "shotSize", "cameraAngle", "composition", "lensFeel", "focusSubject", "cameraMotion", "environmentMotion", "motionSpeed", "motionIntensity", "expressionChange", "continuityHint"];
function isScript(value: unknown): value is LongEpisodeScript { if (!value || typeof value !== "object" || Array.isArray(value)) return false; const item = value as Record<string, unknown>; return typeof item.title === "string" && typeof item.synopsis === "string" && typeof item.ending === "string" && Array.isArray(item.scenes) && item.scenes.length === 6 && item.scenes.every((scene, index) => !!scene && typeof scene === "object" && !Array.isArray(scene) && (scene as Record<string, unknown>).number === index + 1 && fields.every((field) => typeof (scene as Record<string, unknown>)[field] === "string")); }

const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";
const primaryButton = "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const amberOutlineButton = "rounded-full border border-amber-400/40 px-4 py-2 text-sm text-amber-300 hover:bg-amber-500/10 disabled:opacity-50";
const violetOutlineButton = "rounded-full border border-violet-400/40 px-4 py-2 text-sm text-violet-200 hover:bg-violet-500/10";
const textareaClassName = "mt-1.5 min-h-96 w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 font-mono text-xs text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";
const cardSection = "space-y-4 rounded-2xl border border-white/10 bg-slate-900/70 p-5";

function SectionDot() {
  return <span aria-hidden="true" className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]" />;
}

export function LongEpisodeScriptScreen({ projectId, episodeNumber, onBack, onOpenMappingReview }: Props) {
  const [episode, setEpisode] = useState<LongEpisodeDetail | null>(null); const [text, setText] = useState(""); const [loading, setLoading] = useState(true); const [pending, setPending] = useState(false); const [error, setError] = useState<ErrorState | null>(null); const [confirming, setConfirming] = useState(false); const busy = useRef(false);
  const apply = (next: LongEpisodeDetail) => { setEpisode(next); setText(next.script ? JSON.stringify(next.script, null, 2) : ""); setError(null); };
  useEffect(() => { let cancelled = false; setLoading(true); getLongEpisode(projectId, episodeNumber).then((response) => { if (!cancelled) apply(response.episode); }).catch((caught) => { if (!cancelled) setError(toLongProjectDisplayError(caught)); }).finally(() => { if (!cancelled) setLoading(false); }); return () => { cancelled = true; }; }, [projectId, episodeNumber]);
  async function run(action: () => Promise<{ episode: LongEpisodeDetail }>) { if (busy.current) return; busy.current = true; setPending(true); setError(null); try { apply((await action()).episode); } catch (caught) { setError(toLongProjectDisplayError(caught)); } finally { busy.current = false; setPending(false); } }
  function parsed(): LongEpisodeScript | undefined { try { const value: unknown = JSON.parse(text); if (isScript(value)) return value; } catch { /* surfaced below */ } setError({ code: "INVALID_REQUEST", message: "대본은 정확히 6개의 순서가 맞는 장면을 포함한 JSON이어야 합니다." }); return undefined; }
  const hasScript = Boolean(episode?.script);
  return (
    <section className="mt-8 space-y-5">
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
      {!hasScript && episode?.status === "outline_ready" && (
        <button type="button" className={primaryButton} disabled={pending} onClick={() => void run(() => generateLongEpisodeScript(projectId, episodeNumber, {}))}>
          {pending ? "생성 중..." : "대본 초안 만들기"}
        </button>
      )}
      {hasScript && (
        <div className={cardSection}>
          <label className="block text-sm text-slate-300" htmlFor="episode-script-json">
            대본 JSON
            <textarea id="episode-script-json" className={textareaClassName} value={text} disabled={pending || episode?.status !== "script_review"} onChange={(event) => setText(event.target.value)} />
          </label>
          {episode?.status === "script_review" && (
            <div className="flex flex-wrap gap-3">
              <button type="button" className={outlineButton} disabled={pending} onClick={() => { const script = parsed(); if (script) void run(() => updateLongEpisodeScript(projectId, episodeNumber, { script })); }}>수정 저장</button>
              <button type="button" className={amberOutlineButton} disabled={pending} onClick={() => setConfirming(true)}>대본 승인</button>
              <button type="button" className={outlineButton} disabled={pending} onClick={() => void run(() => generateLongEpisodeScript(projectId, episodeNumber, { regenerate: true }))}>새로 생성</button>
            </div>
          )}
          {confirming && (
            <div role="alertdialog" data-testid="episode-script-approve-confirm" className="space-y-3 rounded-xl border border-amber-400/40 bg-slate-900/70 p-4">
              <p className="text-sm text-amber-300">이 대본을 승인할까요? 다음 Asset Mapping 단계는 아직 시작하지 않습니다.</p>
              <div className="flex gap-3">
                <button type="button" className={outlineButton} disabled={pending} onClick={() => setConfirming(false)}>돌아가기</button>
                <button type="button" className={primaryButton} disabled={pending} onClick={() => void run(async () => { const response = await approveLongEpisodeScript(projectId, episodeNumber, { approved: true }); setConfirming(false); return response; })}>최종 승인</button>
              </div>
            </div>
          )}
          {episode?.status === "script_approved" && (
            <div className="space-y-2">
              <p className="text-sm text-emerald-400">대본이 승인되었습니다.</p>
              {onOpenMappingReview && <button type="button" className={violetOutlineButton} onClick={() => onOpenMappingReview(projectId, episodeNumber)}>Asset Mapping 검토</button>}
            </div>
          )}
        </div>
      )}
      {error && <p role="alert" data-error-code={error.code} className="text-sm text-rose-400">{error.message}</p>}
    </section>
  );
}
