/**
 * Minimal, dependency-free NIfTI-1 reader written for learning.
 * ----------------------------------------------------------------------------
 * A NIfTI-1 file (.nii) is dead simple:
 *
 *   [ 348-byte header ][ optional extensions ][ raw voxel data ]
 *
 * The header is a fixed C-struct. Every field lives at a known byte offset and
 * has a known type — that is *all* there is to it. (DICOM, by contrast, stores
 * the same pixel data but wraps it in a tag-based, per-slice format with
 * hundreds of metadata attributes; see README.md for the comparison.)
 *
 * `.nii.gz` is just a gzip-compressed `.nii`. We decompress it in the browser
 * with the native `DecompressionStream` API — no pako, no polyfills.
 *
 * Field offsets below come straight from the official `nifti1.h` struct:
 *   https://nifti.nimh.nih.gov/pub/dist/src/niftilib/nifti1.h
 */

/** NIfTI `datatype` codes -> human label + bytes-per-voxel. */
const DATATYPES: Record<number, { name: string; bytes: number }> = {
  2: { name: "uint8", bytes: 1 },
  4: { name: "int16", bytes: 2 },
  8: { name: "int32", bytes: 4 },
  16: { name: "float32", bytes: 4 },
  64: { name: "float64", bytes: 8 },
  256: { name: "int8", bytes: 1 },
  512: { name: "uint16", bytes: 2 },
  768: { name: "uint32", bytes: 4 },
};

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

export interface NiftiVolume {
  header: NiftiHeader;
  nx: number;
  ny: number;
  nz: number;
  /**
   * Voxels re-quantized to 0..255 for a WebGL2 R8 3D texture.
   * Layout matches Data3DTexture: index = x + y*nx + z*nx*ny.
   */
  texture: Uint8Array<ArrayBuffer>;
  /** Min/max of *display* values (after applying sclSlope/sclInter). */
  displayMin: number;
  displayMax: number;
  /** A robust default window/level, in normalized [0,1] texture space. */
  suggestedWindow: [number, number];
  /** 256-bin intensity histogram over the normalized [0,1] range. */
  histogram: Uint32Array;
}

const SPATIAL_UNITS: Record<number, string> = { 0: "unknown", 1: "m", 2: "mm", 3: "um" };

/** gunzip via the browser-native DecompressionStream, if the buffer is gzip. */
export async function maybeGunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  const head = new Uint8Array(buf, 0, 2);
  const isGzip = head[0] === 0x1f && head[1] === 0x8b;
  if (!isGzip) return buf;
  const stream = new Response(buf).body!.pipeThrough(new DecompressionStream("gzip"));
  return await new Response(stream).arrayBuffer();
}

function parseHeader(buf: ArrayBuffer): NiftiHeader {
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

  // --- Orientation: build the voxel->world affine (method 3 > method 2 > fallback)
  let affine: number[][];
  if (sformCode > 0) {
    // Method 3: the matrix rows are stored explicitly (srow_x/y/z @ 280/296/312).
    affine = [
      [f32(280), f32(284), f32(288), f32(292)],
      [f32(296), f32(300), f32(304), f32(308)],
      [f32(312), f32(316), f32(320), f32(324)],
      [0, 0, 0, 1],
    ];
  } else if (qformCode > 0) {
    // Method 2: orientation encoded as a unit quaternion (b,c,d; a derived).
    const b = f32(256), c = f32(260), d = f32(264);
    const a = Math.sqrt(Math.max(0, 1 - (b * b + c * c + d * d)));
    const qx = f32(268), qy = f32(272), qz = f32(276);
    const qfac = pixdim[0] < 0 ? -1 : 1; // pixdim[0] stores the handedness flag
    const [dx, dy, dz] = [pixdim[1], pixdim[2], pixdim[3]];
    const R = [
      [a * a + b * b - c * c - d * d, 2 * (b * c - a * d), 2 * (b * d + a * c)],
      [2 * (b * c + a * d), a * a + c * c - b * b - d * d, 2 * (c * d - a * b)],
      [2 * (b * d - a * c), 2 * (c * d + a * b), a * a + d * d - b * b - c * c],
    ];
    affine = [
      [R[0][0] * dx, R[0][1] * dy, R[0][2] * dz * qfac, qx],
      [R[1][0] * dx, R[1][1] * dy, R[1][2] * dz * qfac, qy],
      [R[2][0] * dx, R[2][1] * dy, R[2][2] * dz * qfac, qz],
      [0, 0, 0, 1],
    ];
  } else {
    // Fallback: just scale by voxel size, no rotation.
    affine = [
      [pixdim[1], 0, 0, 0],
      [0, pixdim[2], 0, 0],
      [0, 0, pixdim[3], 0],
      [0, 0, 0, 1],
    ];
  }

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
    affine,
    description: str(148, 80),
    magic: str(344, 4),
  };
}

