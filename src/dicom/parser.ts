/**
 * A minimal, dependency-free DICOM reader written for learning — the DICOM
 * counterpart to src/nifti. It handles the *uncompressed* transfer syntaxes
 * (Implicit / Explicit VR, little- and big-endian); compressed pixel data
 * (JPEG / JPEG-LS / JPEG 2000 / RLE) is intentionally out of scope.
 *
 * Layout of a Part-10 file:
 *   [ 128-byte preamble ][ "DICM" ][ File Meta group (0002, always Explicit LE) ]
 *   [ dataset in the transfer syntax named by (0002,0010) ]
 * A dataset is a flat list of elements: (group,element)(VR?)(length)(value).
 */
import type { LoadProgress } from "../nifti";

/** Pack a (group,element) pair into one number for Map keys. */
const TAG = (group: number, element: number): number => ((group << 16) | element) >>> 0;

const PIXEL_DATA = TAG(0x7fe0, 0x0010);
const TRANSFER_SYNTAX_UID = TAG(0x0002, 0x0010);

const TRANSFER_SYNTAXES: Record<
  string,
  { name: string; explicitVR: boolean; littleEndian: boolean }
> = {
  "1.2.840.10008.1.2": { name: "Implicit VR Little Endian", explicitVR: false, littleEndian: true },
  "1.2.840.10008.1.2.1": {
    name: "Explicit VR Little Endian",
    explicitVR: true,
    littleEndian: true,
  },
  "1.2.840.10008.1.2.2": { name: "Explicit VR Big Endian", explicitVR: true, littleEndian: false },
};

// VRs whose explicit-form header is 12 bytes: 2 reserved + a 4-byte length.
const LONG_VR = new Set(["OB", "OW", "OF", "OD", "OL", "OV", "SQ", "UT", "UN", "UC", "UR"]);

interface RawTag {
  vr: string;
  valueOffset: number;
  length: number;
}

interface Element extends RawTag {
  group: number;
  element: number;
  next: number;
}

export interface DicomDataset {
  tags: Map<number, RawTag>;
  dv: DataView;
  littleEndian: boolean;
  explicitVR: boolean;
  transferSyntaxUid: string;
}

/** Does the buffer have the Part-10 "DICM" magic at byte 128? */
export function hasDicomMagic(buf: ArrayBuffer): boolean {
  return buf.byteLength >= 132 && magicAt(new DataView(buf), 128) === "DICM";
}

function magicAt(dv: DataView, off: number): string {
  return String.fromCharCode(
    dv.getUint8(off),
    dv.getUint8(off + 1),
    dv.getUint8(off + 2),
    dv.getUint8(off + 3),
  );
}

/** Read one explicit-VR element header at `pos` (pos → group). */
function readExplicit(dv: DataView, pos: number, le: boolean): Element {
  const group = dv.getUint16(pos, le);
  const element = dv.getUint16(pos + 2, le);
  const vr = String.fromCharCode(dv.getUint8(pos + 4), dv.getUint8(pos + 5));
  let length: number;
  let valueOffset: number;
  if (LONG_VR.has(vr)) {
    length = dv.getUint32(pos + 8, le); // bytes 6..7 are reserved
    valueOffset = pos + 12;
  } else {
    length = dv.getUint16(pos + 6, le);
    valueOffset = pos + 8;
  }
  return {
    group,
    element,
    vr,
    length,
    valueOffset,
    next: stepPast(dv, valueOffset, length, le, true),
  };
}

/** Read one implicit-VR element header at `pos` — no VR in the stream. */
function readImplicit(dv: DataView, pos: number, le: boolean): Element {
  const group = dv.getUint16(pos, le);
  const element = dv.getUint16(pos + 2, le);
  const length = dv.getUint32(pos + 4, le);
  const valueOffset = pos + 8;
  return {
    group,
    element,
    vr: "UN",
    length,
    valueOffset,
    next: stepPast(dv, valueOffset, length, le, false),
  };
}

/** Offset just past an element's value. Real scans carry sequences (e.g. the
 *  de-identification record); we don't read them, but must step over them —
 *  including undefined-length (0xFFFFFFFF) sequences, which end at a delimiter
 *  rather than after a known byte count. (Compressed pixel data, the other use
 *  of undefined length, is rejected earlier by the transfer-syntax check.) */
function stepPast(
  dv: DataView,
  valueOffset: number,
  length: number,
  le: boolean,
  explicitVR: boolean,
): number {
  if (length === 0xffffffff) return skipUndefinedSequence(dv, valueOffset, le, explicitVR);
  return valueOffset + length;
}

