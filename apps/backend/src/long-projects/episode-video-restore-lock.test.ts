import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { EpisodeVideosService } from "./episode-videos.service.js";
import { FINAL_VIDEO_LOCK_KEY, withProjectLock } from "../videos/project-lock.js";

/**
 * An Episode's restore waits for whatever else is writing that Episode's final video.
 *
 * 🔴 It did not. `restoreVersion` took `videos_restore_${number}` while the Episode's merge and its Instagram
 * publish both take FINAL_VIDEO_LOCK_KEY on the same directory — and locks here are per-key, so a key of one's
 * own excludes nobody. The merge's comment states the rule it was breaking: "the post must never be built from
 * a cut this render is replacing". A restore replaces exactly that cut.
 *
 * The short project's video library had the identical defect, found first (2026-09-09); the doc comment above
 * `restoreVersion` says this method mirrors that one, and it did — including the bug.
 *
 * 🟠 Held on FINAL_VIDEO_LOCK_KEY rather than on whatever key restore uses, so handing restore a private key
 * back turns this red. An assertion written against restore's own key would pass either way, which is the
 * whole failure being guarded.
 *
 * The state is written by hand rather than driven through the pipeline: what is under test is the acquire, and
 * everything `restoreVersion` touches before it is the outline entry, the Episode record and one archived file.
 */
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))); });

async function episodeWithAnArchivedFinal() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "episode-restore-lock-")); roots.push(root);
  const projectsRoot = path.join(root, "projects");
  const story = path.join(projectsRoot, "long", "long_story");
  const episode = path.join(story, "Episode01");
  await fs.mkdir(path.join(episode, "videos", "final", "history"), { recursive: true });
  await fs.writeFile(path.join(story, "episode_outlines.json"), JSON.stringify([{ episode_number: 1, title: "one" }]), "utf8");
  await fs.writeFile(path.join(episode, "project.json"), JSON.stringify({
    number: 1, state: "completed", approved: true, script: { scenes: [] }, script_revision: 1, updated_at: "2026-09-09T00:00:00.000Z",
  }), "utf8");
  await fs.writeFile(path.join(episode, "videos", "final", "instagram_reel.mp4"), Buffer.from("current-final"));
  await fs.writeFile(path.join(episode, "videos", "final", "history", "instagram_reel_v001.mp4"), Buffer.from("older-final"));
  return { projectsRoot, episode };
}

describe("restoring a past Episode video", () => {
  it("refuses while something else holds that Episode's final-video lock, instead of writing underneath it", async () => {
    const { projectsRoot, episode } = await episodeWithAnArchivedFinal();
    const videos = new EpisodeVideosService(projectsRoot, undefined, undefined, 20);

    const refusal = await withProjectLock(episode, FINAL_VIDEO_LOCK_KEY, async () =>
      videos.restoreVersion("long", 1, "final", "v001", { approved: true }).catch((error: unknown) => error));

    expect(refusal).toMatchObject({ response: { code: "LONG_EPISODE_VIDEO_RESTORE_IN_PROGRESS" } });
    // And nothing was written: the cut the holder is working with is still the current one.
    expect(await fs.readFile(path.join(episode, "videos", "final", "instagram_reel.mp4"), "utf8")).toBe("current-final");
  });

  it("restores when nothing holds the lock, so the refusal above is about the lock and not the fixture", async () => {
    const { projectsRoot, episode } = await episodeWithAnArchivedFinal();
    const videos = new EpisodeVideosService(projectsRoot, undefined, undefined, 20);

    await videos.restoreVersion("long", 1, "final", "v001", { approved: true });

    expect(await fs.readFile(path.join(episode, "videos", "final", "instagram_reel.mp4"), "utf8")).toBe("older-final");
  });
});
