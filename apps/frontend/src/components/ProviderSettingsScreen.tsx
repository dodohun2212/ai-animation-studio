import { useEffect, useRef, useState } from "react";
import type { ProviderCredentialKind, ProviderCredentialStatus } from "@ai-animation-studio/shared";
import { getProviderSettings, toDisplayError } from "../api/providerSettingsApi.js";
import { ProviderCredentialCard } from "./ProviderCredentialCard.js";

interface Props { onBack: () => void }
type StatusMap = Record<ProviderCredentialKind, ProviderCredentialStatus>;
interface State { statuses: StatusMap | null; error: { code: string; message: string } | null; loading: boolean }

export function ProviderSettingsScreen({ onBack }: Props) {
  const [state, setState] = useState<State>({ statuses: null, error: null, loading: true });
  const operation = useRef<"refresh" | "mutation" | null>("refresh");
  async function load(acquired = false) {
    if (!acquired) { if (operation.current) return; operation.current = "refresh"; setState((old) => ({ ...old, loading: true })); }
    try {
      const response = await getProviderSettings(); const statuses = {} as StatusMap;
      response.providers.forEach((item) => { statuses[item.provider] = item; });
      setState({ statuses, error: null, loading: false });
    } catch (error) { setState((old) => ({ ...old, error: toDisplayError(error), loading: false })); }
    finally { if (operation.current === "refresh") operation.current = null; }
  }
  useEffect(() => { void load(true); }, []);
  const acquireMutation = () => { if (operation.current) return false; operation.current = "mutation"; return true; };
  const releaseMutation = () => { if (operation.current === "mutation") operation.current = null; };
  const update = (status: ProviderCredentialStatus) => setState((old) => old.statuses ? { ...old, statuses: { ...old.statuses, [status.provider]: status } } : old);
  return <section className="mt-8">
    <div className="flex items-center justify-between">
      <button type="button" onClick={onBack}>목록으로</button><h2 className="text-xl font-semibold">API 설정</h2>
      <button type="button" onClick={() => void load()} disabled={state.loading}>새로고침</button>
    </div>
    {!state.statuses && state.loading && <p className="mt-4 text-slate-400">불러오는 중...</p>}
    {state.error && <div className="mt-4 space-y-2"><p role="alert" data-error-code={state.error.code}>{state.error.message}</p><button type="button" onClick={() => void load()} disabled={state.loading}>다시 시도</button></div>}
    {state.statuses && <div>
      <ProviderCredentialCard label="OpenAI" status={state.statuses.openai} onStatusChange={update} acquireMutation={acquireMutation} releaseMutation={releaseMutation}/>
      <ProviderCredentialCard label="Runway" status={state.statuses.runway} onStatusChange={update} acquireMutation={acquireMutation} releaseMutation={releaseMutation}/>
    </div>}
  </section>;
}
