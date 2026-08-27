export interface ElectronBridge {
  openProjectPath(projectId: string, relativePath?: string): Promise<{ opened: boolean }>;
  /**
   * Opens the Meta login page in a window and resolves once it lands on `redirectPrefix`, handing back that URL
   * whole for the server to read.
   *
   * `cancelled` is an answer, not a failure — closing the window is an ordinary thing to do, and treating it as
   * an error would accuse the user of a mistake they did not make.
   *
   * Optional because a shell built before this existed answers every other call normally and simply lacks this
   * one; a required member would let such a shell reach `undefined(...)` at the moment of the click.
   */
  openInstagramLogin?: (url: string, redirectPrefix: string)
    => Promise<{ kind: "redirected"; url: string } | { kind: "cancelled" }>;
}

declare global {
  interface Window {
    electronAPI?: ElectronBridge;
  }
}

/** True only inside the packaged Electron shell — always false in a plain browser tab (dev server, etc). */
export function hasElectronBridge(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI;
}

/**
 * Whether this shell can actually run a sign-in, which is a narrower question than whether a shell is present:
 * the login window arrived later than the bridge itself, so an older shell has `electronAPI` and no way to open
 * one. Asked separately so the screen can say "this build cannot" instead of offering a button that throws.
 */
export function canOpenInstagramLogin(): boolean {
  return typeof window !== "undefined" && typeof window.electronAPI?.openInstagramLogin === "function";
}

/** Resolves to whether the OS actually opened the path. Returns undefined outside Electron. */
export function openProjectPathInExplorer(projectId: string, relativePath?: string): Promise<{ opened: boolean }> | undefined {
  return window.electronAPI?.openProjectPath(projectId, relativePath);
}

/** Returns undefined when this shell cannot open the window — callers must say so rather than appear to hang. */
export function openInstagramLoginWindow(url: string, redirectPrefix: string):
Promise<{ kind: "redirected"; url: string } | { kind: "cancelled" }> | undefined {
  return window.electronAPI?.openInstagramLogin?.(url, redirectPrefix);
}
