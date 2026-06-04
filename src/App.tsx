import { button, folder, Leva, useControls } from "leva";
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { COLORMAPS, SLAB_PROJECTIONS, TECHNIQUES } from "./glsl";
import { IntensityPanel } from "./IntensityPanel";
import { loadNiftiFromUrl, type NiftiVolume, parseNifti } from "./nifti";
import { StatsPanel } from "./StatsPanel";
import {
  type Layout,
  PLANE_COLORS,
  type SlicePick,
  type ViewerParams,
  VolumeViewer,
} from "./VolumeViewer";

/** The sample volumes served from /public. */
const DATASETS: Record<string, { url: string; label: string }> = {
  chris_t1: { url: "/chris_t1.nii.gz", label: "MRI T1 — brain (uint8)" },
  mni152: { url: "/mni152.nii.gz", label: "MRI — MNI152 template (uint8)" },
  ct_abdo: { url: "/CT_Abdo.nii.gz", label: "CT — abdomen (int16, HU)" },
};

/** The four fullscreen views the phone top bar switches between. */
const SINGLE_PLANES = ["axial", "coronal", "sagittal"] as const;
type SinglePlane = (typeof SINGLE_PLANES)[number];
const isSinglePlane = (l: string): l is SinglePlane =>
  (SINGLE_PLANES as readonly string[]).includes(l);
