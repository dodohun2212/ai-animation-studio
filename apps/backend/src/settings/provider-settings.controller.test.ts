import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { HttpStatus } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { ApiError } from "@ai-animation-studio/shared";

import { ProviderSettingsController } from "./provider-settings.controller.js";
import { ProviderSettingsException } from "./provider-settings.error.js";
import { ProviderSettingsRepository } from "./provider-settings.repository.js";
import { ProviderSettingsService } from "./provider-settings.service.js";

describe("ProviderSettingsController", () => {
  let root: string;
  let controller: ProviderSettingsController;
  const secret = "sk-test-abcdefghijklmnopqrstuvwxyz";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "provider-settings-controller-test-"));
    controller = new ProviderSettingsController(new ProviderSettingsService(new ProviderSettingsRepository(root)));
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("serves all four settings operations without returning a secret", async () => {
    expect((await controller.getSettings()).providers).toHaveLength(3);
    const saved = await controller.save("openai", { value: secret });
    expect(saved.provider).toMatchObject({ configured: true, connected: true });
    expect(JSON.stringify(saved)).not.toContain(secret);
    expect((await controller.disconnect("openai", undefined)).provider.connected).toBe(false);
    expect((await controller.reconnect("openai", undefined)).provider.connected).toBe(true);
  });

  it("uses explicit safe error bodies and statuses", async () => {
    for (const [action, status, code] of [
      [controller.save("unknown", { value: secret }), HttpStatus.BAD_REQUEST, "UNKNOWN_PROVIDER"],
      [controller.save("openai", { wrong: secret }), HttpStatus.BAD_REQUEST, "INVALID_REQUEST"],
      [controller.save("openai", { value: "too-short" }), HttpStatus.BAD_REQUEST, "INVALID_CREDENTIAL"],
      [controller.reconnect("runway", undefined), HttpStatus.CONFLICT, "CREDENTIAL_NOT_CONFIGURED"],
    ] as const) {
      try { await action; throw new Error("expected error"); } catch (error) {
        expect(error).toBeInstanceOf(ProviderSettingsException);
        const exception = error as ProviderSettingsException;
        expect(exception.getStatus()).toBe(status);
        const response = exception.getResponse() as ApiError;
        expect(response.code).toBe(code);
        expect(JSON.stringify(response)).not.toContain(secret);
        expect(JSON.stringify(response)).not.toContain(root);
        expect(JSON.stringify(response)).not.toContain("stack");
      }
    }
  });

  it("does not expose dotenv contents through malformed-file API failures", async () => {
    await fs.writeFile(path.join(root, ".env"), `bad dotenv ${secret}\n`, "utf8");
    try {
      await controller.getSettings();
      throw new Error("expected error");
    } catch (error) {
      expect(error).toBeInstanceOf(ProviderSettingsException);
      const exception = error as ProviderSettingsException;
      expect(exception.getStatus()).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
      const response = exception.getResponse() as ApiError;
      expect(response.code).toBe("SETTINGS_FILE_MALFORMED");
      expect(JSON.stringify(response)).not.toContain(secret);
      expect(JSON.stringify(response)).not.toContain(root);
    }
  });
});
