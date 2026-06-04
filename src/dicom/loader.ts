/**
 * Fetching DICOM into a volume, with progress reporting that mirrors the NIfTI
 * loader. Three entry points cover the ways DICOM arrives:
 *   - a multi-frame file at a URL,
 *   - a series described by an index.json manifest (one .dcm per slice),
 *   - a set of files the user dropped onto the page.
 */
import type { LoadProgress } from "../nifti";
import { buildDicomVolume } from "./series";
import type { DicomVolume } from "./types";

/** Stream a single file, reporting byte-level download progress. */
async function fetchBuffer(
  url: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<ArrayBuffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const total = Number(res.headers.get("content-length") ?? 0);
  if (!res.body || !onProgress) return await res.arrayBuffer();

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    loaded += value.byteLength;
    const frac = total ? Math.min(loaded / total, 1) * 0.8 : Math.min(0.6, loaded / 5e6);
    onProgress({ phase: "download", loaded, total, fraction: frac });
  }
  const merged = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    merged.set(c, off);
    off += c.byteLength;
  }
  return merged.buffer;
}

/** Load an enhanced (multi-frame) DICOM file — the whole stack in one buffer. */
export async function loadDicomMultiframeFromUrl(
  url: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<DicomVolume> {
  const buf = await fetchBuffer(url, onProgress);
  onProgress?.({ phase: "parse", loaded: 0, total: 0, fraction: 0.95 });
  return buildDicomVolume([buf]);
}

/**
 * Load a series from a manifest: a JSON array of per-slice filenames, resolved
 * relative to the manifest URL. Slices download sequentially so progress reads
 * naturally as "slice k / N".
 */
export async function loadDicomSeriesFromManifest(
  manifestUrl: string,
  onProgress?: (p: LoadProgress) => void,
): Promise<DicomVolume> {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${manifestUrl}: ${res.status}`);
  const files: string[] = await res.json();
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`Empty or invalid DICOM manifest at ${manifestUrl}.`);
  }
  const baseDir = manifestUrl.replace(/[^/]*$/, "");

  const buffers: ArrayBuffer[] = [];
  for (let i = 0; i < files.length; i++) {
    const r = await fetch(baseDir + files[i]);
    if (!r.ok) throw new Error(`Failed to fetch ${files[i]}: ${r.status}`);
    buffers.push(await r.arrayBuffer());
    onProgress?.({
      phase: "download",
      loaded: i + 1,
      total: files.length,
      fraction: ((i + 1) / files.length) * 0.85,
    });
  }
  onProgress?.({ phase: "parse", loaded: files.length, total: files.length, fraction: 0.95 });
  return buildDicomVolume(buffers);
}

/** Build a volume from files dropped onto the page (a folder of slices, or one file). */
export async function loadDicomFromFiles(files: File[]): Promise<DicomVolume> {
  const buffers = await Promise.all(files.map((f) => f.arrayBuffer()));
  return buildDicomVolume(buffers);
}
