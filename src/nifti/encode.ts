import type { VolumeBase } from "../volume";

/**
 * Writing a NIfTI-1 `.nii` buffer — the mirror image of `decode.ts`.
 * ----------------------------------------------------------------------------
 * The app keeps every loaded volume (NIfTI *or* DICOM) as a format-neutral 8-bit
 * texture plus a spacing/affine/display-range (see VolumeBase). That is exactly
 * enough to emit a valid NIfTI-1: a fixed 348-byte header, 4 zero extension-flag
 * bytes, then the raw voxels at offset 352. We always write `uint8` (datatype 2)
 * because the texture is already 8-bit, and stash a `scl_slope`/`scl_inter` so a
 * reader can recover the original display units: `display = byte*slope + inter`.
 *
 * Field offsets come straight from `nifti1.h` and match the reader in
 * `header.ts` byte for byte; see docs/nifti-format.md for the offset table.
 */

const HEADER_SIZE = 348;
const VOX_OFFSET = 352; // 348-byte header + 4 extension-flag bytes (all zero here)

export interface NiftiExport {
  nx: number;
  ny: number;
  nz: number;
  /** Voxel size in mm along x, y, z → pixdim[1..3]. */
  spacing: [number, number, number];
  /** 4x4 voxel→world (RAS) affine, row-major; only the first 3 rows are written. */
  affine: number[][];
  /** display = byte*sclSlope + sclInter — recovers the original intensity range. */
  sclSlope: number;
  sclInter: number;
  /** Voxels, layout index = x + y*nx + z*nx*ny (matches Data3DTexture / VolumeBase). */
  data: Uint8Array;
  /** Optional free-text description (truncated to 79 chars). */
  description?: string;
}

/** Encode an 8-bit volume as a single-file NIfTI-1 (`.nii`) ArrayBuffer. */
export function encodeNifti1(v: NiftiExport): ArrayBuffer {
  const n = v.nx * v.ny * v.nz;
  if (v.data.length !== n) {
    throw new Error(`encodeNifti1: data length ${v.data.length} != ${v.nx}*${v.ny}*${v.nz} = ${n}`);
  }

  const buf = new ArrayBuffer(VOX_OFFSET + n);
  const dv = new DataView(buf);
  const le = true; // we always write little-endian

  dv.setInt32(0, HEADER_SIZE, le); // sizeof_hdr — also the reader's endianness probe

  // dim[0] = #dimensions, dim[1..3] = sizes, dim[4..7] = 1 (a single 3-D volume).
  dv.setInt16(40, 3, le);
  dv.setInt16(42, v.nx, le);
  dv.setInt16(44, v.ny, le);
  dv.setInt16(46, v.nz, le);
  for (let i = 4; i < 8; i++) dv.setInt16(40 + i * 2, 1, le);

  dv.setInt16(70, 2, le); // datatype = 2 (uint8)
  dv.setInt16(72, 8, le); // bitpix

  dv.setFloat32(76, 1, le); // pixdim[0] = qfac (unused with the sform path)
  dv.setFloat32(80, v.spacing[0], le); // pixdim[1..3] = spacing in mm
  dv.setFloat32(84, v.spacing[1], le);
  dv.setFloat32(88, v.spacing[2], le);

  dv.setFloat32(108, VOX_OFFSET, le); // vox_offset
  dv.setFloat32(112, v.sclSlope, le); // scl_slope
  dv.setFloat32(116, v.sclInter, le); // scl_inter
  dv.setUint8(123, 2); // xyzt_units: low 3 bits = NIFTI_UNITS_MM (2)

  const desc = v.description ?? "";
  for (let i = 0; i < desc.length && i < 79; i++) dv.setUint8(148 + i, desc.charCodeAt(i));

  // Orientation via method 3 (explicit affine rows). qform off, sform = scanner anat.
  dv.setInt16(252, 0, le); // qform_code
  dv.setInt16(254, 1, le); // sform_code = NIFTI_XFORM_SCANNER_ANAT
  const srowBase = [280, 296, 312]; // srow_x / srow_y / srow_z
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 4; c++) dv.setFloat32(srowBase[r] + c * 4, v.affine[r][c], le);
  }

  const magic = "n+1"; // single-file NIfTI; byte 347 stays 0 (null terminator)
  for (let i = 0; i < magic.length; i++) dv.setUint8(344 + i, magic.charCodeAt(i));

  new Uint8Array(buf, VOX_OFFSET).set(v.data); // raw voxels

  return buf;
}

/** The fields encoding needs from a decoded volume — a structural subset of VolumeBase. */
export type EncodableVolume = Pick<
  VolumeBase,
  "nx" | "ny" | "nz" | "texture" | "spacing" | "affine" | "displayMin" | "displayMax"
>;
