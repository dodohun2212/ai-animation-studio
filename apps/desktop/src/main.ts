import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow, dialog, ipcMain, shell, utilityProcess } from "electron";

import { BackendProcessManager, type ChildLike } from "./backend-process.ts";
import { isAllowedLoginUrl, openInstagramLoginWindow, type LoginWindowLike } from "./instagram-login-window.ts";
import { resolveProjectPath } from "./project-path.ts";
import { startProductionWindow } from "./production-startup.ts";
import { resolveRuntimeRoots } from "./runtime-roots.ts";
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

/** Both roots the backend needs, decided in one place — see resolveRuntimeRoots for why they must never be resolved separately. */
function runtimeRoots(): { providerSettingsRoot: string; learningDataRoot: string } {
  return resolveRuntimeRoots({
    packaged: app.isPackaged,
    userDataPath: app.isPackaged ? app.getPath("userData") : "",
    currentDirectory,
  });
}

function learningDataRoot(): string {
  return runtimeRoots().learningDataRoot;
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
  try {
    await migrateUserDataFolder(oldPath, newPath, {
      pathExists: (target) => fsPromises.access(target).then(() => true, () => false),
      rename: (from, to) => fsPromises.rename(from, to),
      copyRecursive: (from, to) => fsPromises.cp(from, to, { recursive: true }),
      mkdirForFile: async (target) => { await fsPromises.mkdir(path.dirname(target), { recursive: true }); },
      removeRecursive: (target) => fsPromises.rm(target, { recursive: true, force: true }),
    });
  } catch {
    // This ran before the window and the IPC handlers were registered, so a throw here used to end startup
    // with nothing on screen at all — the app simply never appeared. The data is untouched at oldPath either
    // way, so the right answer is to say where it is and carry on: the person gets a working app and the one
    // sentence they need, instead of an empty window they cannot explain or no window at all.
    await dialog.showMessageBox({
      type: "warning",
      title: APP_DISPLAY_NAME,
      message: "이전에 쓰던 데이터를 새 폴더로 옮기지 못했습니다. 그대로 남아 있으니 지우지 마세요.",
      detail: [
        `옮기려던 곳: ${newPath}`,
        `데이터가 있는 곳: ${oldPath}`,
        "",
        "앱을 다시 시작하면 한 번 더 시도합니다.",
      ].join("\n"),
    });
  }
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
    // PROVIDER_SETTINGS_ROOT is passed explicitly alongside LEARNING_DATA_ROOT. Leaving it out let it fall back
    // to the launching process's working directory, which differs between this shell and the browser dev server.
    env: {
      ...process.env,
      PORT: String(port),
      FRONTEND_STATIC_DIR: frontendStaticDirectory(),
      LEARNING_DATA_ROOT: runtimeRoots().learningDataRoot,
      PROVIDER_SETTINGS_ROOT: runtimeRoots().providerSettingsRoot,
    },
    port,
    // Deliberately not a quit. startProductionWindow quits when the server never came up, because there is
    // nothing to look at yet; here the person has been working, and closing the app under them would take the
    // screen away before they have read why. The app stays open and useless-but-honest instead of useless and
    // silent — which is what it was, one failed request at a time.
    onGaveUp: () => {
      void dialog.showMessageBox({
        type: "error",
        title: APP_DISPLAY_NAME,
        message: "로컬 서버가 멈췄고 다시 시작하지 못했습니다. 앱을 껐다 켜 주세요.",
        detail: "지금까지 저장된 작업은 그대로 있습니다. 이 상태에서는 새로 만들거나 불러오는 일이 모두 실패합니다.",
      });
    },
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
 * This exists because Meta will not register any address this app can serve: every redirect URL must be HTTPS,
 * and the enforcement cannot be switched off (docs/06_DECISIONS.md D-020). Meta's own success page is HTTPS and
 * needs no registration, but only a window this app can inspect can read the code off it — so the login lives
 * here even though everything else about this feature works in a browser.
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

async function createProductionWindow(): Promise<BrowserWindow | undefined> {
  const port = Number(process.env.BACKEND_PORT ?? DEFAULT_BACKEND_PORT);
  backend = startBackend(port);
  return startProductionWindow<BrowserWindow>({
    port,
    waitUntilReady: () => backend!.waitUntilReady(),
    showStartupFailure: async () => {
      await dialog.showMessageBox({
        type: "error",
        title: APP_DISPLAY_NAME,
        message: "로컬 서버를 시작하지 못했습니다. 앱을 다시 시작해 주세요.",
      });
    },
    quit: () => app.quit(),
    createWindow: () => new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1024,
      minHeight: 700,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: path.join(currentDirectory, "preload.cjs"),
      },
    }),
    load: (window, url) => window.loadURL(url),
  });
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
