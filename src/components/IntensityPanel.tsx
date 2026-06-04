import { useEffect, useRef } from "react";
import { formatCompact } from "../lib/format";
import type { Volume } from "../volume";
import { drawIntensityHistogram } from "./intensityHistogram";

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
  visible,
}: {
  volume: Volume;
  low: number;
  high: number;
  colormap: number;
  /** Fades in (fast) when true; fades out (smoothly) when false. */
  visible: boolean;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const cv = ref.current!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cv.width = W * dpr;
    cv.height = H * dpr;
    const ctx = cv.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawIntensityHistogram(ctx, {
      histogram: volume.histogram,
      low,
      high,
      colormap,
      width: W,
      histoH: HISTO_H,
      barH: BAR_H,
      gap: GAP,
    });
  }, [volume, low, high, colormap]);

  const dv = (t: number) => volume.displayMin + t * (volume.displayMax - volume.displayMin);
  const fmt = (x: number) => formatCompact(x, { fixed: 1, exp: 1, tiny: false });

  return (
    <div className={`intensity${visible ? " visible" : ""}`}>
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
