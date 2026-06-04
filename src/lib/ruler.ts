/**
 * Centimetre-ruler math + drawing for the 2D (MPR / single-plane) overlays.
 * The tick math is pure and unit-tested; drawRuler is the canvas renderer that
 * uses it.
 */

/** Smallest "nice" cm step (…0.1, 0.2, 0.5, 1, 2, 5, 10…) that is at least `minPx` wide on screen. */
export function niceCmStep(minPx: number, pxPerCm: number): number {
  const minCm = minPx / pxPerCm;
  const pow = 10 ** Math.floor(Math.log10(minCm));
  for (const m of [1, 2, 5]) if (m * pow >= minCm) return m * pow;
  return 10 * pow;
}

/**
 * Tick scheme for one axis at the current zoom. `labelCm` is a nice 1/2/5 step
 * kept ≥ minLabelPx apart, so the numbers never collide — it grows when zoomed
 * out (skipping cm) and shrinks to fractions of a cm when zoomed in. Minor ticks
 * subdivide each labelled interval, but are dropped once they'd be denser than
 * MIN_TICK_PX. Returns the tick step and how many ticks make up one label.
 */
export function rulerScheme(pxPerCm: number, minLabelPx: number) {
  const labelCm = niceCmStep(minLabelPx, pxPerCm);
  const mant = Math.round(labelCm / 10 ** Math.floor(Math.log10(labelCm) + 1e-9)); // 1, 2 or 5
  const sub = mant === 5 ? 5 : 2; // subdivisions that keep minor ticks on nice values
  const minorCm = labelCm / sub;
  const useMinor = minorCm * pxPerCm >= 5;
  return { stepCm: useMinor ? minorCm : labelCm, perLabel: useMinor ? sub : 1, labelCm };
}

/** Format a cm value with just enough decimals for its step (1→"5", 0.5→"1.5", 0.05→"0.15"). */
export function fmtCm(cm: number, stepCm: number): string {
  let d = 0;
  for (let s = stepCm; Math.abs(s - Math.round(s)) > 1e-9 && d < 4; s *= 10) d++;
  return cm.toFixed(d);
}

/**
 * L-shaped cm ruler hugging the two inner edges of a 2D viewport — the ones that
 * meet at the screen center. `vEdge`/`hEdge` pick those edges; the lines sit
 * right on them and ticks point inward. A small empty square is left at the
 * inner corner so the vertical and horizontal scales never cross. The cameras
 * keep a fixed aspect, so both scales share the same mm/px.
 *
 * Tick and label spacing adapt to the zoom: when zoomed out the step grows
 * (skipping cm so labels never collide), when zoomed in it shrinks to fractions
 * of a cm — always snapped to a 1/2/5 sequence so the numbers stay readable.
 */
export function drawRuler(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  w: number,
  h: number,
  mmV: number,
  mmH: number,
  vEdge: "left" | "right",
  hEdge: "top" | "bottom",
) {
  const GAP = 13; // empty square at the inner corner (toward the screen center)
  const PAD = 3; // small inset at the outer ends
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(200,212,232,0.45)";
  ctx.fillStyle = "rgba(210,222,242,0.8)";
  ctx.font = "9px ui-monospace, SFMono-Regular, Menlo, monospace";

  // Vertical scale along the inner vertical edge; ticks point into the viewport.
  if (mmV > 0 && Number.isFinite(mmV)) {
    const rx = vEdge === "right" ? left + w - 1 : left + 1;
    const into = vEdge === "right" ? -1 : 1; // tick direction (toward the viewport)
    const pxPerCm = (h / mmV) * 10;
    const { stepCm, perLabel, labelCm } = rulerScheme(pxPerCm, 16); // stacked labels: ≥ 16px apart
    const yGap = hEdge === "bottom" ? top + h - GAP : top + GAP; // gap end (near center)
    const yOut = hEdge === "bottom" ? top + PAD : top + h - PAD; // outer end
    ctx.textBaseline = "middle";
    ctx.textAlign = vEdge === "right" ? "right" : "left";
    ctx.beginPath();
    ctx.moveTo(rx + 0.5, Math.min(yGap, yOut));
    ctx.lineTo(rx + 0.5, Math.max(yGap, yOut));
    ctx.stroke();
    for (let i = 0; ; i++) {
      const cm = i * stepCm;
      const py = top + cm * pxPerCm; // 0 cm at the top edge
      if (py > top + h - PAD) break;
      if (py >= top + PAD && (hEdge === "bottom" ? py <= yGap : py >= yGap)) {
        const major = i % perLabel === 0;
        ctx.beginPath();
        ctx.moveTo(rx, py + 0.5);
        ctx.lineTo(rx + into * (major ? 7 : 4), py + 0.5);
        ctx.stroke();
        if (major && i > 0) ctx.fillText(fmtCm(cm, labelCm), rx + into * 10, py);
      }
    }
    ctx.fillText("cm", rx + into * 11, yOut + (hEdge === "bottom" ? 8 : -8));
  }

  // Horizontal scale along the inner horizontal edge; ticks point into the viewport.
  if (mmH > 0 && Number.isFinite(mmH)) {
    const ry = hEdge === "bottom" ? top + h - 1 : top + 1;
    const into = hEdge === "bottom" ? -1 : 1; // tick direction (toward the viewport)
    const pxPerCm = (w / mmH) * 10;
    const { stepCm, perLabel, labelCm } = rulerScheme(pxPerCm, 28); // side-by-side labels need more room
    const xGap = vEdge === "right" ? left + w - GAP : left + GAP; // gap end (near center)
    ctx.textBaseline = hEdge === "bottom" ? "bottom" : "top";
    ctx.textAlign = "center";
    ctx.beginPath();
    ctx.moveTo(vEdge === "right" ? left + PAD : left + w - PAD, ry + 0.5);
    ctx.lineTo(xGap, ry + 0.5);
    ctx.stroke();
    for (let i = 0; ; i++) {
      const cm = i * stepCm;
      const px = left + cm * pxPerCm; // 0 cm at the left edge
      if (px > left + w - PAD) break;
      if (px >= left + PAD && (vEdge === "right" ? px <= xGap : px >= xGap)) {
        const major = i % perLabel === 0;
        ctx.beginPath();
        ctx.moveTo(px + 0.5, ry);
        ctx.lineTo(px + 0.5, ry + into * (major ? 7 : 4));
        ctx.stroke();
        if (major && i > 0) ctx.fillText(fmtCm(cm, labelCm), px, ry + into * 9);
      }
    }
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}
