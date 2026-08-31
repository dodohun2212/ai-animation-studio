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
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Local NestJS backend only, for manual dev checks — never a paid provider.
    proxy: {
      "/health": "http://127.0.0.1:3000",
      "/projects": "http://127.0.0.1:3000",
      "/long-projects": "http://127.0.0.1:3000",
      "/settings": "http://127.0.0.1:3000",
      "/assets": "http://127.0.0.1:3000",
      "/images": "http://127.0.0.1:3000",
      "/audio": "http://127.0.0.1:3000",
      "/videos": "http://127.0.0.1:3000",
      "/photo-cards": "http://127.0.0.1:3000",
    },
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
