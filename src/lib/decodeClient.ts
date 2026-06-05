/**
 * Main-thread client for the decode worker. Owns a single lazily-created worker
 * (so importing this module — e.g. in tests — never spawns one) and turns its
 * message protocol into a promise + progress callback. Each request carries an
 * incrementing id so concurrent loads don't cross wires; the caller ignores a
 * superseded result via its own cancelled flag (see useVolumeLoader).
 */
import type { Dataset } from "../config/datasets";
import type { LoadProgress } from "../nifti";
import type { Volume, VolumePreview } from "../volume";
import type { DecodeMessage, DecodeRequest } from "../workers/decode.worker";

export type DecodeInput = { kind: "dataset"; dataset: Dataset } | { kind: "files"; files: File[] };

/** Callbacks the decode worker drives as a load progresses. */
export interface DecodeHandlers {
  onProgress?: (p: LoadProgress) => void;
  /** Progressive series only: geometry for the empty preview texture. */
  onInit?: (preview: VolumePreview) => void;
  /** Progressive series only: one decoded z-slab to patch into the preview. */
  onSlab?: (z: number, data: Uint8Array<ArrayBuffer>) => void;
}

let worker: Worker | null = null;
let seq = 0;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../workers/decode.worker.ts", import.meta.url), {
      type: "module",
    });
  }
  return worker;
}

/** Decode a dataset or dropped files in the worker, reporting progress as it goes. */
export function decodeVolume(input: DecodeInput, handlers: DecodeHandlers = {}): Promise<Volume> {
  const { onProgress, onInit, onSlab } = handlers;
  const id = ++seq;
  const w = getWorker();
  return new Promise<Volume>((resolve, reject) => {
    const handler = (e: MessageEvent<DecodeMessage>) => {
      const m = e.data;
      if (m.id !== id) return; // a message for a different (older) request
      if (m.type === "progress") {
        onProgress?.(m.p);
        return;
      }
      if (m.type === "preview-init") {
        onInit?.(m.preview);
        return;
      }
      if (m.type === "preview-slab") {
        onSlab?.(m.z, m.data);
        return;
      }
      w.removeEventListener("message", handler);
      if (m.type === "result") resolve(m.volume);
      else reject(new Error(m.message));
    };
    w.addEventListener("message", handler);
    w.postMessage({ id, ...input } as DecodeRequest);
  });
}
