import { colormapRGB } from "../rendering";

export interface HistogramDraw {
  /** 256-bin intensity histogram (counts). */
  histogram: ArrayLike<number>;
  /** Window low/high in normalized [0,1] texture space. */
  low: number;
  high: number;
  /** Active colormap index. */
  colormap: number;
  /** Logical (CSS) pixel size of the drawing area. */
  width: number;
  /** Height of the histogram area. */
  histoH: number;
  /** Height of the colorbar strip below it. */
  barH: number;
  /** Gap between histogram and colorbar. */
  gap: number;
}

/**
 * Draw the log-scaled intensity histogram with the current window shaded, plus a
 * colorbar showing how that window maps through the active colormap. Shared by the
 * floating IntensityPanel and the Leva window/level plugin so the two stay identical.
 * The caller owns the canvas and its transform (e.g. devicePixelRatio scaling).
 */
export function drawIntensityHistogram(
  ctx: CanvasRenderingContext2D,
  { histogram, low, high, colormap, width, histoH, barH, gap }: HistogramDraw,
): void {
  ctx.clearRect(0, 0, width, histoH + gap + barH);

  const n = histogram.length;
  let maxLog = 0;
  for (let i = 0; i < n; i++) {
    const l = Math.log1p(histogram[i]);
    if (l > maxLog) maxLog = l;
  }

  const xLow = low * width;
  const xHigh = high * width;

  // shaded window region
  ctx.fillStyle = "rgba(94,160,240,0.10)";
  ctx.fillRect(xLow, 0, Math.max(1, xHigh - xLow), histoH);

  // histogram bars (log scale; brighter inside the window)
  for (let x = 0; x < width; x++) {
    const bin = Math.floor((x / width) * n);
    const h = maxLog > 0 ? (Math.log1p(histogram[bin]) / maxLog) * histoH : 0;
    ctx.fillStyle = x >= xLow && x <= xHigh ? "rgba(190,205,230,0.85)" : "rgba(120,140,170,0.4)";
    ctx.fillRect(x, histoH - h, 1, h);
  }

  // window edges
  ctx.strokeStyle = "rgba(94,160,240,0.9)";
  ctx.lineWidth = 1;
  for (const xx of [xLow, xHigh]) {
    ctx.beginPath();
    ctx.moveTo(xx + 0.5, 0);
    ctx.lineTo(xx + 0.5, histoH);
    ctx.stroke();
  }

  // colorbar showing the windowed colormap mapping
  const top = histoH + gap;
  const span = Math.max(1e-5, high - low);
  for (let x = 0; x < width; x++) {
    const t = Math.max(0, Math.min(1, (x / width - low) / span));
    const [r, g, b] = colormapRGB(colormap, t);
    ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
    ctx.fillRect(x, top, 1, barH);
  }
}
