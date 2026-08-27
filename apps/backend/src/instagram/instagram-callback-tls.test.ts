import { describe, expect, it, vi } from "vitest";

import {
  CALLBACK_TLS_CERT_ENV, CALLBACK_TLS_KEY_ENV, CALLBACK_TLS_PORT_ENV,
  DEFAULT_CALLBACK_TLS_PORT, resolveCallbackTls,
} from "./instagram-callback-tls.js";

const reader = (files: Record<string, string>) =>
  vi.fn((path: string) => {
    const contents = files[path];
    if (contents === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
    return contents;
  });

const PEM = { "/certs/cert.pem": "-----BEGIN CERTIFICATE-----\n", "/certs/key.pem": "-----BEGIN PRIVATE KEY-----\n" };
const CONFIGURED = { [CALLBACK_TLS_CERT_ENV]: "/certs/cert.pem", [CALLBACK_TLS_KEY_ENV]: "/certs/key.pem" };

describe("resolveCallbackTls", () => {
  it("resolves to nothing when no certificate is configured", () => {
    // The packaged app and every test process. Absence is the normal case, not a misconfiguration.
    expect(resolveCallbackTls({}, reader({}))).toBeNull();
  });

  it("reads the certificate and key, and defaults to the port kept aside for this", () => {
    const resolved = resolveCallbackTls({ ...CONFIGURED }, reader(PEM));
    expect(resolved).toEqual({
      port: DEFAULT_CALLBACK_TLS_PORT,
      cert: PEM["/certs/cert.pem"],
      key: PEM["/certs/key.pem"],
    });
  });

  it("reads the files here rather than passing paths on", () => {
    // The connection status tells the screen a browser login is available, and that answer comes from this
    // call. Anything that would stop the listener from coming up has to fail before that can be reported.
    const read = reader({});
    expect(() => resolveCallbackTls({ ...CONFIGURED }, read)).toThrow(/certificate/i);
    expect(read).toHaveBeenCalledWith("/certs/cert.pem");
  });

  it("refuses a half-configured certificate instead of falling back", () => {
    // Someone who set one meant to set both, and the fallback's symptom in a browser is a window that waits
    // and then says nothing — the most expensive failure to diagnose is the one this refuses to produce.
    expect(() => resolveCallbackTls({ [CALLBACK_TLS_CERT_ENV]: "/certs/cert.pem" }, reader(PEM))).toThrow(/must be set together/);
    expect(() => resolveCallbackTls({ [CALLBACK_TLS_KEY_ENV]: "/certs/key.pem" }, reader(PEM))).toThrow(/must be set together/);
  });

  it("refuses an empty certificate file", () => {
    const read = reader({ "/certs/cert.pem": "   ", "/certs/key.pem": PEM["/certs/key.pem"] });
    expect(() => resolveCallbackTls({ ...CONFIGURED }, read)).toThrow(/empty/);
  });

  it("takes an explicit port, and refuses one that is not a port", () => {
    expect(resolveCallbackTls({ ...CONFIGURED, [CALLBACK_TLS_PORT_ENV]: "8443" }, reader(PEM))?.port).toBe(8443);
    for (const port of ["0", "70000", "-1", "8443.5", "https"]) {
      expect(() => resolveCallbackTls({ ...CONFIGURED, [CALLBACK_TLS_PORT_ENV]: port }, reader(PEM))).toThrow(/port number/);
    }
  });

  it("never names the key's contents in an error", () => {
    // A startup failure is the easiest place to print a private key without noticing it happened.
    const read = reader({ "/certs/cert.pem": PEM["/certs/cert.pem"], "/certs/key.pem": "" });
    try {
      resolveCallbackTls({ ...CONFIGURED }, read);
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(String(error)).not.toContain("PRIVATE KEY");
    }
  });
});
