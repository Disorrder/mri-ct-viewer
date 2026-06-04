import { useEffect, useRef } from "react";
import { colormapRGB } from "./colormaps";
import type { NiftiVolume } from "./nifti";

/**
 * Bottom-center widget: the volume's intensity histogram (log-scaled) with the
 * current window shaded, plus a colorbar showing how that window maps through
 * the active colormap. Endpoints are labelled in real display values.
 */
const W = 264;
const HISTO_H = 58;
const BAR_H = 12;
const GAP = 6;
const H = HISTO_H + GAP + BAR_H;

export function IntensityPanel({
  volume,
  low,
  high,
  colormap,
}: {
  volume: NiftiVolume;
  low: number;
  high: number;
  colormap: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const hist = volume.histogram;
    const n = hist.length;
    let maxLog = 0;
    for (let i = 0; i < n; i++) {
      const l = Math.log1p(hist[i]);
      if (l > maxLog) maxLog = l;
    }

    const xLow = low * W;
    const xHigh = high * W;

    // shaded window region
    ctx.fillStyle = "rgba(94,160,240,0.10)";
    ctx.fillRect(xLow, 0, Math.max(1, xHigh - xLow), HISTO_H);

    // histogram bars (log scale; brighter inside the window)
    for (let x = 0; x < W; x++) {
      const bin = Math.floor((x / W) * n);
      const h = maxLog > 0 ? (Math.log1p(hist[bin]) / maxLog) * HISTO_H : 0;
      ctx.fillStyle = x >= xLow && x <= xHigh ? "rgba(190,205,230,0.85)" : "rgba(120,140,170,0.4)";
      ctx.fillRect(x, HISTO_H - h, 1, h);
    }

    // window edges
    ctx.strokeStyle = "rgba(94,160,240,0.9)";
    ctx.lineWidth = 1;
    for (const xx of [xLow, xHigh]) {
      ctx.beginPath();
      ctx.moveTo(xx + 0.5, 0);
      ctx.lineTo(xx + 0.5, HISTO_H);
      ctx.stroke();
    }

    // colorbar showing the windowed colormap mapping
    const top = HISTO_H + GAP;
    const span = Math.max(1e-5, high - low);
    for (let x = 0; x < W; x++) {
      const t = Math.max(0, Math.min(1, (x / W - low) / span));
      const [r, g, b] = colormapRGB(colormap, t);
      ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
      ctx.fillRect(x, top, 1, BAR_H);
    }
  }, [volume, low, high, colormap]);

  const dv = (t: number) => volume.displayMin + t * (volume.displayMax - volume.displayMin);
  const fmt = (x: number) => (Math.abs(x) >= 1000 ? x.toExponential(1) : +x.toFixed(1));

  return (
    <div className="intensity">
      <div className="intensity-title">intensity histogram · window</div>
      <canvas ref={ref} className="intensity-canvas" />
      <div className="intensity-labels">
        <span>{fmt(dv(low))}</span>
        <span className="muted">display value →</span>
        <span>{fmt(dv(high))}</span>
      </div>
    </div>
  );
}
