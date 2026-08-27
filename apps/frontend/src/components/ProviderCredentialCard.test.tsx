import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jsonResponse, makeProviderStatus } from "../api/testUtils.js";
import { ProviderCredentialCard } from "./ProviderCredentialCard.js";

const SECRET_CREDENTIAL = "sk-test-credential-1234567890";
const noop = (): void => {};

describe("ProviderCredentialCard", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses a password input and never pre-fills it from the server status", () => {
    vi.stubGlobal("fetch", vi.fn());
    const status = makeProviderStatus({ provider: "openai", configured: true, connected: true, maskedValue: "sk-********7890" });
    render(<ProviderCredentialCard label="OpenAI" status={status} onStatusChange={noop} />);

    const input = screen.getByLabelText("OpenAI credential") as HTMLInputElement;
    expect(input.type).toBe("password");
    expect(input.value).toBe("");
  });

  it("shows 'no saved key' with no maskedValue and a disabled reconnect button when not configured", () => {
    vi.stubGlobal("fetch", vi.fn());
    const status = makeProviderStatus({ provider: "openai", configured: false, connected: false, maskedValue: null });
    render(<ProviderCredentialCard label="OpenAI" status={status} onStatusChange={noop} />);

    expect(screen.getByText("저장된 키 없음")).toBeTruthy();
    expect(screen.queryByText(/sk-/)).toBeNull();
    expect(screen.getByRole("button", { name: "다시 사용" })).toBeDisabled();
  });

  it("shows 'connected' with the masked value and an enabled disconnect button when configured and connected", () => {
    vi.stubGlobal("fetch", vi.fn());
    const status = makeProviderStatus({ provider: "openai", configured: true, connected: true, maskedValue: "sk-********7890" });
    render(<ProviderCredentialCard label="OpenAI" status={status} onStatusChange={noop} />);

    expect(screen.getByText("키 저장됨 · 이 앱에서 사용")).toBeTruthy();
    expect(screen.getByText("sk-********7890")).toBeTruthy();
    expect(screen.getByRole("button", { name: "이 앱에서 사용 안 함" })).not.toBeDisabled();
    expect(screen.getByRole("button", { name: "다시 사용" })).toBeDisabled();
  });

  it("shows 'disconnected · key saved' with the masked value and an enabled reconnect button when configured but not connected", () => {
    vi.stubGlobal("fetch", vi.fn());
    const status = makeProviderStatus({ provider: "openai", configured: true, connected: false, maskedValue: "sk-********7890" });
    render(<ProviderCredentialCard label="OpenAI" status={status} onStatusChange={noop} />);

    expect(screen.getByText("키 저장됨 · 사용 안 함")).toBeTruthy();
    expect(screen.getByText("sk-********7890")).toBeTruthy();
    expect(screen.getByRole("button", { name: "이 앱에서 사용 안 함" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "다시 사용" })).not.toBeDisabled();
  });

  // Regression: this line used to read "연결됨". A user who had just revoked their Runway key on Runway's own
  // dashboard still saw it, and reasonably read it as "this key works". The app has never once asked a provider
  // whether a stored key is valid, so it must not claim a connection it cannot verify (`.claude-bridge` Round 184).
  it("never claims a connection it has not verified, and says what the status actually means", () => {
    render(
      <ProviderCredentialCard
        label="Runway"
        status={{ provider: "runway", configured: true, connected: true, maskedValue: "key********6cbe" }}
        onStatusChange={() => {}}
      />,
    );

    expect(screen.queryByText("연결됨")).toBeNull();
    expect(screen.getByText(/제공사에서 그 키를 지웠거나 만료됐는지는/)).toBeTruthy();
  });

  it("does not raise the provider question at all when no key is stored", () => {
    render(
      <ProviderCredentialCard
        label="Runway"
        status={{ provider: "runway", configured: false, connected: false, maskedValue: null }}
        onStatusChange={() => {}}
      />,
    );

    expect(screen.queryByText(/제공사에서 그 키를 지웠거나/)).toBeNull();
  });

  it("blocks empty, short, and whitespace-containing values before calling fetch", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const status = makeProviderStatus({ provider: "openai" });
    render(<ProviderCredentialCard label="OpenAI" status={status} onStatusChange={noop} />);

    const input = screen.getByLabelText("OpenAI credential");
    const saveButton = screen.getByRole("button", { name: "저장" });

    fireEvent.click(saveButton);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "too-short" } });
    fireEvent.click(saveButton);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: "has a space in it 1234" } });
    fireEvent.click(saveButton);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("saves a credential, clears the input, and updates status via onStatusChange", async () => {
    const nextStatus = makeProviderStatus({ provider: "openai", configured: true, connected: true, maskedValue: "sk-********7890" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { provider: nextStatus }));
    vi.stubGlobal("fetch", fetchMock);
    const onStatusChange = vi.fn();
    const status = makeProviderStatus({ provider: "openai" });
    render(<ProviderCredentialCard label="OpenAI" status={status} onStatusChange={onStatusChange} />);

    const input = screen.getByLabelText("OpenAI credential") as HTMLInputElement;
    fireEvent.change(input, { target: { value: SECRET_CREDENTIAL } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(nextStatus));
    expect(input.value).toBe("");
    // The raw credential must never remain visible anywhere in the DOM after submit.
    expect(document.body.textContent).not.toContain(SECRET_CREDENTIAL);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).not.toContain(SECRET_CREDENTIAL);
  });

  it("keeps the entered value after a save failure and shows the provider-scoped error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(400, { code: "INVALID_CREDENTIAL", message: "credential이 유효하지 않습니다." })),
    );
    const onStatusChange = vi.fn();
    const status = makeProviderStatus({ provider: "openai" });
    render(<ProviderCredentialCard label="OpenAI" status={status} onStatusChange={onStatusChange} />);

    const input = screen.getByLabelText("OpenAI credential") as HTMLInputElement;
    fireEvent.change(input, { target: { value: SECRET_CREDENTIAL } });
    fireEvent.click(screen.getByRole("button", { name: "저장" }));

    const alert = await screen.findByText("credential이 유효하지 않습니다.");
    expect(alert.closest('[role="alert"]')).toHaveAttribute("data-error-code", "INVALID_CREDENTIAL");
    expect(input.value).toBe(SECRET_CREDENTIAL);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("disables the save button while submitting and lets only one rapid duplicate submit call fetch", async () => {
    let resolveFetch: (value: Response) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(
      new Promise<Response>((resolve) => {
        resolveFetch = resolve;
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const status = makeProviderStatus({ provider: "openai" });
    render(<ProviderCredentialCard label="OpenAI" status={status} onStatusChange={noop} />);

    fireEvent.change(screen.getByLabelText("OpenAI credential"), { target: { value: SECRET_CREDENTIAL } });
    const saveButton = screen.getByRole("button", { name: "저장" });

    fireEvent.click(saveButton);
    fireEvent.click(saveButton);
    fireEvent.click(saveButton);

    expect(saveButton).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(
      jsonResponse(200, {
        provider: makeProviderStatus({ provider: "openai", configured: true, connected: true, maskedValue: "sk-********7890" }),
      }),
    );
    await waitFor(() => expect(saveButton).not.toBeDisabled());
  });

  it("shows 'disconnected · key saved' after a successful disconnect and explains the key is not deleted", async () => {
    const nextStatus = makeProviderStatus({ provider: "openai", configured: true, connected: false, maskedValue: "sk-********7890" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { provider: nextStatus }));
    vi.stubGlobal("fetch", fetchMock);
    const onStatusChange = vi.fn();
    const status = makeProviderStatus({ provider: "openai", configured: true, connected: true, maskedValue: "sk-********7890" });
    render(<ProviderCredentialCard label="OpenAI" status={status} onStatusChange={onStatusChange} />);

    fireEvent.click(screen.getByRole("button", { name: "이 앱에서 사용 안 함" }));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(nextStatus));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/settings/providers/openai/disconnect");
    expect(init.body).toBeUndefined();
    expect(screen.getByText(/삭제되지 않습니다/)).toBeTruthy();
  });

  it("reconnects successfully without sending any credential", async () => {
    const nextStatus = makeProviderStatus({ provider: "openai", configured: true, connected: true, maskedValue: "sk-********7890" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { provider: nextStatus }));
    vi.stubGlobal("fetch", fetchMock);
    const onStatusChange = vi.fn();
    const status = makeProviderStatus({ provider: "openai", configured: true, connected: false, maskedValue: "sk-********7890" });
    render(<ProviderCredentialCard label="OpenAI" status={status} onStatusChange={onStatusChange} />);

    fireEvent.click(screen.getByRole("button", { name: "다시 사용" }));

    await waitFor(() => expect(onStatusChange).toHaveBeenCalledWith(nextStatus));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/settings/providers/openai/reconnect");
    expect(init.body).toBeUndefined();
  });

  it("shows CREDENTIAL_NOT_CONFIGURED safely when reconnect fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(409, { code: "CREDENTIAL_NOT_CONFIGURED", message: "저장된 credential이 없습니다." })),
    );
    const status = makeProviderStatus({ provider: "openai", configured: true, connected: false, maskedValue: "sk-********7890" });
    render(<ProviderCredentialCard label="OpenAI" status={status} onStatusChange={noop} />);

    fireEvent.click(screen.getByRole("button", { name: "다시 사용" }));

    const alert = await screen.findByText("저장된 credential이 없습니다.");
    expect(alert.closest('[role="alert"]')).toHaveAttribute("data-error-code", "CREDENTIAL_NOT_CONFIGURED");
  });

  it("does not call fetch or change state when acquireMutation refuses the action", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const onStatusChange = vi.fn();
    const status = makeProviderStatus({ provider: "openai", configured: true, connected: true, maskedValue: "sk-********7890" });
    render(
      <ProviderCredentialCard
        label="OpenAI"
        status={status}
        onStatusChange={onStatusChange}
        acquireMutation={() => false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "이 앱에서 사용 안 함" }));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
  });
});
