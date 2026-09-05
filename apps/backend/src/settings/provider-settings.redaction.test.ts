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

/**
 * Meta's secrets ride in query strings, not dotenv lines.
 *
 * `instagram-oauth.ts` puts `client_secret` in the URL because that is the shape Meta documents, and its own
 * comment says it "must never be logged — see ProviderSettingsLogger for the redaction this codebase already
 * applies". That redaction had no pattern for it: the comment pointed at a protection that did not cover the
 * case. A URL like that reaches a log the moment an unexpected throw carries it — which is exactly what the
 * global crash filter now writes out.
 */
describe("ProviderSettingsRedactor and Meta's query-string secrets", () => {
  const redactor = new ProviderSettingsRedactor();
  const url = "https://graph.facebook.com/v21.0/oauth/access_token?client_id=123&redirect_uri=https%3A%2F%2Flocal&client_secret=abc123secret&code=one-time-code&state=after-the-secret";

  it("redacts the app secret, the one-time code and the tokens", () => {
    const output = redactor.redact(url);
    expect(output).not.toContain("abc123secret");
    expect(output).not.toContain("one-time-code");
    expect(redactor.redact("?input_token=tok_a&access_token=123|shhh")).not.toContain("shhh");
    expect(redactor.redact("&fb_exchange_token=short_lived_value")).not.toContain("short_lived_value");
  });

  it("stops at the next parameter instead of eating the rest of the query", () => {
    // A pattern anchored on whitespace would take everything after the secret with it, which reads on screen as
    // having redacted more than it did — and hides which call the log line belonged to.
    const output = redactor.redact(url);
    // The parameter *after* the secret is the one that proves it. The two before it survive either way,
    // so asserting on those would have passed against a pattern that swallowed the whole rest of the query.
    expect(output).toContain("state=after-the-secret");
    expect(output).toContain("client_id=123");
    expect(output).toContain("[REDACTED]");
  });

  it("leaves an ordinary parameter alone", () => {
    expect(redactor.redact("?state=abc&scope=pages_show_list")).toBe("?state=abc&scope=pages_show_list");
  });
});
