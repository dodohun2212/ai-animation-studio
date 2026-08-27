// Electron's context-isolated preload loader only supports CommonJS, so this
// stays a plain .cjs file (never compiled from TypeScript/ESM) regardless of
// this package's "type": "module" setting.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  openProjectPath: (projectId, relativePath) =>
    ipcRenderer.invoke("open-project-path", { projectId, relativePath }),
  // Opens the Meta login page and resolves with the URL the window landed on, or a cancellation if the person
  // closed it. The renderer hands that URL to the Backend, which is where the code is read and the state it
  // issued is verified — nothing is parsed here.
  openInstagramLogin: (url, redirectPrefix) =>
    ipcRenderer.invoke("instagram-login", { url, redirectPrefix }),
});