/** Read voxel values into a Float64Array (native order: x fastest). */
function readVoxels(buf: ArrayBuffer, h: NiftiHeader, n: number): Float64Array {
  const off = Math.round(h.voxOffset);
  const dv = new DataView(buf, off);
  const out = new Float64Array(n);
  const le = h.littleEndian;
  switch (h.datatypeCode) {
    case 2: for (let i = 0; i < n; i++) out[i] = dv.getUint8(i); break;
    case 256: for (let i = 0; i < n; i++) out[i] = dv.getInt8(i); break;
    case 4: for (let i = 0; i < n; i++) out[i] = dv.getInt16(i * 2, le); break;
    case 512: for (let i = 0; i < n; i++) out[i] = dv.getUint16(i * 2, le); break;
    case 8: for (let i = 0; i < n; i++) out[i] = dv.getInt32(i * 4, le); break;
    case 768: for (let i = 0; i < n; i++) out[i] = dv.getUint32(i * 4, le); break;
    case 16: for (let i = 0; i < n; i++) out[i] = dv.getFloat32(i * 4, le); break;
    case 64: for (let i = 0; i < n; i++) out[i] = dv.getFloat64(i * 8, le); break;
    default: throw new Error(`Unsupported datatype code ${h.datatypeCode}`);
  }
  return out;
}

/** Parse a (possibly gzipped) NIfTI-1 ArrayBuffer into a usable volume. */
export async function parseNifti(input: ArrayBuffer): Promise<NiftiVolume> {
  return parseDecompressed(await maybeGunzip(input));
}

/** Parse an already-decompressed NIfTI-1 buffer (synchronous). */
function parseDecompressed(buf: ArrayBuffer): NiftiVolume {
  const header = parseHeader(buf);

  const [nx, ny, nz] = [header.dim[1], header.dim[2], header.dim[3]];
  const n = nx * ny * nz; // we only read the first volume of any 4-D series
  // `raw` is transient: we use it to find the value range and build the 8-bit
  // texture, then let it be GC'd — keeping ~80 MB of float64 around per dataset
  // would be pure waste since the UI only needs the texture + header.
  const raw = readVoxels(buf, header, n);

  // --- Find min/max of display values (raw * slope + inter).
  const slope = header.sclSlope === 0 ? 1 : header.sclSlope;
  const inter = header.sclInter;
  let lo = Infinity, hi = -Infinity;
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
  let acc = 0, p1 = 0, p99 = 255;
  for (let b = 1; b < 256; b++) {
    acc += hist[b];
    if (acc <= 0.02 * total) p1 = b;
    if (acc <= 0.98 * total) p99 = b;
  }

  return {
    header,
    nx,
    ny,
    nz,
    texture,
    displayMin: lo * slope + inter,
    displayMax: hi * slope + inter,
    suggestedWindow: [p1 / 255, p99 / 255],
    histogram: hist,
  };
}

export type LoadPhase = "download" | "decompress" | "parse";

export interface LoadProgress {
  phase: LoadPhase;
  loaded: number; // bytes downloaded
  total: number; // content-length (0 if the server didn't send one)
  /** 0..1 estimate for the data-loading portion; scene build is reported by the app. */
  fraction: number;
}

/**
 * Fetch + parse a NIfTI volume from a URL, streaming the download so we can
 * report real byte-level progress. Decompress + parse are reported as steps.
 */
export async function loadNiftiFromUrl(
  url: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<NiftiVolume> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);

  let buf: ArrayBuffer;
  if (res.body && onProgress) {
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      loaded += value.byteLength;
      // Download is ~80% of the perceived work for these small files. Clamp in
      // case a server still gzip-transfer-encodes (loaded would exceed total).
      const frac = total ? Math.min(loaded / total, 1) * 0.8 : Math.min(0.6, loaded / 5e6);
      onProgress({ phase: "download", loaded, total, fraction: frac });
    }
    const merged = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      merged.set(c, off);
      off += c.byteLength;
    }
    buf = merged.buffer;
  } else {
    buf = await res.arrayBuffer();
  }

  onProgress?.({ phase: "decompress", loaded: total, total, fraction: 0.85 });
  const raw = await maybeGunzip(buf);
  onProgress?.({ phase: "parse", loaded: total, total, fraction: 0.95 });
  return parseDecompressed(raw);
}
