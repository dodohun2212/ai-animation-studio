import * as fs from "node:fs/promises";
import * as path from "node:path";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";

/**
 * The one window a lock cannot close: Meta has accepted `media_publish`, and the record saying so has not been
 * written yet.
 *
 * Everything else about publishing twice is already answered — a recorded post refuses the second press, and
 * the cross-process lock keeps two windows from both being mid-publish (see FINAL_VIDEO_LOCK_KEY). Both of
 * those depend on the process staying alive long enough to write down what it did. If it dies in between, the
 * post is public and nothing on disk knows: the lock file goes stale in a minute, the project says
 * "never published", and the next press publishes a second copy of a video that is already up.
 *
 * That is not hypothetical here. `apps/backend`'s dev script is `nest start --watch`, so saving any backend
 * file restarts the process — the same fact D-005 records as the reason the lock is a file rather than a Set.
 *
 * So the attempt leaves a trace before the irreversible call and removes it after the record is safely written.
 * A trace with no record means exactly one thing, and it is the honest one: **nobody knows whether that publish
 * went out.** The app cannot find out — it can read the account's pages, not ask whether a Reel is one of ours
 * — so the trace is not cleared by a check. It is cleared by a person saying what they saw, the same shape and
 * for the same reason as ForgetInstagramPostRequest.acknowledged.
 *
 * ## Why a file of its own, and not a field on the project
 *
 * `parseStoredProject` refuses a project file carrying a key it does not know. A trace written into
 * project.json would therefore be readable only by builds that already know about it — and the one moment a
 * trace survives is a crash, which is also the moment somebody is most likely to reopen the app, possibly the
 * packaged build rather than this one. A project that cannot be opened at all is a far worse outcome than the
 * duplicate post this guards against. The trace is crash state, like the lock file beside it, and it lives in
 * the same place for the same reason.
 */
const ATTEMPT_FILE = ".instagram-publish-attempt";

export interface PublishAttemptTrace {
  /**
   * When the irreversible call was made, and to which account.
   *
   * Both optional because the trace being *there* is the whole finding: a file that exists but cannot be parsed
   * still means an attempt happened, and reporting "no attempt" for it would answer the one question this file
   * exists to answer with a guess, in the direction that publishes a second post.
   */
  startedAt?: string;
  igUserId?: string;
}

function attemptFile(directory: string): string {
  return path.join(directory, ATTEMPT_FILE);
}

/**
 * Writes the trace. Called immediately before `media_publish` and nowhere else — a container that was created
 * or a video that was uploaded is not a post, and treating those as unknown outcomes would refuse later
 * publishes over failures that are plainly failures.
 *
 * Deliberately not swallowed: if this write fails, the publish fails and nothing goes out. Refusing to publish
 * because the disk is unwell is the recoverable half of that choice; publishing without being able to say so
 * afterwards is the half that ends in two posts.
 */
export async function recordPublishAttempt(directory: string, trace: PublishAttemptTrace): Promise<void> {
  await fs.mkdir(directory, { recursive: true });
  await atomicWriteUtf8File(attemptFile(directory), JSON.stringify(trace, null, 2));
}

/** The trace, or nothing. Present-but-unreadable is an attempt with lost details, never "no attempt" — see PublishAttemptTrace. */
export async function readPublishAttempt(directory: string): Promise<PublishAttemptTrace | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(attemptFile(directory), "utf8");
  } catch {
    return undefined;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    const record = parsed as Record<string, unknown>;
    return {
      ...(typeof record.startedAt === "string" ? { startedAt: record.startedAt } : {}),
      ...(typeof record.igUserId === "string" ? { igUserId: record.igUserId } : {}),
    };
  } catch {
    return {};
  }
}

/**
 * Removes the trace.
 *
 * Failing to remove it is not failing to publish — the post is up and recorded, and the next press is refused
 * by the record itself, which carries a clearer sentence than this one does. So this never turns a completed
 * publish into an error.
 */
export async function clearPublishAttempt(directory: string): Promise<void> {
  await fs.rm(attemptFile(directory), { force: true }).catch(() => undefined);
}
