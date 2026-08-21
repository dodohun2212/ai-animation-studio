import { describe, expect, it } from "vitest";

import { ProviderSettingsLogger, ProviderSettingsRedactor } from "./provider-settings.redaction.js";

describe("ProviderSettingsRedactor", () => {
  it("redacts dotenv forms, sk patterns, and remembered runtime credentials", () => {
    const actual = "runtime-secret-abcdefghijklmnopqrstuvwxyz";
    const redactor = new ProviderSettingsRedactor();
    redactor.remember(actual);
    const output = redactor.redact(`OPENAI_API_KEY=${actual} RUNWAYML_API_SECRET=${actual} RUNWAY_API_SECRET=${actual} sk-abcdefghijklmnop ${actual}`);
    expect(output).toContain("[REDACTED]");
    expect(output).not.toContain(actual);
    expect(output).not.toContain("sk-abcdefghijklmnop");
  });

  it("redacts every message, context and details field before passing them to Nest logging", () => {
    const calls: string[] = [];
    const logger = new ProviderSettingsLogger({
      log: (message) => calls.push(String(message)),
      error: (message) => calls.push(String(message)),
    });
    const secret = "runtime-secret-abcdefghijklmnopqrstuvwxyz";
    logger.rememberCredential(secret);
    logger.log(`saved ${secret}`, { value: secret }, { key: `OPENAI_API_KEY=${secret}` });
    logger.error(`failed ${secret}`, { secret }, { runway: `RUNWAY_API_SECRET=${secret}` });
    expect(calls).toHaveLength(2);
    expect(calls.join(" ")).not.toContain(secret);
    expect(calls.join(" ")).toContain("[REDACTED]");
  });
});
