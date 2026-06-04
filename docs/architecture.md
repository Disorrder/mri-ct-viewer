# Architecture

The app has three concerns, kept deliberately separate:

1. **Parsing** — turn `.nii.gz` bytes into a `NiftiVolume` (header + an 8-bit
   3D texture + histogram). Pure data, zero DOM, zero WebGL.
2. **Rendering** — turn a `NiftiVolume` into pixels with Three.js / WebGL2.
   Imperative Three.js wrapped in one `VolumeViewer` class.
3. **UI** — React + Leva: controls, overlays, panels, and the glue that pushes
   control changes into the viewer.

Pure, framework-free logic (number formatting, ruler tick math, orientation
math) lives in `lib/` so it can be unit-tested without a browser.

## Directory tree

```
src/
  main.tsx                 # React entry point
  App.tsx                  # top-level orchestrator (slim)
  vite-env.d.ts

  nifti/                   # format parsing — no DOM, no WebGL
    index.ts               #   public surface (re-exports)
    types.ts               #   NiftiHeader, NiftiVolume, LoadProgress, LoadPhase
    datatypes.ts           #   datatype-code and spatial-unit lookup tables
    header.ts              #   parseHeader: 348-byte struct -> NiftiHeader (+ affine)
    decode.ts              #   readVoxels, maybeGunzip, parse -> NiftiVolume
    loader.ts              #   loadNiftiFromUrl: streaming fetch + progress

  rendering/               # everything Three.js / WebGL2
    index.ts               #   public surface (VolumeViewer, types, PLANE_COLORS)
    VolumeViewer.ts        #   the renderer class
    glsl.ts                #   GLSL shaders + colormap/technique name tables
    colormaps.ts           #   colormapRGB: JS port of the GLSL colormaps
    viewcube.ts            #   orientation-cube geometry + affine -> face labels

  components/              # React presentation
    InfoPanel.tsx          #   live NIfTI-header readout
    ScenePerf.tsx          #   FPS / CPU / GPU / RAM perf overlay (compact + full)
    IntensityPanel.tsx     #   histogram + colorbar legend
    LoadBar.tsx            #   determinate progress bar
    DropOverlay.tsx        #   drag-and-drop hint
    MobileTopBar.tsx       #   phone view switcher
    BottomSheet.tsx        #   phone controls sheet
    MprOverlay.tsx         #   2x2 MPR titles + cm rulers
    SinglePlaneOverlay.tsx #   fullscreen single-plane title + ruler

  hooks/
    useMediaQuery.ts       #   reactive matchMedia
    useVolumeLoader.ts     #   fetch/parse/cache a dataset, report progress

  config/
    datasets.ts            #   the bundled sample volumes
    controls.ts            #   the Leva control schema + param mapping

  lib/                     # pure, framework-free, unit-tested
    ruler.ts               #   nice cm steps, tick scheme, cm formatting, drawRuler
    format.ts              #   compact number formatting for the panels
    gpu.ts                 #   GPU-name shortening + FPS color thresholds
    layout.ts              #   single-plane predicates + phone view tabs
```

## Data flow

```
        loadNiftiFromUrl(url)                parseNifti(arrayBuffer)
   (streaming fetch + progress)              (drag-and-dropped file)
                  │                                   │
                  ▼                                   ▼
            maybeGunzip ──► parseHeader ──► readVoxels ──► quantize + histogram
                                                            │
                                                            ▼
                                                       NiftiVolume
                                                            │
                       ┌────────────────────────────────────┼─────────────────────┐
                       ▼                                    ▼                       ▼
              VolumeViewer.setVolume               InfoPanel (header)      IntensityPanel
              (R8 Data3DTexture, box,              live readout            (histogram + colorbar)
               slice planes, viewcube)
                       ▲
                       │ applyParams(ViewerParams)
                       │
            Leva controls ──► config/controls mapping ──► App effect
```

`App.tsx` owns the wiring: it instantiates one `VolumeViewer`, drives dataset
loading through `useVolumeLoader`, builds the Leva control schema from
`config/controls`, maps those control values to a `ViewerParams` object, and
pushes them into the viewer on every change. Pointer events over the canvas are
routed to `viewer.pickSlice(...)` to move the MPR crosshair.

## Coordinate convention

Rendering happens in **voxel-axis space**: the volume's `i/j/k` axes map to the
box's `X/Y/Z`. The full voxel→world (RAS) affine from the header is shown in the
UI but **not** baked into geometry, so the math stays transparent. The camera
"up" is `+Z` because for these brain scans the `k` axis is superior (top of
head). See [rendering.md](rendering.md) for details.
