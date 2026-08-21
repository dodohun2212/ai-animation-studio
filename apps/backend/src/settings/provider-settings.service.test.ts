import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { HttpStatus } from "@nestjs/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ProviderSettingsException } from "./provider-settings.error.js";
import { ProviderSettingsRepository } from "./provider-settings.repository.js";
import { maskCredential, ProviderSettingsService } from "./provider-settings.service.js";

describe("ProviderSettingsService", () => {
  let root: string;
  let service: ProviderSettingsService;
  const openai = "sk-test-abcdefghijklmnopqrstuvwxyz";
  const runway = "key_abcdefghijklmnopqrstuvwxyz";

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "provider-settings-service-test-"));
    service = new ProviderSettingsService(new ProviderSettingsRepository(root));
  });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  it("validates, masks, disconnects and reconnects providers independently", async () => {
    await service.save("openai", { value: ` ${openai} ` });
    await service.save("runway", { value: runway });
    const saved = await service.getSettings();
    expect(saved.providers).toEqual([
      { provider: "openai", configured: true, connected: true, maskedValue: "sk-********wxyz" },
      { provider: "runway", configured: true, connected: true, maskedValue: "key********wxyz" },
    ]);
    expect(JSON.stringify(saved)).not.toContain(openai);
    expect(JSON.stringify(saved)).not.toContain(runway);

    expect((await service.disconnect("openai", undefined)).provider).toMatchObject({ configured: true, connected: false });
    expect((await service.getSettings()).providers[1]).toMatchObject({ provider: "runway", connected: true });
    expect((await service.reconnect("openai", {})).provider).toMatchObject({ connected: true });
  });

  it("shows exactly three leading and four trailing characters without exposing the middle", () => {
    const raw = "sk-test-abcdefghijklmnopqrstuvwxyz";
    const masked = maskCredential(raw);
    expect(masked).toBe("sk-********wxyz");
    expect(masked.slice(0, 3)).toBe("sk-");
    expect(masked.slice(-4)).toBe("wxyz");
    expect(masked).not.toContain(raw);
    expect(masked).not.toContain("test-abcdefghijklmnop");
  });

  it("reloads saved values as connected in a new Backend instance", async () => {
    await service.save("openai", { value: openai });
    await service.save("runway", { value: runway });
    await service.disconnect("openai", {});
    const restarted = new ProviderSettingsService(new ProviderSettingsRepository(root));
    const response = await restarted.getSettings();
    expect(response.providers).toEqual([
      expect.objectContaining({ provider: "openai", configured: true, connected: true }),
      expect.objectContaining({ provider: "runway", configured: true, connected: true }),
    ]);
  });

  it("rejects invalid providers, fields, credentials and reconnect-without-save", async () => {
    const cases: Array<Promise<unknown>> = [
      service.save("other", { value: openai }),
      service.save("openai", { value: openai, extra: true }),
      service.save("openai", { value: 12 }),
      service.save("openai", { value: "short key" }),
      service.disconnect("openai", { extra: true }),
      service.reconnect("openai", undefined),
    ];
    for (const action of cases) {
      await expect(action).rejects.toBeInstanceOf(ProviderSettingsException);
    }
    await expect(service.reconnect("openai", undefined)).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
  });
});
