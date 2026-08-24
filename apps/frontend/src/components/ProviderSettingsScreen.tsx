import { useEffect, useRef, useState } from "react";
import type { ProviderCredentialKind, ProviderCredentialStatus } from "@ai-animation-studio/shared";
import { getProviderSettings, toDisplayError } from "../api/providerSettingsApi.js";
import { ProviderCredentialCard } from "./ProviderCredentialCard.js";
import { Spinner } from "./Spinner.js";

interface Props { onBack: () => void }
type StatusMap = Record<ProviderCredentialKind, ProviderCredentialStatus>;
interface State { statuses: StatusMap | null; error: { code: string; message: string } | null; loading: boolean }

const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50";

export function ProviderSettingsScreen({ onBack }: Props) {
  const [state, setState] = useState<State>({ statuses: null, error: null, loading: true });
  const refreshInFlight = useRef(true);
  const activeMutations = useRef(new Set<ProviderCredentialKind>());
  async function load(acquired = false) {
    if (!acquired) {
      if (refreshInFlight.current || activeMutations.current.size > 0) return;
      refreshInFlight.current = true;
      setState((old) => ({ ...old, loading: true }));
    }
    try {
      const response = await getProviderSettings(); const statuses = {} as StatusMap;
      response.providers.forEach((item) => { statuses[item.provider] = item; });
      setState({ statuses, error: null, loading: false });
    } catch (error) { setState((old) => ({ ...old, error: toDisplayError(error), loading: false })); }
    finally { refreshInFlight.current = false; }
  }
  useEffect(() => { void load(true); }, []);
  const acquireMutation = (provider: ProviderCredentialKind) => {
    if (refreshInFlight.current || activeMutations.current.has(provider)) return false;
    activeMutations.current.add(provider);
    return true;
  };
  const releaseMutation = (provider: ProviderCredentialKind) => { activeMutations.current.delete(provider); };
  const update = (status: ProviderCredentialStatus) => setState((old) => old.statuses ? { ...old, statuses: { ...old.statuses, [status.provider]: status } } : old);
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
        </div>
      )}
    </section>
  );
}
