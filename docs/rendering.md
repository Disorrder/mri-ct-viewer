# Rendering pipeline

All Three.js / WebGL2 code lives in `src/rendering/`, fronted by the
`VolumeViewer` class. It is plain imperative Three.js (no react-three-fiber) so
the path from "voxels" to "pixels" stays readable.

## From voxels to a 3D texture

`VolumeViewer.setVolume(vol)`:

1. Uploads `vol.texture` as a `THREE.Data3DTexture` with `RedFormat` +
   `UnsignedByteType` (a single-channel `R8` 3D texture), linear filtering,
   clamp-to-edge, and `unpackAlignment = 1` (R8 rows are not 4-byte aligned for
   odd widths).
2. Computes the **physical box size** = `voxelCount * spacing` per axis,
   normalized so the largest axis is `1`. This is what gives the brain its
   correct anatomical proportions — without spacing it would be a cube of
   equal cells.
3. Builds the ray-march box mesh, a bounding wireframe, a crop-box outline, three
   orthogonal slice planes, three crosshair line objects, and re-labels the
   orientation cube from the header affine.

## The volume ray-marcher

`rendering/glsl.ts` holds two materials' shaders. The volume fragment shader
(`VOLUME_FRAG`) intersects the view ray with the unit cube, then marches
`uSteps` samples between entry and exit, branching on technique:

- **MIP** (`uTechnique == 0`) — keep the brightest sample along the ray.
  Classic for angiography.
- **Isosurface** (`1`) — stop at the first sample `>= uIso`, shade by the local
  intensity gradient (central differences) under a fixed light.
- **DVR** (`2`) — front-to-back alpha compositing through the whole volume,
  with an opacity multiplier (`uDensity`); early-outs once alpha saturates.

Shared helpers (`applyWindow`, the five `colormap`s) live in a `COMMON` chunk
prepended to both fragment shaders.

### Window / level

`applyWindow(v, [lo, hi])` maps an intensity range to `[0,1]` and clamps. This
is exactly the DICOM "window width / window center" knob: only a slice of the
value range is shown, below is black, above is white.

### Colormaps

The five colormaps (`gray, bone, hot, viridis, jet`) exist in two parallel
implementations that **must stay in sync**:

- GLSL, in `glsl.ts` `COMMON`, used by the shaders.
- JS, in `colormaps.ts` `colormapRGB`, used to draw the 2D colorbar legend and
  tint the histogram.

`viridis` is a 6th-degree polynomial approximation evaluated with Horner's
method in both. A parity test guards the two against drift.

## Slice planes and slabs

The slice fragment shader (`SLICE_FRAG`) samples a **slab** of `uSamples` voxels
along the plane normal and collapses it: `mean` (soft tissue), `MIP`
(vessels/contrast), or `MinIP` (air). Slab thickness in mm is converted to a
voxel count per axis using that axis's spacing, so 1 mm always equals exactly
one voxel.

## Layouts

`ViewerParams.layout` selects the viewport arrangement, rendered in
`renderScene()`:

- **3D** — one fullscreen perspective camera. In "Slices" mode it also shows the
  three slice planes (the perspective camera has the plane layers enabled).
- **MPR** — a 2×2 grid via scissored viewports and render **layers**: top-left
  coronal, top-right sagittal, bottom-left axial, bottom-right 3D. Each
  orthographic camera sees only its own slice-plane layer (1–3) and crosshair
  layer (4–6).
- **axial / coronal / sagittal** — a single orthographic plane filling the
  screen (the phone top-bar views).

Picking: `pickSlice(clientX, clientY)` unprojects a pointer position through the
right viewport's camera into box space and returns updated slice fractions, so
clicking/dragging a 2D view moves the crosshair in all views.

## The orientation cube (ViewCube)

`rendering/viewcube.ts` builds a **rhombicuboctahedron** (a cube with its 8
corners and 12 edges sliced flat) — 26 facets, each its own material group so it
can be picked, colored, and hover-highlighted independently. Every facet's
geometric normal points along its snap direction, so a click raycast yields the
camera direction directly (corners → diagonal views).

The six faces are labelled anatomically (`R/L, A/P, S/I`) by
`faceLabelsFromAffine(affine)`, which reads each affine column's dominant RAS
axis and sign. This is the one place the world affine visibly drives geometry.

## Performance instrumentation

The animation loop measures, and exposes via `viewer.stats`:

- **FPS** (exponentially smoothed inter-frame time),
- **CPU ms** (main-thread time inside `renderScene()`),
- **GPU ms** — real GPU time via an `EXT_disjoint_timer_query_webgl2` query
  issued around the frame's draws and read back a frame later,
- draw calls / triangles and JS heap usage.

`renderer.info.autoReset` is disabled because up to four viewports are drawn per
frame and the counters accumulate across them.
