import type { SinglePlane } from "../lib/layout";
import { PLANE_COLORS } from "../rendering";

// The through-plane axis of each single-plane view — the one the main slice moves
// along. Sliding the scrubber drives this slice fraction (the depth into the stack).
const AXIS: Record<SinglePlane, { key: "sliceX" | "sliceY" | "sliceZ"; letter: string }> = {
  axial: { key: "sliceZ", letter: "Z" },
  coronal: { key: "sliceY", letter: "Y" },
  sagittal: { key: "sliceX", letter: "X" },
};

/**
 * Phone single-plane scrubber: a vertical slider pinned to the left edge that
 * moves the slice through its third (depth) axis — the one you can't drag on the
 * plane itself — so you don't have to open the bottom sheet for it. Top = far end
 * of the stack; the ruler lives on the right, so this sits clear of it.
 */
export function SliceScrubber({
  plane,
  value,
  onChange,
}: {
  plane: SinglePlane;
  value: number;
  onChange: (frac: number) => void;
}) {
  const axis = AXIS[plane];
  const color = PLANE_COLORS[plane];
  return (
    <div className="slice-scrubber">
      <span className="slice-scrubber-axis" style={{ color }}>
        {axis.letter}
      </span>
      <input
        type="range"
        className="slice-scrubber-range"
        min={0}
        max={1}
        step={0.004}
        value={value}
        aria-label={`${plane} slice (${axis.letter} axis)`}
        style={{ accentColor: color }}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}
