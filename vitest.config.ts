import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Vitest config is kept separate from vite.config.ts so the app build does not
// pull in the test-only react()/jsdom setup. Pure-logic suites need no DOM, but
// the component smoke tests run under jsdom (see tests/setup.ts).
export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./tests/setup.ts"],
    include: ["tests/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reportsDirectory: "./coverage",
      include: ["src/**/*.{ts,tsx}"],
      // Entry point and the WebGL renderer are exercised by hand / the browser,
      // not in jsdom — excluded so coverage reflects what is actually tested.
      exclude: ["src/main.tsx", "src/**/*.d.ts", "src/rendering/VolumeViewer.ts"],
    },
  },
});
