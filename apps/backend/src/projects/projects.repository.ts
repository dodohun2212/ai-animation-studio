import * as fsPromises from "node:fs/promises";
import * as path from "node:path";

import { atomicWriteUtf8File } from "./atomic-file.js";
import { dataInvalid, jsonMalformed, projectAlreadyExists, projectNotFound, storageError } from "./project-api.error.js";
import { resolveSafeProjectDirectory } from "./project-id.js";
import { parseStoredProject, type StoredProject } from "./project-storage.schema.js";

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : undefined;
}

type WriteProjectFile = (file: string, content: string) => Promise<void>;

/**
 * Reads and writes `<projectsRoot>/<projectId>/project.json`. Pure local
 * filesystem storage: no database, no provider, no network calls.
 */
export class LocalProjectRepository {
  constructor(
    private readonly projectsRoot: string,
    private readonly writeProjectFile: WriteProjectFile = atomicWriteUtf8File,
  ) {}

  private projectFile(projectId: string): { directory: string; file: string } {
    const directory = resolveSafeProjectDirectory(this.projectsRoot, projectId);
    return { directory, file: path.join(directory, "project.json") };
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
    return stored;
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
