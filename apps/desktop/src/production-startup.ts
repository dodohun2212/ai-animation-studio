/**
 * What the packaged shell does between "the backend is starting" and "there is a window".
 *
 * Extracted so the failure branch can be measured, following this directory's own pattern
 * (`instagram-login-window.ts` exists in exactly this shape for exactly this reason). `main.ts` keeps the
 * Electron glue — building the BrowserWindow, the dialog, the real quit — and hands it in.
 *
 * The branch that needed measuring: `app.quit()` asks the app to close and returns immediately, so the code
 * after it kept running. The shell told the person the server had failed to start and then opened a window
 * pointed at that server, which showed Chromium's own "can't reach this page" underneath the dialog — and a
 * window appearing during a quit can keep the app alive, leaving it running against a backend that is not
 * there. Nothing in `main.ts` had a test, which is why a missing `return` could sit in the one path a person
 * only reaches when something has already gone wrong.
 */
export interface ProductionStartupDeps<W> {
  waitUntilReady: () => Promise<boolean>;
  showStartupFailure: () => Promise<void>;
  quit: () => void;
  createWindow: () => W;
  load: (window: W, url: string) => Promise<void>;
  port: number;
}

export async function startProductionWindow<W>(deps: ProductionStartupDeps<W>): Promise<W | undefined> {
  if (!(await deps.waitUntilReady())) {
    await deps.showStartupFailure();
    deps.quit();
    return undefined;
  }
  const window = deps.createWindow();
  try {
    await deps.load(window, `http://127.0.0.1:${deps.port}/`);
  } catch {
    // The same failure as never becoming ready, half a second later: the backend answered /health and then was
    // gone before the page loaded. Nothing was handling this — `createWindow()` is called with `void`, so the
    // rejection was unhandled and the person got an empty window with no explanation.
    //
    // The same dialog on purpose, and no new wording. From where the person sits the two cases are one thing —
    // the server is not there — and inventing a second sentence would give one situation two explanations.
    await deps.showStartupFailure();
    deps.quit();
    return undefined;
  }
  return window;
}
