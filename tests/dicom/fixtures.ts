/**
 * Build synthetic DICOM buffers byte by byte for the parser tests — the DICOM
 * analogue of tests/nifti/fixtures.ts. Independent of both the production reader
 * (src/dicom) and the sample generator (scripts/), so a shared bug can't hide.
 *
 * Defaults produce a valid Explicit-VR-LE single-frame image; override fields to
 * exercise implicit VR, big-endian, multi-frame, signed/8-bit pixels, etc.
 */

const LONG_VR = new Set(["OB", "OW", "OF", "OD", "OL", "OV", "SQ", "UT", "UN", "UC", "UR"]);

export interface DicomSpec {
  rows: number;
  columns: number;
  /** Stored pixel values, length = rows*columns*frames (frame-major, col fastest). */
  pixels: number[];
  frames?: number;
  bitsAllocated?: number; // 8 or 16 (default 16)
  signed?: boolean; // PixelRepresentation (default false)
  pixelSpacing?: [number, number]; // [row, col] mm (default [1, 1])
  sliceThickness?: number;
  spacingBetweenSlices?: number;
  orientation?: number[]; // 6 cosines (default identity axial)
  position?: [number, number, number]; // ImagePositionPatient
  rescaleSlope?: number;
  rescaleIntercept?: number;
  windowCenter?: number;
  windowWidth?: number;
  modality?: string;
  samplesPerPixel?: number; // default 1
  explicitVR?: boolean; // default true
  littleEndian?: boolean; // default true (set false for Explicit VR Big Endian)
  /** Override the transfer syntax UID written to the meta group (e.g. a JPEG one). */
  transferSyntax?: string;
  /** Insert a sequence (SQ) before PixelData to test sequence-skipping (Explicit VR LE). */
  sequence?: "defined" | "undefined";
}

function concat(parts: Uint8Array[]): Uint8Array {
  const len = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(len);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function pad(value: Uint8Array, padByte: number): Uint8Array {
  if (value.length % 2 === 0) return value;
  const out = new Uint8Array(value.length + 1);
  out.set(value);
  out[value.length] = padByte;
  return out;
}

const ascii = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0));

function element(
  group: number,
  elem: number,
  vr: string,
  rawValue: Uint8Array,
  explicitVR: boolean,
  le: boolean,
): Uint8Array {
  const value = pad(rawValue, vr === "UI" ? 0x00 : 0x20);
  if (!explicitVR) {
    const head = new Uint8Array(8);
    const dv = new DataView(head.buffer);
    dv.setUint16(0, group, le);
    dv.setUint16(2, elem, le);
    dv.setUint32(4, value.length, le);
    return concat([head, value]);
  }
  const long = LONG_VR.has(vr);
  const head = new Uint8Array(long ? 12 : 8);
  const dv = new DataView(head.buffer);
  dv.setUint16(0, group, le);
  dv.setUint16(2, elem, le);
  head[4] = vr.charCodeAt(0);
  head[5] = vr.charCodeAt(1);
  if (long) dv.setUint32(8, value.length, le);
  else dv.setUint16(6, value.length, le);
  return concat([head, value]);
}

function u16(n: number, le: boolean): Uint8Array {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, le);
  return b;
}

function pixelBytes(spec: DicomSpec, le: boolean): Uint8Array {
  const bits = spec.bitsAllocated ?? 16;
  const bytesPer = bits / 8;
  const buf = new Uint8Array(spec.pixels.length * bytesPer);
  const dv = new DataView(buf.buffer);
  spec.pixels.forEach((v, i) => {
    if (bytesPer === 1) (spec.signed ? dv.setInt8 : dv.setUint8).call(dv, i, v);
    else (spec.signed ? dv.setInt16 : dv.setUint16).call(dv, i * 2, v, le);
  });
  return buf;
}

/** An 8-byte item/delimiter tag (FFFE,xxxx)(4-byte length), no VR — LE only. */
function itemTag(elem: number, length: number): Uint8Array {
  const b = new Uint8Array(8);
  const dv = new DataView(b.buffer);
  dv.setUint16(0, 0xfffe, true);
  dv.setUint16(2, elem, true);
  dv.setUint32(4, length, true);
  return b;
}

