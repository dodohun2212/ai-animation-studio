import * as crypto from "node:crypto";

import { Injectable } from "@nestjs/common";
import type {
  CompleteInstagramLoginResponse, InstagramConnectionStatus,
  SetInstagramAppResponse, StartInstagramLoginResponse,
} from "@ai-animation-studio/shared";

import { InstagramConnectionStore } from "./instagram-connection.store.js";
import { InstagramAdapterError, type RetryOptions } from "./instagram-request.js";
import {
  DESKTOP_REDIRECT_URI, exchangeCodeForToken, exchangeForLongLivedToken, extractOAuthResult,
  instagramLoginDialogUrl, readOAuthCallback, type OAuthRedirectResult,
} from "./instagram-oauth.js";
import { instagramNotConnected, instagramProviderError, invalidInstagramRequest } from "./instagram-api.error.js";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** A login attempt is answered once, soon, or not at all — a window left open for hours is abandoned, not pending. */
const STATE_LIFETIME_MS = 10 * 60 * 1000;

/**
 * Signing this computer in to Instagram. Owns the one-time `state` that ties a returned code to a login this
 * app actually started, and turns the code into the long-lived token the connection store keeps.
 *
 * The app secret never leaves this process: the desktop shell only opens a URL and reports back the URL the
 * window landed on. Parsing and verification happen here, where they are tested.
 */
@Injectable()
export class InstagramLoginService {
  /**
   * In memory on purpose: an unfinished login must not survive a restart — the user simply presses the button
   * again. (In development that is not rare, because `nest start --watch` restarts on every edit; the callback
   * route logs the reason, since the two failures are indistinguishable from outside.)
   *
   * The redirect URI is remembered here rather than held on the instance because Meta requires the identical
   * string at the dialog and at the exchange. Tying it to the attempt makes that structural: there is no way to
   * complete a login against a different address from the one it was started with.
   */
  private pending: { state: string; issuedAt: number; redirectUri: string } | null = null;

  constructor(
    private readonly connection: InstagramConnectionStore,
    /** This backend's own callback address — see instagramCallbackUrl. Unreachable today (D-020) and used only if a login is ever started against it. */
    private readonly callbackUri: string,
    private readonly requestOptions: RetryOptions = {},
    private readonly now: () => number = Date.now,
  ) {}

  private async statusOf(): Promise<InstagramConnectionStatus> {
    const [app, token] = await Promise.all([this.connection.appCredentials(), this.connection.token()]);
    return {
      appConfigured: app !== null,
      tokenStored: token !== null,
      ...(token?.expiresAt ? { tokenExpiresAt: token.expiresAt } : {}),
    };
  }

  status(): Promise<InstagramConnectionStatus> {
    return this.statusOf();
  }

  /**
   * Meta app id and secret, entered by the user from their own app dashboard. Saving a different app drops any
   * stored token — see InstagramConnectionStore.saveAppCredentials for why keeping it would be worse than
   * losing it.
   */
  async saveApp(request: unknown): Promise<SetInstagramAppResponse> {
    if (!isObject(request) || Object.keys(request).length !== 2
      || typeof request.appId !== "string" || !request.appId.trim()
      || typeof request.appSecret !== "string" || !request.appSecret.trim()) {
      throw invalidInstagramRequest("Request body must contain only appId and appSecret.");
    }
    await this.connection.saveAppCredentials({ appId: request.appId.trim(), appSecret: request.appSecret.trim() });
    return this.statusOf();
  }

  /**
   * Issues the login URL and remembers the state it embedded. Starting again replaces any earlier attempt —
   * only the most recent window can complete.
   *
   * `flow` picks which redirect Meta is asked to use, and the two are not interchangeable. "desktop" sends the
   * window to Meta's own page and the shell reads the code off it; "callback" sends the browser to this backend
   * and needs no window watched — but no `http://` address can be registered with Meta at all (D-020), so it is
   * unreachable until this app has a public HTTPS domain. The screen only ever asks for "desktop".
   */
  async start(flow: "desktop" | "callback" = "desktop"): Promise<StartInstagramLoginResponse> {
    const app = await this.connection.appCredentials();
    if (!app) throw invalidInstagramRequest("Enter the Meta app ID and secret before signing in.");
    const state = crypto.randomBytes(16).toString("hex");
    const redirectUri = flow === "desktop" ? DESKTOP_REDIRECT_URI : this.callbackUri;
    this.pending = { state, issuedAt: this.now(), redirectUri };
    return {
      url: instagramLoginDialogUrl(app.appId, state, redirectUri),
      ...(flow === "desktop" ? { redirectPrefix: DESKTOP_REDIRECT_URI } : {}),
    };
  }

