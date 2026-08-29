import * as fs from "node:fs/promises";
import * as path from "node:path";

import { Injectable } from "@nestjs/common";
import type { GetInstagramTargetsResponse, InstagramTargetDiagnostics, SetInstagramTargetResponse } from "@ai-animation-studio/shared";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { countInstagramPublishCandidates, listInstagramPublishTargets, readGrantedInstagramPermissions, type InstagramPublishTargetRecord } from "./instagram-graph-adapter.js";
import { INSTAGRAM_PUBLISH_SCOPES } from "./instagram-oauth.js";
import { InstagramConnectionStore } from "./instagram-connection.store.js";
import { InstagramAdapterError, type RetryOptions } from "./instagram-request.js";
import { instagramNotConnected, instagramProviderError, instagramStorageError, instagramTargetNotFound, invalidInstagramRequest } from "./instagram-api.error.js";

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Which Instagram account this computer publishes to. Stored beside the budget ledgers in learning_data rather
 * than with the provider credentials: it is a destination, not a secret, and it is never masked — hiding it
 * would stop the user confirming where a post is about to go (docs/06_DECISIONS.md D-014).
 */
@Injectable()
export class InstagramTargetsService {
  constructor(
    private readonly learningDataRoot: string,
    private readonly connection: InstagramConnectionStore,
    private readonly requestOptions: RetryOptions = {},
  ) {}

  private get filePath(): string {
    return path.join(this.learningDataRoot, "instagram_target.json");
  }

  private async readStoredSelection(): Promise<string | null> {
    let text: string;
    try { text = await fs.readFile(this.filePath, "utf8"); } catch { return null; }
    try {
      const parsed: unknown = JSON.parse(text);
      return isObject(parsed) && typeof parsed.ig_user_id === "string" && parsed.ig_user_id.trim() ? parsed.ig_user_id.trim() : null;
    } catch {
      // A corrupt selection file means "we do not know where to publish", which is exactly the state that must
      // make the screen ask again — never a reason to fail the whole listing.
      return null;
    }
  }

  private async writeStoredSelection(igUserId: string): Promise<void> {
    try {
      await fs.mkdir(this.learningDataRoot, { recursive: true });
      await atomicWriteUtf8File(this.filePath, JSON.stringify({ ig_user_id: igUserId }, null, 2));
    } catch {
      throw instagramStorageError();
    }
  }

  /** Fetches the accounts this token can publish to right now. An expired or missing login is reported as not-connected rather than as an empty list — see instagramNotConnected. */
  private async liveTargets(): Promise<InstagramPublishTargetRecord[]> {
    const token = await this.connection.token();
    if (!token) throw instagramNotConnected();
    try {
      return await listInstagramPublishTargets(token.accessToken, this.requestOptions);
    } catch (error) {
      if (error instanceof InstagramAdapterError) {
        if (error.category === "authentication") throw instagramNotConnected();
        throw instagramProviderError(error.category, error.message);
      }
      throw error;
    }
  }

  /**
   * `selectedIgUserId` is echoed back only when the stored choice is genuinely present in this fetch. A page can
   * be disconnected, deleted, or have its permission revoked between sessions, and publishing to a remembered id
   * without checking would be the app acting on something it never verified (docs/06_DECISIONS.md D-006). The
   * check lives here rather than in the screen so no caller can forget it.
   */
  async list(): Promise<GetInstagramTargetsResponse> {
    const targets = await this.liveTargets();
    const stored = await this.readStoredSelection();
    const selected = stored !== null && targets.some((target) => target.igUserId === stored) ? stored : undefined;
    return {
      targets,
      ...(selected !== undefined ? { selectedIgUserId: selected } : {}),
      // Only when there is nothing to choose from: a working account should not pay for two extra provider
      // calls on every load just so the empty case can explain itself.
      ...(targets.length === 0 ? { diagnostics: await this.diagnose() } : {}),
    };
  }

  /**
   * Which of the three reasons the list is empty.
   *
   * Fails soft in both halves. A diagnosis is a help, not a precondition — if the counts cannot be read the
   * screen still says the list is empty, and `permissionsChecked: false` keeps it from presenting a guess
   * about permissions as a fact.
   */
  private async diagnose(): Promise<InstagramTargetDiagnostics> {
    const token = await this.connection.token();
    if (!token) return { pageCount: 0, pagesWithInstagramAccount: 0, missingPermissions: [], grantedPermissions: [], permissionsChecked: false };
    const counts = await countInstagramPublishCandidates(token.accessToken, this.requestOptions)
      .catch(() => ({ pageCount: 0, pagesWithInstagramAccount: 0 }));
    const granted = await readGrantedInstagramPermissions(token.accessToken, this.requestOptions).catch(() => undefined);
    if (!granted) return { ...counts, missingPermissions: [], grantedPermissions: [], permissionsChecked: false };
    return {
      ...counts,
      missingPermissions: INSTAGRAM_PUBLISH_SCOPES.filter((scope) => !granted.includes(scope)),
      grantedPermissions: granted,
      permissionsChecked: true,
    };
  }

  async select(request: unknown): Promise<SetInstagramTargetResponse> {
    if (!isObject(request) || Object.keys(request).length !== 1 || typeof request.igUserId !== "string" || !request.igUserId.trim()) {
      throw invalidInstagramRequest("Request body must contain only igUserId.");
    }
    const igUserId = request.igUserId.trim();
    const targets = await this.liveTargets();
    // Validated against a live fetch, not against whatever the client believed was available: storing an id that
    // is not really publishable would surface later as an unexplained publish failure, or worse, silently.
    if (!targets.some((target) => target.igUserId === igUserId)) throw instagramTargetNotFound();
    await this.writeStoredSelection(igUserId);
    return { targets, selectedIgUserId: igUserId };
  }
}
