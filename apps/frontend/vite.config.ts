import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

/**
 * Every top-level route prefix the app calls must be listed below, or that screen silently breaks in browser
 * dev: Vite answers an unproxied path with index.html, so the fetch succeeds, returns HTML, and fails while
 * being parsed as JSON — which surfaces as an empty screen or a vanished card rather than as "the backend was
 * not reached". `/audio` and `/videos` were both missing, so the audio and video library screens were dead in
 * the browser while working in the packaged app.
 *
 * The list is exhaustive against the top-level prefixes in shared's API_ROUTES: /health, /projects,
 * /long-projects, /settings, /assets, /audio, /videos. Instagram needs no entry of its own — its routes live
 * under /settings.
 */
// Local NestJS backend only, for manual dev checks — never a paid provider.
const DEV_PROXY: Record<string, string> = {
  "/health": "http://127.0.0.1:3000",
  "/projects": "http://127.0.0.1:3000",
  "/long-projects": "http://127.0.0.1:3000",
  "/settings": "http://127.0.0.1:3000",
  "/assets": "http://127.0.0.1:3000",
  "/images": "http://127.0.0.1:3000",
  "/audio": "http://127.0.0.1:3000",
  "/videos": "http://127.0.0.1:3000",
  "/photo-cards": "http://127.0.0.1:3000",
  "/news": "http://127.0.0.1:3000",
  // The subtitle fonts, so a card preview in the dev browser draws with the same bytes FFmpeg burns in.
  "/fonts": "http://127.0.0.1:3000",
};

/**
 * A second checkout (an agent's git worktree) runs beside the person's own app, so it cannot take 5173 and 3000.
 * DEV_FRONTEND_PORT and DEV_BACKEND_URL move it; with neither set nothing changes. The table above stays
 * literal — `dev-proxy-prefixes.test.ts` reads this file's source for the `"/prefix": "http` lines — and the
 * override only swaps every target after the fact, so the two cannot list different prefixes.
 */
const backendOverride = process.env.DEV_BACKEND_URL;
const proxy = backendOverride
  ? Object.fromEntries(Object.keys(DEV_PROXY).map((prefix) => [prefix, backendOverride]))
  : DEV_PROXY;

export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    port: Number(process.env.DEV_FRONTEND_PORT ?? 5173),
    strictPort: true,
    proxy,
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
    /**
     * Vitest's default is 5s, and this suite's slowest test measured 3238ms — 1.54x of headroom, on a machine
     * doing nothing else. `npm test` runs the workspaces together, so "nothing else" is not the case that
     * matters: under that load the backend suite went red 3 runs out of 3 at the same ratio (b98657f), each
     * run naming whichever tests happened to be slow rather than a test that was actually wrong.
     *
     * A suite that goes red because something else is running teaches people to re-run instead of read, and a
     * real failure gets waved through on the second try. 20s is the number four backend tests had already
     * chosen inline for themselves before it was made the default there — not a new one invented here. Passing
     * runs are not slowed: a timeout is a ceiling on failure, never a wait.
     */
    testTimeout: 20_000,
  },
});
