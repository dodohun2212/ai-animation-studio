import { useEffect, useRef, useState, type FormEvent } from "react";
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
const LOGIN_POLL_INTERVAL_MS = 1500;
// Long enough to cover finding a password, a 2FA prompt, and choosing which accounts to grant. Past this the
// polling stops and the button below is what finishes the job — nothing is lost, it just stops asking.
const LOGIN_POLL_TIMEOUT_MS = 5 * 60 * 1000;

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

export interface PollDeps {
  /** Read afresh each round: the login window may be closed by the callback page, or by the person. */
  isWindowClosed: () => boolean;
  readStatus: () => Promise<InstagramConnectionStatus>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
  /** True once the screen has moved on — every await here can outlive the thing that started it. */
  abandoned: () => boolean;
  intervalMs?: number;
  timeoutMs?: number;
}

/**
 * Watches for a sign-in finishing in the other window, so the usual case needs no second button press.
 *
 * The button stays regardless — this only removes a step, it does not become the thing the flow depends on.
 * That matters because polling can legitimately give up (window closed, five minutes gone) while the person is
 * in fact signed in, and a flow whose only path had just expired would be worse than one with an extra click.
 *
 * The one thing that counts as success is the server saying a token is stored. Not a closed window, not time
 * passing — reading success off anything else is how a screen claims a connection it never had (D-006).
 */
export async function pollUntilTokenStored(deps: PollDeps): Promise<InstagramConnectionStatus | null> {
  const intervalMs = deps.intervalMs ?? LOGIN_POLL_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? LOGIN_POLL_TIMEOUT_MS;
  const startedAt = deps.now();

  for (;;) {
    await deps.wait(intervalMs);
    if (deps.abandoned()) return null;

    // Read whether the window is gone BEFORE asking the server, so the answer that follows is never older than
    // the close. The callback page closes its own window once the server has the token, so on a success the
    // close and the token arrive together — checked the other way round, a real login would stop the polling
    // about half the time and look like nothing happened.
    const closedBeforeRead = deps.isWindowClosed();

    let status: InstagramConnectionStatus | undefined;
    // A failed poll is not a failed login. The sign-in is happening in another window and does not care that one
    // of our reads did not land; giving up on it would abandon something still in progress.
    try {
      status = await deps.readStatus();
    } catch {
      status = undefined;
    }
    if (deps.abandoned()) return null;
    if (status?.tokenStored) return status;
    if (closedBeforeRead) return null;
    if (deps.now() - startedAt >= timeoutMs) return null;
  }
}

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
  const loginWindow = useRef<{ closed: boolean } | null>(null);
  // Held in a ref because the parent passes a fresh closure on every render; in the effect's dependency list it
  // would restart the polling constantly.
  const notifyStatus = useRef(onStatusChange);
  notifyStatus.current = onStatusChange;

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
      loginWindow.current = opened;
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

  useEffect(() => {
    if (!awaitingLogin) return;
    let abandoned = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void pollUntilTokenStored({
      isWindowClosed: () => loginWindow.current?.closed ?? true,
      readStatus: getInstagramConnection,
      wait: (ms) => new Promise((resolve) => { timer = setTimeout(resolve, ms); }),
      now: () => Date.now(),
      abandoned: () => abandoned,
    }).then((status) => {
      if (abandoned || !status) return;
      setAwaitingLogin(false);
      notifyStatus.current(status);
    });

    return () => {
      abandoned = true;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [awaitingLogin]);

  /**
   * The way to finish when watching did not manage it — the window was closed early, five minutes passed, or
   * the sign-in happened somewhere this screen could not see. Kept as a button, not replaced by the polling,
   * because polling gives up while a person who knows they are signed in does not.
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
            새 창에서 페이스북 로그인을 마치면 이 화면이 저절로 바뀝니다. 창은 닫으셔도 됩니다.
            바뀌지 않으면 아래를 눌러 주세요.
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
