import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProviderStatus } from "../api/testUtils.js";
import { ProviderSettingsScreen } from "./ProviderSettingsScreen.js";

describe("ProviderSettingsScreen", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows loading, then both provider cards on success", async () => {
    const providers = [makeProviderStatus({ provider: "openai" }), makeProviderStatus({ provider: "runway" })];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { providers })));
    render(<ProviderSettingsScreen onBack={() => {}} />);

    expect(screen.getByText("불러오는 중...")).toBeTruthy();
    expect(await screen.findByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("Runway")).toBeTruthy();
  });

  it("shows a screen-level error with its code identifiable when the initial GET fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(500, { code: "SETTINGS_FILE_MALFORMED", message: "설정을 불러오지 못했습니다." })),
    );
    render(<ProviderSettingsScreen onBack={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe("설정을 불러오지 못했습니다.");
    expect(alert).toHaveAttribute("data-error-code", "SETTINGS_FILE_MALFORMED");
  });

  it("does not render an untrusted error code, message, path, or secret anywhere in the DOM", async () => {
    const leakedCode = "UNKNOWN_C:\\Users\\secret\\sk-live-value";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(500, {
      code: leakedCode,
      message: "raw server message C:\\Users\\secret\\sk-live-value",
      details: { path: "C:\\Users\\secret", credential: "sk-live-value" },
    })));
    const rendered = render(<ProviderSettingsScreen onBack={() => {}} />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "CLIENT_UNKNOWN_ERROR");
    expect(rendered.container.innerHTML).not.toContain("secret");
    expect(rendered.container.innerHTML).not.toContain("sk-live-value");
    expect(alert.outerHTML).not.toContain("C:\\Users");
    expect(alert.textContent).toBe("요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.");
  });

  it("recovers after retrying a failed initial load", async () => {
    const providers = [makeProviderStatus({ provider: "openai" }), makeProviderStatus({ provider: "runway" })];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, { code: "SETTINGS_STORAGE_ERROR", message: "실패" }))
      .mockResolvedValueOnce(jsonResponse(200, { providers }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderSettingsScreen onBack={() => {}} />);

    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(await screen.findByText("OpenAI")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a previously successful status when a later refresh fails, and shows the error alongside it", async () => {
    const providers = [makeProviderStatus({ provider: "openai" }), makeProviderStatus({ provider: "runway" })];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { providers }))
      .mockResolvedValueOnce(jsonResponse(500, { code: "SETTINGS_STORAGE_ERROR", message: "internal detail, not shown" }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderSettingsScreen onBack={() => {}} />);

    await screen.findByText("OpenAI");
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveAttribute("data-error-code", "SETTINGS_STORAGE_ERROR");
    expect(alert.textContent).not.toContain("internal detail");
    // Both cards must still be visible even though the refresh failed.
    expect(screen.getByText("OpenAI")).toBeTruthy();
    expect(screen.getByText("Runway")).toBeTruthy();
  });

  it("does not let an OpenAI action change the Runway card's status or trigger a Runway request", async () => {
    const initial = [
      makeProviderStatus({ provider: "openai", configured: true, connected: true, maskedValue: "sk-********7890" }),
      makeProviderStatus({ provider: "runway", configured: true, connected: true, maskedValue: "rw-********7890" }),
    ];
    const disconnectedOpenAi = makeProviderStatus({
      provider: "openai",
      configured: true,
      connected: false,
      maskedValue: "sk-********7890",
    });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(200, { providers: initial }))
      .mockResolvedValueOnce(jsonResponse(200, { provider: disconnectedOpenAi }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderSettingsScreen onBack={() => {}} />);

    await screen.findByText("OpenAI");
    const disconnectButtons = screen.getAllByRole("button", { name: "연결 해제" });
    fireEvent.click(disconnectButtons[0] as HTMLElement); // OpenAI's card is rendered first

    await screen.findByText("연결 해제됨 · 키 저장됨");
    // Runway must remain connected and unaffected.
    expect(screen.getByText("rw-********7890")).toBeTruthy();
    expect(fetchMock.mock.calls.every(([url]) => String(url) !== "/settings/providers/runway/disconnect")).toBe(true);
  });

  it("does not start a card mutation while a deferred refresh GET is in flight", async () => {
    const providers = [
      makeProviderStatus({ provider: "openai", configured: true, connected: true, maskedValue: "sk-********7890" }),
      makeProviderStatus({ provider: "runway" }),
    ];
    let resolveRefresh: (response: Response) => void = () => {};
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { providers }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveRefresh = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderSettingsScreen onBack={() => {}} />);

    await screen.findByText("OpenAI");
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));
    fireEvent.click(screen.getAllByRole("button", { name: "연결 해제" })[0] as HTMLElement);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveRefresh(jsonResponse(200, { providers }));
    await waitFor(() => expect(screen.getByRole("button", { name: "새로고침" })).not.toBeDisabled());
  });

  it("does not start a refresh GET while a deferred card mutation is in flight", async () => {
    const providers = [
      makeProviderStatus({ provider: "openai", configured: true, connected: true, maskedValue: "sk-********7890" }),
      makeProviderStatus({ provider: "runway" }),
    ];
    const disconnected = { ...providers[0], connected: false };
    let resolveMutation: (response: Response) => void = () => {};
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse(200, { providers }))
      .mockReturnValueOnce(new Promise<Response>((resolve) => { resolveMutation = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProviderSettingsScreen onBack={() => {}} />);

    await screen.findByText("OpenAI");
    fireEvent.click(screen.getAllByRole("button", { name: "연결 해제" })[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "새로고침" }));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolveMutation(jsonResponse(200, { provider: disconnected }));
    await screen.findByText("연결 해제됨 · 키 저장됨");
  });

  it("calls onBack when the back button is clicked", async () => {
    const providers = [makeProviderStatus({ provider: "openai" }), makeProviderStatus({ provider: "runway" })];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { providers })));
    const onBack = vi.fn();
    render(<ProviderSettingsScreen onBack={onBack} />);

    await screen.findByText("OpenAI");
    fireEvent.click(screen.getByRole("button", { name: "목록으로" }));

    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
