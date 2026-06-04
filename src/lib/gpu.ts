/** Display helpers for the performance overlay (StatsPanel). Pure + unit-tested. */

/** FPS readout color: green at 55+, amber 30-54, red below 30. */
export function fpsColor(fps: number): string {
  if (fps >= 55) return "#5ef08a";
  if (fps >= 30) return "#f0d24e";
  return "#f0644e";
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
