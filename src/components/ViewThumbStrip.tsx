import { type RefObject, useLayoutEffect, useRef } from "react";
import type { ViewTab } from "../lib/layout";
import { type Layout, PLANE_COLORS, type VolumeViewer } from "../rendering";

// Short chip labels + accent colors for the corner badge on each preview.
const SHORT: Record<string, string> = { "3D": "3D", axial: "AX", coronal: "COR", sagittal: "SAG" };
const ACCENT: Record<string, string> = {
  "3D": "#9fb4d6",
  axial: PLANE_COLORS.axial,
  coronal: PLANE_COLORS.coronal,
  sagittal: PLANE_COLORS.sagittal,
};

/**
 * Phone view switcher: a row of small live preview squares — one per view you are
 * *not* currently looking at. Tapping a square switches the main view to it. The
 * previews are real viewports: each square reports its on-screen rect to the
 * viewer (relative to the canvas host), which draws that view into the box every
 * frame. The buttons themselves stay transparent so the render shows through.
 */
export function ViewThumbStrip({
  viewer,
  hostRef,
  views,
  active,
  onSelect,
}: {
  viewer: VolumeViewer | null;
  hostRef: RefObject<HTMLDivElement | null>;
  views: ViewTab[];
  active: string;
  onSelect: (v: Layout) => void;
}) {
  const cells = views.filter((v) => v.key !== active); // the three remaining views
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Measure each square (relative to the canvas host) and hand the rects to the
  // viewer, which draws each view into its box every frame. The squares' positions
  // only change when the active view switches or the host resizes — not when the
  // slice moves — so this stays off the per-frame path (deps are `active`/`viewer`,
  // both stable across a slice drag; `views` is a module constant).
  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!viewer || !host) return;
    const report = () => {
      const host0 = host.getBoundingClientRect();
      const thumbs = views
        .filter((v) => v.key !== active)
        .map((v) => {
          const el = cellRefs.current.get(v.key);
          if (!el) return null;
          const r = el.getBoundingClientRect();
          return {
            kind: v.key,
            x: r.left - host0.left,
            y: r.top - host0.top,
            w: r.width,
            h: r.height,
          };
        })
        .filter((t): t is NonNullable<typeof t> => t !== null);
      viewer.setThumbnails(thumbs);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(host);
    window.addEventListener("resize", report);
    return () => {
      window.removeEventListener("resize", report);
      ro.disconnect();
      viewer.setThumbnails([]);
    };
  }, [viewer, hostRef, active, views]);

  return (
    <div className="thumb-strip">
      {cells.map((c) => (
        <button
          type="button"
          key={c.key}
          ref={(el) => {
            if (el) cellRefs.current.set(c.key, el);
            else cellRefs.current.delete(c.key);
          }}
          className="thumb-cell"
          aria-label={`Switch to ${c.label}`}
          onClick={() => onSelect(c.key)}
        >
          <span className="thumb-badge" style={{ color: ACCENT[c.key] }}>
            {SHORT[c.key] ?? c.label}
          </span>
        </button>
      ))}
    </div>
  );
}
