import {
  GRAPH_API_VERSION, GRAPH_BASE_URL,
  InstagramAdapterError, isObject, requestWithRetry, type RetryOptions,
} from "./instagram-request.js";

/**
 * Facebook Login for Business token acquisition, verified against Meta's own documentation
 * (developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow and
 * .../access-tokens/get-long-lived). Pure functions only: this module opens no window, stores no token, and
 * owns no expiry policy — the desktop shell owns showing the login window, the backend service owns storage.
 *
 * Why an in-app login flow rather than asking the user to paste a token (docs/06_DECISIONS.md D-007): a
 * long-lived token lasts ~60 days and Meta documents no way to refresh one before it expires — its stated
 * remedy is "the person will have to go through the login flow again to get a new token." With a paste-based
 * setup that remedy is a developer-tool procedure the user must rediscover twice a year; with this flow it is
 * the same button they already used once.
 */

/**
 * Meta's documented value for a login flow hosted inside a desktop app's webview: "If you are using this in a
 * webview within a desktop app, this must be set to https://www.facebook.com/connect/login_success.html".
 * Using it means this app needs no localhost redirect registration, no HTTPS-vs-HTTP exception, and no callback
 * route on the local backend — Facebook redirects the webview to its own page and we read the code off the URL.
 */
export const DESKTOP_REDIRECT_URI = "https://www.facebook.com/connect/login_success.html";

/**
 * The three permissions Meta documents as required to publish through the Content Publishing API, plus
 * pages_show_list so the app can find which Page (and therefore which Instagram professional account) this user
 * actually has — without it the user would have to look up and hand-copy their Instagram Business Account ID,
 * exactly the developer-tool step this login flow exists to remove.
 *
 * Deliberately NOT requested: ads_management / ads_read. Meta lists those only for users whose Page role comes
 * via Business Manager, and asking for ads permissions this app never uses would be over-asking for access to
 * someone's ad account.
 */
export const INSTAGRAM_PUBLISH_SCOPES = ["instagram_basic", "instagram_content_publish", "pages_read_engagement", "pages_show_list"] as const;

/**
 * The URL the desktop shell loads in its login window. `state` is generated and remembered by the caller and
 * must be compared against the value that comes back (see extractOAuthResult) — cheap, and the only thing
 * standing between this flow and accepting a code that did not originate from this app's own request.
 */
export function instagramLoginDialogUrl(appId: string, state: string): string {
  if (!appId.trim()) throw new InstagramAdapterError("invalid_request", "Meta 앱 ID가 필요합니다.");
  if (!state.trim()) throw new InstagramAdapterError("invalid_request", "OAuth state 값이 필요합니다.");
  const query = new URLSearchParams({
    client_id: appId.trim(),
    redirect_uri: DESKTOP_REDIRECT_URI,
    state: state.trim(),
    response_type: "code",
    scope: INSTAGRAM_PUBLISH_SCOPES.join(","),
  });
  return `https://www.facebook.com/${GRAPH_API_VERSION}/dialog/oauth?${query.toString()}`;
}

export type OAuthRedirectResult =
  | { kind: "pending" }
  | { kind: "code"; code: string; state: string }
  | { kind: "denied"; detail?: string };

/**
 * Reads one navigation URL from the login window. Returns "pending" for every URL that is not the redirect
 * target, so the desktop shell can call this on every navigation event without deciding anything itself.
 *
 * Never throws on a malformed URL — a login window navigates through URLs this app does not control, and one
 * that fails to parse is simply not the redirect.
 */
export function extractOAuthResult(url: string): OAuthRedirectResult {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return { kind: "pending" }; }
  if (`${parsed.origin}${parsed.pathname}` !== DESKTOP_REDIRECT_URI) return { kind: "pending" };
  const code = parsed.searchParams.get("code");
  const state = parsed.searchParams.get("state");
  if (code && state) return { kind: "code", code, state };
  const error = parsed.searchParams.get("error_description") ?? parsed.searchParams.get("error");
  // Reached the redirect but carries no usable code — a denial, or a response missing `state` (which this app
  // refuses rather than trusting, since state is what proves the code answers this app's own request).
  return { kind: "denied", ...(error ? { detail: error } : {}) };
}

interface TokenResponse { accessToken: string; expiresInSeconds: number | null }

