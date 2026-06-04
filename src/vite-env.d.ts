/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL for dataset assets; empty falls back to same-origin `/public`. */
  readonly VITE_DATA_BASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
