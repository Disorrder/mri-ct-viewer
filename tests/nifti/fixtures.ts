/**
 * Build a synthetic NIfTI-1 ArrayBuffer byte by byte, at the exact offsets the
 * parser reads. Defaults produce a valid little-endian uint8 volume; override
 * any field to exercise a specific code path (endianness, affine method,
 * datatype, scaling, …). See docs/nifti-format.md for the offset table.
 */

const DEFAULT_VOX_OFFSET = 352;

/** Bytes per voxel for each supported NIfTI datatype code. */
export const DATATYPE_BYTES: Record<number, number> = {
  2: 1, // uint8
  4: 2, // int16
  8: 4, // int32
  16: 4, // float32
  64: 8, // float64
  256: 1, // int8
  512: 2, // uint16
  768: 4, // uint32
};

export interface NiftiSpec {
  dim?: [number, number, number];
  datatypeCode?: number;
  bitpix?: number;
  pixdim?: [number, number, number]; // spacing in mm
  qfac?: number; // pixdim[0] handedness flag
  voxOffset?: number;
  sclSlope?: number;
  sclInter?: number;
  calMin?: number;
  calMax?: number;
  xyztUnits?: number; // 0 unknown, 1 m, 2 mm, 3 um
  qformCode?: number;
  sformCode?: number;
  quat?: [number, number, number]; // quatern b, c, d
  qoffset?: [number, number, number];
  srow?: [number[], number[], number[]]; // 3 affine rows of 4
  descrip?: string;
  magic?: string;
  littleEndian?: boolean;
  voxels: number[]; // raw values, length = product(dim)
}

function writeVoxel(dv: DataView, off: number, code: number, le: boolean, v: number): void {
  switch (code) {
    case 2:
      dv.setUint8(off, v);
      break;
    case 256:
      dv.setInt8(off, v);
      break;
    case 4:
      dv.setInt16(off, v, le);
      break;
    case 512:
      dv.setUint16(off, v, le);
      break;
    case 8:
      dv.setInt32(off, v, le);
      break;
    case 768:
      dv.setUint32(off, v, le);
      break;
    case 16:
      dv.setFloat32(off, v, le);
      break;
    case 64:
      dv.setFloat64(off, v, le);
      break;
    default:
      throw new Error(`fixture cannot write datatype ${code}`);
  }
}

export function makeNifti(spec: NiftiSpec): ArrayBuffer {
  const le = spec.littleEndian ?? true;
  const dim = spec.dim ?? [2, 2, 2];
  const code = spec.datatypeCode ?? 2;
  const bpv = DATATYPE_BYTES[code] ?? 1;
  const voxOffset = spec.voxOffset ?? DEFAULT_VOX_OFFSET;
  const n = dim[0] * dim[1] * dim[2];

  const buf = new ArrayBuffer(voxOffset + n * bpv);
  const dv = new DataView(buf);

  dv.setInt32(0, 348, le); // sizeof_hdr

  dv.setInt16(40, 3, le); // dim[0] = #dimensions
  dv.setInt16(42, dim[0], le);
  dv.setInt16(44, dim[1], le);
  dv.setInt16(46, dim[2], le);

  dv.setInt16(70, code, le); // datatype
  dv.setInt16(72, spec.bitpix ?? bpv * 8, le); // bitpix

  dv.setFloat32(76, spec.qfac ?? 1, le); // pixdim[0] = qfac
  const pd = spec.pixdim ?? [1, 1, 1];
  dv.setFloat32(80, pd[0], le); // pixdim[1..3] = spacing
  dv.setFloat32(84, pd[1], le);
  dv.setFloat32(88, pd[2], le);

  dv.setFloat32(108, voxOffset, le); // vox_offset
  dv.setFloat32(112, spec.sclSlope ?? 0, le); // scl_slope
  dv.setFloat32(116, spec.sclInter ?? 0, le); // scl_inter
  dv.setUint8(123, spec.xyztUnits ?? 2); // xyzt_units (mm)
  dv.setFloat32(124, spec.calMax ?? 0, le); // cal_max
  dv.setFloat32(128, spec.calMin ?? 0, le); // cal_min

  dv.setInt16(252, spec.qformCode ?? 0, le); // qform_code
  dv.setInt16(254, spec.sformCode ?? 0, le); // sform_code

  const q = spec.quat ?? [0, 0, 0];
  dv.setFloat32(256, q[0], le); // quatern_b/c/d
  dv.setFloat32(260, q[1], le);
  dv.setFloat32(264, q[2], le);
  const qo = spec.qoffset ?? [0, 0, 0];
  dv.setFloat32(268, qo[0], le); // qoffset_x/y/z
  dv.setFloat32(272, qo[1], le);
  dv.setFloat32(276, qo[2], le);

  if (spec.srow) {
    const base = [280, 296, 312]; // srow_x/y/z
    spec.srow.forEach((row, r) => row.forEach((c, i) => dv.setFloat32(base[r] + i * 4, c, le)));
  }

  const desc = spec.descrip ?? "";
  for (let i = 0; i < desc.length && i < 80; i++) dv.setUint8(148 + i, desc.charCodeAt(i));

  const magic = spec.magic ?? "n+1";
  for (let i = 0; i < magic.length && i < 4; i++) dv.setUint8(344 + i, magic.charCodeAt(i));

  spec.voxels.forEach((v, i) => writeVoxel(dv, voxOffset + i * bpv, code, le, v));
  return buf;
}

/** gzip an ArrayBuffer with the platform CompressionStream (mirrors maybeGunzip). */
export async function gzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Response(buf).body!.pipeThrough(new CompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}
