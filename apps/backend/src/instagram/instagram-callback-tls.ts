import * as fs from "node:fs";

/**
 * The certificate that lets Meta redirect a browser straight back to this machine.
 *
 * Meta refuses to register any `http://` redirect, and the enforcement toggle that once allowed an exception is
 * locked on for every app created after 2018 (docs/06_DECISIONS.md D-020). What it does accept is
 * `https://127.0.0.1:<port>` — confirmed by registering it, not inferred. So the callback flow is reachable
 * exactly when this process is willing to serve that address over TLS, and this module is the one place that
 * decides whether it is.
 *
 * Configured, never bundled: a packaged app sets none of these variables, gets no listener, and signs in through
 * the desktop window instead. That is deliberate rather than incidental — a shipped app carrying a certificate
 * would put a trust warning in front of every user's login, which is the trade D-020 refused (D-022).
 */

/** Separate from the app's own port so the HTTP surface stays exactly as it is; only the callback gains a TLS door. */
export const DEFAULT_CALLBACK_TLS_PORT = 3443;

export const CALLBACK_TLS_CERT_ENV = "INSTAGRAM_CALLBACK_TLS_CERT";
export const CALLBACK_TLS_KEY_ENV = "INSTAGRAM_CALLBACK_TLS_KEY";
export const CALLBACK_TLS_PORT_ENV = "INSTAGRAM_CALLBACK_TLS_PORT";

export interface CallbackTls {
  port: number;
  /** PEM contents, read here rather than passed as paths so a missing file fails at startup, not at login. */
  cert: string;
  key: string;
}

/**
 * Resolves the callback listener's certificate, or `null` where there is not meant to be one.
 *
 * Reads the files rather than returning their paths on purpose. The connection status tells the screen whether a
 * browser login is available, and that answer is derived from this same call — so anything that would stop the
 * listener from coming up has to fail here, before anything can report that it did. A resolver that only
 * remembered paths would let the app claim a working browser login while the listener was refusing to start.
 *
 * Half-configured is an error rather than a silent fallback to the desktop flow. Someone who set one variable
 * meant to set both, and the desktop flow's symptom in a browser is a window that waits and then says nothing —
 * the failure most expensive to diagnose is the one this refuses to produce.
 */
export function resolveCallbackTls(
  env: NodeJS.ProcessEnv,
  readFile: (path: string) => string = (path) => fs.readFileSync(path, "utf8"),
): CallbackTls | null {
  const certPath = env[CALLBACK_TLS_CERT_ENV]?.trim();
  const keyPath = env[CALLBACK_TLS_KEY_ENV]?.trim();

  if (!certPath && !keyPath) return null;
  if (!certPath || !keyPath) {
    throw new Error(
      `${CALLBACK_TLS_CERT_ENV} and ${CALLBACK_TLS_KEY_ENV} must be set together — the Instagram callback needs both a certificate and its key.`,
    );
  }

  const port = resolvePort(env[CALLBACK_TLS_PORT_ENV]?.trim());

  let cert: string;
  let key: string;
  try {
    cert = readFile(certPath);
    key = readFile(keyPath);
  } catch (error) {
    // The path is named because it is the user's own, and the reason is Node's own — this is a startup message
    // for whoever set the variable, not something a screen will ever show.
    throw new Error(`Could not read the Instagram callback certificate: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!cert.trim() || !key.trim()) {
    throw new Error(`The Instagram callback certificate or key is empty (${certPath}, ${keyPath}).`);
  }

  return { port, cert, key };
}

function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw === "") return DEFAULT_CALLBACK_TLS_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${CALLBACK_TLS_PORT_ENV} must be a port number between 1 and 65535 (got ${JSON.stringify(raw)}).`);
  }
  return port;
}
