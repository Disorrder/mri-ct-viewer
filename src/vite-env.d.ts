/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for dataset assets; empty falls back to same-origin `/public`. */
  readonly VITE_DATA_BASE?: string;
  /**
   * Set to "true" to ship the demo-reel feature tour (`/?demo`, Shift+D,
   * __demo()). Unset/anything else → the reel is tree-shaken out of the bundle.
   * Off by default everywhere; enable via `.env*` or the build env (e.g. Vercel).
   */
  readonly VITE_INCLUDE_DEMO_SCRIPT?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
