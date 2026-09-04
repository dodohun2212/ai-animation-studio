import { useEffect, useRef, useState, type FormEvent } from "react";
import type { InstagramConnectionStatus } from "@ai-animation-studio/shared";

import { canOpenInstagramLogin, openInstagramLoginWindow } from "../api/electronBridge.js";
import {
  completeInstagramLogin,
  disconnectInstagram,
  getInstagramConnection,
  instagramConnectionErrorForCode,
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

const LOGIN_POLL_INTERVAL_MS = 1500;
// Long enough to cover finding a password, a 2FA prompt, and choosing which accounts to grant. Past this the
// waiting stops; the person can press the button again, which costs them nothing.
const LOGIN_POLL_TIMEOUT_MS = 5 * 60 * 1000;

export interface PollDeps {
  /** Read afresh each round — the person may close the window at any moment, including after succeeding. */
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
 * How the callback flow learns it finished. Meta redirects the window to this app's own HTTPS listener, which
 * stores the token by itself, so nothing comes back through the window — the only way to find out is to ask
 * the server again.
 *
 * The one thing that counts as success is the server saying a token is stored. Not a closed window, not time
 * passing — reading success off either would be claiming a connection this app never confirmed (D-006). A
 * closed window is especially weak evidence, because a person closes it whenever they feel like it: before
 * signing in, halfway through, or well after it finished.
 *
 * A reported refusal ends the wait too, and that is the same rule rather than an exception: both are the server
 * answering about this attempt. What it removes is a five-minute silence ending in "it took too long", said
 * about a login that was refused in the first few seconds — an answer that is not merely unhelpful but false,
 * and that sends the person to wait when the thing to change is in their hands.
 */
export async function pollUntilTokenStored(deps: PollDeps): Promise<InstagramConnectionStatus | null> {
  const intervalMs = deps.intervalMs ?? LOGIN_POLL_INTERVAL_MS;
  const timeoutMs = deps.timeoutMs ?? LOGIN_POLL_TIMEOUT_MS;
  const startedAt = deps.now();

  for (;;) {
    await deps.wait(intervalMs);
    if (deps.abandoned()) return null;

    // Read whether the window is gone BEFORE asking the server, so the status is never older than the close.
    // The callback page has no script and closes nothing — it asks the person to close the window — so the
    // close lands at an arbitrary moment. Read first and the "not stored yet" answer can already be stale by
    // the time the window shuts, ending the wait on a login that had in fact completed. That failure depends
    // on human timing, so it would reproduce only sometimes.
    const closedBeforeRead = deps.isWindowClosed();

    let status: InstagramConnectionStatus | undefined;
    // A failed poll is not a failed login: the sign-in is happening in another window and does not care that
    // one of our reads did not land. The timeout is what ends this, not one bad read.
    try {
      status = await deps.readStatus();
    } catch {
      status = undefined;
    }
    if (deps.abandoned()) return null;
    // A refusal ends the wait exactly as a token does — both are the server having something to say about this
    // attempt. Kept in the same shape (the status itself) so the caller reads one value and decides once.
    if (status?.tokenStored || status?.lastLoginError) return status;
    if (closedBeforeRead) return null;
    if (deps.now() - startedAt >= timeoutMs) return null;
  }
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
  const [cancelled, setCancelled] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  /**
   * Set once this card is gone, so a sign-in still running has something to check.
   *
   * The callback flow waits up to five minutes inside a click handler, and the settings screen is one people
   * come and go from — so the wait routinely outlives the card that started it. Without this the poll keeps
   * asking the server and then reports into a tree that is no longer mounted.
   *
   * A ref rather than state on purpose: it is read from inside a running loop, never rendered, and setting it
   * must not schedule a render on a component that is being torn down.
   */
  const abandoned = useRef(false);
  useEffect(() => () => { abandoned.current = true; }, []);

  const line = tokenLine(status, Date.now());
  // Which sign-in this screen can run, decided here because neither side knows alone: the server knows whether
  // it is serving the HTTPS callback, and only the screen knows whether it sits in a shell that can read its
  // own window. "none" is a real answer — a browser tab with no callback listener has no way to sign in, and
  // saying so beats a button that always fails.
  const flow: "desktop" | "callback" | "none" = canOpenInstagramLogin()
    ? "desktop"
    : status.callbackLoginAvailable ? "callback" : "none";

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
   * The whole sign-in, end to end: ask the server for the page, open it in a window the shell owns, and hand
   * back whatever URL that window landed on.
   *
   * The screen never reads that URL — the server takes the code out of it and checks it against the `state` it
   * issued, so a URL that did not come from our own request cannot be turned into a login here. That is also
   * what lets this pass along an address it does not understand.
   *
   * Meta only accepts an HTTPS redirect address, and its documented one for a desktop window is a page on
   * facebook.com. A local backend has no HTTPS address to offer instead, which is why this path needs the shell
   * and a browser tab cannot stand in for it (docs/06_DECISIONS.md D-020).
   */
  async function login(): Promise<void> {
    if (pending || flow === "none") return;
    setPending(true);
    setError(null);
    setCancelled(false);
    setTimedOut(false);
    try {
      const started = await startInstagramLogin(flow);

      if (flow === "desktop") {
        if (!started.redirectPrefix) {
          // The desktop flow is finished by watching for this address, so its absence leaves nothing to watch
          // for. It cannot happen against a matching backend, which is why it is reported as a build problem
          // rather than something the person did — but silence here would read as a broken button.
          setError({
            code: "CLIENT_UNSUPPORTED_LOGIN_FLOW",
            message: "이 앱이 처리할 수 없는 로그인 방식입니다. 앱을 다시 빌드해야 할 수 있습니다.",
          });
          return;
        }
        const outcome = await openInstagramLoginWindow(started.url, started.redirectPrefix);
        if (!outcome) {
          setError({
            code: "CLIENT_NO_DESKTOP_BRIDGE",
            message: "로그인 창을 열 수 없습니다. 데스크톱 앱에서 시도해 주세요.",
          });
          return;
        }
        // Closing the window is an ordinary change of mind, not a failure — an error banner here would accuse
        // the user of a mistake they did not make. It is also a complete answer in this flow: the code is only
        // exchanged by the call below, so nothing was stored and nothing is left to confirm.
        if (outcome.kind === "cancelled") {
          setCancelled(true);
          return;
        }
        onStatusChange(await completeInstagramLogin(outcome.url));
        return;
      }

      // Callback flow: the server receives the code itself, so this window is opened and then only watched for
      // whether it is still there. Everything about the outcome comes from asking the server.
      const opened = window.open(started.url, "instagram-login", "width=520,height=760");
      if (!opened) {
        setError({
          code: "CLIENT_POPUP_BLOCKED",
          message: "로그인 창이 열리지 않았습니다. 이 주소의 팝업 차단을 해제한 뒤 다시 눌러 주세요.",
        });
        return;
      }
      const stored = await pollUntilTokenStored({
        isWindowClosed: () => opened.closed,
        readStatus: getInstagramConnection,
        wait: (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
        now: () => Date.now(),
        abandoned: () => abandoned.current,
      });
      if (abandoned.current) return;
      if (stored?.lastLoginError) {
        // Refused. Say which refusal, using the same table the thrown-error path uses — the desktop flow and
        // this one must not describe one failure two ways. The status still goes through, because everything
        // else on it (app configured, callback available) is current.
        onStatusChange(stored);
        setError(instagramConnectionErrorForCode(stored.lastLoginError.code));
        return;
      }
      if (stored) {
        onStatusChange(stored);
        return;
      }
      // Nothing was stored. Which of the two ways it ended is worth distinguishing: a closed window is a choice
      // the person made, and a five-minute silence is not.
      if (opened.closed) setCancelled(true);
      else {
        opened.close();
        setTimedOut(true);
      }
    } catch (caught) {
      if (!abandoned.current) setError(toInstagramConnectionDisplayError(caught));
    } finally {
      if (!abandoned.current) setPending(false);
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
          disabled={pending || !status.appConfigured || flow === "none"}
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

      {/*
        Says why, not only that. The reason is not "this is unfinished" — Meta accepts only an HTTPS redirect
        address, and a plain browser tab has none to offer until the local callback listener is running. Naming
        that spares the person hunting for a setting inside this app. It is deliberately not phrased as "ready
        to sign in" when the listener IS running: whether that address is registered with the Meta app, and
        whether this browser trusts the certificate, are things this screen cannot know and that only show up
        as a failure on Meta's page.
      */}
      {flow === "none" && (
        <div className="space-y-1 rounded-xl border border-white/10 bg-slate-950/40 p-3" data-testid="instagram-login-unavailable">
          <p className="text-xs text-slate-400">
            지금은 로그인할 수 없습니다 — 인스타그램은 HTTPS 주소로만 로그인을 돌려보내는데, 이 주소는 아직 준비돼 있지 않습니다.
          </p>
          <p className="text-xs text-slate-500">
            로컬 인증서를 설정해 콜백 주소를 켜거나, 데스크톱 앱에서 로그인하면 됩니다. 어느 쪽이든 한 번만 하면 약 60일간 유지됩니다.
          </p>
        </div>
      )}

      {cancelled && (
        <p data-testid="instagram-login-cancelled" className="text-xs text-slate-400">
          로그인을 취소했습니다.
        </p>
      )}
      {timedOut && (
        <p data-testid="instagram-login-timeout" className="text-xs text-slate-400">
          로그인이 끝나지 않아 기다리기를 멈췄습니다. 로그인을 마쳤다면 새로고침해 주세요.
        </p>
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
