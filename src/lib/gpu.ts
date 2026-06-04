/** Display helpers for the performance overlay (ScenePerf). Pure + unit-tested. */

/** FPS readout color: green at 55+, amber 30-54, red below 30. */
export function fpsColor(fps: number): string {
  if (fps >= 55) return "#5ef08a";
  if (fps >= 30) return "#f0d24e";
  return "#f0644e";
}

/** Format a byte count compactly: 512 -> "512 B", 16 MiB -> "16 MB", 1.5 GiB -> "1.5 GB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const v = bytes / 1024 ** i;
  // Bytes are always whole; larger units show a decimal only while under 10.
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Format a large count compactly: 999 -> "999", 12000 -> "12.0k", 3.4e6 -> "3.4M". */
export function formatCount(n: number): string {
  if (n < 1e3) return `${Math.round(n)}`;
  if (n < 1e6) return `${(n / 1e3).toFixed(1)}k`;
  if (n < 1e9) return `${(n / 1e6).toFixed(1)}M`;
  return `${(n / 1e9).toFixed(1)}B`;
}

/**
 * Frame-rate stability from a ring buffer of raw frame intervals (ms), all in FPS:
 * - `avg`  mean frame rate over the window
 * - `min`  the single slowest frame (worst-case hitch)
 * - `low`  the "1% low" — the rate at the 99th-percentile-slowest frame, which
 *          surfaces stutter the exponentially-smoothed headline FPS hides.
 * Returns zeros for an empty buffer.
 */
export function frameStats(frameMs: number[]): { avg: number; min: number; low: number } {
  if (frameMs.length === 0) return { avg: 0, min: 0, low: 0 };
  let sum = 0;
  let max = 0;
  for (const ms of frameMs) {
    sum += ms;
    if (ms > max) max = ms;
  }
  const sorted = [...frameMs].sort((a, b) => a - b);
  const p99 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))];
  const toFps = (ms: number) => (ms > 0 ? 1000 / ms : 0);
  return { avg: toFps(sum / frameMs.length), min: toFps(max), low: toFps(p99) };
}

/** Shorten a verbose WebGL renderer string to a readable device name (≤ 30 chars). */
export function shortGpu(name: string): string {
  // "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, ...)" -> "Apple M1 Max"
  const m = name.match(/ANGLE \(([^,]+),\s*([^,]+)/);
  const raw = m ? m[2] : name;
  const clean = raw
    .replace(/\s*\(.*$/, "")
    .replace(/^ANGLE.*Renderer:\s*/i, "")
    .trim();
  return clean.length > 30 ? `${clean.slice(0, 29)}…` : clean;
}
