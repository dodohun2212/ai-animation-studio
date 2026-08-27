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
/**
 * Says what the app actually knows, which is only what is stored here.
 *
 * This used to read "연결됨", and a user who had just revoked their Runway key on Runway's own dashboard still
 * saw it — reasonably reading it as "this key works". Nothing in this app ever asks the provider whether a
 * stored key is still valid, so "연결" was a claim about a relationship the app has never once checked
 * (`.claude-bridge` Round 184). The wording now describes the local switch it really is.
 */
const statusText = (status: ProviderCredentialStatus) =>
  !status.configured ? "저장된 키 없음" : status.connected ? "키 저장됨 · 이 앱에서 사용" : "키 저장됨 · 사용 안 함";
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
        <button type="button" className={outlineButton} disabled={disabled || pending || !status.connected} onClick={() => void run(() => disconnectProvider(status.provider))}>이 앱에서 사용 안 함</button>
        <button type="button" className={outlineButton} disabled={disabled || pending || !status.configured || status.connected} onClick={() => void run(() => reconnectProvider(status.provider))}>다시 사용</button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        사용을 꺼도 저장된 credential은 삭제되지 않습니다.
        {status.configured && " 위 표시는 이 앱에 키가 저장돼 있다는 뜻입니다 — 제공사에서 그 키를 지웠거나 만료됐는지는 실제로 요청을 보내봐야 알 수 있습니다."}
      </p>
      {actionError && <p role="alert" data-error-code={actionError.code} className="mt-2 text-sm text-rose-400">{actionError.message}</p>}
    </div>
  );
}
