/**
 * Fetching DICOM into a volume, with progress reporting that mirrors the NIfTI
 * loader. Three entry points cover the ways DICOM arrives:
 *   - a multi-frame file at a URL,
 *   - a series described by an index.json manifest (one .dcm per slice),
 *   - a set of files the user dropped onto the page.
 */
import type { LoadProgress } from "../nifti";
import { quantizeFrame, type VolumePreview } from "../volume";
import { type DicomImage, readDicomImage } from "./parser";
import { assembleDicomVolume, buildAffine, buildDicomVolume } from "./series";
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

/**
 * A bisection (van der Corput-style) ordering of [0..n-1]: the two ends first,
 * then repeated midpoints. Downloading slices in this order makes the volume
 * *densify uniformly* on screen — a coarse stack that keeps getting finer —
 * instead of filling in plane by plane from one end.
 *
 *   interleavedOrder(5) -> [0, 4, 2, 1, 3]
 */
export function interleavedOrder(n: number): number[] {
  if (n <= 0) return [];
  if (n === 1) return [0];
  const order: number[] = [];
  const seen = new Uint8Array(n);
  const push = (i: number) => {
    if (i >= 0 && i < n && !seen[i]) {
      seen[i] = 1;
      order.push(i);
    }
  };
  push(0);
  push(n - 1);
  // Breadth-first split of each interval at its midpoint (index pointer, not
  // Array.shift, so it stays linear).
  const queue: Array<[number, number]> = [[0, n - 1]];
  for (let head = 0; head < queue.length; head++) {
    const [lo, hi] = queue[head];
    const mid = (lo + hi) >> 1;
    if (mid !== lo && mid !== hi) {
      push(mid);
      queue.push([lo, mid], [mid, hi]);
    }
  }
  // Safety net: append anything the split somehow missed (it shouldn't).
  for (let i = 0; i < n; i++) push(i);
  return order;
}

/** Sink for streamed series loading: progress, the one-off geometry init, and z-slabs. */
export interface SeriesStreamSink {
  onProgress?: (p: LoadProgress) => void;
  onInit?: (preview: VolumePreview) => void;
  onSlab?: (z: number, data: Uint8Array<ArrayBuffer>) => void;
}

/**
 * How many slice downloads to keep in flight at once. A handful of parallel
 * fetches keeps the network pipe full (object-storage round-trips dominate the
 * load); ~6 matches the classic browser per-host cap and is HTTP/2-friendly.
 */
const SERIES_FETCH_CONCURRENCY = 6;

/**
 * Load a series like `loadDicomSeriesFromManifest`, but stream it for progressive
 * display: slices are fetched in `interleavedOrder` and each is pushed to the sink
 * as a quantized z-slab the moment it arrives, so the viewer fills a coarse stack
 * that keeps refining. A small worker pool keeps up to SERIES_FETCH_CONCURRENCY
 * downloads in flight at once while still dispatching in bisection order. Slabs are
 * quantized against a *provisional* range (the first slice to arrive); the returned
 * volume is assembled from all slices with the authoritative global window + spatial
 * sort, exactly like the non-streamed path.
 */
export async function loadDicomSeriesProgressive(
  manifestUrl: string,
  sink: SeriesStreamSink,
): Promise<DicomVolume> {
  const res = await fetch(manifestUrl);
  if (!res.ok) throw new Error(`Failed to fetch ${manifestUrl}: ${res.status}`);
  const files: string[] = await res.json();
  if (!Array.isArray(files) || files.length === 0) {
    throw new Error(`Empty or invalid DICOM manifest at ${manifestUrl}.`);
  }
  const baseDir = manifestUrl.replace(/[^/]*$/, "");
  const n = files.length;
  const order = interleavedOrder(n);

  const images: DicomImage[] = [];
  let provLo = 0;
  let provHi = 1;
  let inited = false;
  let done = 0;
  let lastError: unknown;

  // The first slice to arrive fixes the provisional intensity range + texture
  // geometry, before any slab is emitted. With parallel fetches that's whichever
  // download resolves first; it's only provisional (the final assemble re-windows
  // the whole volume), so an unrepresentative end slice here is harmless. Runs
  // synchronously, so concurrent tasks can't slip a slab in ahead of init.
  const initFromSlice = (img: DicomImage, frame: Float64Array) => {
    inited = true;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < frame.length; i++) {
      const v = frame[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    provLo = lo;
    provHi = hi > lo ? hi : lo + 1;
    const dz = img.spacingBetweenSlices ?? img.sliceThickness ?? 1;
    sink.onInit?.({
      nx: img.columns,
      ny: img.rows,
      nz: n,
      spacing: [img.pixelSpacing[1], img.pixelSpacing[0], dz],
      affine: buildAffine(
        img.orientation,
        img.position.length === 3 ? img.position : [0, 0, 0],
        img.pixelSpacing,
        dz,
      ),
    });
  };

  // Worker-pool fan-out: each puller takes the next index off a shared cursor, so
  // SERIES_FETCH_CONCURRENCY downloads run at once while the dispatch order still
  // follows the bisection sequence. `cursor++` is atomic (no await between read and
  // increment), so no two pullers grab the same slice.
  let cursor = 0;
  const puller = async () => {
    for (let k = cursor++; k < order.length; k = cursor++) {
      const idx = order[k];
      try {
        const r = await fetch(baseDir + files[idx]);
        if (!r.ok) throw new Error(`Failed to fetch ${files[idx]}: ${r.status}`);
        const img = readDicomImage(await r.arrayBuffer());
        const frame = img.readFrame(0);
        if (!inited) initFromSlice(img, frame);
        images.push(img);
        // Provisional placement at the manifest index. The final volume re-sorts by
        // ImagePositionPatient and replaces the whole texture, so an out-of-order
        // manifest self-corrects at the end; in the common ordered case it's exact.
        sink.onSlab?.(idx, quantizeFrame(frame, provLo, provHi));
      } catch (e) {
        lastError = e; // skip unreadable companions, like buildDicomVolume does
      }
      done++;
      sink.onProgress?.({ phase: "download", loaded: done, total: n, fraction: (done / n) * 0.85 });
    }
  };

  await Promise.all(Array.from({ length: Math.min(SERIES_FETCH_CONCURRENCY, n) }, puller));

  if (images.length === 0) {
    throw lastError instanceof Error ? lastError : new Error("No readable DICOM images found.");
  }
  sink.onProgress?.({ phase: "parse", loaded: n, total: n, fraction: 0.95 });
  return assembleDicomVolume(images);
}
