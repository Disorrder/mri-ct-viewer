import { type ReactNode, type PointerEvent as ReactPointerEvent, useRef, useState } from "react";

/**
 * Phone-only bottom sheet that holds the Leva panel. A peek handle stays above
 * the bottom edge; tap it or swipe it up to reveal the controls, swipe down (or
 * tap the backdrop) to dismiss. The sheet follows the finger 1:1 while dragging,
 * then snaps to open/closed on release based on how far it traveled.
 */
const SHEET_PEEK = 40; // px of the handle left visible when closed

export function BottomSheet({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
}) {
  const sheetRef = useRef<HTMLDivElement>(null);
  // `last`/`moved` live in the ref so endDrag sees the final position synchronously
  // (state is async) and can tell a tap from a swipe without a separate click handler.
  const dragRef = useRef<{
    startY: number;
    height: number;
    base: number;
    last: number;
    moved: boolean;
  } | null>(null);
  const [dragY, setDragY] = useState<number | null>(null); // live translateY (px) during a drag
  const TAP_SLOP = 6; // movement under this is a tap, not a drag

  const onPointerDown = (e: ReactPointerEvent) => {
    const height = sheetRef.current?.getBoundingClientRect().height ?? 0;
    const base = open ? 0 : Math.max(0, height - SHEET_PEEK);
    dragRef.current = { startY: e.clientY, height, base, last: base, moved: false };
    setDragY(base);
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer capture is best-effort */
    }
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const max = Math.max(0, d.height - SHEET_PEEK);
    if (Math.abs(e.clientY - d.startY) > TAP_SLOP) d.moved = true;
    d.last = Math.min(max, Math.max(0, d.base + (e.clientY - d.startY)));
    setDragY(d.last);
  };
  const endDrag = () => {
    const d = dragRef.current;
    if (!d) return;
    const max = Math.max(0, d.height - SHEET_PEEK);
    dragRef.current = null;
    setDragY(null);
    if (!d.moved)
      onOpenChange(!open); // a tap toggles
    else onOpenChange(d.last < max / 2); // a swipe snaps by where it ended up
  };

  // While dragging we drive translateY directly (no transition); otherwise CSS
  // animates between the open (0) and closed (peek) rest positions.
  const dragging = dragY !== null;
  const translateY = dragging ? `${dragY}px` : open ? "0px" : `calc(100% - ${SHEET_PEEK}px)`;

  return (
    <>
      <div
        className={`sheet-backdrop${open ? " visible" : ""}`}
        onClick={() => onOpenChange(false)}
      />
      <div
        ref={sheetRef}
        className={`sheet${dragging ? " dragging" : ""}`}
        style={{ transform: `translateY(${translateY})` }}
      >
        <div
          className="sheet-handle"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
        >
          <div className="sheet-grip" />
          <span className="sheet-title">controls</span>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </>
  );
}
