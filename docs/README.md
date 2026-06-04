# Documentation

Project docs for the **DICOM / NIfTI volume viewer** — an educational WebGL2
volume renderer built to learn how medical-imaging data formats actually work.

Start here, then dive into whichever area you need:

| Doc | What it covers |
|-----|----------------|
| [architecture.md](architecture.md) | Module map, the directory tree, and how data flows from a `.nii.gz` byte stream to pixels on screen. |
| [nifti-format.md](nifti-format.md) | The NIfTI-1 file format, field by field — doubles as the behavioural **spec** the parser tests verify. |
| [rendering.md](rendering.md) | The WebGL2 rendering pipeline: 3D textures, the volume ray-marcher, MPR layout, and the orientation cube. |
| [dicom-vs-nifti.md](dicom-vs-nifti.md) | How DICOM and NIfTI differ, and why the same concepts (voxels, spacing, orientation, window, rescale) apply to both. |
| [testing.md](testing.md) | Test strategy: what is unit-tested, what is smoke-tested, and what deliberately is not (and why). |
| [development.md](development.md) | Local setup, the npm scripts, linting/formatting with Biome, and the commit conventions. |

## What this project is

A single-page app (Three.js · React 19 · TypeScript · Vite · Leva) that:

1. Fetches a `.nii.gz` volume, streams the download, gunzips it in the browser
   with the native `DecompressionStream`, and parses the NIfTI-1 header and
   voxels **from scratch** — no parser libraries.
2. Uploads the voxels as a single-channel `R8` 3D texture and ray-marches it on
   the GPU (MIP / isosurface / DVR), with orthogonal slice planes and an MPR
   ("radiologist's desktop") layout.
3. Surfaces every concept it relies on in the UI — the live-parsed header, the
   intensity histogram, the window/level knob, a real GPU-time counter, and an
   anatomically-labelled orientation cube.

It is **a learning tool, not clinical software** — see the "honest
simplifications" section of the root [README](../README.md).
