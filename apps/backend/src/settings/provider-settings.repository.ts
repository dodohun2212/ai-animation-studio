import * as fs from "node:fs/promises";
import * as path from "node:path";

import type { ProviderCredentialKind } from "@ai-animation-studio/shared";

import { atomicWriteUtf8File } from "../projects/atomic-file.js";
import { settingsFileMalformed, settingsStorageError } from "./provider-settings.error.js";

const ENV_NAMES: Record<ProviderCredentialKind, readonly string[]> = {
  openai: ["OPENAI_API_KEY"],
  runway: ["RUNWAYML_API_SECRET", "RUNWAY_API_SECRET"],
};
const OFFICIAL_ENV_NAME: Record<ProviderCredentialKind, string> = {
  openai: "OPENAI_API_KEY",
  runway: "RUNWAYML_API_SECRET",
};

type WriteEnvFile = (file: string, content: string) => Promise<void>;
type ReadEnvFile = (file: string, encoding: "utf8") => Promise<string>;

function envName(line: string): string | undefined {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) return undefined;
  const equals = trimmed.indexOf("=");
  if (equals <= 0) throw settingsFileMalformed();
  const name = trimmed.slice(0, equals).trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw settingsFileMalformed();
  return name;
}

function envValue(line: string): string {
  const value = line.slice(line.indexOf("=") + 1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

/** Local UTF-8 dotenv storage only. It neither reads process.env nor calls providers. */
export class ProviderSettingsRepository {
  private readonly envFile: string;

  constructor(root: string, private readonly readFile: ReadEnvFile = fs.readFile, private readonly writeFile: WriteEnvFile = atomicWriteUtf8File) {
    this.envFile = path.join(root, ".env");
  }

  async read(provider: ProviderCredentialKind): Promise<string | null> {
    const lines = await this.readLines();
    const names = new Set(ENV_NAMES[provider]);
    let value: string | null = null;
    for (const line of lines) {
      if (names.has(envName(line) ?? "")) value = envValue(line) || null;
    }
    return value;
  }

  async save(provider: ProviderCredentialKind, value: string): Promise<void> {
    const lines = await this.readLines();
    const names = new Set(ENV_NAMES[provider]);
    const output: string[] = [];
    let inserted = false;
    for (const line of lines) {
      if (names.has(envName(line) ?? "")) {
        if (!inserted) {
          output.push(`${OFFICIAL_ENV_NAME[provider]}=${value}`);
          inserted = true;
        }
      } else {
        output.push(line);
      }
    }
    if (!inserted) {
      if (provider === "openai") output.unshift(`${OFFICIAL_ENV_NAME[provider]}=${value}`);
      else output.push(`${OFFICIAL_ENV_NAME[provider]}=${value}`);
    }
    try {
      await this.writeFile(this.envFile, `${output.join("\n")}\n`);
    } catch {
      throw settingsStorageError();
    }
  }

  /**
   * Any other named setting in the same file — today the two monthly budget limits.
   *
   * The same `.env` this app already owns and already writes. A second store for one number each would be a
   * second thing to find, back up and get wrong, and these are environment variables in every other respect:
   * a person who sets OPENAI_MONTHLY_BUDGET_USD in their shell means exactly what the settings screen means.
   *
   * Provider credentials keep their own read/save because they have two accepted spellings each and a
   * preferred one to write back; a plain setting has one name and no history.
   */
  async readNamed(name: string): Promise<string | null> {
    let value: string | null = null;
    for (const line of await this.readLines()) {
      if (envName(line) === name) value = envValue(line) || null;
    }
    return value;
  }

  /** Replaces the value in place when the name is already there, so the file keeps the order a person left it in. */
  async saveNamed(name: string, value: string): Promise<void> {
    const output: string[] = [];
    let written = false;
    for (const line of await this.readLines()) {
      if (envName(line) === name) {
        if (!written) { output.push(`${name}=${value}`); written = true; }
      } else {
        output.push(line);
      }
    }
    if (!written) output.push(`${name}=${value}`);
    try {
      await this.writeFile(this.envFile, `${output.join("\n")}\n`);
    } catch {
      throw settingsStorageError();
    }
  }

  private async readLines(): Promise<string[]> {
    try {
      const lines = (await this.readFile(this.envFile, "utf8")).split(/\r?\n/);
      if (lines.at(-1) === "") lines.pop();
      return lines;
    } catch (error) {
      if (typeof error === "object" && error !== null && "code" in error && (error as { code?: string }).code === "ENOENT") return [];
      throw settingsStorageError();
    }
  }
}
