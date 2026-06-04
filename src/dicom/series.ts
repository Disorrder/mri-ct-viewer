/**
 * Turn one or more parsed DICOM images into a single 3-D volume.
 *
 * Two shapes feed in here (see docs/dicom-vs-nifti.md):
 *   - a *series*: many single-frame files, one per slice — the usual CT/MR case.
 *     We sort them along the slice normal (DICOM doesn't guarantee file order)
 *     and infer the inter-slice spacing from the patient positions.
 *   - a *multi-frame* file: the whole stack in one buffer (enhanced DICOM).
 * Either way we stack the frames into one Float64Array and hand it to the shared
 * `quantize` so DICOM and NIfTI produce identical texture/window/histogram.
 */
import { quantize } from "../volume";
import { type DicomImage, readDicomImage } from "./parser";
import type { DicomMeta, DicomVolume } from "./types";

type Slice = { img: DicomImage; frame: number; sort: number; ipp: number[] };

export function buildDicomVolume(buffers: ArrayBuffer[]): DicomVolume {
  if (buffers.length === 0) throw new Error("No DICOM files provided.");
  // Parse leniently: a dropped folder often carries non-image companions — an
  // index.json, a README, a DICOMDIR, a color secondary-capture — that we skip
  // rather than fail the whole series on. Keep the last parse error so an
  // all-unreadable drop (e.g. a fully compressed series) still reports *why*.
  const images: DicomImage[] = [];
  let lastError: unknown;
  for (const buf of buffers) {
    try {
      images.push(readDicomImage(buf));
    } catch (e) {
      lastError = e;
    }
  }
  if (images.length === 0) {
    throw lastError instanceof Error ? lastError : new Error("No readable DICOM images found.");
  }
  const first = images[0];

  let source: "series" | "multiframe";
  let ordered: Slice[];
  let dz: number;
  let origin: number[];

  if (images.length === 1 && first.frames > 1) {
    source = "multiframe";
    dz = first.spacingBetweenSlices ?? first.sliceThickness ?? 1;
    origin = first.position.length === 3 ? first.position : [0, 0, 0];
    ordered = Array.from({ length: first.frames }, (_, f) => ({
      img: first,
      frame: f,
      sort: f,
      ipp: origin,
    }));
  } else {
    source = "series";
    const normal = sliceNormal(first.orientation);
    ordered = images.map((img) => {
      if (img.columns !== first.columns || img.rows !== first.rows) {
        throw new Error("DICOM series has slices of differing dimensions.");
      }
      const ipp = img.position.length === 3 ? img.position : [0, 0, 0];
      return { img, frame: 0, sort: dot(ipp, normal), ipp };
    });
    // DICOM doesn't promise the files arrive in spatial order — sort them.
    ordered.sort((a, b) => a.sort - b.sort);
    origin = ordered[0].ipp;
    dz =
      spacingFromPositions(ordered.map((s) => s.sort)) ??
      first.spacingBetweenSlices ??
      first.sliceThickness ??
      1;
  }

  const nx = first.columns;
  const ny = first.rows;
  const nz = ordered.length;
  const frameLen = nx * ny;
  const n = frameLen * nz;

  // Stack frames in z order. DICOM pixel order (column-fastest, then row) already
  // matches the texture's x + y*nx + z*nx*ny layout, so a straight copy suffices.
  const raw = new Float64Array(n);
  ordered.forEach((s, k) => {
    raw.set(s.img.readFrame(s.frame), k * frameLen);
  });

  const slope = first.rescaleSlope === 0 ? 1 : first.rescaleSlope;
  const stats = quantize(raw, n, slope, first.rescaleIntercept);

  const spacing: [number, number, number] = [first.pixelSpacing[1], first.pixelSpacing[0], dz];
  const affine = buildAffine(first.orientation, origin, first.pixelSpacing, dz);

  const meta: DicomMeta = {
    modality: first.modality,
    seriesDescription: first.seriesDescription,
    transferSyntaxUid: first.transferSyntaxUid,
    transferSyntaxName: first.transferSyntaxName,
    explicitVR: first.explicitVR,
    littleEndian: first.littleEndian,
    rows: ny,
    columns: nx,
    bitsAllocated: first.bitsAllocated,
    pixelRepresentation: first.signed ? 1 : 0,
    photometric: first.photometric,
    rescaleSlope: first.rescaleSlope,
    rescaleIntercept: first.rescaleIntercept,
    windowCenter: first.windowCenter,
    windowWidth: first.windowWidth,
    pixelSpacing: first.pixelSpacing,
    sliceThickness: first.sliceThickness,
    sliceSpacing: dz,
    imageOrientation: first.orientation,
    imagePosition: origin,
    sliceCount: nz,
    source,
  };

  return { format: "dicom", nx, ny, nz, spacing, affine, meta, ...stats };
}

// --- Geometry helpers --------------------------------------------------------

function dot(a: number[], b: number[]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function cross(a: number[], b: number[]): number[] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** Slice normal = rowCosines × colCosines (defaults to +Z when no orientation). */
function sliceNormal(orientation: number[]): number[] {
  if (orientation.length !== 6) return [0, 0, 1];
  return cross(orientation.slice(0, 3), orientation.slice(3, 6));
}

/** Median spacing between consecutive (sorted) slice positions, or null. */
function spacingFromPositions(sorted: number[]): number | null {
  if (sorted.length < 2) return null;
  const diffs: number[] = [];
  for (let i = 1; i < sorted.length; i++) diffs.push(Math.abs(sorted[i] - sorted[i - 1]));
  diffs.sort((a, b) => a - b);
  const mid = diffs[Math.floor(diffs.length / 2)];
  return mid > 0 ? mid : null;
}

/**
 * Voxel→world affine in RAS, the convention the orientation cube labels expect.
 * Columns map voxel (i=column, j=row, k=slice) to patient space:
 *   i → rowCosines * colSpacing,  j → colCosines * rowSpacing,  k → normal * dz.
 * DICOM patient coordinates are LPS, so we negate the X and Y rows to get RAS.
 */
function buildAffine(
  orientation: number[],
  position: number[],
  pixelSpacing: [number, number],
  dz: number,
): number[][] {
  const row = orientation.length === 6 ? orientation.slice(0, 3) : [1, 0, 0];
  const col = orientation.length === 6 ? orientation.slice(3, 6) : [0, 1, 0];
  const nrm = cross(row, col);
  const dc = pixelSpacing[1]; // column spacing → x
  const dr = pixelSpacing[0]; // row spacing → y
  const t = position.length === 3 ? position : [0, 0, 0];
  return [
    [-dc * row[0], -dr * col[0], -dz * nrm[0], -t[0]],
    [-dc * row[1], -dr * col[1], -dz * nrm[1], -t[1]],
    [dc * row[2], dr * col[2], dz * nrm[2], t[2]],
    [0, 0, 0, 1],
  ];
}
