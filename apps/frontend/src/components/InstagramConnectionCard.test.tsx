import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { InstagramConnectionCard, pollUntilTokenStored, tokenLine } from "./InstagramConnectionCard.js";

function status(overrides: Record<string, unknown> = {}) {
  return { appConfigured: true, tokenStored: false, callbackLoginAvailable: false, ...overrides } as never;
}

/**
 * Stands in for the packaged shell for one test and puts the real value back afterwards. A plain browser tab
 * has no `electronAPI` at all, and an older shell has one without `openInstagramLogin` — both are states this
 * card has to handle, so the fake is built from whatever the test passes rather than a fixed shape.
 */
async function withElectron(bridge: Record<string, unknown>, body: () => Promise<void>): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(window, "electronAPI");
  Object.defineProperty(window, "electronAPI", {
    value: { openProjectPath: vi.fn(), ...bridge },
    configurable: true,
  });
  try {
    await body();
  } finally {
    if (original) Object.defineProperty(window, "electronAPI", original);
    else Reflect.deleteProperty(window as unknown as Record<string, unknown>, "electronAPI");
  }
}

function renderCard(overrides: Record<string, unknown> = {}, onStatusChange = () => {}) {
  return render(<InstagramConnectionCard status={status(overrides)} onStatusChange={onStatusChange} />);
}

