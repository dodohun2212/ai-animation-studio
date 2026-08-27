import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse } from "../api/testUtils.js";
import { InstagramConnectionCard, tokenLine } from "./InstagramConnectionCard.js";

function status(overrides: Record<string, unknown> = {}) {
  return { appConfigured: true, tokenStored: false, ...overrides } as never;
}

/**
 * Stands in for the packaged shell for one test and puts the real value back afterwards. A plain browser tab has
 * no `electronAPI`, which is itself one of the states this card has to handle.
 */
async function withElectron(
  openInstagramLogin: ReturnType<typeof vi.fn>,
  body: () => Promise<void>,
): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(window, "electronAPI");
  Object.defineProperty(window, "electronAPI", {
    value: { openProjectPath: vi.fn(), openInstagramLogin },
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

describe("InstagramConnectionCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("asks for the app details before anything else when they are missing", () => {
    renderCard({ appConfigured: false });
    expect(screen.getByTestId("instagram-app-missing")).toBeTruthy();
    expect(screen.queryByTestId("instagram-token-line")).toBeNull();
  });

  // A browser tab has no window to open, so the button says which app can do it rather than doing nothing.
  it("says login needs the desktop app when there is no shell to open a window", () => {
    renderCard();
    expect(screen.getByTestId("instagram-login-button")).toBeDisabled();
    expect(screen.getByTestId("instagram-login-unavailable").textContent).toContain("데스크톱 앱");
  });

  it("cannot start a login before the app details exist", async () => {
    await withElectron(vi.fn(), async () => {
      renderCard({ appConfigured: false });
      expect(screen.getByTestId("instagram-login-button")).toBeDisabled();
    });
  });

  it("opens the login page, then hands the landed url straight back to the server", async () => {
    const landed = "https://www.facebook.com/connect/login_success.html?code=abc&state=xyz";
    const openInstagramLogin = vi.fn().mockResolvedValue({ kind: "redirected", url: landed });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { url: "https://www.facebook.com/dialog/oauth?x=1", redirectPrefix: "https://www.facebook.com/connect/login_success.html" }))
      .mockResolvedValueOnce(jsonResponse(200, { appConfigured: true, tokenStored: true, tokenExpiresAt: new Date(NOW + 60 * DAY).toISOString() }));
    vi.stubGlobal("fetch", fetchMock);

    await withElectron(openInstagramLogin, async () => {
      const onStatusChange = vi.fn();
      renderCard({}, onStatusChange);

      fireEvent.click(screen.getByTestId("instagram-login-button"));

      await waitFor(() => expect(onStatusChange).toHaveBeenCalled());
      expect(openInstagramLogin).toHaveBeenCalledWith("https://www.facebook.com/dialog/oauth?x=1", "https://www.facebook.com/connect/login_success.html");
      const complete = fetchMock.mock.calls[1] as [string, RequestInit];
      expect(String(complete[0])).toBe("/settings/instagram/login/complete");
      // The screen reads nothing out of the URL — the server checks the state it issued against it.
      expect(JSON.parse(String(complete[1].body))).toEqual({ redirectedUrl: landed });
    });
  });

  // Closing the window is an ordinary change of mind. It must not look like a failure — but a button press that
  // visibly does nothing reads as broken, so it is acknowledged quietly instead.
  it("treats a closed window as a cancellation, not an error", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { url: "https://www.facebook.com/dialog/oauth", redirectPrefix: "https://www.facebook.com/connect/login_success.html" }));
    vi.stubGlobal("fetch", fetchMock);

    await withElectron(vi.fn().mockResolvedValue({ kind: "cancelled" }), async () => {
      renderCard();
      fireEvent.click(screen.getByTestId("instagram-login-button"));

      await screen.findByTestId("instagram-login-cancelled");
      expect(screen.queryByTestId("instagram-connection-error")).toBeNull();
      // Nothing was sent to complete a login that never happened.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  it("shows a rejected login start without leaking the raw backend text", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(400, { code: "INSTAGRAM_PROVIDER_ERROR", message: "raw backend detail" })));

    await withElectron(vi.fn(), async () => {
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
