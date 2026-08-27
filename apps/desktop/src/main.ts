import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from "electron";

import { BackendProcessManager, type ChildLike } from "./backend-process.ts";
import { isAllowedLoginUrl, openInstagramLoginWindow, type LoginWindowLike } from "./instagram-login-window.ts";
import { resolveProjectPath } from "./project-path.ts";
import { migrateUserDataFolder } from "./userdata-migration.ts";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_BACKEND_PORT = 4317;
// Electron's userData path otherwise defaults to the raw npm package name from package.json
// ("@ai-animation-studio/desktop"), which nests unusably on Windows as
// `%APPDATA%\@ai-animation-studio\desktop` — a real problem when a user actually needs to find this folder
// (a real problem during a Runway credit investigation).
const APP_DISPLAY_NAME = "AI Animation Studio";

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

/**
 * Renames the app (so getPath("userData") starts returning the readable path) and, only for a packaged install
 * that already has real data sitting under the old default name, moves it forward — never deletes anything, and
 * never touches the old path if something is already at the new one (see migrateUserDataFolder's own doc
 * comment). oldPath is captured before setName() so it reflects the pre-rename default, not the new one.
 */
async function renameAppAndMigrateUserData(): Promise<void> {
  if (!app.isPackaged) { app.setName(APP_DISPLAY_NAME); return; }
  const oldPath = app.getPath("userData");
  app.setName(APP_DISPLAY_NAME);
  const newPath = app.getPath("userData");
  await migrateUserDataFolder(oldPath, newPath, {
    pathExists: (target) => fsPromises.access(target).then(() => true, () => false),
    rename: (from, to) => fsPromises.rename(from, to),
    copyRecursive: (from, to) => fsPromises.cp(from, to, { recursive: true }),
    mkdirForFile: async (target) => { await fsPromises.mkdir(path.dirname(target), { recursive: true }); },
  });
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

/**
 * Opens the Meta login page in its own window and hands the landed URL back to the renderer, which passes it to
 * the backend to be parsed and verified. Nothing about the code or the app secret passes through here.
 *
 * The window runs with no preload and no Node access: it displays a real login form on a third-party page, so
 * it gets the least authority this app can give it.
 */
function registerInstagramLoginHandler(): void {
  ipcMain.handle("instagram-login", async (_event, payload: unknown) => {
    const request = payload as { url?: unknown; redirectPrefix?: unknown } | null;
    const url = typeof request?.url === "string" ? request.url : "";
    const redirectPrefix = typeof request?.redirectPrefix === "string" ? request.redirectPrefix : "";
    if (!isAllowedLoginUrl(url) || !isAllowedLoginUrl(redirectPrefix)) return { kind: "cancelled" };

    return openInstagramLoginWindow(url, redirectPrefix, {
      createWindow: (): LoginWindowLike => {
        const window = new BrowserWindow({
          width: 520,
          height: 720,
          title: "Instagram 로그인",
          autoHideMenuBar: true,
          webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
        });
        return {
          loadURL: (target) => { void window.loadURL(target); },
          onNavigate: (listener) => {
            // will-redirect catches the hop to the success page; did-navigate covers a direct landing.
            window.webContents.on("will-redirect", (_navigationEvent, target) => listener(target));
            window.webContents.on("did-navigate", (_navigationEvent, target) => listener(target));
          },
          onClosed: (listener) => window.on("closed", listener),
          close: () => { if (!window.isDestroyed()) window.close(); },
        };
      },
    });
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

void app.whenReady().then(async () => {
  await renameAppAndMigrateUserData();
  registerOpenProjectPathHandler();
  registerInstagramLoginHandler();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => backend?.stop());
