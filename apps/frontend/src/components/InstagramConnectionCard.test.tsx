import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { InstagramConnectionCard, pollUntilTokenStored, tokenLine } from "./InstagramConnectionCard.js";

function status(overrides: Record<string, unknown> = {}) {
  return { appConfigured: true, tokenStored: false, ...overrides } as never;
}

function renderCard(overrides: Record<string, unknown> = {}, onStatusChange = () => {}) {
  return render(<InstagramConnectionCard status={status(overrides)} onStatusChange={onStatusChange} />);
}

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.parse("2026-08-27T00:00:00.000Z");

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

/** A clock that only moves when the flow waits, so a five-minute timeout costs a test no time at all. */
function clock() {
  let current = 0;
  return { now: () => current, wait: async (ms: number) => { current += ms; } };
}

const STORED = { appConfigured: true, tokenStored: true } as never;
const NOT_STORED = { appConfigured: true, tokenStored: false } as never;

describe("pollUntilTokenStored", () => {
  const open = () => false;

  it("succeeds only once the server says a token is stored", async () => {
    const readStatus = vi.fn()
      .mockResolvedValueOnce(NOT_STORED)
      .mockResolvedValueOnce(NOT_STORED)
      .mockResolvedValueOnce(STORED);
    const result = await pollUntilTokenStored({
      isWindowClosed: open, readStatus, abandoned: () => false, ...clock(), intervalMs: 10, timeoutMs: 10_000,
    });
    expect(result).toBe(STORED);
    expect(readStatus).toHaveBeenCalledTimes(3);
  });

  /**
   * The one that decides whether watching is worth having.
   *
   * The callback page has no script and closes nothing — it asks the person to close the window — so the close
   * arrives whenever they get round to it, including right after a sign-in that already succeeded. Check the
   * closed window after the read instead of before and that read can be stale, ending the wait on a login that
   * completed; the person is then left pressing the fallback button on an account already connected. Because it
   * turns on human timing it would reproduce only sometimes, which is the worst way for it to be found.
   */
  it("treats a window that closed on success as a success", async () => {
    const result = await pollUntilTokenStored({
      isWindowClosed: () => true, readStatus: async () => STORED, abandoned: () => false,
      ...clock(), intervalMs: 10, timeoutMs: 10_000,
    });
    expect(result).toBe(STORED);
  });

  // Giving up is not a failure state here: the button below still finishes the job, so this only has to stop.
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
      isWindowClosed: open, readStatus, abandoned: () => false, ...clock(), intervalMs: 100, timeoutMs: 250,
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
      isWindowClosed: open, readStatus, abandoned: () => false, ...clock(), intervalMs: 10, timeoutMs: 10_000,
    });
    expect(result).toBe(STORED);
  });

  // Every await here can outlive the card that started it — a status that arrives after the screen moved on
  // must not be pushed into a component that is no longer listening.
  it("reports nothing once abandoned, even holding a stored token", async () => {
    let abandoned = false;
    const result = await pollUntilTokenStored({
      isWindowClosed: open,
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

  // Login now works wherever the app runs: Meta redirects back to the backend, so nothing has to inspect a
  // window. The browser is the environment the user actually works in.
  it("offers login in a plain browser tab, with no desktop shell present", () => {
    renderCard();
    expect(screen.getByTestId("instagram-login-button")).not.toBeDisabled();
    expect(screen.queryByTestId("instagram-login-unavailable")).toBeNull();
  });

  it("cannot start a login before the app details exist", () => {
    renderCard({ appConfigured: false });
    expect(screen.getByTestId("instagram-login-button")).toBeDisabled();
  });

  it("opens the login page and then asks the server what happened, never reading the code itself", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { url: "https://www.facebook.com/dialog/oauth?x=1" }))
      .mockResolvedValueOnce(jsonResponse(200, { appConfigured: true, tokenStored: true, tokenExpiresAt: new Date(NOW + 60 * DAY).toISOString() }));
    vi.stubGlobal("fetch", fetchMock);
    const open = vi.fn().mockReturnValue({});
    vi.stubGlobal("open", open);

    const onStatusChange = vi.fn();
    renderCard({}, onStatusChange);

    fireEvent.click(screen.getByTestId("instagram-login-button"));
    await screen.findByTestId("instagram-login-awaiting");
    expect(open).toHaveBeenCalledWith("https://www.facebook.com/dialog/oauth?x=1", "instagram-login", expect.any(String));

    fireEvent.click(screen.getByTestId("instagram-login-refresh"));
    await waitFor(() => expect(onStatusChange).toHaveBeenCalled());
    // The second call reads status; the code never passes through this screen at all.
    expect(String((fetchMock.mock.calls[1] as [string, RequestInit])[0])).toBe("/settings/instagram/connection");
  });

  // A blocked popup is the one case where pressing the button really does nothing, so it has to be said.
  it("says so when the login window is blocked", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { url: "https://www.facebook.com/dialog/oauth" })));
    vi.stubGlobal("open", vi.fn().mockReturnValue(null));

    renderCard();
    fireEvent.click(screen.getByTestId("instagram-login-button"));

    const error = await screen.findByTestId("instagram-connection-error");
    expect(error.textContent).toContain("팝업");
    expect(screen.queryByTestId("instagram-login-awaiting")).toBeNull();
  });

  // Run in a plain tab, like every other test here: signing in no longer involves the shell at all, so putting a
  // fake `electronAPI` on the window would exercise a state the app no longer has.
  it("shows a rejected login start without leaking the raw backend text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code: "INSTAGRAM_PROVIDER_ERROR", message: "raw backend detail" })));
    vi.stubGlobal("open", vi.fn());

    renderCard();
    fireEvent.click(screen.getByTestId("instagram-login-button"));

    const error = await screen.findByTestId("instagram-connection-error");
    expect(error.textContent).not.toContain("raw backend detail");
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
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { appConfigured: true, tokenStored: false }));
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
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { appConfigured: true, tokenStored: false }));
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
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { appConfigured: true, tokenStored: false }));
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
