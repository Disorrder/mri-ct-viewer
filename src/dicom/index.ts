/**
 * Minimal, dependency-free DICOM reader written for learning. Parses the
 * uncompressed transfer syntaxes and assembles a series (or a multi-frame file)
 * into the same `Volume` the rest of the app renders. See docs/dicom-vs-nifti.md.
 */
export {
  interleavedOrder,
  loadDicomFromFiles,
  loadDicomMultiframeFromUrl,
  loadDicomSeriesFromManifest,
  loadDicomSeriesProgressive,
  type SeriesStreamSink,
} from "./loader";
export { type DicomImage, hasDicomMagic, parseDicom, readDicomImage } from "./parser";
export { assembleDicomVolume, buildDicomVolume } from "./series";
export type { DicomMeta, DicomVolume } from "./types";
