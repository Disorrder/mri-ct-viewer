/** NIfTI `datatype` codes -> human label + bytes-per-voxel. */
export const DATATYPES: Record<number, { name: string; bytes: number }> = {
  2: { name: "uint8", bytes: 1 },
  4: { name: "int16", bytes: 2 },
  8: { name: "int32", bytes: 4 },
  16: { name: "float32", bytes: 4 },
  64: { name: "float64", bytes: 8 },
  256: { name: "int8", bytes: 1 },
  512: { name: "uint16", bytes: 2 },
  768: { name: "uint32", bytes: 4 },
};

/** `xyzt_units` spatial-unit codes (low 3 bits) -> label. */
export const SPATIAL_UNITS: Record<number, string> = { 0: "unknown", 1: "m", 2: "mm", 3: "um" };
