import { useEffect, useRef } from "react";
import type { SinglePlane } from "../lib/layout";
import { drawRuler } from "../lib/ruler";
import type { NiftiVolume } from "../nifti";
import { PLANE_COLORS, type VolumeViewer } from "../rendering";

/**
 * Phone single-plane overlay: one orthogonal view filling the screen. Shows the
 * plane label + slice index and an L-shaped cm ruler on the right + bottom edges
 * (the desktop MPR ruler, scaled up to the whole screen). The ruler polls the
 * viewer each frame so it stays correct while pinch/scroll-zooming.
 */
export function SinglePlaneOverlay({
  viewer,
  volume,
  plane,
  sliceX,
  sliceY,
  sliceZ,
  showRuler,
}: {
  viewer: VolumeViewer;
  volume: NiftiVolume;
  plane: SinglePlane;
  sliceX: number;
  sliceY: number;
  sliceZ: number;
  showRuler: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const idx = (frac: number, n: number) => Math.round(frac * (n - 1));
  // Read inside the RAF loop so toggling the ruler / switching plane doesn't restart it.
  const showRulerRef = useRef(showRuler);
  showRulerRef.current = showRuler;
  const planeRef = useRef(plane);
  planeRef.current = plane;

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
      const mm =
        planeRef.current === "axial"
          ? { v: v.axialMm, h: v.axialMmH }
          : planeRef.current === "coronal"
            ? { v: v.coronalMm, h: v.coronalMmH }
            : { v: v.sagittalMm, h: v.sagittalMmH };
      drawRuler(ctx, 0, 0, w, h, mm.v, mm.h, "right", "bottom");
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [viewer]);

  const meta = {
    axial: {
      color: PLANE_COLORS.axial,
      label: `Axial · z ${idx(sliceZ, volume.nz)} / ${volume.nz - 1}`,
    },
    coronal: {
      color: PLANE_COLORS.coronal,
      label: `Coronal · y ${idx(sliceY, volume.ny)} / ${volume.ny - 1}`,
    },
    sagittal: {
      color: PLANE_COLORS.sagittal,
      label: `Sagittal · x ${idx(sliceX, volume.nx)} / ${volume.nx - 1}`,
    },
  }[plane];

  return (
    <div className="single-overlay">
      <canvas className="mpr-ruler" ref={canvasRef} />
      <span className="single-label" style={{ color: meta.color }}>
        {meta.label}
      </span>
      <span className="single-hint">tap / drag to move · pinch to zoom</span>
    </div>
  );
}
