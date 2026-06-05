/**
 * The format-neutral volume the renderer and UI consume. NIfTI and DICOM differ
 * only in how the bytes are wrapped (see docs/dicom-vs-nifti.md) — both decode
 * to the same `VolumeBase`: an 8-bit 3D texture plus the few numbers needed to
 * place it in space and window its intensities. A `format` discriminator carries
 * the format-specific metadata for the info panel.
 */
import type { DicomVolume } from "./dicom/types";
import type { NiftiVolume } from "./nifti/types";

export interface VolumeBase {
  nx: number;
  ny: number;
  nz: number;
  /**
   * Voxels re-quantized to 0..255 for a WebGL2 R8 3D texture.
   * Layout matches Data3DTexture: index = x + y*nx + z*nx*ny.
   */
  texture: Uint8Array<ArrayBuffer>;
  /** Min/max of *display* values (after applying the format's rescale). */
  displayMin: number;
  displayMax: number;
  /** A robust default window/level, in normalized [0,1] texture space. */
  suggestedWindow: [number, number];
  /** 256-bin intensity histogram over the normalized [0,1] range. */
  histogram: Uint32Array;
  /** Voxel size in mm along x, y, z — what the renderer scales the box by. */
  spacing: [number, number, number];
  /** 4x4 voxel→world (RAS) affine, row-major; drives the orientation-cube labels. */
  affine: number[][];
}

/** A decoded volume, tagged by source format. */
export type Volume = NiftiVolume | DicomVolume;

/**
 * Geometry for a volume that is still streaming in. The renderer allocates an
 * empty 3D texture of this size, then fills it z-slab by z-slab as slices arrive
 * (see VolumeViewer.beginProgressive / pushSlab). Spacing + affine are provisional
 * (derived from the first slice) and replaced when the final `Volume` is applied.
 */
export interface VolumePreview {
  nx: number;
  ny: number;
  nz: number;
  spacing: [number, number, number];
  affine: number[][];
}

export interface VolumeStats {
  texture: Uint8Array<ArrayBuffer>;
  histogram: Uint32Array;
  displayMin: number;
  displayMax: number;
  suggestedWindow: [number, number];
}

/**
 * Turn raw voxel values into everything the GPU + UI need: an 8-bit texture, a
 * 256-bin histogram, the display value range (raw * slope + inter), and a robust
 * 1st..99th percentile auto-window. Shared by both format decoders so NIfTI and
 * DICOM quantize identically.
 *
 * `slope`/`inter` map stored values to display units (NIfTI scl_slope/scl_inter,
 * DICOM RescaleSlope/RescaleIntercept). The texture itself is built from the raw
 * range so the full precision of the stored data fills the 0..255 range.
 */
export function quantize(
  raw: ArrayLike<number>,
  n: number,
  slope: number,
  inter: number,
): VolumeStats {
  // --- Find min/max of the raw stored values.
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < n; i++) {
    const v = raw[i];
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  const span = hi - lo || 1;

  // --- Re-quantize to 0..255 for the R8 texture, and build a 256-bin histogram.
  const texture = new Uint8Array(n);
  const hist = new Uint32Array(256);
  for (let i = 0; i < n; i++) {
    const b = Math.round(((raw[i] - lo) / span) * 255);
    texture[i] = b;
    hist[b]++;
  }

  // --- Auto window: 1st..99th percentile of voxels (ignoring the empty-air bin 0).
  const total = n - hist[0];
  let acc = 0;
  let p1 = 0;
  let p99 = 255;
  for (let b = 1; b < 256; b++) {
    acc += hist[b];
    if (acc <= 0.02 * total) p1 = b;
    if (acc <= 0.98 * total) p99 = b;
  }

  return {
    texture,
    histogram: hist,
    displayMin: lo * slope + inter,
    displayMax: hi * slope + inter,
    suggestedWindow: [p1 / 255, p99 / 255],
  };
}

/**
 * Map one frame's raw values to R8 against a *fixed* [lo, hi] range — used while a
 * series streams in, before the global range is known. Unlike `quantize` (which
 * scans the whole volume for its range), this lets every slab share one provisional
 * mapping so the partial render stays visually consistent; the final `quantize`
 * pass replaces it once all slices are in.
 */
export function quantizeFrame(
  raw: ArrayLike<number>,
  lo: number,
  hi: number,
): Uint8Array<ArrayBuffer> {
  const span = hi - lo || 1;
  const n = raw.length;
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const b = Math.round(((raw[i] - lo) / span) * 255);
    out[i] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
  return out;
}
