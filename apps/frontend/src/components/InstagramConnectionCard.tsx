import { useState, type FormEvent } from "react";
import type { InstagramConnectionStatus } from "@ai-animation-studio/shared";

import {
  disconnectInstagram,
  getInstagramConnection,
  setInstagramApp,
  startInstagramLogin,
  toInstagramConnectionDisplayError,
} from "../api/instagramConnectionApi.js";

interface Props {
  status: InstagramConnectionStatus;
  onStatusChange: (status: InstagramConnectionStatus) => void;
}

const outlineButton =
  "rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5 disabled:opacity-50 disabled:hover:bg-transparent";
const primaryButton =
  "rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-4 py-2 text-sm font-semibold text-white shadow-[0_0_16px_rgba(139,92,246,0.35)] disabled:opacity-50";
const fieldClass =
  "w-full rounded-xl border border-white/10 bg-slate-950/60 px-3.5 py-2.5 text-slate-100 focus:border-violet-400/50 focus:outline-none focus:ring-2 focus:ring-violet-500/30 disabled:opacity-50";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the app can say about the stored token, and nothing more.
 *
 * "Stored" is not "works" — this app has never asked Meta whether a stored token is still accepted, and saying
 * "로그인됨" would be the same untrue claim the provider cards used to make (docs/06_DECISIONS.md D-006).
 *
 * The expiry date is different: it is a fact we hold, so a date already in the past can be stated outright. A
 * long-lived token lasts about 60 days and Meta documents no way to refresh one before it expires
 * (docs/06_DECISIONS.md D-007) — showing the date is what keeps that from arriving as "it suddenly stopped".
 */
export function tokenLine(status: InstagramConnectionStatus, now: number): {
  text: string;
  tone: "ok" | "warn" | "none";
  expired: boolean;
} {
  if (!status.tokenStored) return { text: "로그인이 필요합니다.", tone: "warn", expired: false };

  const parsed = status.tokenExpiresAt ? Date.parse(status.tokenExpiresAt) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    // The contract allows an absent expiry and does not define what that means, so this states the absence
    // rather than inventing a reading of it.
    return { text: "토큰 저장됨 · 만료일은 확인되지 않았습니다.", tone: "ok", expired: false };
  }

  const when = new Date(parsed).toLocaleDateString("ko-KR");
  if (parsed <= now) return { text: `토큰이 ${when}에 만료되었습니다. 다시 로그인해야 합니다.`, tone: "warn", expired: true };

  const daysLeft = Math.ceil((parsed - now) / DAY_MS);
  if (daysLeft <= 14) return { text: `토큰 저장됨 · ${when} 만료 (${daysLeft}일 남음)`, tone: "warn", expired: false };
  return { text: `토큰 저장됨 · ${when} 만료`, tone: "ok", expired: false };
}

const TONE_CLASS = { ok: "text-emerald-300", warn: "text-amber-300", none: "text-slate-400" } as const;

/**
 * Instagram's connection lives here, beside the other credentials, because it answers the same question they do
 * — "can we act at all?". Which account a post goes to is a different question and lives on the post screen
 * instead (docs/06_DECISIONS.md D-006's sibling reasoning; see InstagramPostScreen).
 */
