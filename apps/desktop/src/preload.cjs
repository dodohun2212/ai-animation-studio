// Electron's context-isolated preload loader only supports CommonJS, so this
// stays a plain .cjs file (never compiled from TypeScript/ESM) regardless of
// this package's "type": "module" setting.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openProjectPath: (projectId, relativePath) =>
    ipcRenderer.invoke("open-project-path", { projectId, relativePath }),
});