/** A clock that only moves when the flow waits, so a five-minute timeout costs a test no time at all. */
function clock() {
  let current = 0;
  return { now: () => current, wait: async (ms: number) => { current += ms; } };
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-27T00:00:00.000Z");
const PREFIX = "https://www.facebook.com/connect/login_success.html";
const PAGE = "https://www.facebook.com/dialog/oauth?client_id=1";
const STORED = { appConfigured: true, tokenStored: true, callbackLoginAvailable: true } as never;
const NOT_STORED = { appConfigured: true, tokenStored: false, callbackLoginAvailable: true } as never;
const REFUSED = {
  appConfigured: true, tokenStored: false, callbackLoginAvailable: true,
  lastLoginError: { code: "INSTAGRAM_PROVIDER_ERROR" },
} as never;

describe("tokenLine", () => {
  // "Stored" is not "works": this app has never asked Meta whether a stored token is still accepted, and saying
  // so would repeat exactly the claim the provider cards had to stop making.
  it("never says the app is logged in — only that a token is stored", () => {
    const line = tokenLine(status({ tokenStored: true, tokenExpiresAt: new Date(NOW + 60 * DAY).toISOString() }), NOW);
    expect(line.text).toContain("토큰 저장됨");
    expect(line.text).not.toContain("로그인됨");
    expect(line.text).not.toContain("연결됨");
  });

  // The expiry date is a fact we hold, so a date already past can be stated outright — that is different from
  // claiming the token works.
  it("states an expiry already in the past as a fact, and says what to do", () => {
    const line = tokenLine(status({ tokenStored: true, tokenExpiresAt: new Date(NOW - DAY).toISOString() }), NOW);
    expect(line.expired).toBe(true);
    expect(line.text).toContain("다시 로그인");
  });

  // A long-lived token lasts about 60 days and Meta documents no way to refresh one, so an approaching expiry
  // has to be visible before it arrives as "it suddenly stopped".
  it("warns while the expiry is still ahead but close", () => {
    const line = tokenLine(status({ tokenStored: true, tokenExpiresAt: new Date(NOW + 3 * DAY).toISOString() }), NOW);
    expect(line.tone).toBe("warn");
    expect(line.text).toContain("3일 남음");
    expect(line.expired).toBe(false);
  });

  it("says the expiry is unknown rather than inventing a reading of it", () => {
    expect(tokenLine(status({ tokenStored: true }), NOW).text).toContain("확인되지 않았습니다");
  });
});

describe("pollUntilTokenStored", () => {
  const openWindow = () => false;

  it("succeeds only once the server says a token is stored", async () => {
    const readStatus = vi.fn()
      .mockResolvedValueOnce(NOT_STORED)
      .mockResolvedValueOnce(NOT_STORED)
      .mockResolvedValueOnce(STORED);
    const result = await pollUntilTokenStored({
      isWindowClosed: openWindow, readStatus, abandoned: () => false, ...clock(), intervalMs: 10, timeoutMs: 10_000,
    });
    expect(result).toBe(STORED);
    expect(readStatus).toHaveBeenCalledTimes(3);
  });

  /**
   * The one that decides whether this flow works at all.
   *
   * The callback page has no script and closes nothing — it asks the person to close the window — so the close
   * arrives whenever they get round to it, including right after a sign-in that already succeeded. Check the
   * closed window after the read instead of before and that read can be stale, ending the wait on a completed
   * login; the person is then told nothing happened on an account that is in fact connected. Because it turns
   * on human timing it would reproduce only sometimes, which is the worst way for it to be found.
   */
  it("treats a window that closed on success as a success", async () => {
    const result = await pollUntilTokenStored({
      isWindowClosed: () => true, readStatus: async () => STORED, abandoned: () => false,
      ...clock(), intervalMs: 10, timeoutMs: 10_000,
    });
    expect(result).toBe(STORED);
  });

  /**
   * The five-minute wait was the whole cost here. A refusal lands in the first seconds, and without this the
   * screen sat silent until its timer ran out and then said the login "took too long" — about something that
   * had already been answered, and in a direction that sends the person to wait rather than to fix.
   */
  it("stops as soon as a refusal is reported, without waiting out the timeout", async () => {
    const readStatus = vi.fn()
      .mockResolvedValueOnce(NOT_STORED)
      .mockResolvedValueOnce(REFUSED);
    const result = await pollUntilTokenStored({
      isWindowClosed: openWindow, readStatus, abandoned: () => false,
      ...clock(), intervalMs: 10, timeoutMs: 10_000,
    });
    expect(result).toBe(REFUSED);
    expect(readStatus).toHaveBeenCalledTimes(2);
  });

  it("stops when the window closed with no token", async () => {
    const result = await pollUntilTokenStored({
      isWindowClosed: () => true, readStatus: async () => NOT_STORED, abandoned: () => false,
      ...clock(), intervalMs: 10, timeoutMs: 10_000,
    });
    expect(result).toBeNull();
  });

  it("stops once the cap is reached", async () => {
    const readStatus = vi.fn().mockResolvedValue(NOT_STORED);
    const result = await pollUntilTokenStored({
      isWindowClosed: openWindow, readStatus, abandoned: () => false, ...clock(), intervalMs: 100, timeoutMs: 250,
    });
    expect(result).toBeNull();
    expect(readStatus).toHaveBeenCalledTimes(3);
  });

  // The sign-in is happening elsewhere and does not care that one read did not land.
  it("keeps waiting through a failed read", async () => {
    const readStatus = vi.fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(STORED);
    const result = await pollUntilTokenStored({
      isWindowClosed: openWindow, readStatus, abandoned: () => false, ...clock(), intervalMs: 10, timeoutMs: 10_000,
    });
    expect(result).toBe(STORED);
  });

  // Every await here can outlive the card that started it — a status arriving after the screen moved on must
  // not be pushed into a component that is no longer listening.
  it("reports nothing once abandoned, even holding a stored token", async () => {
    let abandoned = false;
    const result = await pollUntilTokenStored({
      isWindowClosed: openWindow,
      readStatus: async () => { abandoned = true; return STORED; },
      abandoned: () => abandoned,
      ...clock(), intervalMs: 10, timeoutMs: 10_000,
    });
    expect(result).toBeNull();
  });
});

describe("InstagramConnectionCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the app details before anything else when they are missing", () => {
    renderCard({ appConfigured: false });
    expect(screen.getByTestId("instagram-app-missing")).toBeTruthy();
    expect(screen.queryByTestId("instagram-token-line")).toBeNull();
  });

  /**
   * Neither side can decide this alone: the server knows whether it is serving the HTTPS callback, and only the
   * screen knows whether it sits in a shell that can read its own window. These three pin the combination.
   */
  it("offers the browser sign-in when the server is serving the callback", () => {
    renderCard({ callbackLoginAvailable: true });
    expect(screen.getByTestId("instagram-login-button")).not.toBeDisabled();
    expect(screen.queryByTestId("instagram-login-unavailable")).toBeNull();
  });

  it("prefers the shell's own window whenever there is one, callback or not", async () => {
    await withElectron({ openInstagramLogin: vi.fn() }, async () => {
      renderCard({ callbackLoginAvailable: false });
      expect(screen.getByTestId("instagram-login-button")).not.toBeDisabled();
    });
  });

  /**
   * A browser tab with no callback listener has no way to sign in at all — Meta will not redirect to an address
   * this app cannot offer. The button must not be pressable, and the notice has to name the missing piece
   * rather than leave the person hunting for a setting inside this app.
   */
  it("says why a plain browser tab cannot sign in yet", () => {
    renderCard({ callbackLoginAvailable: false });
    expect(screen.getByTestId("instagram-login-button")).toBeDisabled();
    const notice = screen.getByTestId("instagram-login-unavailable");
    expect(notice.textContent).toContain("HTTPS");
    expect(notice.textContent).toContain("인증서");
  });

  /**
   * A shell built before the login window existed has `electronAPI` and no `openInstagramLogin`. Gating on the
   * bridge's presence alone would send it down the desktop path and then call `undefined`.
   */
  it("does not take the desktop path in a shell that cannot open the window", async () => {
    await withElectron({}, async () => {
      renderCard({ callbackLoginAvailable: false });
      expect(screen.getByTestId("instagram-login-button")).toBeDisabled();
      expect(screen.getByTestId("instagram-login-unavailable")).toBeTruthy();
    });
  });

  it("cannot start a login before the app details exist", async () => {
    await withElectron({ openInstagramLogin: vi.fn() }, async () => {
      renderCard({ appConfigured: false });
      expect(screen.getByTestId("instagram-login-button")).toBeDisabled();
    });
  });

  /**
   * The flow is named in the request because the server cannot tell a browser tab from the shell, and a wrong
   * guess does not fail loudly — it opens a window nobody watches. So which name is sent is worth pinning on
   * both branches.
   */
  it("names the desktop flow, then hands the landed url straight back to the server", async () => {
    const landed = `${PREFIX}?code=abc&state=xyz`;
    const openInstagramLogin = vi.fn().mockResolvedValue({ kind: "redirected", url: landed });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { url: PAGE, redirectPrefix: PREFIX }))
      .mockResolvedValueOnce(jsonResponse(200, { appConfigured: true, tokenStored: true, callbackLoginAvailable: false }));
    vi.stubGlobal("fetch", fetchMock);

    await withElectron({ openInstagramLogin }, async () => {
      const onStatusChange = vi.fn();
      renderCard({}, onStatusChange);
      fireEvent.click(screen.getByTestId("instagram-login-button"));

      await waitFor(() => expect(onStatusChange).toHaveBeenCalled());
      const [startUrl, startInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(String(startUrl)).toBe("/settings/instagram/login/start");
      expect(JSON.parse(String(startInit.body))).toEqual({ flow: "desktop" });
      // Opened on the server's page and watched for the server's prefix — the screen invents neither, so it
      // cannot open a dialog carrying a `state` the server will not recognise.
      expect(openInstagramLogin).toHaveBeenCalledWith(PAGE, PREFIX);
      const complete = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(String(complete[0])).toBe("/settings/instagram/login/complete");
      // Handed over whole: the screen reads nothing out of it, so a URL from anywhere else cannot be dressed up
      // as a login here.
      expect(JSON.parse(String(complete[1].body))).toEqual({ redirectedUrl: landed });
    });
  });

  it("names the callback flow and opens the page the server gave, without waiting on a window it never got", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { url: PAGE }));
    vi.stubGlobal("fetch", fetchMock);
    const open = vi.fn().mockReturnValue(null);
    vi.stubGlobal("open", open);

    renderCard({ callbackLoginAvailable: true });
    fireEvent.click(screen.getByTestId("instagram-login-button"));

    const error = await screen.findByTestId("instagram-connection-error");
    // A blocked popup is not a server error and not something pressing again fixes, so it names the setting.
    expect(error).toHaveAttribute("data-error-code", "CLIENT_POPUP_BLOCKED");
    expect(error.textContent).toContain("팝업 차단");
    const [, startInit] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(startInit.body))).toEqual({ flow: "callback" });
    expect(String((open.mock.calls[0] as unknown[])[0])).toBe(PAGE);
  });

  /**
   * The refusal has to arrive as the refusal, in the same words the desktop flow would use. Yesterday this
   * failure reached nobody: the server knew the credentials were wrong, and the screen said it had waited too
   * long. The message that was already correct simply had no route to the person reading it.
   */
  it("says why a browser sign-in was refused, in the same words as everywhere else", async () => {
    const refused = { appConfigured: true, tokenStored: false, callbackLoginAvailable: true, lastLoginError: { code: "INSTAGRAM_PROVIDER_ERROR" } };
    vi.stubGlobal("fetch", vi.fn().mockImplementation((url: unknown) => Promise.resolve(
      String(url).includes("/login/start") ? jsonResponse(200, { url: PAGE }) : jsonResponse(200, refused),
    )));
    vi.stubGlobal("open", vi.fn().mockReturnValue({ closed: false, close: vi.fn() }));

    renderCard({ callbackLoginAvailable: true });
    fireEvent.click(screen.getByTestId("instagram-login-button"));

    const error = await screen.findByTestId("instagram-connection-error", undefined, { timeout: 4000 });
    expect(error).toHaveAttribute("data-error-code", "INSTAGRAM_PROVIDER_ERROR");
    expect(error.textContent).toContain("앱 ID와 시크릿");
    // Not the clock's fault, and not the person's — neither of those may be claimed here.
    expect(screen.queryByTestId("instagram-login-timeout")).toBeNull();
    expect(screen.queryByTestId("instagram-login-cancelled")).toBeNull();
  });

  /**
   * Closing the window is an ordinary change of mind, and in the desktop flow it is also a complete answer —
   * the code is only exchanged by the completion call, so nothing was stored and nothing is left to confirm.
   */
  it("treats a closed desktop window as a cancellation, and sends nothing", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { url: PAGE, redirectPrefix: PREFIX }));
    vi.stubGlobal("fetch", fetchMock);

    await withElectron({ openInstagramLogin: vi.fn().mockResolvedValue({ kind: "cancelled" }) }, async () => {
      renderCard();
      fireEvent.click(screen.getByTestId("instagram-login-button"));

      await screen.findByTestId("instagram-login-cancelled");
      expect(screen.queryByTestId("instagram-connection-error")).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  /**
   * The desktop flow is finished by watching for an address, so a start without one leaves nothing to watch.
   * It cannot happen against a matching backend — which is why it is reported as a build problem — but silence
   * would leave the button looking broken, and opening a window against an undefined prefix would be worse.
   */
  it("says so when a desktop start arrives with no address to watch", async () => {
    const openInstagramLogin = vi.fn();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { url: PAGE })));

    await withElectron({ openInstagramLogin }, async () => {
      renderCard();
      fireEvent.click(screen.getByTestId("instagram-login-button"));

      const error = await screen.findByTestId("instagram-connection-error");
      expect(error).toHaveAttribute("data-error-code", "CLIENT_UNSUPPORTED_LOGIN_FLOW");
      expect(openInstagramLogin).not.toHaveBeenCalled();
    });
  });

  it("shows a rejected login start without leaking the raw backend text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code: "INSTAGRAM_PROVIDER_ERROR", message: "raw backend detail" })));

    await withElectron({ openInstagramLogin: vi.fn() }, async () => {
      renderCard();
      fireEvent.click(screen.getByTestId("instagram-login-button"));

      const error = await screen.findByTestId("instagram-connection-error");
      expect(error.textContent).not.toContain("raw backend detail");
    });
  });

  // Saving new app details throws the stored token away, so it is said before it happens rather than discovered
  // by finding oneself logged out.
  it("warns before replacing app details that would invalidate the stored token", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    renderCard({ tokenStored: true, tokenExpiresAt: new Date(NOW + 60 * DAY).toISOString() });

    fireEvent.change(screen.getByTestId("instagram-app-id"), { target: { value: "1234" } });
    fireEvent.change(screen.getByTestId("instagram-app-secret"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByTestId("instagram-app-save"));

    expect(screen.getByTestId("instagram-app-replace-warning").textContent).toContain("다시 로그인");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves on the second press, once the warning has been seen", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { appConfigured: true, tokenStored: false, callbackLoginAvailable: false }));
    vi.stubGlobal("fetch", fetchMock);
    renderCard({ tokenStored: true, tokenExpiresAt: new Date(NOW + 60 * DAY).toISOString() });

    fireEvent.change(screen.getByTestId("instagram-app-id"), { target: { value: "1234" } });
    fireEvent.change(screen.getByTestId("instagram-app-secret"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByTestId("instagram-app-save"));
    fireEvent.click(screen.getByTestId("instagram-app-save"));

    await screen.findByTestId("instagram-app-id");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String((fetchMock.mock.calls[0] as [string, RequestInit])[0])).toBe("/settings/instagram/app");
  });

  // No token stored means nothing to invalidate, so the extra press would be a confirmation of nothing.
  it("saves straight away when there is no token to lose", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { appConfigured: true, tokenStored: false, callbackLoginAvailable: false }));
    vi.stubGlobal("fetch", fetchMock);
    renderCard();

    fireEvent.change(screen.getByTestId("instagram-app-id"), { target: { value: "1234" } });
    fireEvent.change(screen.getByTestId("instagram-app-secret"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByTestId("instagram-app-save"));

    await screen.findByTestId("instagram-app-id");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("instagram-app-replace-warning")).toBeNull();
  });

  it("keeps the secret out of the DOM as readable text", () => {
    renderCard();
    expect(screen.getByTestId("instagram-app-secret")).toHaveAttribute("type", "password");
  });

  it("signs out via the connection endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { appConfigured: true, tokenStored: false, callbackLoginAvailable: false }));
    vi.stubGlobal("fetch", fetchMock);
    renderCard({ tokenStored: true, tokenExpiresAt: new Date(NOW + 60 * DAY).toISOString() });

    fireEvent.click(screen.getByTestId("instagram-logout-button"));

    await screen.findByTestId("instagram-connection");
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/settings/instagram/connection");
    expect(init.method).toBe("DELETE");
  });

  it("shows a rejected save's reason without leaking the raw backend text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code: "INSTAGRAM_PROVIDER_ERROR", message: "raw backend detail" })));
    renderCard();

    fireEvent.change(screen.getByTestId("instagram-app-id"), { target: { value: "1234" } });
    fireEvent.change(screen.getByTestId("instagram-app-secret"), { target: { value: "s3cret" } });
    fireEvent.click(screen.getByTestId("instagram-app-save"));

    const error = await screen.findByTestId("instagram-connection-error");
    expect(error.textContent).not.toContain("raw backend detail");
  });
});