/** Any 2D slice layout — MPR grid or one fullscreen plane (slice controls + crosshair apply). */
const isOrtho = (l: string) => l === "MPR" || isSinglePlane(l);
const PHONE_TABS: { key: Layout; label: string }[] = [
  { key: "3D", label: "3D" },
  { key: "axial", label: "Axial" },
  { key: "coronal", label: "Coronal" },
  { key: "sagittal", label: "Sagittal" },
];

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<VolumeViewer | null>(null);
  // Parsed volumes are cached, so a dataset is fetched at most once (lazy load).
  const cacheRef = useRef<Map<string, NiftiVolume>>(new Map());
  const volumeRef = useRef<NiftiVolume | null>(null); // current volume, for Leva button closures
  const draggingRef = useRef(false); // pointer drag state for MPR crosshair
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const lockAxisRef = useRef<"h" | "v" | null>(null); // Shift-locked axis during a drag
  const [viewer, setViewer] = useState<VolumeViewer | null>(null);
  const [volume, setVolume] = useState<NiftiVolume | null>(null);
  const [progress, setProgress] = useState<{ fraction: number; label: string } | null>({
    fraction: 0,
    label: "connecting",
  });
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 700px)").matches,
  );
  // Narrow phones get the top-bar + bottom-sheet layout (the Leva panel moves
  // into a swipe-up sheet; views switch from the top bar instead of `layout`).
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(max-width: 500px)").matches,
  );
  const [sheetOpen, setSheetOpen] = useState(false);

  const [params, set, get] = useControls(
    () => ({
      dataset: {
        value: "chris_t1",
        options: Object.fromEntries(Object.entries(DATASETS).map(([k, v]) => [v.label, k])),
      },
      layout: {
        value: "3D",
        // On phones the top bar is the view switcher, so this control is hidden —
        // but it still holds the value (single planes included) the rest of the UI reads.
        options: isPhone ? ["3D", "axial", "coronal", "sagittal"] : ["3D", "MPR"],
        render: () => !isPhone,
      },
      mode: {
        value: "Volume",
        options: ["Volume", "Slices"],
        render: (get) => get("layout") === "3D",
      },
      // Volume controls (also drive the 3D quadrant in MPR). iso → Isosurface, density → DVR.
      "3D render": folder(
        {
          technique: { value: "DVR", options: [...TECHNIQUES] },
          steps: { value: 256, min: 32, max: 512, step: 32 },
          iso: {
            value: 0.32,
            min: 0,
            max: 1,
            step: 0.01,
            hint: "isosurface threshold",
            render: (get) => get("3D render.technique") === "Isosurface",
          },
          density: {
            value: 0.4,
            min: 0.02,
            max: 2,
            step: 0.02,
            hint: "DVR opacity",
            render: (get) => get("3D render.technique") === "DVR",
          },
        },
        {
          render: (get) =>
            get("layout") === "MPR" || (get("layout") === "3D" && get("mode") === "Volume"),
        },
      ),
      colormap: { value: "gray", options: [...COLORMAPS] },
      "window / level": folder({
        // A two-thumb interval slider: low/high in one range, like the clip ranges.
        window: {
          value: [0.1, 0.85] as [number, number],
          min: 0,
          max: 1,
          step: 0.005,
          label: "range",
        },
        "auto (data)": button(() => {
          const v = volumeRef.current;
          if (v)
            set({ window: [+v.suggestedWindow[0].toFixed(3), +v.suggestedWindow[1].toFixed(3)] });
        }),
        "full range": button(() => set({ window: [0, 1] })),
        "high contrast": button(() => set({ window: [0.2, 0.55] })),
      }),
      // Slices-only controls.
      slices: folder(
        {
          sliceX: { value: 0.5, min: 0, max: 1, step: 0.004, label: "sagittal (X)" },
          sliceY: { value: 0.5, min: 0, max: 1, step: 0.004, label: "coronal (Y)" },
          sliceZ: { value: 0.5, min: 0, max: 1, step: 0.004, label: "axial (Z)" },
          thickness: {
            value: 1,
            min: 1,
            max: 20,
            step: 0.5,
            label: "thickness (mm)",
            hint: "slab thickness",
          },
          slabMode: {
            value: "mean",
            options: [...SLAB_PROJECTIONS],
            label: "slab projection",
            render: (get) => get("slices.thickness") > 1, // irrelevant at 1 voxel
          },
          showX: { value: true, label: "show sagittal", render: (get) => get("layout") === "3D" },
          showY: { value: true, label: "show coronal", render: (get) => get("layout") === "3D" },
          showZ: { value: true, label: "show axial", render: (get) => get("layout") === "3D" },
        },
        {
          render: (get) =>
            isOrtho(get("layout")) || (get("layout") === "3D" && get("mode") === "Slices"),
        },
      ),
      // Cut plane (Volume mode). Axis/position/flip appear only once enabled.
      clip: folder(
        {
          clipEnabled: { value: false, label: "enable cut" },
          // A two-thumb interval slider per axis -> a 3D crop box.
          clipX: {
            value: [0.15, 0.85] as [number, number],
            min: 0,
            max: 1,
            step: 0.004,
            label: "X range",
            render: (get) => get("clip.clipEnabled"),
          },
          clipY: {
            value: [0.15, 0.85] as [number, number],
            min: 0,
            max: 1,
            step: 0.004,
            label: "Y range",
            render: (get) => get("clip.clipEnabled"),
          },
          clipZ: {
            value: [0.15, 0.85] as [number, number],
            min: 0,
            max: 1,
            step: 0.004,
            label: "Z range",
            render: (get) => get("clip.clipEnabled"),
          },
          clipInvert: {
            value: false,
            label: "invert (cut out)",
            render: (get) => get("clip.clipEnabled"),
          },
        },
        {
          render: (get) =>
            get("layout") === "MPR" || (get("layout") === "3D" && get("mode") === "Volume"),
        },
      ),
      scene: folder({
        autoRotate: false,
        background: "#0a0c11",
        "reset view": button(() => viewerRef.current?.resetView()),
        screenshot: button(() => {
          const url = viewerRef.current?.screenshot();
          if (!url) return;
          const a = document.createElement("a");
          a.href = url;
          a.download = "nifti-view.png";
          a.click();
        }),
      }),
      // Ruler toggle — applies to every 2D layout (MPR grid + single planes).
      other: folder(
        {
          showRuler: { value: true, label: "rulers" },
        },
        { render: (get) => isOrtho(get("layout")) },
      ),
    }),
    [isPhone],
  );

  // Build the scene for a parsed volume + reset the window to its auto value.
  const applyVolume = useCallback(
    (vol: NiftiVolume) => {
      viewerRef.current?.setVolume(vol);
      volumeRef.current = vol;
      setVolume(vol);
      set({
        window: [+vol.suggestedWindow[0].toFixed(3), +vol.suggestedWindow[1].toFixed(3)],
      });
    },
    [set],
  );

  // Load a user-dropped .nii / .nii.gz (our parser already takes an ArrayBuffer).
  const loadLocalFile = useCallback(
    async (file: File) => {
      try {
        setError(null);
        setProgress({ fraction: 0.25, label: `reading ${file.name}` });
        const buf = await file.arrayBuffer();
        setProgress({ fraction: 0.6, label: `parsing ${file.name}` });
        const vol = await parseNifti(buf);
        setProgress({ fraction: 0.97, label: "building scene" });
        await new Promise((r) => requestAnimationFrame(r));
        applyVolume(vol);
        setProgress({ fraction: 1, label: "ready" });
        setTimeout(() => setProgress(null), 280);
      } catch (e) {
        setError(`${file.name}: ${e}`);
        setProgress(null);
      }
    },
    [applyVolume],
  );

  // --- Create the Three.js viewer once.
  useEffect(() => {
    if (!mountRef.current) return;
    const v = new VolumeViewer(mountRef.current);
    viewerRef.current = v;
    setViewer(v);
    return () => {
      v.dispose();
      viewerRef.current = null;
      setViewer(null);
    };
  }, []);

  // --- Lazily fetch + parse the selected dataset (cached after first load),
  //     reporting download/decompress/parse/scene-build progress as we go.
  useEffect(() => {
    let cancelled = false;
    const ds = DATASETS[params.dataset];

    (async () => {
      const cached = cacheRef.current.get(params.dataset);
      if (cached) {
        setError(null);
        applyVolume(cached); // instant — no fetch, no progress bar
        setProgress(null);
        return;
      }
      try {
        setError(null);
        setProgress({ fraction: 0, label: "connecting" });
        const vol = await loadNiftiFromUrl(ds.url, (p) => {
          if (cancelled) return;
          const mb = (b: number) => (b / 1048576).toFixed(1);
          const label =
            p.phase === "download"
              ? p.total
                ? `downloading  ${mb(p.loaded)} / ${mb(p.total)} MB`
                : `downloading  ${mb(p.loaded)} MB`
              : p.phase === "decompress"
                ? "decompressing (gunzip)"
                : "parsing header + voxels";
          setProgress({ fraction: p.fraction, label });
        });
        if (cancelled) return;
        cacheRef.current.set(params.dataset, vol);
        setProgress({ fraction: 0.97, label: "building scene (GPU upload)" });
        await new Promise((r) => requestAnimationFrame(r)); // let 97% paint first
        if (cancelled) return;
        applyVolume(vol);
        setProgress({ fraction: 1, label: "ready" });
        setTimeout(() => !cancelled && setProgress(null), 280);
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        setProgress(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [params.dataset, applyVolume]);

  // --- Dev-only handles so the scene can be poked from the console.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__leva = set;
      (window as unknown as Record<string, unknown>).__viewer = () => viewerRef.current;
    }
  }, [set]);

  // --- Collapse the controls panel by default on phones.
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 700px)");
    const onChange = () => setIsMobile(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // --- Track the phone breakpoint (top bar + bottom sheet). Leaving phone width
  //     while on a single-plane view drops back to 3D ("MPR" is the desktop grid).
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 500px)");
    const onChange = () => {
      setIsPhone(mq.matches);
      if (!mq.matches) {
        setSheetOpen(false);
        if (isSinglePlane(get("layout") as string)) set({ layout: "3D" });
      }
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [set, get]);

  // --- Push every control change into the viewer.
  useEffect(() => {
    const mapped: ViewerParams = {
      layout: params.layout as ViewerParams["layout"],
      mode: params.mode as ViewerParams["mode"],
      technique: TECHNIQUES.indexOf(params.technique as (typeof TECHNIQUES)[number]),
      colormap: COLORMAPS.indexOf(params.colormap as (typeof COLORMAPS)[number]),
      steps: params.steps,
      windowLow: (params.window as number[])[0],
      windowHigh: (params.window as number[])[1],
      iso: params.iso,
      density: params.density,
      sliceX: params.sliceX,
      sliceY: params.sliceY,
      sliceZ: params.sliceZ,
      showX: params.showX,
      showY: params.showY,
      showZ: params.showZ,
      clipEnabled: params.clipEnabled,
      clipMin: [
        (params.clipX as number[])[0],
        (params.clipY as number[])[0],
        (params.clipZ as number[])[0],
      ],
      clipMax: [
        (params.clipX as number[])[1],
        (params.clipY as number[])[1],
        (params.clipZ as number[])[1],
      ],
      clipInvert: params.clipInvert,
      thickness: params.thickness,
      slabProjection: SLAB_PROJECTIONS.indexOf(
        params.slabMode as (typeof SLAB_PROJECTIONS)[number],
      ),
      autoRotate: params.autoRotate,
      background: params.background,
    };
    viewerRef.current?.applyParams(mapped);
  }, [params]);

  return (
    <>
      {/* Desktop: the usual fixed Leva panel. Phones get it in the bottom sheet below. */}
      {!isPhone && <Leva collapsed={isMobile} />}
      <div
        className="app"
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragActive) setDragActive(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragActive(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const f = e.dataTransfer.files?.[0];
          if (f) loadLocalFile(f);
        }}
      >
        <div
          className="canvas-host"
          ref={mountRef}
          onPointerDown={(e) => {
            if (!isOrtho(params.layout)) return;
            const pick = viewerRef.current?.pickSlice(e.clientX, e.clientY);
            if (pick) {
              draggingRef.current = true;
              dragStartRef.current = { x: e.clientX, y: e.clientY };
              lockAxisRef.current = null;
              set(pick.updates);
              try {
                e.currentTarget.setPointerCapture(e.pointerId);
              } catch {
                /* pointer capture is best-effort */
              }
            }
          }}
          onPointerMove={(e) => {
            if (!draggingRef.current) return;
            const pick = viewerRef.current?.pickSlice(e.clientX, e.clientY);
            if (!pick) return;
            if (e.shiftKey) {
              // Shift locks the crosshair to one axis, picked by the dominant drag delta.
              const start = dragStartRef.current;
              if (lockAxisRef.current === null && start) {
                const dx = Math.abs(e.clientX - start.x);
                const dy = Math.abs(e.clientY - start.y);
                if (Math.max(dx, dy) < 4) return; // wait until the direction is clear
                lockAxisRef.current = dx >= dy ? "h" : "v";
              }
              const key = lockAxisRef.current === "v" ? pick.verticalKey : pick.horizontalKey;
              const val = pick.updates[key];
              if (val !== undefined) set({ [key]: val } as SlicePick["updates"]);
            } else {
              lockAxisRef.current = null; // Shift released → free movement again
              set(pick.updates);
            }
          }}
          onPointerUp={() => {
            draggingRef.current = false;
            dragStartRef.current = null;
            lockAxisRef.current = null;
          }}
          onPointerCancel={() => {
            draggingRef.current = false;
            dragStartRef.current = null;
            lockAxisRef.current = null;
          }}
        />
        {isPhone && <MobileTopBar active={params.layout} onSelect={(v) => set({ layout: v })} />}
        {volume && params.layout === "3D" && <InfoPanel volume={volume} mode={params.mode} />}
        {volume && viewer && params.layout === "MPR" && (
          <MprOverlay
            viewer={viewer}
            volume={volume}
            sliceX={params.sliceX}
            sliceY={params.sliceY}
            sliceZ={params.sliceZ}
            showRuler={params.showRuler}
          />
        )}
        {volume && viewer && isSinglePlane(params.layout) && (
          <SinglePlaneOverlay
            viewer={viewer}
            volume={volume}
            plane={params.layout}
            sliceX={params.sliceX}
            sliceY={params.sliceY}
            sliceZ={params.sliceZ}
            showRuler={params.showRuler}
          />
        )}
        {viewer && <StatsPanel viewer={viewer} />}
        {volume && !progress && params.layout === "3D" && (
          <IntensityPanel
            volume={volume}
            low={(params.window as number[])[0]}
            high={(params.window as number[])[1]}
            colormap={COLORMAPS.indexOf(params.colormap as (typeof COLORMAPS)[number])}
          />
        )}
        {progress && <LoadBar fraction={progress.fraction} label={progress.label} />}
        {error && <div className="status error">{error}</div>}
        {dragActive && (
          <div className="drop-overlay">
            <div className="drop-card">
              Drop a <b>.nii</b> / <b>.nii.gz</b> file to load it
            </div>
          </div>
        )}
        {isPhone && (
          <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <Leva fill flat titleBar={false} />
          </BottomSheet>
        )}
      </div>
    </>
  );
}