/** Skip an undefined-length sequence: a run of Items ending at the Sequence
 *  Delimitation Item (FFFE,E0DD). Item/delimiter tags never carry a VR. */
function skipUndefinedSequence(
  dv: DataView,
  pos: number,
  le: boolean,
  explicitVR: boolean,
): number {
  while (pos + 8 <= dv.byteLength) {
    const group = dv.getUint16(pos, le);
    const element = dv.getUint16(pos + 2, le);
    const length = dv.getUint32(pos + 4, le);
    pos += 8;
    if (group === 0xfffe && element === 0xe0dd) return pos; // Sequence Delimitation Item
    if (group === 0xfffe && element === 0xe000) {
      pos = length === 0xffffffff ? skipUndefinedItem(dv, pos, le, explicitVR) : pos + length;
    } else {
      return pos; // malformed — bail without looping forever
    }
  }
  return dv.byteLength;
}

/** Skip an undefined-length item: data elements until the Item Delimitation
 *  Item (FFFE,E00D); nested undefined-length sequences recurse via readElement. */
function skipUndefinedItem(dv: DataView, pos: number, le: boolean, explicitVR: boolean): number {
  while (pos + 8 <= dv.byteLength) {
    if (dv.getUint16(pos, le) === 0xfffe && dv.getUint16(pos + 2, le) === 0xe00d) {
      return pos + 8; // Item Delimitation Item (tag + zero length)
    }
    const el = explicitVR ? readExplicit(dv, pos, le) : readImplicit(dv, pos, le);
    pos = el.next;
  }
  return dv.byteLength;
}

/** Scan a DICOM buffer into a flat tag map (stops once PixelData is reached). */
export function parseDicom(buf: ArrayBuffer): DicomDataset {
  const dv = new DataView(buf);
  let pos: number;
  let metaPresent = false;
  if (hasDicomMagic(buf)) {
    pos = 132;
    metaPresent = true;
  } else {
    pos = 0; // a bare dataset with no preamble — assume Implicit VR LE
  }

  let transferSyntaxUid = "1.2.840.10008.1.2";
  if (metaPresent) {
    // The File Meta group (0002) is ALWAYS Explicit VR Little Endian, whatever
    // the dataset's own transfer syntax turns out to be.
    while (pos + 8 <= buf.byteLength) {
      const group = dv.getUint16(pos, true);
      if (group !== 0x0002) break;
      const el = readExplicit(dv, pos, true);
      if (TAG(el.group, el.element) === TRANSFER_SYNTAX_UID) {
        transferSyntaxUid = readString(dv, el.valueOffset, el.length);
      }
      pos = el.next;
    }
  }

  const syntax = TRANSFER_SYNTAXES[transferSyntaxUid];
  if (!syntax) {
    throw new Error(
      `Unsupported DICOM transfer syntax ${transferSyntaxUid} — this reader handles only uncompressed pixel data (Implicit/Explicit VR).`,
    );
  }
  const { explicitVR, littleEndian } = syntax;

  const tags = new Map<number, RawTag>();
  while (pos + 8 <= buf.byteLength) {
    const el = explicitVR
      ? readExplicit(dv, pos, littleEndian)
      : readImplicit(dv, pos, littleEndian);
    tags.set(TAG(el.group, el.element), {
      vr: el.vr,
      valueOffset: el.valueOffset,
      length: el.length,
    });
    if (TAG(el.group, el.element) === PIXEL_DATA) break; // last thing we need
    pos = el.next;
  }

  return { tags, dv, littleEndian, explicitVR, transferSyntaxUid };
}

// --- Value readers -----------------------------------------------------------

/** ASCII string, trimming the trailing NUL/space DICOM uses to keep even length. */
function readString(dv: DataView, off: number, length: number): string {
  let s = "";
  for (let i = 0; i < length; i++) s += String.fromCharCode(dv.getUint8(off + i));
  return s.replace(/[\0 ]+$/, "");
}

// --- High-level image extraction ---------------------------------------------

export interface DicomImage {
  columns: number; // nx
  rows: number; // ny
  frames: number;
  bitsAllocated: number;
  signed: boolean;
  rescaleSlope: number;
  rescaleIntercept: number;
  windowCenter: number | null;
  windowWidth: number | null;
  pixelSpacing: [number, number]; // [row spacing (y), column spacing (x)] mm
  sliceThickness: number;
  spacingBetweenSlices: number | null;
  orientation: number[]; // 6 cosines, or [] when absent
  position: number[]; // 3 coords, or [] when absent
  modality: string;
  seriesDescription: string;
  photometric: string;
  transferSyntaxUid: string;
  transferSyntaxName: string;
  explicitVR: boolean;
  littleEndian: boolean;
  /** Read one frame's stored pixels into a fresh Float64Array (length = columns*rows). */
  readFrame(frameIndex: number): Float64Array;
}

