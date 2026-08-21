import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { app, BrowserWindow } from "electron";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });

  const developmentUrl = process.env.FRONTEND_DEV_URL;
  if (developmentUrl) {
    void window.loadURL(developmentUrl);
    return;
  }

  void window.loadFile(join(currentDirectory, "../../frontend/dist/index.html"));
}

void app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => app.quit());
