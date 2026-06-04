# Testing strategy

Test runner: **Vitest**. Component tests use **@testing-library/react** under
**jsdom**. Run them with:

```bash
npm test            # watch mode
npm run test:run    # single run (CI)
npm run coverage    # single run + V8 coverage report
```

Tests live in `tests/`, mirroring `src/`.

## The guiding principle

Test the logic that has a right answer; do not fake the things that need a real
GPU. Concretely, three tiers:

### 1. Pure logic — unit-tested exhaustively

These have deterministic inputs and outputs and zero environment dependencies.
This is where coverage is comprehensive:

- `nifti/` — the parser. Tests build **synthetic NIfTI buffers** byte by byte
  (a small `DataView` helper) and assert on the parsed header, endianness
  detection, the affine for all three orientation methods (sform / qform /
  fallback), datatype dispatch for every supported code, the quantized texture,
  the histogram, and the 1st–99th-percentile suggested window. `maybeGunzip` is
  tested round-trip with `CompressionStream`, and `loadNiftiFromUrl` with a
  mocked `fetch` (including streamed progress callbacks).
- `rendering/colormaps.ts` — `colormapRGB` for all five maps: endpoints,
  clamping, monotonicity where expected, and **parity** with the GLSL source
  (the polynomial coefficients are duplicated and must not drift).
- `rendering/viewcube.ts` — `faceLabelsFromAffine` / `axisAnatomy` for identity,
  flipped, and permuted affines; `triNormal`; facet counts of the generated
  geometry.
- `lib/ruler.ts` — `niceCmStep`, `rulerScheme`, `fmtCm`: the 1/2/5 tick ladder,
  decimal precision, and zoom-dependent subdivision.
- `lib/format.ts`, `lib/gpu.ts` — number formatting, GPU-name shortening, FPS
  color thresholds.

### 2. React components — smoke-tested

Presentational components are rendered in jsdom and asserted on their DOM output
(labels, values, structure) — not their pixels. Canvas-drawing components are
checked for "mounts and draws without throwing" with a stubbed 2D context;
components that take a `VolumeViewer` get a lightweight stub object, never a real
WebGL context.

Examples: `LoadBar` shows the rounded percentage; `InfoPanel` renders the header
rows and the 4×4 affine; `MobileTopBar` highlights the active tab and fires
`onSelect`.

### 3. Out of scope (and why)

- **Pixel-accurate WebGL output** — needs a real GPU; jsdom has no WebGL2. The
  shaders are validated by eye and by the colormap-parity test, not by
  rendering. (A browser-based E2E layer with Playwright is the natural place to
  add this later, if ever.)
- **OrbitControls / pointer-driven camera orbit** — interaction wiring that only
  means anything against a live renderer.

## Adding a test

Mirror the source path under `tests/` and name it `*.test.ts(x)`. Pure-logic
modules should be importable with no side effects — keep DOM/WebGL access behind
the `VolumeViewer` class and React components, never in `lib/`, `nifti/`, or the
non-component parts of `rendering/`.
