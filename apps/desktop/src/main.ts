import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from "electron";

import { BackendProcessManager, type ChildLike } from "./backend-process.ts";
import { resolveProjectPath } from "./project-path.ts";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_BACKEND_PORT = 4317;

function backendModulePath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "backend", "main.cjs")
    : path.join(currentDirectory, "../../backend/dist-bundle/main.cjs");
}

function frontendStaticDirectory(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "frontend")
    : path.join(currentDirectory, "../../frontend/dist");
}

function learningDataRoot(): string {
  return app.isPackaged
    ? path.join(app.getPath("userData"), "learning_data")
    : path.join(currentDirectory, "../../../learning_data");
}

let backend: BackendProcessManager | undefined;

function startBackend(port: number): BackendProcessManager {
  const manager = new BackendProcessManager({
    fork: (modulePath, args, env): ChildLike => utilityProcess.fork(modulePath, [...args], { env }) as unknown as ChildLike,
    checkHealth: async (url) => {
      try {
        const response = await fetch(url);
        return response.ok;
      } catch {
        return false;
      }
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    modulePath: backendModulePath(),
    env: { ...process.env, PORT: String(port), FRONTEND_STATIC_DIR: frontendStaticDirectory(), LEARNING_DATA_ROOT: learningDataRoot() },
    port,
  });
  manager.start();
  return manager;
}

function registerOpenProjectPathHandler(): void {
  ipcMain.handle("open-project-path", async (_event, payload: unknown) => {
    const request = payload as { projectId?: unknown; relativePath?: unknown } | null;
    const projectId = typeof request?.projectId === "string" ? request.projectId : "";
    const relativePath = typeof request?.relativePath === "string" ? request.relativePath : undefined;
    const projectsRoot = path.join(learningDataRoot(), "projects");
    const target = resolveProjectPath(projectsRoot, projectId, relativePath);
    if (!target) return { opened: false };
    const error = await shell.openPath(target);
    return { opened: error === "" };
  });
}

async function createProductionWindow(): Promise<BrowserWindow> {
  const port = Number(process.env.BACKEND_PORT ?? DEFAULT_BACKEND_PORT);
  backend = startBackend(port);
  const ready = await backend.waitUntilReady();
  if (!ready) {
    await dialog.showMessageBox({
      type: "error",
      title: "AI Animation Studio",
      message: "로컬 서버를 시작하지 못했습니다. 앱을 다시 시작해 주세요.",
    });
    app.quit();
  }
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(currentDirectory, "preload.cjs"),
    },
  });
  await window.loadURL(`http://127.0.0.1:${port}/`);
  return window;
}

function createDevelopmentWindow(developmentUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(currentDirectory, "preload.cjs"),
    },
  });
  void window.loadURL(developmentUrl);
  return window;
}

function createWindow(): void {
  const developmentUrl = process.env.FRONTEND_DEV_URL;
  if (developmentUrl) {
    createDevelopmentWindow(developmentUrl);
    return;
  }
  void createProductionWindow();
}

void app.whenReady().then(() => {
  registerOpenProjectPathHandler();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => backend?.stop());
