import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { HttpStatus } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProviderSettingsException } from "./provider-settings.error.js";
import { ProviderSettingsRepository } from "./provider-settings.repository.js";

describe("ProviderSettingsRepository", () => {
  let root: string;

  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "provider-settings-test-")); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("preserves unrelated UTF-8 settings and comments while de-duplicating credential keys", async () => {
    const env = path.join(root, ".env");
    await fs.writeFile(env, "# local settings\nMONTHLY_BUDGET=7\nOPENAI_API_KEY=old\nOPENAI_API_KEY=older\nRUNWAY_API_SECRET=legacy\nRUNWAYML_API_SECRET=old-official\n", "utf8");
    const repository = new ProviderSettingsRepository(root);
    await repository.save("openai", "sk-test-abcdefghijklmnopqrstuvwxyz");
    await repository.save("runway", "key_abcdefghijklmnopqrstuvwxyz");
    const content = await fs.readFile(env, "utf8");
    expect(content).toContain("# local settings\nMONTHLY_BUDGET=7\n");
    expect(content.match(/OPENAI_API_KEY=/g)).toHaveLength(1);
    expect(content.match(/RUNWAYML_API_SECRET=/g)).toHaveLength(1);
    expect(content).not.toContain("RUNWAY_API_SECRET=");
    expect(await repository.read("openai")).toBe("sk-test-abcdefghijklmnopqrstuvwxyz");
    expect(await repository.read("runway")).toBe("key_abcdefghijklmnopqrstuvwxyz");
  });

  it("creates a missing dotenv through the atomic writer", async () => {
    const repository = new ProviderSettingsRepository(root);
    await repository.save("openai", "sk-test-abcdefghijklmnopqrstuvwxyz");
    expect(await fs.readFile(path.join(root, ".env"), "utf8")).toContain("OPENAI_API_KEY=");
    expect((await fs.readdir(root)).some((name) => name.endsWith(".tmp"))).toBe(false);
  });

  it("preserves a final unrelated line when the source dotenv has no trailing newline", async () => {
    const env = path.join(root, ".env");
    await fs.writeFile(env, "OPENAI_API_KEY=old\nKEEP_LAST=value", "utf8");
    await new ProviderSettingsRepository(root).save("openai", "sk-test-abcdefghijklmnopqrstuvwxyz");
    expect(await fs.readFile(env, "utf8")).toBe("OPENAI_API_KEY=sk-test-abcdefghijklmnopqrstuvwxyz\nKEEP_LAST=value\n");
  });

  it("reads a final credential line without a trailing newline", async () => {
    await fs.writeFile(path.join(root, ".env"), "RUNWAYML_API_SECRET=key_abcdefghijklmnopqrstuvwxyz", "utf8");
    expect(await new ProviderSettingsRepository(root).read("runway")).toBe("key_abcdefghijklmnopqrstuvwxyz");
  });

  it("keeps empty files and trailing-newline dotenv files usable", async () => {
    const env = path.join(root, ".env");
    const repository = new ProviderSettingsRepository(root);
    await fs.writeFile(env, "", "utf8");
    expect(await repository.read("openai")).toBeNull();
    await fs.writeFile(env, "KEEP=1\n", "utf8");
    await repository.save("runway", "key_abcdefghijklmnopqrstuvwxyz");
    expect(await fs.readFile(env, "utf8")).toBe("KEEP=1\nRUNWAYML_API_SECRET=key_abcdefghijklmnopqrstuvwxyz\n");
  });

  it("maps malformed dotenv input and storage failure without exposing paths or content", async () => {
    await fs.writeFile(path.join(root, ".env"), "NOT_A_DOTENV_LINE\n", "utf8");
    await expect(new ProviderSettingsRepository(root).read("openai")).rejects.toMatchObject({
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    });

    const original = "# valid settings\nKEEP_THIS_EXACTLY=unchanged\n";
    await fs.writeFile(path.join(root, ".env"), original, "utf8");
    const writeFailure = vi.fn(async () => { throw Object.assign(new Error("sk-secret at C:\\private"), { code: "EPERM" }); });
    const repository = new ProviderSettingsRepository(root, fs.readFile, writeFailure);
    try {
      await repository.save("openai", "sk-test-abcdefghijklmnopqrstuvwxyz");
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderSettingsException);
      const exception = error as ProviderSettingsException;
      expect((exception.getResponse() as { code: string }).code).toBe("SETTINGS_STORAGE_ERROR");
      expect(JSON.stringify(exception.getResponse())).not.toContain("sk-secret");
      expect(JSON.stringify(exception.getResponse())).not.toContain(root);
      expect(await fs.readFile(path.join(root, ".env"), "utf8")).toBe(original);
    }
  });
});
