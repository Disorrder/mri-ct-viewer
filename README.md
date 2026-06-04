# DICOM / NIfTI volume viewer

An educational **WebGL2 volume viewer** for brain MRI / abdominal CT, built to
learn — by implementing it — how medical-imaging data formats actually work.

Stack: **Three.js (WebGL2) · React 19 · TypeScript · Vite · Leva**. No
parser libraries: the NIfTI-1 header and gzip are decoded by hand, on purpose,
for clarity.

> 🇷🇺 Исходная русская версия — [README.ru.md](README.ru.md).

## What it does

- Streams a `.nii.gz` volume, gunzips it in the browser with the native
  `DecompressionStream`, and parses the NIfTI-1 header + voxels **from scratch**.
- Uploads the voxels as a single-channel `R8` 3D texture and **ray-marches** it
  on the GPU — MIP, isosurface, and DVR — with orthogonal slice planes and an
  MPR ("radiologist's desktop") 2×2 layout.
- Surfaces every concept in the UI: the live-parsed 348-byte header, an
  intensity histogram, the window/level knob, a **real GPU-time** counter
  (WebGL2 timer query), and an anatomically-labelled orientation cube.
- Three sample datasets show MRI vs CT directly in the header: `uint8` 0…255 vs
  `int16` Hounsfield units.

Extras: drag-and-drop your own `.nii`/`.nii.gz`, a box cut-plane, window presets,
a PNG screenshot, cm rulers on the 2D views, and a phone layout (top-bar views +
swipe-up controls sheet).

## Quick start

```bash
npm install
npm run dev      # http://localhost:5173
```

The sample volumes in `public/*.nii.gz` are served as **raw bytes** by a small
Vite plugin (so the browser does not silently inflate the gzip and break the
download-progress accounting). See [docs/development.md](docs/development.md).

## Scripts

| Script | Purpose |
|--------|---------|
| `npm run dev` | Vite dev server with HMR. |
| `npm run build` | Type-check + production build. |
| `npm run test` / `test:run` | Vitest (watch / single run). |
| `npm run coverage` | Vitest + V8 coverage. |
| `npm run lint` / `check` | Biome lint / lint + format check. |
| `npm run format` | Biome format-write. |

## Project structure

```
src/
  App.tsx           # slim orchestrator: state, Leva schema, effects, JSX
  nifti/            # NIfTI-1 parsing — no DOM, no WebGL (types/header/decode/loader)
  rendering/        # Three.js / WebGL2: VolumeViewer, glsl shaders, colormaps, viewcube
  components/       # React UI: panels + overlays
  hooks/            # useMediaQuery, useVolumeLoader
  config/           # sample datasets + Leva-values -> ViewerParams mapping
  lib/              # pure, framework-free, unit-tested: ruler, format, gpu, layout
tests/              # Vitest suites, mirroring src/
docs/               # architecture, format spec, rendering, testing, development
```

Full details: [docs/architecture.md](docs/architecture.md).

## Learn the formats

The whole point of the project. Start with:

- **[docs/nifti-format.md](docs/nifti-format.md)** — the NIfTI-1 file format field
  by field (and the spec the parser tests verify). Code: [`src/nifti/`](src/nifti/).
- **[docs/rendering.md](docs/rendering.md)** — 3D textures, the volume
  ray-marcher, MPR, the orientation cube. Code: [`src/rendering/`](src/rendering/).
- **[docs/dicom-vs-nifti.md](docs/dicom-vs-nifti.md)** — why the same concepts
  (voxels, spacing, orientation, window, rescale) apply to DICOM.

## Tests & quality

Vitest + Testing Library, **77 tests**. Pure logic (parser, colormaps, ruler and
orientation math, formatters, control mapping) is covered exhaustively; React
components get jsdom smoke tests. The WebGL renderer is validated by hand, not in
jsdom — see [docs/testing.md](docs/testing.md). Linting/formatting via
[Biome](https://biomejs.dev).

## Honest simplifications

This is a learning demo, not clinical software:

- Rendering happens in **voxel-axis space**; the full world affine is shown in
  the UI but not baked into geometry (keeps the math transparent).
- Voxels are quantized to **8 bits** (lossless for the `uint8` samples; a
  deliberate simplification for `int16`/`float32`).
- Only the first volume of a 4-D series is read.

## Data & sources

Sample NIfTI volumes come from the **NiiVue** demo set
([niivue/niivue-demo-images](https://github.com/niivue/niivue-demo-images)) —
deliberately low resolution so they load fast:

- `chris_t1.nii.gz` — individual T1 head MRI (uint8).
- `mni152.nii.gz` — ICBM 152 template (averaged brain, uint8).
- `CT_Abdo.nii.gz` — abdominal CT (int16, Hounsfield units).

Format spec: <https://nifti.nimh.nih.gov/nifti-1>.
