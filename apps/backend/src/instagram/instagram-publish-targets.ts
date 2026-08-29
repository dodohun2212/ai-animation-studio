import { listInstagramPublishTargets, readGrantedPageIds, readPublishTargetById, type InstagramPublishTargetRecord } from "./instagram-graph-adapter.js";
import { InstagramConnectionStore } from "./instagram-connection.store.js";
import type { RetryOptions } from "./instagram-request.js";

/**
 * The pages this token was granted, asked for one by one.
 *
 * Only reached when `/me/accounts` came back empty, and that combination is real rather than defensive: a token
 * can hold `pages_show_list` for a specific page, read that page and its linked Instagram account perfectly,
 * and still be handed an empty list. Someone in that state has done everything right and sees "no account to
 * publish to" — the app was asking the one question its account could not answer.
 *
 * Fails soft. This is a second chance at an answer, so a failure here leaves the empty list the primary path
 * already produced, and the caller's own diagnosis explains that instead.
 */
async function grantedTargets(connection: InstagramConnectionStore, accessToken: string, options: RetryOptions): Promise<InstagramPublishTargetRecord[]> {
  const app = await connection.appCredentials().catch(() => null);
  if (!app) return [];
  try {
    const pageIds = await readGrantedPageIds(accessToken, `${app.appId}|${app.appSecret}`, options);
    const targets = await Promise.all(pageIds.map((pageId) => readPublishTargetById(accessToken, pageId, options)));
    return targets.filter((target): target is InstagramPublishTargetRecord => target !== undefined);
  } catch {
    return [];
  }
}

/**
 * Every answer to "which accounts can this login publish to", from one place.
 *
 * There are two callers — the screen that lists accounts to choose from, and the publish step that checks the
 * chosen one is still allowed (D-006) — and they must never disagree. They did: the granular-permission
 * fallback was added to the listing alone, so a token whose `/me/accounts` is empty saw its account offered on
 * screen and then refused at publish time with INSTAGRAM_TARGET_NOT_FOUND. Both sides read the same list and
 * both looked correct on their own; only asking the same question twice showed it.
 *
 * A second fallback beside the publish check would have fixed that instance and left the shape intact. This is
 * the shape: one function, so a third caller cannot get a different answer either.
 */
export async function resolveInstagramPublishTargets(
  connection: InstagramConnectionStore,
  accessToken: string,
  options: RetryOptions = {},
): Promise<InstagramPublishTargetRecord[]> {
  const listed = await listInstagramPublishTargets(accessToken, options);
  return listed.length > 0 ? listed : await grantedTargets(connection, accessToken, options);
}
