import { type EncodableVolume, encodeNifti1 } from "../nifti/encode";

/**
 * Exporting the clip selection as a file.
 * ----------------------------------------------------------------------------
 * The "clip" controls define an axis-aligned crop box in normalized [0,1] space
 * per axis (the same box the shader keeps or cuts out — see glsl.ts `clipped()`).
 * This module turns that box into a real, smaller volume and serializes it.
 *
 * **Format support.** We export NIfTI-1 (`.nii`) for *both* NIfTI and DICOM
 * sources, because by the time a volume is loaded it has been reduced to the
 * format-neutral 8-bit texture + spacing + affine that NIfTI stores directly
 * (this is exactly the well-trodden DICOM→NIfTI conversion). We do **not** write
 * DICOM back out: that needs a full per-slice SOP/UID/series rebuild, and the
 * viewer only retains an 8-bit re-quantized texture, so the round-trip wouldn't
 * be faithful anyway. NIfTI reloads in this viewer and in every medical tool.
 */

/** Crop box in normalized [0,1] coordinates per axis (inclusive lower / upper). */
export interface ClipBox {
  min: [number, number, number];
  max: [number, number, number];
}

/** The whole volume — the sensible export when clipping is off. */
export const FULL_BOX: ClipBox = { min: [0, 0, 0], max: [1, 1, 1] };

/** Map a normalized [lo,hi] range to integer voxel bounds [a,b) that are never empty. */
function voxelBounds(n: number, lo: number, hi: number): [number, number] {
  let a = Math.round(Math.min(lo, hi) * n);
  let b = Math.round(Math.max(lo, hi) * n);
  a = Math.max(0, Math.min(n, a));
  b = Math.max(0, Math.min(n, b));
  if (b <= a) {
    // Degenerate range (zero-width or fully outside) → keep one voxel so the
    // export is always a valid, non-empty volume.
    a = Math.max(0, Math.min(n - 1, a));
    b = a + 1;
  }
  return [a, b];
}

export interface CroppedVolume extends EncodableVolume {
  sclSlope: number;
  sclInter: number;
}

/**
 * Extract the clip box into a new, smaller volume. The affine origin is shifted
 * so the crop stays in the same world location (new voxel (0,0,0) = old voxel
 * (x0,y0,z0)), and a slope/intercept is derived to recover the display range.
 */
export function cropToClip(vol: EncodableVolume, box: ClipBox): CroppedVolume {
  const [x0, x1] = voxelBounds(vol.nx, box.min[0], box.max[0]);
  const [y0, y1] = voxelBounds(vol.ny, box.min[1], box.max[1]);
  const [z0, z1] = voxelBounds(vol.nz, box.min[2], box.max[2]);
  const ox = x1 - x0;
  const oy = y1 - y0;
  const oz = z1 - z0;

  // Copy the sub-box. Source layout is index = x + y*nx + z*nx*ny, so each
  // output row is a contiguous run we can walk with a single moving cursor.
  const data = new Uint8Array(ox * oy * oz);
  let w = 0;
  for (let z = z0; z < z1; z++) {
    for (let y = y0; y < y1; y++) {
      let r = x0 + y * vol.nx + z * vol.nx * vol.ny;
      for (let x = x0; x < x1; x++) data[w++] = vol.texture[r++];
    }
  }

  // Shift the translation column by the world position of the first kept voxel;
  // the linear (rotation/scale) part is unchanged.
  const A = vol.affine;
  const tx = A[0][0] * x0 + A[0][1] * y0 + A[0][2] * z0 + A[0][3];
  const ty = A[1][0] * x0 + A[1][1] * y0 + A[1][2] * z0 + A[1][3];
  const tz = A[2][0] * x0 + A[2][1] * y0 + A[2][2] * z0 + A[2][3];
  const affine = [
    [A[0][0], A[0][1], A[0][2], tx],
    [A[1][0], A[1][1], A[1][2], ty],
    [A[2][0], A[2][1], A[2][2], tz],
    [0, 0, 0, 1],
  ];

  // Reverse the 0..255 quantization: a texture byte maps back to display units
  // via display = byte*slope + inter (a non-zero slope, since 0 means "unset").
  const span = vol.displayMax - vol.displayMin;
  const sclSlope = span / 255 || 1;
  const sclInter = vol.displayMin;

  return {
    nx: ox,
    ny: oy,
    nz: oz,
    texture: data as Uint8Array<ArrayBuffer>,
    spacing: vol.spacing,
    affine,
    displayMin: vol.displayMin,
    displayMax: vol.displayMax,
    sclSlope,
    sclInter,
  };
}

/** Crop to the clip box and serialize it as a NIfTI-1 `.nii` Blob. */
export function exportClippedNifti(vol: EncodableVolume, box: ClipBox, label = "volume"): Blob {
  const c = cropToClip(vol, box);
  const buf = encodeNifti1({
    nx: c.nx,
    ny: c.ny,
    nz: c.nz,
    spacing: c.spacing,
    affine: c.affine,
    sclSlope: c.sclSlope,
    sclInter: c.sclInter,
    data: c.texture,
    description: `${label} crop`,
  });
  return new Blob([buf], { type: "application/octet-stream" });
}