/** Parse a DICOM buffer into the fields this viewer needs, plus a pixel reader. */
export function readDicomImage(buf: ArrayBuffer): DicomImage {
  const ds = parseDicom(buf);
  const { dv, littleEndian: le, tags } = ds;

  const u16 = (g: number, e: number, dflt: number): number => {
    const t = tags.get(TAG(g, e));
    return t && t.length >= 2 ? dv.getUint16(t.valueOffset, le) : dflt;
  };
  const str = (g: number, e: number): string => {
    const t = tags.get(TAG(g, e));
    return t ? readString(dv, t.valueOffset, t.length) : "";
  };
  const nums = (g: number, e: number): number[] => {
    const s = str(g, e);
    return s ? s.split("\\").map(Number) : [];
  };
  const num1 = (g: number, e: number, dflt: number): number => {
    const arr = nums(g, e);
    return arr.length && Number.isFinite(arr[0]) ? arr[0] : dflt;
  };

  const samplesPerPixel = u16(0x0028, 0x0002, 1);
  if (samplesPerPixel !== 1) {
    throw new Error(
      `Only single-channel (grayscale) DICOM is supported, got SamplesPerPixel=${samplesPerPixel}.`,
    );
  }

  const columns = u16(0x0028, 0x0011, 0);
  const rows = u16(0x0028, 0x0010, 0);
  if (!columns || !rows) throw new Error("DICOM image has no Rows/Columns.");
  const bitsAllocated = u16(0x0028, 0x0100, 16);
  if (bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw new Error(`Unsupported BitsAllocated=${bitsAllocated} (only 8 or 16).`);
  }
  const signed = u16(0x0028, 0x0103, 0) === 1;

  const framesStr = str(0x0028, 0x0008);
  const frames = framesStr ? Math.max(1, Number.parseInt(framesStr, 10)) : 1;

  const ps = nums(0x0028, 0x0030);
  const pixelSpacing: [number, number] = ps.length >= 2 ? [ps[0], ps[1]] : [1, 1];
  const spacingTag = nums(0x0018, 0x0088);

  const wc = nums(0x0028, 0x1050);
  const ww = nums(0x0028, 0x1051);

  const pixelData = tags.get(PIXEL_DATA);
  if (!pixelData) throw new Error("DICOM file has no PixelData (7FE0,0010).");
  const bytesPer = bitsAllocated / 8;
  const frameLen = columns * rows;

  const readFrame = (frameIndex: number): Float64Array => {
    const out = new Float64Array(frameLen);
    const base = pixelData.valueOffset + frameIndex * frameLen * bytesPer;
    if (bytesPer === 1) {
      for (let i = 0; i < frameLen; i++)
        out[i] = signed ? dv.getInt8(base + i) : dv.getUint8(base + i);
    } else {
      for (let i = 0; i < frameLen; i++) {
        out[i] = signed ? dv.getInt16(base + i * 2, le) : dv.getUint16(base + i * 2, le);
      }
    }
    return out;
  };

  return {
    columns,
    rows,
    frames,
    bitsAllocated,
    signed,
    rescaleSlope: num1(0x0028, 0x1053, 1),
    rescaleIntercept: num1(0x0028, 0x1052, 0),
    windowCenter: wc.length ? wc[0] : null,
    windowWidth: ww.length ? ww[0] : null,
    pixelSpacing,
    sliceThickness: num1(0x0018, 0x0050, 1),
    spacingBetweenSlices: spacingTag.length ? spacingTag[0] : null,
    orientation: nums(0x0020, 0x0037),
    position: nums(0x0020, 0x0032),
    modality: str(0x0008, 0x0060),
    seriesDescription: str(0x0008, 0x103e),
    photometric: str(0x0028, 0x0004),
    transferSyntaxUid: ds.transferSyntaxUid,
    transferSyntaxName: TRANSFER_SYNTAXES[ds.transferSyntaxUid]?.name ?? ds.transferSyntaxUid,
    explicitVR: ds.explicitVR,
    littleEndian: le,
    readFrame,
  };
}

export type { LoadProgress };
