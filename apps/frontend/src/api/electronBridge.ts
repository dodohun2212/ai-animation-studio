export interface ElectronBridge {
  openProjectPath(projectId: string, relativePath?: string): Promise<{ opened: boolean }>;
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

/** Resolves to whether the OS actually opened the path. Returns undefined outside Electron. */
export function openProjectPathInExplorer(projectId: string, relativePath?: string): Promise<{ opened: boolean }> | undefined {
  return window.electronAPI?.openProjectPath(projectId, relativePath);
}