  /**
   * Completes a desktop login from the URL the window landed on, unparsed.
   *
   * The shell hands the whole URL over rather than picking it apart, so code extraction and the state check stay
   * in this one tested place. A URL that is not the redirect target is refused rather than treated as a failed
   * login: the shell should not have called at all, and calling it a denial would spend the issued state.
   */
  async completeFromRedirect(request: unknown): Promise<CompleteInstagramLoginResponse> {
    if (!isObject(request) || Object.keys(request).length !== 1
      || typeof request.redirectedUrl !== "string" || !request.redirectedUrl.trim()) {
      throw invalidInstagramRequest("Request body must contain only redirectedUrl.");
    }
    const result = extractOAuthResult(request.redirectedUrl);
    if (result.kind === "pending") throw invalidInstagramRequest("That is not the address a completed sign-in lands on.");
    return this.finish(result);
  }

  /**
   * Completes the login from the query Meta put on the callback. The state must match the one issued and be
   * consumed exactly once — a code that arrives without it is not proof of anything this app asked for, so it is
   * refused rather than exchanged.
   */
  complete(params: Record<string, string | undefined>): Promise<CompleteInstagramLoginResponse> {
    return this.finish(readOAuthCallback(params));
  }

  /**
   * The half both flows share, and deliberately the only place a token is ever written: whichever way the code
   * arrived, the state check and the exchange happen here once. Splitting them would leave two paths to a stored
   * token, and only one of them would stay checked.
   */
  private async finish(result: OAuthRedirectResult): Promise<CompleteInstagramLoginResponse> {
    const app = await this.connection.appCredentials();
    if (!app) throw invalidInstagramRequest("Enter the Meta app ID and secret before signing in.");

    const pending = this.pending;
    // Cleared before anything can go wrong, so one issued state can never be spent twice.
    this.pending = null;
    if (!pending || this.now() - pending.issuedAt > STATE_LIFETIME_MS) {
      throw invalidInstagramRequest("This sign-in attempt is no longer valid. Start it again.");
    }

    if (result.kind !== "code") throw invalidInstagramRequest("Sign-in did not complete.");
    if (result.state !== pending.state) throw invalidInstagramRequest("Sign-in could not be verified. Start it again.");

    try {
      // The redirect this attempt was started with, not whatever the service was constructed with — Meta rejects
      // an exchange whose redirect_uri differs by even a character from the one the dialog was given.
      const short = await exchangeCodeForToken(app.appId, app.appSecret, result.code, pending.redirectUri, this.requestOptions);
      const long = await exchangeForLongLivedToken(app.appId, app.appSecret, short.accessToken, this.requestOptions);
      // Turned into an absolute instant here, once, at the moment Meta stated the lifetime — storing the
      // duration would quietly mean something different every time it was read.
      const expiresAt = long.expiresInSeconds === null ? null : new Date(this.now() + long.expiresInSeconds * 1000).toISOString();
      await this.connection.saveToken({ accessToken: long.accessToken, expiresAt });
    } catch (error) {
      if (error instanceof InstagramAdapterError) throw instagramProviderError(error.category, error.message);
      throw error;
    }
    return this.statusOf();
  }

  /** Forgets the token but keeps the app registration, so signing back in does not mean re-entering the app id and secret. */
  async signOut(): Promise<InstagramConnectionStatus> {
    const app = await this.connection.appCredentials();
    if (!app) throw instagramNotConnected();
    this.pending = null;
    await this.connection.clearToken();
    return this.statusOf();
  }
}
