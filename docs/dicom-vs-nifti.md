# DICOM vs NIfTI

The two formats store the **same pixel data** but wrap it very differently.

| | **NIfTI** | **DICOM** |
|--|-----------|-----------|
| Structure | one file, fixed 348-byte header | tag-based (`group,element`), hundreds of attributes |
| Volume | whole 3D volume in one file | usually **one file per slice**; a series is a folder of hundreds |
| Metadata | minimal (geometry) | patient, device, protocol, modality (CT/MR/…) |
| Geometry | affine matrix in the header | `ImagePositionPatient` + `ImageOrientationPatient` + `PixelSpacing` per slice |
| Window | `cal_min` / `cal_max` (a hint) | `WindowCenter` / `WindowWidth` |
| Rescale | `scl_slope` / `scl_inter` | `RescaleSlope` / `RescaleIntercept` (CT → Hounsfield units) |

The **concepts are identical** — voxels, spacing, orientation, window, rescale —
only the storage differs. Once you understand the NIfTI header you already grasp
~80% of what DICOM encodes. NIfTI was in fact designed to collapse a pile of
DICOM slices into one convenient volume for processing.

## What the sample datasets show

The bundled volumes make the MRI-vs-CT difference visible directly in the
header panel:

- **MRI** (`chris_t1`, `mni152`): `datatype = uint8`, `display range` ≈ 0…255.
- **CT** (`CT_Abdo`): `datatype = int16`, `display range` in **Hounsfield
  units** (signed: air ≈ −1000, bone ≈ +1000). The CT looks best as an
  isosurface — threshold near bone density reveals the skeleton.

## Radiology concepts the scene demonstrates

- **Voxel** — the 3D analogue of a pixel; the whole "model" is a grid of
  intensities.
- **Spacing** — anisotropy / proportions (watch the shape change on load).
- **Window / Level** — the `low/high` sliders: exactly how a radiologist tunes
  contrast to show one band of brightness (soft tissue vs bone).
- **MIP** — maximum-intensity projection (classic for vessels / angiography).
- **Isosurface** — first voxel above a threshold + gradient shading (≈ "skin").
- **DVR** — direct volume rendering: accumulate opacity along the ray through
  the whole volume.
- **Orthogonal slices** — three perpendicular planes (sagittal / coronal /
  axial), the way scans are actually read in the clinic.

## Loading DICOM in this viewer

The reader in [`src/dicom`](../src/dicom) is hand-written and dependency-free,
the same spirit as [`src/nifti`](../src/nifti). It decodes a DICOM dataset into
the exact same `Volume` the renderer already consumes, so once parsed a DICOM and
a NIfTI volume are indistinguishable downstream.

What it handles:

- **Uncompressed transfer syntaxes** — Implicit VR Little Endian, Explicit VR
  Little/Big Endian. Compressed pixel data (JPEG / JPEG-LS / JPEG 2000 / RLE) is
  out of scope — the parser throws a clear error naming the syntax.
- **Two import shapes** — a single **multi-frame** file (enhanced DICOM, the whole
  stack in one buffer), and a **series**: a folder of one-file-per-slice. Drag a
  folder onto the page and the slices are sorted by `ImagePositionPatient` along
  the slice normal (DICOM doesn't promise file order), with the inter-slice
  spacing inferred from the positions.
- **Geometry** — `PixelSpacing` + `SliceThickness`/`SpacingBetweenSlices` become
  the voxel spacing; `ImageOrientationPatient` + `ImagePositionPatient` build the
  voxel→world affine (converted from DICOM's LPS to the viewer's RAS).
- **Intensity** — `RescaleSlope`/`RescaleIntercept` give the display range (CT in
  Hounsfield units); `WindowCenter`/`WindowWidth` are surfaced as the window hint.

The bundled sample (`public/dicom-ct-dental/`) is a real dental cone-beam CT — a
trimmed, downsampled, uncompressed copy of an i-CAT scan; see its
[`SOURCE.md`](../public/dicom-ct-dental/SOURCE.md) for provenance and how it was
prepared from the original (JPEG-compressed) series.
