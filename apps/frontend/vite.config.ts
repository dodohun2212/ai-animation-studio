import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

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
      "/settings": "http://127.0.0.1:3000",
      "/assets": "http://127.0.0.1:3000",
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/test-setup.ts",
  },
});
