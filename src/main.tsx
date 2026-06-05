import { createRoot } from "react-dom/client";
import { nextPaint } from "./lib/nextPaint";
import "./styles.css";

/**
 * Boot sequence with a progress bar. The splash markup lives in index.html so it
 * paints on the first frame, before any of the heavy chunks (three ~487 kB, leva
 * ~175 kB) download. We pull those in with explicit dynamic imports so each one
 * is a visible step on the bar, then mount the app and fade the splash out.
 */
const fill = document.getElementById("boot-fill");
const bootLabel = document.getElementById("boot-label");
const boot = document.getElementById("boot");

function setBoot(fraction: number, label?: string) {
  if (fill) fill.style.width = `${Math.round(fraction * 100)}%`;
  if (label && bootLabel) bootLabel.textContent = label;
}

async function start() {
  setBoot(0.12, "loading renderer");
  // Warm the heavy chunks one at a time so each is a visible step. Import the
  // app's own rendering entry (not the bare "three" package) so we only pull the
  // slice of Three.js the app actually uses — a bare `import("three")` drags in
  // the whole barrel and tree-shaking can't trim it.
  await import("./rendering");
  setBoot(0.62, "loading controls");
  await import("leva");
  setBoot(0.85, "starting");
  const { default: App } = await import("./App"); // app code; three/leva already warm

  // NB: intentionally NOT wrapped in <StrictMode>. Leva 0.10's folder height
  // animation caches a fixed pixel height per folder on mount; StrictMode's
  // double-invoked effects bake that height in before the panel settles, so
  // render-gated controls (e.g. the clip ranges) overflow instead of growing
  // their section. Without the double-invoke the heights stay `auto` and resize.
  createRoot(document.getElementById("root")!).render(<App />);

  setBoot(1, "ready");
  // Fade the splash out only after the app's first paint, so there's no flash of
  // empty page between the two (nextPaint falls back to a timer in background
  // tabs, where rAF is paused — otherwise the splash would never leave).
  await nextPaint();
  boot?.classList.add("hidden");
  setTimeout(() => boot?.remove(), 320);
}

start();
