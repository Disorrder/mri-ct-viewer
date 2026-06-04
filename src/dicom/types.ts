/**
 * DICOM data types. Where NIfTI packs everything into one fixed header, DICOM is
 * a flat list of `(group,element)` tags — but the *concepts* are identical (see
 * docs/dicom-vs-nifti.md). `DicomMeta` collects the handful of tags this viewer
 * needs to place and window a volume; `DicomVolume` is the decoded result.
 */
import type { VolumeBase } from "../volume";

export interface DicomMeta {
  modality: string; // (0008,0060) e.g. "CT", "MR"
  seriesDescription: string; // (0008,103E)
  transferSyntaxUid: string; // (0002,0010)
  transferSyntaxName: string; // human-readable name for the UID
  explicitVR: boolean;
  littleEndian: boolean;
  rows: number; // (0028,0010) = ny
  columns: number; // (0028,0011) = nx
  bitsAllocated: number; // (0028,0100)
  pixelRepresentation: number; // (0028,0103) 0 = unsigned, 1 = signed (two's complement)
  photometric: string; // (0028,0004) MONOCHROME1/2
  rescaleSlope: number; // (0028,1053) — display = stored * slope + intercept (HU for CT)
  rescaleIntercept: number; // (0028,1052)
  windowCenter: number | null; // (0028,1050) the radiologist's window hint
  windowWidth: number | null; // (0028,1051)
  pixelSpacing: [number, number]; // (0028,0030) [row spacing (y), column spacing (x)] in mm
  sliceThickness: number; // (0018,0050)
  sliceSpacing: number; // effective spacing between slice centers (mm)
  imageOrientation: number[]; // (0020,0037) 6 direction cosines
  imagePosition: number[]; // (0020,0032) first-slice patient position (3)
  sliceCount: number; // = nz
  /** Where the slices came from: a folder of files, or one multi-frame file. */
  source: "series" | "multiframe";
}

export interface DicomVolume extends VolumeBase {
  format: "dicom";
  meta: DicomMeta;
}
