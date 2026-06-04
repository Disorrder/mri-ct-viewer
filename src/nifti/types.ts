/**
 * NIfTI-1 data types. Field offsets in the parser come straight from the
 * official `nifti1.h` struct:
 *   https://nifti.nimh.nih.gov/pub/dist/src/niftilib/nifti1.h
 */
import type { VolumeBase } from "../volume";

export interface NiftiHeader {
  sizeofHdr: number; // must be 348 — also used to detect endianness
  littleEndian: boolean;
  dim: number[]; // dim[0] = #dimensions, dim[1..7] = sizes
  datatypeCode: number;
  datatype: string;
  bitpix: number; // bits per voxel
  pixdim: number[]; // pixdim[1..3] = voxel size in mm (spacing); pixdim[0] = qfac
  voxOffset: number; // byte offset where voxel data begins (352 for .nii)
  sclSlope: number; // display value = raw * sclSlope + sclInter
  sclInter: number;
  calMin: number; // suggested display window (min)
  calMax: number; // suggested display window (max)
  xyzUnits: string; // spatial unit (mm / m / um)
  qformCode: number; // orientation method 2 (quaternion) present if > 0
  sformCode: number; // orientation method 3 (affine rows) present if > 0
  /** 4x4 voxel->world (RAS) matrix, row-major. The heart of "where is this voxel in space". */
  affine: number[][];
  description: string;
  magic: string; // "n+1" (single file) or "ni1" (header/data pair)
}

export interface NiftiVolume extends VolumeBase {
  format: "nifti";
  header: NiftiHeader;
}

export type LoadPhase = "download" | "decompress" | "parse";

export interface LoadProgress {
  phase: LoadPhase;
  loaded: number; // bytes downloaded
  total: number; // content-length (0 if the server didn't send one)
  /** 0..1 estimate for the data-loading portion; scene build is reported by the app. */
  fraction: number;
}
