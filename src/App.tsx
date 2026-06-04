import { button, folder, Leva, useControls } from "leva";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  BottomSheet,
  DropOverlay,
  InfoPanel,
  IntensityPanel,
  LoadBar,
  MobileTopBar,
  MprOverlay,
  SinglePlaneOverlay,
  StatsPanel,
} from "./components";
import { toViewerParams } from "./config/controls";
import { DATASETS } from "./config/datasets";
import { useMediaQuery } from "./hooks/useMediaQuery";
import { useVolumeLoader } from "./hooks/useVolumeLoader";
import { isOrtho, isSinglePlane } from "./lib/layout";
import type { NiftiVolume } from "./nifti";
import { COLORMAPS, SLAB_PROJECTIONS, type SlicePick, TECHNIQUES, VolumeViewer } from "./rendering";

export default function App() {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<VolumeViewer | null>(null);
  const volumeRef = useRef<NiftiVolume | null>(null); // current volume, for Leva button closures
  const draggingRef = useRef(false); // pointer drag state for MPR crosshair
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const lockAxisRef = useRef<"h" | "v" | null>(null); // Shift-locked axis during a drag
  const [viewer, setViewer] = useState<VolumeViewer | null>(null);
  const [volume, setVolume] = useState<NiftiVolume | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  // Tablets (≤ 700px) start with the Leva panel collapsed; narrow phones (< 500px)
  // switch to the top-bar + bottom-sheet layout (controls move into a swipe-up sheet).
  const isMobile = useMediaQuery("(max-width: 700px)");
  const isPhone = useMediaQuery("(max-width: 500px)");

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

  // Dataset loading (fetch + parse + cache + progress) and drag-and-drop live in
  // a hook; applyVolume is the sink it calls for every parsed volume.
  const { progress, error, loadFile } = useVolumeLoader(params.dataset, applyVolume);

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

  // --- Dev-only handles so the scene can be poked from the console.
  useEffect(() => {
    if (import.meta.env.DEV) {
      (window as unknown as Record<string, unknown>).__leva = set;
      (window as unknown as Record<string, unknown>).__viewer = () => viewerRef.current;
    }
  }, [set]);

  // --- Leaving phone width while on a single-plane view drops back to 3D ("MPR"
  //     is the desktop grid) and closes the bottom sheet.
  useEffect(() => {
    if (!isPhone) {
      setSheetOpen(false);
      if (isSinglePlane(get("layout") as string)) set({ layout: "3D" });
    }
  }, [isPhone, set, get]);

  // --- Push every control change into the viewer.
  useEffect(() => {
    viewerRef.current?.applyParams(toViewerParams(params));
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
          if (f) loadFile(f);
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
        {dragActive && <DropOverlay />}
        {isPhone && (
          <BottomSheet open={sheetOpen} onOpenChange={setSheetOpen}>
            <Leva fill flat titleBar={false} />
          </BottomSheet>
        )}
      </div>
    </>
  );
}
