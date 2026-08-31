import { Injectable } from "@nestjs/common";
import * as path from "node:path";
import type { BackfillGeneratedImageAssetsResponse } from "@ai-animation-studio/shared";
import { LocalAssetsRepository } from "../assets/assets.repository.js";
import { GeneratedImageLibraryService } from "./generated-image-library.service.js";

/**
 * Puts already-generated pictures into the Asset Library for projects and Episodes that will never do it
 * themselves.
 *
 * Indexing happens when images are generated, and is re-seeded when a scene is approved or regenerated. Those
 * are the only three moments — and a finished project does none of them ever again. Anything made before
 * indexing existed therefore keeps its pictures on disk and stays out of the Library permanently, which is what
 * a real Episode turned out to be (12/Episode01: six images on disk, no Folder, no children). The repair that
 * already existed was reachable only through an action that Episode had left behind.
 *
 * Asking the person to open the right screen would have "fixed" it too, and that is the shape this deliberately
 * avoids: a defect whose remedy is pressing the right things in the right order is not remedied.
 *
 * What exists is decided by the same walker the "generated images" listing uses, rather than a second opinion
 * about which Episodes are real. A source that already has a Folder is left alone, exactly as the legacy
 * reference migration leaves an already-migrated item alone — this is safe to run twice.
 */
@Injectable()
export class GeneratedImageBackfillService {
  constructor(
    private readonly library: GeneratedImageLibraryService,
    private readonly assets: LocalAssetsRepository,
    private readonly projectsRoot: string,
  ) {}

  async backfillAll(): Promise<BackfillGeneratedImageAssetsResponse> {
    const listing = await this.library.list();
    const sources = new Map<string, { directory: string; topic: string; scenes: number }>();
    for (const row of listing.projects) {
      const existing = sources.get(row.projectId);
      sources.set(row.projectId, {
        directory: path.join(this.projectsRoot, row.projectId, "images"),
        topic: row.projectTitle,
        scenes: Math.max(existing?.scenes ?? 0, row.sceneNumber),
      });
    }
    for (const row of listing.episodes) {
      // The same identity the rest of the app uses for an Episode's assets (EpisodeMappingOwner.id): naming a
      // Folder by the project alone would let two Episodes share one, and approving scene 1 of the second would
      // find the first one's picture.
      const id = `${row.projectId}/Episode${String(row.episodeNumber).padStart(2, "0")}`;
      const existing = sources.get(id);
      sources.set(id, {
        directory: path.join(this.projectsRoot, row.projectId, "long_story", `Episode${String(row.episodeNumber).padStart(2, "0")}`, "images"),
        topic: row.episodeTitle,
        scenes: Math.max(existing?.scenes ?? 0, row.sceneNumber),
      });
    }

    let registered = 0;
    let skipped = 0;
    let failed = 0;
    for (const [sourceProjectId, source] of sources) {
      if (await this.assets.hasGeneratedProjectFolder(sourceProjectId)) { skipped += 1; continue; }
      try {
        // The descriptions a generation would have written are gone; the topic stands in for every scene, which
        // is what indexGeneratedProjectImages already falls back to for an empty description.
        await this.assets.indexGeneratedProjectImages(
          { sourceProjectId, imagesDirectory: source.directory, kind: sourceProjectId.includes("/") ? "long episode" : "short project" },
          source.topic,
          Array.from({ length: source.scenes }, () => ""),
        );
        registered += 1;
      } catch { failed += 1; }
    }
    return { scanned: sources.size, registered, skipped, failed };
  }
}
