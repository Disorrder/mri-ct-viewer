import { maybeGunzip, parseDecompressed } from "./decode";
import type { LoadProgress, NiftiVolume } from "./types";

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
