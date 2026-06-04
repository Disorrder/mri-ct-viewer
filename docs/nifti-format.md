# The NIfTI-1 format (and what our parser guarantees)

This doc is both a **reference** for the NIfTI-1 format and the behavioural
**spec** for `src/nifti/`. Every guarantee below is exercised by a test in
`tests/nifti/` — see [testing.md](testing.md).

Authoritative source: the official `nifti1.h` struct,
<https://nifti.nimh.nih.gov/pub/dist/src/niftilib/nifti1.h>, and the format
overview at <https://nifti.nimh.nih.gov/nifti-1>.

## File layout

A single-file `.nii` is just:

```
[ 348-byte header ][ optional extensions ][ raw voxel data ]
```

`.nii.gz` is a gzip-compressed `.nii`. We detect the gzip magic (`0x1f 0x8b`)
and inflate with the browser-native `DecompressionStream` — no `pako`.

The header is a fixed C-struct: every field lives at a known byte offset with a
known type. That is the whole format.

## Header fields the parser reads

| Field | Offset | Type | Meaning |
|-------|--------|------|---------|
| `sizeof_hdr` | 0 | int32 | Must be `348`. Also used to **detect endianness** (see below). |
| `dim[8]` | 40 | int16×8 | `dim[0]` = #dimensions; `dim[1..3]` = volume size in voxels. |
| `datatype` | 70 | int16 | Voxel type code (see table). |
| `bitpix` | 72 | int16 | Bits per voxel. |
| `pixdim[8]` | 76 | float32×8 | `pixdim[1..3]` = voxel size in mm (**spacing**); `pixdim[0]` = qfac handedness flag. |
| `vox_offset` | 108 | float32 | Byte offset where voxel data begins (`352` for `.nii`). |
| `scl_slope` | 112 | float32 | Rescale slope: `value = raw * slope + inter`. |
| `scl_inter` | 116 | float32 | Rescale intercept. |
| `cal_max` | 124 | float32 | Suggested display window max. |
| `cal_min` | 128 | float32 | Suggested display window min. |
| `xyzt_units` | 123 | uint8 | Low 3 bits = spatial unit (m / mm / um). |
| `qform_code` | 252 | int16 | Orientation method 2 (quaternion) present if `> 0`. |
| `sform_code` | 254 | int16 | Orientation method 3 (affine rows) present if `> 0`. |
| `quatern_b/c/d` | 256/260/264 | float32 | Quaternion orientation (method 2). |
| `qoffset_x/y/z` | 268/272/276 | float32 | Translation (method 2). |
| `srow_x/y/z` | 280/296/312 | float32×4 | Explicit affine rows (method 3). |
| `descrip` | 148 | char×80 | Free-text description. |
| `magic` | 344 | char×4 | `"n+1"` (single file) or `"ni1"` (header/data pair). |

### Endianness

The first int32 is `sizeof_hdr`, always `348`. The parser reads it
little-endian first; if it is not `348`, the file is big-endian, so the parser
flips and re-reads every subsequent field big-endian. If it is still not `348`,
the input is rejected as **not a NIfTI-1 file**.

### Datatype codes

| Code | Type | Bytes |
|------|------|-------|
| 2 | uint8 | 1 |
| 4 | int16 | 2 |
| 8 | int32 | 4 |
| 16 | float32 | 4 |
| 64 | float64 | 8 |
| 256 | int8 | 1 |
| 512 | uint16 | 2 |
| 768 | uint32 | 4 |

An unsupported code throws when reading voxels.

### Orientation (the affine)

The voxel→world (RAS) affine — "where is voxel `(i,j,k)` in patient space" — is
built with a strict precedence:

1. **Method 3** (`sform_code > 0`): the 3×4 matrix rows are stored explicitly in
   `srow_*`. Used verbatim.
2. **Method 2** (`qform_code > 0`): orientation is a unit quaternion `(b,c,d)`
   with `a = sqrt(1 - b² - c² - d²)`; the rotation matrix is scaled by `pixdim`
   and the third column is negated when `pixdim[0] < 0` (qfac handedness).
3. **Fallback**: a pure diagonal scale by `pixdim[1..3]`, no rotation.

The fourth row is always `[0, 0, 0, 1]`.

## The `NiftiVolume` the parser produces

`parseNifti(buf)` / `loadNiftiFromUrl(url)` resolve to a `NiftiVolume`:

- `header` — the parsed `NiftiHeader` above.
- `nx, ny, nz` — `dim[1..3]` (only the first volume of a 4-D series is read).
- `texture` — voxels re-quantized to `0..255` (`Uint8Array`), laid out as
  `index = x + y*nx + z*nx*ny` to match a `Data3DTexture`.
- `displayMin / displayMax` — min/max of **display** values, i.e. after applying
  `scl_slope`/`scl_inter`.
- `suggestedWindow` — a robust default `[low, high]` window in normalized
  `[0,1]` texture space, computed from the **1st…99th percentile** of non-air
  voxels (histogram bin 0 is treated as empty air and ignored).
- `histogram` — a 256-bin intensity histogram over the normalized range.

### Quantization caveat

Voxels are quantized to 8 bits for the `R8` texture. For the bundled `uint8`
samples this is lossless; for `int16`/`float32` it is a deliberate
simplification (see the root README's "honest simplifications").

## Progress reporting

`loadNiftiFromUrl` streams the response body and reports `LoadProgress` in three
phases: `download` (real byte counts when `Content-Length` is present),
`decompress` (gunzip), and `parse`. The download phase is weighted to ~80% of
the bar because, for these small files, that is where the perceived time goes.
