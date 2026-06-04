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
