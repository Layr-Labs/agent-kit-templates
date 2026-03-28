import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    root: resolve(__dirname),
    include: ["src/**/*.test.tsx"],
    setupFiles: ["src/test/setup.ts"],
  },
  resolve: {
    alias: {
      "@ai-sdk/react": resolve(__dirname, "src/test/__mocks__/@ai-sdk/react.ts"),
    },
  },
});
