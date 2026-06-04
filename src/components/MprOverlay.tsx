import { useEffect, useRef } from "react";
import { drawRuler } from "../lib/ruler";
import { PLANE_COLORS, type VolumeViewer } from "../rendering";
import type { Volume } from "../volume";

/**
 * MPR overlay: colored viewport titles + slice indices, plus a live cm ruler on
 * the right edge of each 2D viewport. Layout matches a dental CBCT viewer —
 * TL coronal, TR sagittal, BL axial, BR 3D. The ruler polls the viewer each
 * frame so it stays correct while wheel-zooming the 2D views.
 */
export function MprOverlay({
  viewer,
  volume,
  sliceX,
  sliceY,
  sliceZ,
  showRuler,
}: {
  viewer: VolumeViewer;
  volume: Volume;
  sliceX: number;
  sliceY: number;
  sliceZ: number;
  showRuler: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const idx = (frac: number, n: number) => Math.round(frac * (n - 1));
  // Read inside the RAF loop so toggling doesn't restart it.
  const showRulerRef = useRef(showRuler);
  showRulerRef.current = showRuler;

  useEffect(() => {
    const cv = canvasRef.current!;
    const ctx = cv.getContext("2d")!;
    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      if (!showRulerRef.current) return;
      const v = viewer.getMprView();
      const hw = w / 2;
      const hh = h / 2;
      // Each ruler hugs the two inner edges that meet at the screen center.
      drawRuler(ctx, 0, 0, hw, hh, v.coronalMm, v.coronalMmH, "right", "bottom"); // TL
      drawRuler(ctx, hw, 0, hw, hh, v.sagittalMm, v.sagittalMmH, "left", "bottom"); // TR
      drawRuler(ctx, 0, hh, hw, hh, v.axialMm, v.axialMmH, "right", "top"); // BL
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [viewer]);

  return (
    <div className="mpr-overlay">
      <canvas className="mpr-ruler" ref={canvasRef} />
      <div className="mpr-cell tl">
        <span className="mpr-label" style={{ color: PLANE_COLORS.coronal }}>
          Coronal · y {idx(sliceY, volume.ny)} / {volume.ny - 1}
        </span>
      </div>
      <div className="mpr-cell tr">
        <span className="mpr-label" style={{ color: PLANE_COLORS.sagittal }}>
          Sagittal · x {idx(sliceX, volume.nx)} / {volume.nx - 1}
        </span>
      </div>
      <div className="mpr-cell bl">
        <span className="mpr-label" style={{ color: PLANE_COLORS.axial }}>
          Axial · z {idx(sliceZ, volume.nz)} / {volume.nz - 1}
        </span>
      </div>
      <div className="mpr-cell br">
        <span className="mpr-label">3D · scroll a 2D view to zoom · drag to move crosshair</span>
      </div>
    </div>
  );
}
