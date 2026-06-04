# AGENTS.md

Guidance for AI coding agents working in this repository. Humans: see
[README.md](README.md) and [docs/](docs/).

## What this is

An educational WebGL2 NIfTI/DICOM volume viewer (Three.js · React 19 ·
TypeScript · Vite · Leva). It is a **learning tool**, not clinical software.
Clarity of the data-format and rendering code is the primary goal — prefer
readable, well-commented code over cleverness.

## Commands

```bash
npm install            # if ~/.npm is not writable, add: --cache ./.npm-cache
npm run typecheck      # tsc --noEmit (covers src + tests)
npm run test:run       # Vitest, single run
npm run check          # Biome lint + format check
npm run build          # tsc + vite build
```

Before finishing a change, the gate is: **`npm run check && npm run typecheck &&
npm run test:run`** (and `npm run build` for anything non-trivial). Keep all of
them green in every commit.

## Architecture & boundaries

See [docs/architecture.md](docs/architecture.md) for the full tree. The layering
is deliberate — respect it:

- `src/nifti/`, `src/lib/` — **pure**. No DOM, no WebGL, no React. Importing them
  must have no side effects. This is what makes them unit-testable; keep it that
  way.
- `src/rendering/` — all Three.js / WebGL2, behind the `VolumeViewer` class.
  `viewcube.ts`, `glsl.ts`, `colormaps.ts` hold the pieces; pure geometry/affine
  math lives in `viewcube.ts` so it can be tested without a GL context.
- `src/components/` — React presentation. `src/hooks/`, `src/config/` — glue and
  data.

## Invariants (don't break these)

- **Colormap parity.** The five colormaps exist twice: GLSL in
  `rendering/glsl.ts` (`COMMON`) and JS in `rendering/colormaps.ts`
  (`colormapRGB`). They must stay numerically identical — a test in
  `tests/rendering/colormaps.test.ts` enforces it. Change both together.
- **Voxel-axis space.** Rendering uses the volume's i/j/k axes as the box X/Y/Z;
  the world affine is displayed but not baked into geometry. Keep the math
  transparent.
- **Raw `.nii.gz` bytes.** The Vite plugin in `vite.config.ts` serves volumes
  with no `Content-Encoding` so the app's own `DecompressionStream` runs and
  download progress is byte-accurate. Don't "simplify" this away.

## Testing

Strategy in [docs/testing.md](docs/testing.md). In short: unit-test pure logic
exhaustively; smoke-test React components in jsdom (DOM, not pixels). Do **not**
try to test WebGL output in jsdom — there is no GL context. jsdom lacks
`matchMedia` and a real canvas; `tests/setup.ts` stubs them. Build synthetic
NIfTI inputs with `tests/nifti/fixtures.ts` rather than committing binaries.

## Conventions

- **Conventional Commits** (`feat`, `fix`, `refactor`, `test`, `docs`, `chore`,
  `style`). One coherent change per commit. When a refactor moves a source file,
  update its test imports in the **same** commit so every commit type-checks and
  tests green.
- **Formatting/linting via Biome** (`biome.json`): 2-space indent, double quotes,
  semicolons, trailing commas, 100-col. A few rules are intentionally off
  (noNonNullAssertion for ref/getContext access; two a11y rules for the
  pointer-driven canvas + overlay backdrops). Prefer fixing a finding over adding
  a new suppression; if you must suppress, use an inline `biome-ignore` with a
  reason.
- Don't commit build/local cruft: `*.tsbuildinfo`, `dist/`, `node_modules/`,
  `.claude/settings.local.json` are gitignored — keep it so.

## Gotchas

- Node 20+ required (native `fetch`, `DecompressionStream`, ES2022).
- `npm install` may hit `EACCES` on a non-writable global `~/.npm`; use
  `npm install --cache ./.npm-cache` (the dir is gitignored).
- The production JS chunk is large because of Three.js — that's expected, not a
  regression to "fix".
