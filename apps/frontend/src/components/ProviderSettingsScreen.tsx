import { useEffect, useRef, useState } from "react";
import type { InstagramConnectionStatus, ProviderCredentialKind, ProviderCredentialStatus, ProviderMonthlyBudget, VideoModelSetting } from "@ai-animation-studio/shared";
import { getInstagramConnection } from "../api/instagramConnectionApi.js";
import { getProviderSettings, toDisplayError } from "../api/providerSettingsApi.js";
import { InstagramConnectionCard } from "./InstagramConnectionCard.js";
import { MonthlyBudgetCard } from "./MonthlyBudgetCard.js";
import { ProviderCredentialCard } from "./ProviderCredentialCard.js";
import { VideoModelCard } from "./VideoModelCard.js";
import { Spinner } from "./Spinner.js";

interface Props { onBack: () => void }
type StatusMap = Record<ProviderCredentialKind, ProviderCredentialStatus>;
type BudgetMap = Record<ProviderCredentialKind, ProviderMonthlyBudget>;
interface State { statuses: StatusMap | null; budgets: BudgetMap | null; videoModel: VideoModelSetting | null; error: { code: string; message: string } | null; loading: boolean }
/**
 * A failed read must not be rendered as "not connected", which is a different fact — but it must not be
 * rendered as nothing either. Hiding the card on failure is what this screen used to do, and it produced the
 * worst version of the problem: the card was simply absent, with nothing on the page saying so or why. Someone
 * looking for it had no way to tell "this app has no such feature" from "this feature could not be reached".
 * Three states, so the screen can say which one it is.
 */
type InstagramState =
  | { kind: "loading" }
  | { kind: "ready"; status: InstagramConnectionStatus }
  | { kind: "unavailable" };

const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";