function readTokenResponse(body: unknown): TokenResponse {
  const accessToken = isObject(body) && typeof body.access_token === "string" ? body.access_token.trim() : "";
  if (!accessToken) throw new InstagramAdapterError("unknown", undefined, "Meta 응답에 access_token이 없습니다.");
  const expiresIn = isObject(body) && typeof body.expires_in === "number" && Number.isFinite(body.expires_in) ? body.expires_in : null;
  return { accessToken, expiresInSeconds: expiresIn };
}

/**
 * Exchanges the one-time `code` from the login window for a short-lived user access token. `maxRetries: 0`: a
 * code is single-use, so a retry after an ambiguous failure would send an already-consumed code and fail in a
 * way that looks like a rejected login rather than a lost response.
 *
 * `client_secret` travels in the query string because that is the shape Meta documents for this endpoint. It is
 * HTTPS-only and must never be logged — see ProviderSettingsLogger for the redaction this codebase already
 * applies to stored credentials.
 */
export async function exchangeCodeForToken(appId: string, appSecret: string, code: string, options: RetryOptions = {}): Promise<TokenResponse> {
  if (!code.trim()) throw new InstagramAdapterError("invalid_request", "로그인 코드가 비어 있습니다.");
  const query = new URLSearchParams({ client_id: appId, redirect_uri: DESKTOP_REDIRECT_URI, client_secret: appSecret, code: code.trim() });
  const response = await requestWithRetry(
    `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/oauth/access_token?${query.toString()}`,
    { method: "GET" },
    { ...options, maxRetries: 0 },
  );
  return readTokenResponse(await response.json().catch(() => null));
}

/**
 * Exchanges a short-lived token for the ~60-day long-lived one this app actually stores. Safe to retry (unlike
 * the code exchange, the input is not single-use), so the caller's retry policy applies unchanged.
 */
export async function exchangeForLongLivedToken(appId: string, appSecret: string, shortLivedToken: string, options: RetryOptions = {}): Promise<TokenResponse> {
  if (!shortLivedToken.trim()) throw new InstagramAdapterError("invalid_request", "교환할 토큰이 비어 있습니다.");
  const query = new URLSearchParams({
    grant_type: "fb_exchange_token", client_id: appId, client_secret: appSecret, fb_exchange_token: shortLivedToken.trim(),
  });
  const response = await requestWithRetry(
    `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/oauth/access_token?${query.toString()}`,
    { method: "GET" },
    options,
  );
  return readTokenResponse(await response.json().catch(() => null));
}

export interface TokenInspection {
  isValid: boolean;
  /** ISO timestamp, or null when Meta reported no expiry (documented as a unixtime; 0/absent is reported as "none stated" rather than asserting a meaning the docs do not give). */
  expiresAt: string | null;
  scopes: string[];
}

/**
 * Asks Meta whether a stored token is actually still valid, and when it expires. Read-only and free — this is
 * the call behind the "확인은 무료입니다" check button and behind showing a real expiry date, so the app stops
 * having to claim a credential works without ever having asked (docs/06_DECISIONS.md D-006).
 *
 * The app access token form `APP_ID|APP_SECRET` is Meta's documented way to authenticate this inspection
 * without a separate token fetch.
 */
export async function inspectInstagramToken(appId: string, appSecret: string, token: string, options: RetryOptions = {}): Promise<TokenInspection> {
  if (!token.trim()) throw new InstagramAdapterError("invalid_request", "확인할 토큰이 비어 있습니다.");
  const query = new URLSearchParams({ input_token: token.trim(), access_token: `${appId}|${appSecret}` });
  const response = await requestWithRetry(
    `${GRAPH_BASE_URL}/${GRAPH_API_VERSION}/debug_token?${query.toString()}`,
    { method: "GET" },
    options,
  );
  const body: unknown = await response.json().catch(() => null);
  const data = isObject(body) && isObject(body.data) ? body.data : undefined;
  if (!data || typeof data.is_valid !== "boolean") throw new InstagramAdapterError("unknown", undefined, "Meta 토큰 확인 응답을 해석할 수 없습니다.");
  const expiresAtUnix = typeof data.expires_at === "number" && Number.isFinite(data.expires_at) && data.expires_at > 0 ? data.expires_at : null;
  const scopes = Array.isArray(data.scopes) ? data.scopes.filter((item): item is string => typeof item === "string") : [];
  return {
    isValid: data.is_valid,
    expiresAt: expiresAtUnix === null ? null : new Date(expiresAtUnix * 1000).toISOString(),
    scopes,
  };
}
