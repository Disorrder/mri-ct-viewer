import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

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

export default defineConfig({
  plugins: [react(), rawNiftiBytes()],
  server: { port: 5173, open: false },
  build: {
    rollupOptions: {
      output: {
        // Split the heavy, rarely-changing libraries out of the app bundle so
        // they cache independently: Three.js (by far the largest) on its own,
        // the React/Leva runtime in a second vendor chunk, app code in a third.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("/three/")) return "three";
          return "vendor";
        },
      },
    },
    // Three.js alone is ~600 kB minified — inherent to the library, not a
    // regression. Lift the warning above it so it only fires on real bloat.
    chunkSizeWarningLimit: 700,
  },
});