export function InstagramConnectionCard({ status, onStatusChange }: Props) {
  const [appId, setAppId] = useState("");
  const [appSecret, setAppSecret] = useState("");
  const [confirmReplace, setConfirmReplace] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [awaitingLogin, setAwaitingLogin] = useState(false);

  const line = tokenLine(status, Date.now());

  async function run(action: () => Promise<InstagramConnectionStatus>): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      onStatusChange(await action());
    } catch (caught) {
      setError(toInstagramConnectionDisplayError(caught));
    } finally {
      setPending(false);
    }
  }

  /**
   * The whole sign-in, end to end: ask the server for the page, open it, hand back whatever URL it landed on.
   *
   * The screen never parses that URL — the server reads the code out of it and checks the state it issued, so a
   * redirect that did not come from our own request cannot be turned into a login here.
   */
  async function login(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    setAwaitingLogin(false);
    try {
      const started = await startInstagramLogin();
      // Meta redirects the window back to this app's own backend, which completes the login by itself. Nothing
      // here watches that window — it may even be closed — so the only way to learn the outcome is to ask.
      const opened = window.open(started.url, "instagram-login", "width=520,height=720");
      if (!opened) {
        setError({ code: "CLIENT_POPUP_BLOCKED", message: "로그인 창이 차단되었습니다. 팝업을 허용한 뒤 다시 시도해 주세요." });
        return;
      }
      setAwaitingLogin(true);
    } catch (caught) {
      setError(toInstagramConnectionDisplayError(caught));
    } finally {
      setPending(false);
    }
  }

  /**
   * Pressed after finishing in the login window. Deliberately a button rather than a poll: a timer would keep
   * asking on a screen nobody is looking at, and the person is the one who knows the login is done.
   */
  async function refreshAfterLogin(): Promise<void> {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      onStatusChange(await getInstagramConnection());
      setAwaitingLogin(false);
    } catch (caught) {
      setError(toInstagramConnectionDisplayError(caught));
    } finally {
      setPending(false);
    }
  }

  function submitApp(event: FormEvent): void {
    event.preventDefault();
    if (pending) return;
    if (!appId.trim() || !appSecret.trim()) {
      setFieldError("앱 ID와 시크릿을 모두 입력해 주세요.");
      return;
    }
    setFieldError(null);
    // Saving throws away the stored token, so the person is told before it happens rather than discovering it
    // by finding themselves logged out.
    if (status.tokenStored && !confirmReplace) {
      setConfirmReplace(true);
      return;
    }
    void run(() => setInstagramApp(appId.trim(), appSecret.trim())).then(() => {
      setAppId("");
      setAppSecret("");
      setConfirmReplace(false);
    });
  }

  return (
    <div className="space-y-3 rounded-2xl border border-white/10 bg-slate-900/70 p-5" data-testid="instagram-connection">
      <h3 className="text-base font-semibold text-slate-100">Instagram — 게시</h3>

      {!status.appConfigured ? (
        <p data-testid="instagram-app-missing" className="text-sm text-slate-400">
          앱 정보가 없습니다. 아래에 Meta 앱 ID와 시크릿을 입력해야 로그인할 수 있습니다.
        </p>
      ) : (
        <p data-testid="instagram-token-line" className={`text-sm ${TONE_CLASS[line.tone]}`}>
          {line.text}
        </p>
      )}

      {status.tokenStored && (
        <p className="text-xs text-slate-500" data-testid="instagram-stored-caveat">
          토큰이 저장돼 있다는 뜻입니다 — 인스타그램이 아직 받아주는지는 실제로 요청을 보내봐야 알 수 있습니다.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className={primaryButton}
          disabled={pending || !status.appConfigured}
          data-testid="instagram-login-button"
          onClick={() => void login()}
        >
          {pending ? "로그인 중..." : status.tokenStored ? "다시 로그인" : "페이스북으로 로그인"}
        </button>
        {status.tokenStored && (
          <button
            type="button"
            className={outlineButton}
            disabled={pending}
            data-testid="instagram-logout-button"
            onClick={() => void run(disconnectInstagram)}
          >
            로그아웃
          </button>
        )}
      </div>

      {awaitingLogin && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-slate-950/40 p-3" data-testid="instagram-login-awaiting">
          <p className="text-xs text-slate-400">
            새 창에서 페이스북 로그인을 마친 뒤 아래를 눌러 주세요. 창은 닫으셔도 됩니다.
          </p>
          <button
            type="button"
            className={outlineButton}
            disabled={pending}
            data-testid="instagram-login-refresh"
            onClick={() => void refreshAfterLogin()}
          >
            로그인 완료 확인
          </button>
        </div>
      )}

      <form className="space-y-2" onSubmit={submitApp}>
        <label className="block text-sm text-slate-300" htmlFor="instagram-app-id">
          앱 ID
          <input
            id="instagram-app-id"
            data-testid="instagram-app-id"
            className={`mt-1.5 ${fieldClass}`}
            autoComplete="off"
            value={appId}
            disabled={pending}
            onChange={(event) => setAppId(event.target.value)}
          />
        </label>
        <label className="block text-sm text-slate-300" htmlFor="instagram-app-secret">
          앱 시크릿
          <input
            id="instagram-app-secret"
            data-testid="instagram-app-secret"
            type="password"
            autoComplete="off"
            className={`mt-1.5 ${fieldClass}`}
            value={appSecret}
            disabled={pending}
            onChange={(event) => setAppSecret(event.target.value)}
          />
        </label>
        {fieldError && <p role="alert" className="text-sm text-rose-400">{fieldError}</p>}

        {confirmReplace && (
          <p role="alert" data-testid="instagram-app-replace-warning" className="text-sm text-amber-300">
            앱 정보를 바꾸면 지금 저장된 토큰이 지워져 다시 로그인해야 합니다. 계속하려면 저장을 한 번 더 누르세요.
          </p>
        )}

        <button type="submit" className={primaryButton} disabled={pending} data-testid="instagram-app-save">
          {confirmReplace ? "네, 저장합니다" : "저장"}
        </button>
      </form>

      <p className="text-xs text-slate-500">
        앱 시크릿은 저장된 뒤 다시 보이지 않습니다. 화면에도, 서버 응답에도 나오지 않습니다.
      </p>

      {error && (
        <p role="alert" data-error-code={error.code} data-testid="instagram-connection-error" className="text-sm text-rose-400">
          {error.message}
        </p>
      )}
    </div>
  );
}
