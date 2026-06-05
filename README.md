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

## Demo reel

A hands-free feature tour drives every control on a timeline (handy for
screen-recording). Trigger it with `/?demo` in the URL, `Shift+D`, or `__demo()`
in the console.

It ships only when the **`VITE_INCLUDE_DEMO_SCRIPT`** env var is set to `"true"`
— **off by default everywhere** (dev and prod alike), so a normal build omits it
and `/?demo` does nothing. When unset the reel chunk is tree-shaken out entirely;
when enabled it is emitted as a separate lazy chunk that loads only once the demo
is triggered.

Enable it through any of Vite's env sources — locally via a `.env*` file:

```bash
# .env.development.local  (or .env.local)
VITE_INCLUDE_DEMO_SCRIPT=true
```

…or for a one-off build / CI:

```bash
VITE_INCLUDE_DEMO_SCRIPT=true npm run build
```

On Vercel, add `VITE_INCLUDE_DEMO_SCRIPT=true` to the project's environment
variables (so `/?demo` works on the deploy).

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

The bundled samples are already in `public/` — nothing to download to run the
demo. The links below are where each one comes from, if you want the originals
or to swap in full-resolution data.

### NIfTI

From the **NiiVue** demo set
([niivue/niivue-demo-images](https://github.com/niivue/niivue-demo-images),
licence in the repo) — deliberately low resolution so they load fast:

| File | What | Download |
|------|------|----------|
| `nifti-mri-brain/chris_t1.nii.gz` | individual T1 head MRI (uint8) | [raw](https://github.com/niivue/niivue-demo-images/raw/main/chris_t1.nii.gz) |
| `nifti-mri-mni152/mni152.nii.gz` | ICBM 152 template, averaged brain (uint8) | [raw](https://github.com/niivue/niivue-demo-images/raw/main/mni152.nii.gz) |
| `nifti-ct-abdomen/CT_Abdo.nii.gz` | abdominal CT (int16, Hounsfield units) | [raw](https://github.com/niivue/niivue-demo-images/raw/main/CT_Abdo.nii.gz) |

Format spec: <https://nifti.nimh.nih.gov/nifti-1>.

### DICOM

`dicom-ct-dental/` — a real dental cone-beam CT (Imaging Sciences International
**i-CAT**), from the **Medimodel** free sample library, "Class 3 malocclusion"
(anonymised, free for education and research):

<https://medimodel.com/sample-dicom-files/class-3-malocclusion/>

The original is 518 slices of JPEG-compressed DICOM (~425 MB) which this viewer
can't read. The bundled copy is a trimmed, decompressed, downsampled preview
(80 slices, 256×256, ~10 MB) prepared with
[`scripts/prep-icat-sample.py`](scripts/prep-icat-sample.py). Provenance and the
exact steps to regenerate it: [`public/dicom-ct-dental/SOURCE.md`](public/dicom-ct-dental/SOURCE.md).
