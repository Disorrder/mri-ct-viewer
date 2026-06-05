import { readFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";

/**
 * Serve the .nii.gz volumes as raw bytes: Content-Type application/gzip and,
 * crucially, NO Content-Encoding. Vite's static server otherwise treats a .gz
 * file as the gzip-*encoded* form of a .nii, so the browser silently inflates
 * it — which bypasses our own DecompressionStream step and makes byte-accurate
 * download progress impossible (Content-Length is the compressed size while the
 * delivered body is the decompressed one). Here the app gets the real file.
 */
function rawNiftiBytes(): Plugin {
  const handle = async (
    req: IncomingMessage,
    res: ServerResponse,
    next: (err?: unknown) => void,
  ) => {
    const name = (req.url ?? "").split("?")[0].replace(/^\//, "");
    if (!name.endsWith(".nii.gz") || name.includes("/")) return next();
    try {
      const data = await readFile(resolve(process.cwd(), "public", name));
      res.setHeader("Content-Type", "application/gzip");
      res.setHeader("Content-Length", String(data.byteLength));
      res.setHeader("Cache-Control", "no-cache");
      res.end(data);
    } catch {
      next();
    }
  };
  return {
    name: "raw-nifti-bytes",
    configureServer(server: ViteDevServer) {
      server.middlewares.use(handle);
    },
    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use(handle);
    },
  };
}

// The demo-reel feature tour (`/?demo`, Shift+D, __demo()) is gated in App.tsx
// on the VITE_INCLUDE_DEMO_SCRIPT env var (off unless set to "true"). Vite loads
// and statically inlines that VITE_-prefixed var automatically — from .env files
// or the build environment (e.g. a Vercel project var) — so no `define` here:
// when it isn't "true" the guard folds to a constant and Rollup tree-shakes the
// whole reel chunk out; when it is, the chunk ships and loads lazily on trigger.
export default defineConfig({
  plugins: [react(), rawNiftiBytes()],
  server: { port: 5173, open: false },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries out of the app bundle so
        // they cache independently: Three.js (by far the largest) on its own,
        // the Leva control panel and its subtree (~175 kB: @radix-ui, @stitches,
        // zustand, react-colorful, react-dropzone, …) on its own, the React
        // runtime in a third vendor chunk, app code in a fourth. Leva and React
        // version independently, so keeping them apart means upgrading one no
        // longer busts the other's cache.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/three/")) return "three";
          if (
            /\/(leva|@radix-ui|@stitches|@use-gesture|colord|react-colorful|react-dropzone|zustand|v8n|merge-value|dequal)\//.test(
              id,
            )
          )
            return "leva";
          return "vendor";
        },
      },
    },
    // Three.js alone is ~600 kB minified — inherent to the library, not a
    // regression. Lift the warning above it so it only fires on real bloat.
    chunkSizeWarningLimit: 700,
  },
});
