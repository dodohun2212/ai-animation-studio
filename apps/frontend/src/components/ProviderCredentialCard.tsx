import { useRef, useState, type FormEvent } from "react";
import type { ProviderCredentialStatus } from "@ai-animation-studio/shared";
import { disconnectProvider, reconnectProvider, saveProviderCredential, toDisplayError } from "../api/providerSettingsApi.js";
import { validateCredentialInput } from "../validation/credential.js";

interface Props {
  label: string; status: ProviderCredentialStatus;
  onStatusChange: (status: ProviderCredentialStatus) => void;
  acquireMutation?: () => boolean; releaseMutation?: () => void;
  disabled?: boolean; onPendingChange?: (pending: boolean) => void;
}
const statusText = (status: ProviderCredentialStatus) => !status.configured ? "저장된 키 없음" : status.connected ? "연결됨" : "연결 해제됨 · 키 저장됨";
const statusTone = (status: ProviderCredentialStatus) => !status.configured ? "text-slate-400" : status.connected ? "text-emerald-300" : "text-amber-300";
const outlineButton = "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50 disabled:hover:bg-transparent";

export function ProviderCredentialCard({ label, status, onStatusChange, acquireMutation = () => true, releaseMutation = () => {}, disabled = false, onPendingChange = () => {} }: Props) {
  const [value, setValue] = useState("");
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<{ code: string; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);

  async function run(action: () => Promise<{ provider: ProviderCredentialStatus }>): Promise<boolean> {
    if (disabled || pendingRef.current || !acquireMutation()) return false;
    pendingRef.current = true; setPending(true); onPendingChange(true); setActionError(null);
    try { const result = await action(); onStatusChange(result.provider); return true; }
    catch (error) { setActionError(toDisplayError(error)); return false; }
    finally { pendingRef.current = false; releaseMutation(); onPendingChange(false); setPending(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (disabled || pendingRef.current) return;
    const checked = validateCredentialInput(value);
    if ("error" in checked) { setFieldError(checked.error); return; }
    setFieldError(null);
    if (await run(() => saveProviderCredential(status.provider, checked.value))) setValue("");
  }
  const inputId = `${status.provider}-credential`;
  return (
    <div className="rounded-2xl border border-white/10 bg-slate-900/70 p-5">
      <h3 className="text-base font-semibold text-slate-100">{label}</h3>
      <p className={`mt-1 text-sm ${statusTone(status)}`}>{statusText(status)}</p>
      {status.configured && status.maskedValue && <p className="mt-1 font-mono text-sm text-slate-400">{status.maskedValue}</p>}
      <form className="mt-4 space-y-2" onSubmit={save}>
        <label className="block text-sm text-slate-300" htmlFor={inputId}>{label} credential</label>
        <input
          id={inputId}
          type="password"
          autoComplete="off"
          className="w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          disabled={disabled || pending}
        />
        {fieldError && <p role="alert" className="text-sm text-rose-400">{fieldError}</p>}
        <button type="submit" disabled={disabled || pending} className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50">저장</button>
      </form>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button type="button" className={outlineButton} disabled={disabled || pending || !status.connected} onClick={() => void run(() => disconnectProvider(status.provider))}>연결 해제</button>
        <button type="button" className={outlineButton} disabled={disabled || pending || !status.configured || status.connected} onClick={() => void run(() => reconnectProvider(status.provider))}>다시 연결</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">연결을 해제해도 저장된 credential은 삭제되지 않습니다.</p>
      {actionError && <p role="alert" data-error-code={actionError.code} className="mt-2 text-sm text-rose-400">{actionError.message}</p>}
    </div>
  );
}
