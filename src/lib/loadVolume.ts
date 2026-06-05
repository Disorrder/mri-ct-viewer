/**
 * Format-aware loading: pick the right decoder for a dataset or a dropped file
 * and return the shared `Volume`. Keeps the NIfTI/DICOM dispatch in one place so
 * the App and the loader hook don't each reimplement it.
 */
import type { Dataset } from "../config/datasets";
import {
  buildDicomVolume,
  hasDicomMagic,
  loadDicomMultiframeFromUrl,
  loadDicomSeriesFromManifest,
} from "../dicom";
import { type LoadProgress, loadNiftiFromUrl, parseNifti } from "../nifti";
import type { Volume } from "../volume";

/** Fetch + decode a picker dataset (NIfTI file, DICOM multi-frame, or DICOM series). */
export function loadDataset(ds: Dataset, onProgress?: (p: LoadProgress) => void): Promise<Volume> {
  if (ds.format === "nifti") {
    if (!ds.url) throw new Error("NIfTI dataset is missing a url.");
    return loadNiftiFromUrl(ds.url, onProgress);
  }
  if (ds.url) return loadDicomMultiframeFromUrl(ds.url, onProgress);
  if (ds.manifest) return loadDicomSeriesFromManifest(ds.manifest, onProgress);
  throw new Error("DICOM dataset needs either a url (multi-frame) or a manifest (series).");
}

/**
 * Decode files dropped onto the page. Several files are taken as a DICOM series
 * (a dropped folder of slices); a single file is sniffed — DICOM by its "DICM"
 * magic, otherwise parsed as NIfTI. Progress is coarse (read → parse) since a
 * local file has no meaningful download phase.
 */
export async function loadDroppedFiles(
  files: File[],
  onProgress?: (p: LoadProgress) => void,
): Promise<Volume> {
  if (files.length === 0) throw new Error("No files to load.");
  onProgress?.({ phase: "download", loaded: 0, total: 0, fraction: 0.3 });
  if (files.length > 1) {
    const buffers = await Promise.all(files.map((f) => f.arrayBuffer()));
    onProgress?.({ phase: "parse", loaded: 0, total: 0, fraction: 0.6 });
    return buildDicomVolume(buffers);
  }
  const buf = await files[0].arrayBuffer();
  onProgress?.({ phase: "parse", loaded: 0, total: 0, fraction: 0.6 });
  return hasDicomMagic(buf) ? buildDicomVolume([buf]) : parseNifti(buf);
}

/** Human-readable progress label for a dataset load, matched to its source. */
export function progressLabel(ds: Dataset, p: LoadProgress): string {
  const mb = (b: number) => (b / 1048576).toFixed(1);
  const isSeries = ds.format === "dicom" && !ds.url;
  if (p.phase === "decompress") return "decompressing (gunzip)";
  if (p.phase === "parse") {
    return ds.format === "dicom" ? "parsing DICOM tags + pixels" : "parsing header + voxels";
  }
  if (isSeries) return `downloading slice ${p.loaded} / ${p.total}`;
  return p.total
    ? `downloading  ${mb(p.loaded)} / ${mb(p.total)} MB`
    : `downloading  ${mb(p.loaded)} MB`;
}
