/**
 * Decode worker: runs the whole fetch → decompress → parse → quantize pipeline
 * off the main thread. The per-voxel loops in the NIfTI/DICOM decoders block the
 * event loop for hundreds of ms on large volumes; doing them here keeps the page
 * responsive and lets the progress bar actually animate.
 *
 * The decode modules it pulls in (lib/loadVolume → nifti/dicom → volume) are all
 * DOM-free, so they run unchanged in a worker. The finished `Volume` is posted
 * back with its two big buffers (texture, histogram) in the transfer list, so
 * the hand-off is zero-copy.
 */
import type { Dataset } from "../config/datasets";
import { loadDataset, loadDroppedFiles } from "../lib/loadVolume";
import type { LoadProgress } from "../nifti";
import type { Volume } from "../volume";

export type DecodeRequest =
  | { id: number; kind: "dataset"; dataset: Dataset }
  | { id: number; kind: "files"; files: File[] };

export type DecodeMessage =
  | { id: number; type: "progress"; p: LoadProgress }
  | { id: number; type: "result"; volume: Volume }
  | { id: number; type: "error"; message: string };

// The project's tsconfig uses the DOM lib (not WebWorker, which would clash), so
// `self` is typed as a Window here. Cast to the slice of the worker scope we use:
// a request-typed onmessage and a postMessage that takes a transfer list.
interface WorkerCtx {
  onmessage: ((e: MessageEvent<DecodeRequest>) => void) | null;
  postMessage(message: DecodeMessage, options?: { transfer?: Transferable[] }): void;
}
const ctx = self as unknown as WorkerCtx;

ctx.onmessage = async (e: MessageEvent<DecodeRequest>) => {
  const req = e.data;
  const onProgress = (p: LoadProgress) =>
    ctx.postMessage({ id: req.id, type: "progress", p } satisfies DecodeMessage);

  try {
    const volume =
      req.kind === "dataset"
        ? await loadDataset(req.dataset, onProgress)
        : await loadDroppedFiles(req.files, onProgress);

    // Transfer the big arrays instead of copying them across the worker boundary.
    ctx.postMessage({ id: req.id, type: "result", volume } satisfies DecodeMessage, {
      transfer: [volume.texture.buffer, volume.histogram.buffer],
    });
  } catch (err) {
    ctx.postMessage({ id: req.id, type: "error", message: String(err) } satisfies DecodeMessage);
  }
};
