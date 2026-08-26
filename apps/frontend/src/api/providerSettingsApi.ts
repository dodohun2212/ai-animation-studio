import {
  API_ROUTES,
  type GetProviderSettingsResponse,
  type ProviderCredentialKind,
  type ProviderCredentialStatus,
  type SaveProviderCredentialResponse,
  type SetProviderConnectionResponse,
} from "@ai-animation-studio/shared";

export class ProviderSettingsApiError extends Error {
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "ProviderSettingsApiError";
    this.code = code;
    this.details = details;
  }
}

const NETWORK_ERROR = { code: "CLIENT_NETWORK_ERROR", message: "서버에 연결하지 못했습니다. 네트워크 상태를 확인해주세요." };
const MALFORMED_RESPONSE_ERROR = { code: "CLIENT_MALFORMED_RESPONSE", message: "서버 응답을 해석하지 못했습니다." };
/** Same distinction as projectsApi: a 5xx with no backend error shape means the server never answered. */
const SERVER_UNAVAILABLE_ERROR = {
  code: "CLIENT_SERVER_UNAVAILABLE",
  message: "서버가 응답하지 않습니다. 서버가 재시작 중이거나 꺼져 있을 수 있습니다. 잠시 후 다시 시도해 주세요.",
};
const UNKNOWN_ERROR = { code: "CLIENT_UNKNOWN_ERROR", message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요." };

const PROVIDER_KINDS: readonly ProviderCredentialKind[] = ["openai", "runway"];

// Fixed, safe Korean text for every backend error code. The server's own
// `message` (and `details`) is never displayed — only this trusted mapping is.
const KNOWN_ERROR_MESSAGES: Record<string, string> = {
  INVALID_REQUEST: "요청이 올바르지 않습니다.",
  UNKNOWN_PROVIDER: "알 수 없는 제공자입니다.",
  INVALID_CREDENTIAL: "credential이 유효하지 않습니다.",
  CREDENTIAL_NOT_CONFIGURED: "저장된 credential이 없습니다.",
  SETTINGS_FILE_MALFORMED: "설정을 불러오지 못했습니다.",
  SETTINGS_STORAGE_ERROR: "설정을 저장하지 못했습니다.",
};

const CLIENT_ERROR_MESSAGES: Record<string, string> = {
  [NETWORK_ERROR.code]: NETWORK_ERROR.message,
  [MALFORMED_RESPONSE_ERROR.code]: MALFORMED_RESPONSE_ERROR.message,
  [SERVER_UNAVAILABLE_ERROR.code]: SERVER_UNAVAILABLE_ERROR.message,
  [UNKNOWN_ERROR.code]: UNKNOWN_ERROR.message,
};

/** Never surfaces raw body content, stack traces, or local paths — only a fixed, safe message keyed by code. */
export function toDisplayError(error: unknown): { code: string; message: string } {
  if (error instanceof ProviderSettingsApiError) {
    const message = KNOWN_ERROR_MESSAGES[error.code] ?? CLIENT_ERROR_MESSAGES[error.code];
    return message ? { code: error.code, message } : UNKNOWN_ERROR;
  }
  return UNKNOWN_ERROR;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isProviderCredentialKind(value: unknown): value is ProviderCredentialKind {
  return PROVIDER_KINDS.includes(value as ProviderCredentialKind);
}

// Matches exactly the backend's mask shape: 3 visible chars + 8 literal
// asterisks + 4 visible chars (see maskCredential on the backend). Anything
// else — including a raw credential passed through as maskedValue — is
// rejected instead of rendered.
const MASKED_VALUE_PATTERN = /^\S{3}\*{8}\S{4}$/;

/** Rejects internally contradictory statuses instead of trusting them. */
function isProviderCredentialStatus(value: unknown): value is ProviderCredentialStatus {
  if (!isRecord(value)) return false;
  if (!isProviderCredentialKind(value.provider)) return false;
  if (typeof value.configured !== "boolean") return false;
  if (typeof value.connected !== "boolean") return false;
  if (value.connected && !value.configured) return false;
  if (!value.configured) {
    return value.maskedValue === null;
  }
  return typeof value.maskedValue === "string" && MASKED_VALUE_PATTERN.test(value.maskedValue);
}

function isProviderCredentialStatusFor(
  expectedProvider: ProviderCredentialKind,
): (value: unknown) => value is ProviderCredentialStatus {
  return (value: unknown): value is ProviderCredentialStatus =>
    isProviderCredentialStatus(value) && value.provider === expectedProvider;
}

function isGetProviderSettingsResponse(value: unknown): value is GetProviderSettingsResponse {
  if (!isRecord(value) || !Array.isArray(value.providers)) return false;
  if (!value.providers.every(isProviderCredentialStatus)) return false;
  const seenProviders = new Set((value.providers as ProviderCredentialStatus[]).map((item) => item.provider));
  if (seenProviders.size !== value.providers.length) return false;
  return PROVIDER_KINDS.every((kind) => seenProviders.has(kind));
}

// The response's provider must equal the one requested — otherwise a mismatched
// (e.g. Runway) status could get written into the requested (e.g. OpenAI) card.
function isSaveProviderCredentialResponseFor(
  expectedProvider: ProviderCredentialKind,
): (value: unknown) => value is SaveProviderCredentialResponse {
  return (value: unknown): value is SaveProviderCredentialResponse =>
    isRecord(value) && isProviderCredentialStatusFor(expectedProvider)(value.provider);
}

function isSetProviderConnectionResponseFor(
  expectedProvider: ProviderCredentialKind,
): (value: unknown) => value is SetProviderConnectionResponse {
  return (value: unknown): value is SetProviderConnectionResponse =>
    isRecord(value) && isProviderCredentialStatusFor(expectedProvider)(value.provider);
}

function toApiErrorShape(body: unknown): { code: string; message: string; details?: Record<string, unknown> } {
  if (isRecord(body) && isNonEmptyString(body.code) && isNonEmptyString(body.message)) {
    const details = isRecord(body.details) ? body.details : undefined;
    return details ? { code: body.code, message: body.message, details } : { code: body.code, message: body.message };
  }
  return MALFORMED_RESPONSE_ERROR;
}

async function readJsonBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

async function requestJson<T>(
  input: string,
  init: RequestInit | undefined,
  isValidResponse: (body: unknown) => body is T,
): Promise<T> {
  let response: Response;
  try {
    response = init ? await fetch(input, init) : await fetch(input);
  } catch {
    throw new ProviderSettingsApiError(NETWORK_ERROR.code, NETWORK_ERROR.message);
  }

  const body = await readJsonBody(response);

  if (!response.ok) {
    const apiError = toApiErrorShape(body);
    if (apiError.code === MALFORMED_RESPONSE_ERROR.code && response.status >= 500) {
      throw new ProviderSettingsApiError(SERVER_UNAVAILABLE_ERROR.code, SERVER_UNAVAILABLE_ERROR.message);
    }
    throw new ProviderSettingsApiError(apiError.code, apiError.message, apiError.details);
  }

  if (!isValidResponse(body)) {
    // No diagnostic logging here, deliberately, and the word is spelled around on purpose: a guard test
    // greps this file for that logging API by name, because the payloads it handles carry credential state
    // and a log line is somewhere that state can leak — a browser extension, a screen share, a pasted bug
    // report. projectsApi logs its equivalent case; this is the one module where that is not worth it.
    throw new ProviderSettingsApiError(MALFORMED_RESPONSE_ERROR.code, MALFORMED_RESPONSE_ERROR.message);
  }

  return body;
}

export async function getProviderSettings(): Promise<GetProviderSettingsResponse> {
  return requestJson(API_ROUTES.providerSettings, undefined, isGetProviderSettingsResponse);
}

export async function saveProviderCredential(
  provider: ProviderCredentialKind,
  value: string,
): Promise<SaveProviderCredentialResponse> {
  return requestJson(
    API_ROUTES.providerCredential(provider),
    { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value }) },
    isSaveProviderCredentialResponseFor(provider),
  );
}

export async function disconnectProvider(provider: ProviderCredentialKind): Promise<SetProviderConnectionResponse> {
  return requestJson(
    API_ROUTES.providerDisconnect(provider),
    { method: "POST" },
    isSetProviderConnectionResponseFor(provider),
  );
}

export async function reconnectProvider(provider: ProviderCredentialKind): Promise<SetProviderConnectionResponse> {
  return requestJson(
    API_ROUTES.providerReconnect(provider),
    { method: "POST" },
    isSetProviderConnectionResponseFor(provider),
  );
}