/** A private SQ element (Explicit VR LE) to exercise the parser's sequence skip. */
function sequenceLE(mode: "defined" | "undefined"): Uint8Array {
  const head = new Uint8Array(12);
  const dv = new DataView(head.buffer);
  dv.setUint16(0, 0x0009, true); // private group
  dv.setUint16(2, 0x0010, true);
  head[4] = 0x53; // 'S'
  head[5] = 0x51; // 'Q'
  if (mode === "defined") {
    dv.setUint32(8, 0, true); // empty, defined-length sequence
    return head;
  }
  dv.setUint32(8, 0xffffffff, true); // undefined length
  return concat([
    head,
    itemTag(0xe000, 0xffffffff), // Item, undefined length
    element(0x0008, 0x0070, "LO", ascii("ACME"), true, true), // one element inside the item
    itemTag(0xe00d, 0), // Item Delimitation
    itemTag(0xe0dd, 0), // Sequence Delimitation
  ]);
}

export function makeDicom(spec: DicomSpec): ArrayBuffer {
  const explicitVR = spec.explicitVR ?? true;
  const le = spec.littleEndian ?? true;
  const bits = spec.bitsAllocated ?? 16;
  const ts =
    spec.transferSyntax ??
    (!explicitVR ? "1.2.840.10008.1.2" : le ? "1.2.840.10008.1.2.1" : "1.2.840.10008.1.2.2");

  // File Meta group — ALWAYS Explicit VR Little Endian.
  const metaBody = concat([element(0x0002, 0x0010, "UI", ascii(ts), true, true)]);
  const meta = concat([
    element(
      0x0002,
      0x0000,
      "UL",
      new Uint8Array(new Uint32Array([metaBody.length]).buffer),
      true,
      true,
    ),
    metaBody,
  ]);

  const ds: Uint8Array[] = [];
  const DS = (g: number, e: number, s: string) =>
    ds.push(element(g, e, "DS", ascii(s), explicitVR, le));
  const US = (g: number, e: number, n: number) =>
    ds.push(element(g, e, "US", u16(n, le), explicitVR, le));

  ds.push(element(0x0008, 0x0060, "CS", ascii(spec.modality ?? "CT"), explicitVR, le));
  if (spec.sequence) ds.push(sequenceLE(spec.sequence));
  if (spec.sliceThickness !== undefined) DS(0x0018, 0x0050, String(spec.sliceThickness));
  if (spec.spacingBetweenSlices !== undefined)
    DS(0x0018, 0x0088, String(spec.spacingBetweenSlices));
  if (spec.position) DS(0x0020, 0x0032, spec.position.join("\\"));
  DS(0x0020, 0x0037, (spec.orientation ?? [1, 0, 0, 0, 1, 0]).join("\\"));
  US(0x0028, 0x0002, spec.samplesPerPixel ?? 1);
  ds.push(element(0x0028, 0x0004, "CS", ascii("MONOCHROME2"), explicitVR, le));
  if (spec.frames !== undefined)
    ds.push(element(0x0028, 0x0008, "IS", ascii(String(spec.frames)), explicitVR, le));
  US(0x0028, 0x0010, spec.rows);
  US(0x0028, 0x0011, spec.columns);
  DS(0x0028, 0x0030, (spec.pixelSpacing ?? [1, 1]).join("\\"));
  US(0x0028, 0x0100, bits);
  US(0x0028, 0x0101, bits);
  US(0x0028, 0x0103, spec.signed ? 1 : 0);
  if (spec.windowCenter !== undefined) DS(0x0028, 0x1050, String(spec.windowCenter));
  if (spec.windowWidth !== undefined) DS(0x0028, 0x1051, String(spec.windowWidth));
  if (spec.rescaleIntercept !== undefined) DS(0x0028, 0x1052, String(spec.rescaleIntercept));
  if (spec.rescaleSlope !== undefined) DS(0x0028, 0x1053, String(spec.rescaleSlope));

  const pixelVr = bits === 8 ? "OB" : "OW";
  const pixel = element(0x7fe0, 0x0010, pixelVr, pixelBytes(spec, le), explicitVR, le);

  const out = concat([new Uint8Array(128), ascii("DICM"), meta, concat(ds), pixel]);
  return out.buffer as ArrayBuffer;
}
