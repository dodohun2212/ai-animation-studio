import * as fs from "node:fs/promises";
import * as path from "node:path";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { instagramStorageError } from "./instagram-api.error.js";

export interface InstagramAppCredentials { appId: string; appSecret: string }
export interface InstagramToken { accessToken: string; expiresAt: string | null }
export interface InstagramConnection extends InstagramAppCredentials, Partial<InstagramToken> {}

interface StoredConnection {
  app_id: string;
  app_secret: string;
  access_token?: string;
  /** ISO timestamp, or absent when Meta stated no expiry. Never computed from a remembered duration — see saveToken. */
  token_expires_at?: string | null;
}

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The whole Instagram connection in one file: the Meta app credentials the user registered, and the long-lived
 * token derived from them.
 *
 * Kept together rather than split across the provider-credential store, because these four values are one
 * connection — they are written by the same login and stop being true at the same moment. Storing the token
 * apart from its expiry, or apart from the app that issued it, creates exactly the drift this codebase keeps
 * being bitten by: one place still asserting something another place stopped matching.
 *
 * Lives under PROVIDER_SETTINGS_ROOT, not learning_data, because it holds a secret and that root is the one
 * this app refuses to guess (it throws rather than defaulting to the working directory).
 */
export class InstagramConnectionStore {
  constructor(private readonly settingsRoot: string) {}

  private get filePath(): string {
    return path.join(this.settingsRoot, "instagram_connection.json");
  }

  private async read(): Promise<StoredConnection | null> {
    let text: string;
    try { text = await fs.readFile(this.filePath, "utf8"); } catch { return null; }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!isObject(parsed) || typeof parsed.app_id !== "string" || typeof parsed.app_secret !== "string") return null;
      if (!parsed.app_id.trim() || !parsed.app_secret.trim()) return null;
      return {
        app_id: parsed.app_id,
        app_secret: parsed.app_secret,
        ...(typeof parsed.access_token === "string" && parsed.access_token ? { access_token: parsed.access_token } : {}),
        ...(typeof parsed.token_expires_at === "string" ? { token_expires_at: parsed.token_expires_at } : {}),
      };
    } catch {
      // A corrupt connection file reads as "not connected", which sends the user through the login they would
      // have to do anyway — never as a hard failure that leaves no way forward.
      return null;
    }
  }

  private async write(connection: StoredConnection): Promise<void> {
    try {
      await fs.mkdir(this.settingsRoot, { recursive: true });
      await atomicWriteUtf8File(this.filePath, JSON.stringify(connection, null, 2));
    } catch {
      throw instagramStorageError();
    }
  }

  async appCredentials(): Promise<InstagramAppCredentials | null> {
    const stored = await this.read();
    return stored ? { appId: stored.app_id, appSecret: stored.app_secret } : null;
  }

  async token(): Promise<InstagramToken | null> {
    const stored = await this.read();
    if (!stored?.access_token) return null;
    return { accessToken: stored.access_token, expiresAt: stored.token_expires_at ?? null };
  }

  /**
   * Replacing the app credentials drops any stored token. A token issued to one Meta app means nothing to
   * another, so keeping it would leave a value that looks like a working login and is not — the app would then
   * report itself connected while every publish failed (D-006).
   */
  async saveAppCredentials(credentials: InstagramAppCredentials): Promise<void> {
    const stored = await this.read();
    const unchanged = stored?.app_id === credentials.appId && stored?.app_secret === credentials.appSecret;
    await this.write({
      app_id: credentials.appId,
      app_secret: credentials.appSecret,
      ...(unchanged && stored?.access_token ? { access_token: stored.access_token } : {}),
      ...(unchanged && stored?.token_expires_at !== undefined ? { token_expires_at: stored.token_expires_at } : {}),
    });
  }

  /** `expiresAt` is an absolute instant the caller derived once, at the moment the token was issued — storing a duration instead would silently mean something different every time it is read. */
  async saveToken(token: InstagramToken): Promise<void> {
    const stored = await this.read();
    if (!stored) throw instagramStorageError();
    await this.write({
      app_id: stored.app_id,
      app_secret: stored.app_secret,
      access_token: token.accessToken,
      token_expires_at: token.expiresAt,
    });
  }

  /** Forgets the token but keeps the app registration, so signing in again does not require re-entering the app id and secret. */
  async clearToken(): Promise<void> {
    const stored = await this.read();
    if (!stored) return;
    await this.write({ app_id: stored.app_id, app_secret: stored.app_secret });
  }
}
