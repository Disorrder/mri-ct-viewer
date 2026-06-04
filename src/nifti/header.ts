import { DATATYPES, SPATIAL_UNITS } from "./datatypes";
import type { NiftiHeader } from "./types";

/**
 * Parse the fixed 348-byte NIfTI-1 header. Every field lives at a known byte
 * offset; see docs/nifti-format.md for the offset table.
 */
export function parseHeader(buf: ArrayBuffer): NiftiHeader {
  const dv = new DataView(buf);

  // The first int32 is `sizeof_hdr`, always 348. If it doesn't read as 348 in
  // little-endian, the file was written big-endian — so we flip and re-read.
  let littleEndian = true;
  let sizeofHdr = dv.getInt32(0, littleEndian);
  if (sizeofHdr !== 348) {
    littleEndian = false;
    sizeofHdr = dv.getInt32(0, littleEndian);
  }
  if (sizeofHdr !== 348) throw new Error(`Not a NIfTI-1 file (sizeof_hdr=${sizeofHdr})`);

  const i16 = (o: number) => dv.getInt16(o, littleEndian);
  const f32 = (o: number) => dv.getFloat32(o, littleEndian);
  const str = (o: number, len: number) => {
    let s = "";
    for (let i = 0; i < len; i++) {
      const c = dv.getUint8(o + i);
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s.trim();
  };

  const dim: number[] = [];
  for (let i = 0; i < 8; i++) dim.push(i16(40 + i * 2)); // short dim[8] @ 40

  const pixdim: number[] = [];
  for (let i = 0; i < 8; i++) pixdim.push(f32(76 + i * 4)); // float pixdim[8] @ 76

  const datatypeCode = i16(70);
  const xyzUnitsCode = dv.getUint8(123) & 0x07; // low 3 bits of xyzt_units @ 123
  const qformCode = i16(252);
  const sformCode = i16(254);

  return {
    sizeofHdr,
    littleEndian,
    dim,
    datatypeCode,
    datatype: DATATYPES[datatypeCode]?.name ?? `code ${datatypeCode}`,
    bitpix: i16(72),
    pixdim,
    voxOffset: f32(108),
    sclSlope: f32(112),
    sclInter: f32(116),
    calMin: f32(128),
    calMax: f32(124),
    xyzUnits: SPATIAL_UNITS[xyzUnitsCode] ?? "unknown",
    qformCode,
    sformCode,
    affine: buildAffine({ f32, sformCode, qformCode, pixdim }),
    description: str(148, 80),
    magic: str(344, 4),
  };
}

/**
 * Build the voxel->world (RAS) affine with method precedence: explicit srow rows
 * (method 3) > quaternion (method 2) > a plain diagonal scale by spacing.
 */
function buildAffine(ctx: {
  f32: (o: number) => number;
  sformCode: number;
  qformCode: number;
  pixdim: number[];
}): number[][] {
  const { f32, sformCode, qformCode, pixdim } = ctx;

  if (sformCode > 0) {
    // Method 3: the matrix rows are stored explicitly (srow_x/y/z @ 280/296/312).
    return [
      [f32(280), f32(284), f32(288), f32(292)],
      [f32(296), f32(300), f32(304), f32(308)],
      [f32(312), f32(316), f32(320), f32(324)],
      [0, 0, 0, 1],
    ];
  }

  if (qformCode > 0) {
    // Method 2: orientation encoded as a unit quaternion (b,c,d; a derived).
    const b = f32(256),
      c = f32(260),
      d = f32(264);
    const a = Math.sqrt(Math.max(0, 1 - (b * b + c * c + d * d)));
    const qx = f32(268),
      qy = f32(272),
      qz = f32(276);
    const qfac = pixdim[0] < 0 ? -1 : 1; // pixdim[0] stores the handedness flag
    const [dx, dy, dz] = [pixdim[1], pixdim[2], pixdim[3]];
    const R = [
      [a * a + b * b - c * c - d * d, 2 * (b * c - a * d), 2 * (b * d + a * c)],
      [2 * (b * c + a * d), a * a + c * c - b * b - d * d, 2 * (c * d - a * b)],
      [2 * (b * d - a * c), 2 * (c * d + a * b), a * a + d * d - b * b - c * c],
    ];
    return [
      [R[0][0] * dx, R[0][1] * dy, R[0][2] * dz * qfac, qx],
      [R[1][0] * dx, R[1][1] * dy, R[1][2] * dz * qfac, qy],
      [R[2][0] * dx, R[2][1] * dy, R[2][2] * dz * qfac, qz],
      [0, 0, 0, 1],
    ];
  }

  // Fallback: just scale by voxel size, no rotation.
  return [
    [pixdim[1], 0, 0, 0],
    [0, pixdim[2], 0, 0],
    [0, 0, pixdim[3], 0],
    [0, 0, 0, 1],
  ];
}
