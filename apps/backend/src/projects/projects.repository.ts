import * as fsPromises from "node:fs/promises";
import { reRootedPath } from "./re-rooted-path.js";
import * as path from "node:path";

import { atomicWriteUtf8File } from "./atomic-file.js";
import { archiveProjectDirectory, deleteArchivedProjectDirectory, listArchivedProjectDirectories, restoreProjectDirectory } from "./project-archive.js";
import { dataInvalid, jsonMalformed, projectAlreadyExists, projectNotFound, storageError } from "./project-api.error.js";
import { resolveSafeProjectDirectory } from "./project-id.js";
import { parseStoredProject, type StoredProject } from "./project-storage.schema.js";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

type WriteProjectFile = (file: string, content: string) => Promise<void>;
type ArchiveDirectory = (projectsRoot: string, projectId: string) => Promise<void>;

/**
 * Reads and writes `<projectsRoot>/<projectId>/project.json`. Pure local
 * filesystem storage: no database, no provider, no network calls.
 */
export class LocalProjectRepository {
  constructor(
    private readonly projectsRoot: string,
    private readonly writeProjectFile: WriteProjectFile = atomicWriteUtf8File,
    private readonly moveDirectory: ArchiveDirectory = archiveProjectDirectory,
    private readonly restoreDirectory: ArchiveDirectory = restoreProjectDirectory,
    private readonly removeArchivedDirectory: ArchiveDirectory = deleteArchivedProjectDirectory,
  ) {}

  async archive(projectId: string): Promise<void> {
    await this.moveDirectory(this.projectsRoot, projectId);
  }

  async restore(projectId: string): Promise<void> {
    await this.restoreDirectory(this.projectsRoot, projectId);
  }

  async deleteArchived(projectId: string): Promise<void> {
    await this.removeArchivedDirectory(this.projectsRoot, projectId);
  }

  private projectFile(projectId: string): { directory: string; file: string } {
    const directory = resolveSafeProjectDirectory(this.projectsRoot, projectId);
    return { directory, file: path.join(directory, "project.json") };
  }

  /**
   * The directory every project lives under.
   *
   * Exposed so a service holding this repository can build the things that live beside a project — its Asset
   * Mappings, most of all — without also being handed the root separately. A service that has this repository
   * demonstrably knows where the projects are; making it take the same path twice is how one of the two ends up
   * missing, which is exactly how three callers came to compute staleness without their mappings.
   */
  get root(): string {
    return this.projectsRoot;
  }

  /** Resolved absolute storage directory for one project, e.g. for confirming a stored path stays within it. */
  projectDirectory(projectId: string): string {
    return this.projectFile(projectId).directory;
  }

  async create(stored: StoredProject): Promise<void> {
    const { directory, file } = this.projectFile(stored.project_id);

    try {
      await fsPromises.mkdir(this.projectsRoot, { recursive: true });
    } catch {
      throw storageError(`Failed to prepare the projects directory for "${stored.project_id}".`);
    }

    // A plain (non-recursive) mkdir on the per-project directory is the
    // atomic ID reservation: the OS either creates it or fails with EEXIST,
    // so two concurrent creates for the same ID can never both succeed the
    // way a separate existsSync-then-mkdir check could.
    try {
      await fsPromises.mkdir(directory);
    } catch (error) {
      if (errorCode(error) === "EEXIST") {
        throw projectAlreadyExists(stored.project_id);
      }
      throw storageError(`Failed to reserve a directory for project "${stored.project_id}".`);
    }

    try {
      await this.writeProjectFile(file, JSON.stringify(stored, null, 2));
    } catch (error) {
      // Only this request could have created `directory` (mkdir above was
      // the atomic reservation), so it is safe to remove it again here.
      // rmdir is non-recursive: it silently no-ops on ENOENT and refuses to
      // remove a non-empty directory, so data written by anything else is
      // never touched.
      await fsPromises.rmdir(directory).catch(() => undefined);
      throw storageError(`Failed to save project "${stored.project_id}".`);
    }
  }

  async findById(projectId: string): Promise<StoredProject> {
    const { file } = this.projectFile(projectId);
    return this.readStoredProject(file, projectId);
  }

  /** Same as {@link findById} but reads from `<projectsRoot>/.archive/<projectId>` instead of the active location. */
  async findArchivedById(projectId: string): Promise<StoredProject> {
    const archiveRoot = path.resolve(this.projectsRoot, ".archive");
    const directory = resolveSafeProjectDirectory(archiveRoot, projectId);
    return this.readStoredProject(path.join(directory, "project.json"), projectId);
  }