/** Phone-only top bar: switch between the four fullscreen views. */
function MobileTopBar({ active, onSelect }: { active: string; onSelect: (v: Layout) => void }) {
  return (
    <div className="topbar">
      {PHONE_TABS.map((t) => (
        <button
          type="button"
          key={t.key}
          className={`topbar-tab${active === t.key ? " active" : ""}`}
          onClick={() => onSelect(t.key)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Phone-only bottom sheet that holds the Leva panel. A peek handle stays above
 * the bottom edge; tap it or swipe it up to reveal the controls, swipe down (or
 * tap the backdrop) to dismiss. The sheet follows the finger 1:1 while dragging,
 * then snaps to open/closed on release based on how far it traveled.
 */
const SHEET_PEEK = 40; // px of the handle left visible when closed
function BottomSheet({
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

/**
 * MPR overlay: colored viewport titles + slice indices, plus a live cm ruler on
 * the right edge of each 2D viewport. Layout matches a dental CBCT viewer —
 * TL coronal, TR sagittal, BL axial, BR 3D. The ruler polls the viewer each
 * frame so it stays correct while wheel-zooming the 2D views.
 */
function MprOverlay({
  viewer,
  volume,
  sliceX,
  sliceY,
  sliceZ,
  showRuler,
}: {
  viewer: VolumeViewer;
  volume: NiftiVolume;
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

/**
 * Phone single-plane overlay: one orthogonal view filling the screen. Shows the
 * plane label + slice index and an L-shaped cm ruler on the right + bottom edges
 * (the desktop MPR ruler, scaled up to the whole screen). The ruler polls the
 * viewer each frame so it stays correct while pinch/scroll-zooming.
 */
function SinglePlaneOverlay({
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
function drawRuler(
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

/** Determinate progress bar shown while a dataset is loading / building. */
function LoadBar({ fraction, label }: { fraction: number; label: string }) {
  return (
    <div className="loader">
      <div className="loader-row">
        <span className="loader-label">{label}</span>
        <span className="loader-pct">{Math.round(fraction * 100)}%</span>
      </div>
      <div className="loader-track">
        <div className="loader-fill" style={{ width: `${Math.max(3, fraction * 100)}%` }} />
      </div>
    </div>
  );
}

function InfoPanel({ volume, mode }: { volume: NiftiVolume; mode: string }) {
  const h = volume.header;
  const fmt = (n: number) =>
    Math.abs(n) >= 1000 || (n !== 0 && Math.abs(n) < 0.01) ? n.toExponential(2) : +n.toFixed(3);
  return (
    <div className="info">
      <h1>NIfTI-1 header</h1>
      <p className="sub">
        What a medical volume actually is — parsed live from the 348-byte header.
      </p>
      <dl>
        <Row k="magic" v={`"${h.magic}"  (single-file .nii)`} />
        <Row k="dimensions" v={`${volume.nx} × ${volume.ny} × ${volume.nz} voxels`} />
        <Row k="datatype" v={`${h.datatype} (${h.bitpix}-bit), code ${h.datatypeCode}`} />
        <Row
          k="voxel spacing"
          v={`${fmt(h.pixdim[1])} × ${fmt(h.pixdim[2])} × ${fmt(h.pixdim[3])} ${h.xyzUnits}`}
        />
        <Row k="scl_slope / inter" v={`${fmt(h.sclSlope)} / ${fmt(h.sclInter)}`} />
        <Row k="display range" v={`${fmt(volume.displayMin)} … ${fmt(volume.displayMax)}`} />
        <Row k="vox_offset" v={`${h.voxOffset} bytes`} />
        <Row k="endianness" v={h.littleEndian ? "little" : "big"} />
        <Row k="orientation" v={`qform=${h.qformCode}, sform=${h.sformCode}`} />
      </dl>
      <div className="affine">
        <div className="affine-title">voxel → world affine (mm, RAS)</div>
        <table>
          <tbody>
            {h.affine.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static 4x4 affine, never reordered
              <tr key={i}>
                {row.map((c, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static row, never reordered
                  <td key={j}>{fmt(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {mode === "Volume"
          ? "Drag to orbit · scroll to zoom. The cube is the whole scan; the ray-marcher walks through every voxel."
          : "The three planes are orthogonal cuts (sagittal / coronal / axial) — the way clinicians actually read scans."}
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
