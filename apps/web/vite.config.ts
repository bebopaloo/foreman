import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// WEB_PORT moves the dev server. PORT is the API port (apps/api/src/config.ts),
// so the proxy follows the API when `pnpm dev` starts both with one PORT.
const WEB_PORT = Number(process.env.WEB_PORT ?? 5173);
const API_ORIGIN = `http://127.0.0.1:${process.env.PORT ?? "3000"}`;

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: WEB_PORT,
    strictPort: true,
    proxy: { "/api": API_ORIGIN },
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    proxy: { "/api": API_ORIGIN },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
  },
});