export function ProviderSettingsScreen({ onBack }: Props) {
  const [state, setState] = useState<State>({ statuses: null, budgets: null, videoModel: null, error: null, loading: true });
  const [instagram, setInstagram] = useState<InstagramState>({ kind: "loading" });
  const refreshInFlight = useRef(true);
  const activeMutations = useRef(new Set<ProviderCredentialKind>());
  async function load(acquired = false) {
    if (!acquired) {
      if (refreshInFlight.current || activeMutations.current.size > 0) return;
      refreshInFlight.current = true;
      setState((old) => ({ ...old, loading: true }));
    }
    try {
      const response = await getProviderSettings(); const statuses = {} as StatusMap; const budgets = {} as BudgetMap;
      response.providers.forEach((item) => { statuses[item.provider] = item; });
      response.monthlyBudgets.forEach((item) => { budgets[item.provider] = item; });
      setState({ statuses, budgets, videoModel: response.videoModel, error: null, loading: false });
    } catch (error) { setState((old) => ({ ...old, error: toDisplayError(error), loading: false })); }
    finally { refreshInFlight.current = false; }
    // A separate store with its own failure mode — losing it costs the Instagram card, not the whole screen.
    try { setInstagram({ kind: "ready", status: await getInstagramConnection() }); } catch { setInstagram({ kind: "unavailable" }); }
  }
  useEffect(() => { void load(true); }, []);
  const acquireMutation = (provider: ProviderCredentialKind) => {
    if (refreshInFlight.current || activeMutations.current.has(provider)) return false;
    activeMutations.current.add(provider);
    return true;
  };
  const releaseMutation = (provider: ProviderCredentialKind) => { activeMutations.current.delete(provider); };
  const update = (status: ProviderCredentialStatus) => setState((old) => old.statuses ? { ...old, statuses: { ...old.statuses, [status.provider]: status } } : old);
  const updateBudget = (budget: ProviderMonthlyBudget) => setState((old) => old.budgets ? { ...old, budgets: { ...old.budgets, [budget.provider]: budget } } : old);
  const updateVideoModel = (videoModel: VideoModelSetting) => setState((old) => ({ ...old, videoModel }));
  return (
    <section className="mt-8 max-w-2xl space-y-4">
      <div className="flex items-center justify-between">
        <button type="button" className={outlineButton} onClick={onBack}>목록으로</button>
        <h2 className="flex items-center gap-2.5 text-lg font-semibold">
          <span
            aria-hidden="true"
            className="h-2 w-2 rounded-full bg-gradient-to-br from-violet-300 to-pink-300 shadow-[0_0_6px_rgba(216,180,254,0.7)]"
          />
          API 설정
        </h2>
        <button type="button" className={outlineButton} onClick={() => void load()} disabled={state.loading}>새로고침</button>
      </div>
      {!state.statuses && state.loading && <Spinner label="불러오는 중..." className="mt-4" />}
      {state.error && (
        <div className="mt-4 space-y-2 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
          <p role="alert" data-error-code={state.error.code} className="text-sm text-rose-400">{state.error.message}</p>
          <button type="button" className={outlineButton} onClick={() => void load()} disabled={state.loading}>다시 시도</button>
        </div>
      )}
      {state.statuses && (
        <div className="space-y-4">
          <ProviderCredentialCard label="OpenAI" status={state.statuses.openai} onStatusChange={update} acquireMutation={() => acquireMutation("openai")} releaseMutation={() => releaseMutation("openai")}/>
          <ProviderCredentialCard label="Runway" status={state.statuses.runway} onStatusChange={update} acquireMutation={() => acquireMutation("runway")} releaseMutation={() => releaseMutation("runway")}/>
          {state.budgets && <MonthlyBudgetCard budgets={state.budgets} onBudgetChange={updateBudget} />}
          {/* Beside the budget on purpose: the model is what decides the per-second rate the budget is spent
              at, so the two numbers a person compares are next to each other rather than a screen apart. */}
          {state.videoModel && <VideoModelCard setting={state.videoModel} onChange={updateVideoModel} />}
          {instagram.kind === "ready" && (
            <InstagramConnectionCard status={instagram.status} onStatusChange={(status) => setInstagram({ kind: "ready", status })} />
          )}
          {instagram.kind === "unavailable" && (
            // Deliberately not role="alert": the Instagram store being unreachable does not stop the rest of
            // this screen working, and announcing it as an alert would rank it with the failures that do.
            <div className="space-y-2 rounded-2xl border border-white/10 bg-slate-900/70 p-5" data-testid="instagram-unavailable">
              <h3 className="text-base font-semibold text-slate-100">Instagram — 게시</h3>
              <p className="text-sm text-amber-300">인스타그램 연결 정보를 불러오지 못했습니다.</p>
              {/* Named because it is the cause that leaves no other trace: the packaged shell runs a
                  pre-built backend bundle, so a shell built before this feature existed answers as though the
                  feature does not exist — which looks identical to a bug in this screen. */}
              <p className="text-xs text-slate-500">
                이 기능이 없는 오래된 빌드로 실행 중일 수 있습니다. 나머지 설정은 정상입니다.
              </p>
              <button type="button" className={outlineButton} onClick={() => void load()} disabled={state.loading}>다시 시도</button>
            </div>
          )}

          {/* The screen listed two provider names and nothing about what either one is for, so there was no way
              to tell which key a stuck step needs — or what stops working if you disconnect one. */}
          <section aria-label="어떤 AI가 어디에 쓰이나" className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5">
            <h3 className="text-sm font-semibold text-slate-200">어떤 AI가 어디에 쓰이나</h3>
            <div className="space-y-2">
              <div className="rounded-xl border border-violet-400/25 bg-violet-500/5 p-3">
                <p className="text-sm font-semibold text-violet-200">OpenAI — 글과 그림, 목소리</p>
                <ul className="mt-1.5 space-y-1 text-xs text-slate-400">
                  <li>· 단기 프로젝트 <span className="text-slate-300">대본</span> 만들기</li>
                  <li>· 장기 프로젝트 <span className="text-slate-300">전체 개요</span>와 <span className="text-slate-300">회차별 대본</span> 만들기</li>
                  <li>· 장면 <span className="text-slate-300">이미지</span> 만들기</li>
                  <li>· 읽어줄 문장 <span className="text-slate-300">목소리(음성)</span> 만들기</li>
                </ul>
                <p className="mt-1.5 text-xs text-slate-500">이 키가 없으면 대본·이미지·목소리 단계가 모두 멈춥니다.</p>
              </div>
              <div className="rounded-xl border border-rose-400/25 bg-rose-500/5 p-3">
                <p className="text-sm font-semibold text-rose-200">Runway — 움직이는 영상</p>
                <ul className="mt-1.5 space-y-1 text-xs text-slate-400">
                  <li>· 완성된 장면 이미지를 <span className="text-slate-300">영상 클립</span>으로 움직이기</li>
                  <li>· 실패한 장면 <span className="text-slate-300">다시 만들기</span></li>
                </ul>
                <p className="mt-1.5 text-xs text-slate-500">이 키가 없으면 대본·이미지까지는 되지만 영상이 안 만들어집니다.</p>
              </div>
              <div className="rounded-xl border border-sky-400/25 bg-sky-500/5 p-3">
                <p className="text-sm font-semibold text-sky-200">Instagram — 완성한 영상 올리기</p>
                <ul className="mt-1.5 space-y-1 text-xs text-slate-400">
                  <li>· 올릴 <span className="text-slate-300">계정</span> 목록 가져오기</li>
                  <li>· 완성된 영상을 <span className="text-slate-300">릴스로 게시</span>하기</li>
                </ul>
                <p className="mt-1.5 text-xs text-slate-500">이 연결이 없어도 영상은 다 만들어집니다 — 올리는 것만 직접 하시게 됩니다. 비용은 들지 않습니다.</p>
              </div>
            </div>
            <p className="text-xs text-slate-500">
              최종 영상 합치기는 컴퓨터 안에서 처리해서 어느 키도 필요 없고 비용도 들지 않습니다.
              단계별 호출 횟수와 예상 비용은 <span className="text-slate-300">작업 워크플로우</span> 화면에 있습니다.
            </p>
          </section>
        </div>
      )}
    </section>
  );
}