  private async readStoredProject(file: string, projectId: string): Promise<StoredProject> {
    let raw: string;
    try {
      raw = await fsPromises.readFile(file, "utf8");
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        throw projectNotFound(projectId);
      }
      throw storageError(`Failed to read project "${projectId}".`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw jsonMalformed(projectId);
    }

    const stored = parseStoredProject(parsed);
    if (stored.project_id !== projectId) {
      throw dataInvalid("Stored project ID does not match its directory.");
    }
    return this.underThisRoot(stored);
  }

  /**
   * Every path this project recorded, read as a location under the root it is being read from.
   *
   * These are stored absolute, and the learning-data root moves — the desktop shell keeps it in `apps/backend`
   * during development and under `userData` once packaged (docs/06_DECISIONS.md D-038). Done here, at the one
   * place a project is read, rather than in each of the many callers that use these paths, because the ones that
   * matter fail *quietly*:
   *
   * - `generated_images` is what "this scene is already made" is decided from: image generation reuses a scene
   *   only when the project's own record already names the file on disk. A stale path does not read as an error,
   *   it reads as "not made yet", and six images are **bought again**. It is also the single line the photo
   *   card's "no paid calls" rests on.
   * - `generated_video_paths` and a record's `output_path` are what the merge is handed. A stale path is a merge
   *   that cannot find clips that were already paid for.
   *
   * (The provider is deliberately not named here: projects.no-provider-calls.test.ts holds this file to code and
   * comments that stay free of provider names, and it caught the first draft of this comment.)
   *
   * Repaired on the way out too: the next `save()` writes the relocated paths back, so the file heals itself
   * once rather than being re-derived on every read forever.
   */
  private underThisRoot(stored: StoredProject): StoredProject {
    const relocate = (value: string) => reRootedPath(value, path.dirname(this.projectsRoot), [path.basename(this.projectsRoot)]);
    const records = stored.video_generation_records.map((record) => {
      if (typeof record !== "object" || record === null || Array.isArray(record)) return record;
      const output = (record as { output_path?: unknown }).output_path;
      return typeof output === "string" && output ? { ...record, output_path: relocate(output) } : record;
    });
    return {
      ...stored,
      generated_images: stored.generated_images.map((value) => (value ? relocate(value) : value)),
      generated_video_paths: stored.generated_video_paths.map((value) => (value ? relocate(value) : value)),
      generated_narrations: stored.generated_narrations.map((value) => (value ? relocate(value) : value)),
      final_video_path: stored.final_video_path ? relocate(stored.final_video_path) : stored.final_video_path,
      video_generation_records: records,
    };
  }

  /** Lists every readable archived project alongside its approximate archived-at timestamp. Unreadable entries are silently skipped, mirroring {@link list}. */
  async listArchived(): Promise<Array<{ project: StoredProject; archivedAt: string }>> {
    const entries = await listArchivedProjectDirectories(this.projectsRoot);
    const results: Array<{ project: StoredProject; archivedAt: string }> = [];
    for (const entry of entries) {
      try {
        results.push({ project: await this.findArchivedById(entry.projectId), archivedAt: entry.archivedAt });
      } catch {
        continue;
      }
    }
    return results;
  }

  async save(stored: StoredProject): Promise<void> {
    const { file } = this.projectFile(stored.project_id);
    try {
      await this.writeProjectFile(file, JSON.stringify(stored, null, 2));
    } catch {
      throw storageError(`Failed to save project "${stored.project_id}".`);
    }
  }

  /**
   * Returns every readable, valid short project. Matches
   * MemoryManager.list_projects(): entries that fail to load (corrupt JSON,
   * unsafe directory name, unknown/invalid fields) are silently skipped
   * rather than failing the whole listing.
   */
  async list(): Promise<StoredProject[]> {
    let entries: string[];
    try {
      const dirents = await fsPromises.readdir(this.projectsRoot, { withFileTypes: true });
      entries = dirents.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    } catch (error) {
      if (errorCode(error) === "ENOENT") {
        return [];
      }
      throw storageError("Failed to list the projects directory.");
    }

    const results: StoredProject[] = [];
    for (const name of entries) {
      try {
        results.push(await this.findById(name));
      } catch {
        continue;
      }
    }
    return results;
  }
}
