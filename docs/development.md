# Development

## Prerequisites

- Node.js 20+ (uses native `fetch`, `DecompressionStream`, ES2022).
- A WebGL2-capable browser to run the app.

## Setup

```bash
npm install
npm run dev      # http://localhost:5173
```

The sample volumes live in `public/*.nii.gz` (already committed). A small Vite
plugin in [`vite.config.ts`](../vite.config.ts) serves them as **raw bytes**
(Content-Type `application/gzip`, no `Content-Encoding`), so the browser does
not silently inflate the gzip — otherwise our own `DecompressionStream` step
would be bypassed and byte-accurate download progress would be impossible
(`Content-Length` would be the compressed size while the delivered body is the
decompressed one).

## Environment

Real Vite environment files are intentionally local-only: `.env`, `.env.*`, and
`*.local` are ignored by git. Use `.env.development.local` for `npm run dev` and
`.env.production.local` only for local production builds. Hosted production
deployments should define `VITE_DATA_BASE` in the deployment environment manager.

Leaving `VITE_DATA_BASE` unset keeps dataset URLs same-origin, which is useful
when serving the bundled `public/` data locally. Set it only when dataset assets
should be fetched from external object storage.

## Scripts

| Script | What it does |
|--------|--------------|
| `npm run dev` | Vite dev server with HMR. |
| `npm run build` | Type-check (`tsc`) then production build (`vite build`). |
| `npm run preview` | Serve the production build locally. |
| `npm test` | Vitest in watch mode. |
| `npm run test:run` | Vitest single run (for CI). |
| `npm run coverage` | Vitest single run with a coverage report. |
| `npm run lint` | Biome: lint check (no writes). |
| `npm run format` | Biome: format-write the tree. |
| `npm run check` | Biome: combined lint + format + import-organize check. |

## Linting & formatting — Biome

We use [Biome](https://biomejs.dev) for both linting and formatting (one tool,
no ESLint + Prettier split). Config is in [`biome.json`](../biome.json). It is
tuned to match the existing code style (2-space indent, double quotes, trailing
commas) so adopting it did not reformat the whole codebase.

CI-style gate before committing:

```bash
npm run check && npm run test:run && npm run build
```

## Project layout

See [architecture.md](architecture.md) for the directory tree and module
responsibilities.

## Commit conventions

Commits follow [Conventional Commits](https://www.conventionalcommits.org):

```
<type>(<optional scope>): <summary>
```

Types used here: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`.
Each commit is one coherent change (e.g. "extract pure ruler math into `lib/`"
is separate from "add tests for it"). Source moves and their test-import updates
go in the same commit so every commit type-checks and tests green.
