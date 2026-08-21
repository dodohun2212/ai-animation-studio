import { describe, expect, it } from "vitest";

import { validateCredentialInput } from "./credential.js";

describe("validateCredentialInput", () => {
  it("rejects an empty value", () => {
    expect(validateCredentialInput("")).toHaveProperty("error");
    expect(validateCredentialInput("   ")).toHaveProperty("error");
  });

  it("rejects a value shorter than 20 characters after trimming", () => {
    expect(validateCredentialInput("short-key")).toHaveProperty("error");
  });

  it("rejects a value containing internal whitespace", () => {
    expect(validateCredentialInput("sk-this has a space in it")).toHaveProperty("error");
  });

  it("accepts a trimmed value at least 20 characters with no whitespace", () => {
    const result = validateCredentialInput("  sk-test-credential-1234567890  ");
    expect(result).toEqual({ value: "sk-test-credential-1234567890" });
  });
});
