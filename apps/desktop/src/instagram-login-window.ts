export interface LoginWindowLike {
  loadURL(url: string): void;
  onNavigate(listener: (url: string) => void): void;
  onClosed(listener: () => void): void;
  close(): void;
}

export interface OpenLoginWindowDeps {
  createWindow: () => LoginWindowLike;
}

export type LoginWindowResult =
  | { kind: "redirected"; url: string }
  | { kind: "cancelled" };

/**
 * Only a Facebook login page may be opened here. The URL arrives over IPC from the renderer, and an IPC handler
 * that opens whatever it is handed is a hole worth closing even when the only caller today is our own screen:
 * this window shows a real login form, so anything that can steer it somewhere else is a phishing surface.
 */
export function isAllowedLoginUrl(candidate: string): boolean {
  let parsed: URL;
  try { parsed = new URL(candidate); } catch { return false; }
  return parsed.protocol === "https:" && (parsed.hostname === "www.facebook.com" || parsed.hostname === "facebook.com");
}

/**
 * Opens the Meta login page and reports the URL the window finally landed on, so the backend can read the code
 * and verify the state it issued. This module deliberately parses nothing: the whole redirect URL goes back
 * untouched, keeping code extraction and state checking in one tested place on the server.
 *
 * Closing the window is a real answer, not an error — someone changing their mind is the ordinary case, and it
 * has to be distinguishable from a login that failed.
 */
export function openInstagramLoginWindow(url: string, redirectPrefix: string, deps: OpenLoginWindowDeps): Promise<LoginWindowResult> {
  return new Promise((resolve) => {
    const window = deps.createWindow();
    let settled = false;

    // The window closing after a match would otherwise resolve a second time as "cancelled", turning a
    // successful login into an abandoned one.
    const settle = (result: LoginWindowResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    window.onNavigate((candidate) => {
      if (!candidate.startsWith(redirectPrefix)) return;
      settle({ kind: "redirected", url: candidate });
      // Closed only after settling: the close triggers onClosed, which settle() now ignores.
      window.close();
    });
    window.onClosed(() => settle({ kind: "cancelled" }));
    window.loadURL(url);
  });
}
