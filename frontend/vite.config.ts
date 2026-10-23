import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vitest/config";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "127.0.0.1",
    proxy: { "/api": "http://127.0.0.1:5053" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/app/test-setup.ts"],
    clearMocks: true,
  },
});
