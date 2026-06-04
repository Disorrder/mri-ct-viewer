import { quantize } from "../volume";
import { parseHeader } from "./header";
import type { NiftiHeader, NiftiVolume } from "./types";

/**
 * Decoding a NIfTI-1 buffer into a usable volume.
 * ----------------------------------------------------------------------------
 * A `.nii` file is `[ 348-byte header ][ extensions? ][ raw voxels ]`. `.nii.gz`
 * is just a gzip-compressed `.nii`, inflated here with the browser-native
 * `DecompressionStream` — no pako, no polyfills.
 */

/** gunzip via the browser-native DecompressionStream, if the buffer is gzip. */
export async function maybeGunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, 2);
  const isGzip = head[0] === 0x1f && head[1] === 0x8b;
  if (!isGzip) return buf;
  const stream = new Response(buf).body!.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

/** Read voxel values into a Float64Array (native order: x fastest). */
function readVoxels(buf: ArrayBuffer, h: NiftiHeader, n: number): Float64Array {
  const off = Math.round(h.voxOffset);
  const dv = new DataView(buf, off);
  const out = new Float64Array(n);
  const le = h.littleEndian;
  switch (h.datatypeCode) {
    case 2:
      for (let i = 0; i < n; i++) out[i] = dv.getUint8(i);
      break;
    case 256:
      for (let i = 0; i < n; i++) out[i] = dv.getInt8(i);
      break;
    case 4:
      for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, le);
      break;
    case 512:
      for (let i = 0; i < n; i++) out[i] = dv.getUint16(i * 2, le);
      break;
    case 8:
      for (let i = 0; i < n; i++) out[i] = dv.getInt32(i * 4, le);
      break;
    case 768:
      for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 4, le);
      break;
    case 16:
      for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, le);
      break;
    case 64:
      for (let i = 0; i < n; i++) out[i] = dv.getFloat64(i * 8, le);
      break;
    default:
      throw new Error(`Unsupported datatype code ${h.datatypeCode}`);
  }
  return out;
}

/** Parse a (possibly gzipped) NIfTI-1 ArrayBuffer into a usable volume. */
export async function parseNifti(input: ArrayBuffer): Promise<NiftiVolume> {
  return parseDecompressed(await maybeGunzip(input));
}

/** Parse an already-decompressed NIfTI-1 buffer (synchronous). */
export function parseDecompressed(buf: ArrayBuffer): NiftiVolume {
  const header = parseHeader(buf);

  const [nx, ny, nz] = [header.dim[1], header.dim[2], header.dim[3]];
  const n = nx * ny * nz; // we only read the first volume of any 4-D series
  // `raw` is transient: we use it to find the value range and build the 8-bit
  // texture, then let it be GC'd — keeping ~80 MB of float64 around per dataset
  // would be pure waste since the UI only needs the texture + header.
  const raw = readVoxels(buf, header, n);

  // scl_slope = 0 means "no scaling" by the NIfTI convention.
  const slope = header.sclSlope === 0 ? 1 : header.sclSlope;
  const stats = quantize(raw, n, slope, header.sclInter);

  return {
    format: "nifti",
    header,
    nx,
    ny,
    nz,
    spacing: [header.pixdim[1], header.pixdim[2], header.pixdim[3]],
    affine: header.affine,
    ...stats,
  };
}
