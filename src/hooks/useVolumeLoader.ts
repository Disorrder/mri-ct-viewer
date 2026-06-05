import { useCallback, useEffect, useRef, useState } from "react";
import { DATASETS } from "../config/datasets";
import { decodeVolume } from "../lib/decodeClient";
import { progressLabel } from "../lib/loadVolume";
import { nextPaint } from "../lib/nextPaint";
import type { Volume, VolumePreview } from "../volume";

export interface LoadState {
  fraction: number;
  label: string;
}

/** Progressive-preview hooks: a streamed series fills these in before onVolume. */
export interface PreviewSink {
  onInit?: (preview: VolumePreview) => void;
  onSlab?: (z: number, data: Uint8Array<ArrayBuffer>) => void;
}

/**
 * Owns dataset loading: fetches + decodes the selected dataset (cached after the
 * first load) with progress reporting, and exposes loadFiles for drag-and-dropped
 * volumes — a single .nii/.dcm, or a folder of DICOM slices. Calls onVolume with
 * each decoded volume; surfaces progress + error for the UI. The dataset fetch is
 * cancellable so a quick dataset switch can't apply a stale volume.
 *
 * For a streamed DICOM series the optional `preview` sink receives the empty-texture
 * geometry then a z-slab per slice, so the viewer can show a coarsening stack during
 * the load; preview calls are gated by the same cancellation as onVolume.
 */
export function useVolumeLoader(
  datasetKey: string,
  onVolume: (
    vol: Volume,
    onUploadProgress?: (frac: number) => void,
    shouldCancel?: () => boolean,
  ) => void | Promise<void>,
  preview?: PreviewSink,
) {
  const cacheRef = useRef<Map<string, Volume>>(new Map());
  // Held in a ref so a changing `preview` object doesn't re-run the load effect.
  const previewRef = useRef(preview);
  previewRef.current = preview;
  const [progress, setProgress] = useState<LoadState | null>({ fraction: 0, label: "connecting" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ds = DATASETS[datasetKey];

    (async () => {
      // Drives the load bar through the chunked GPU upload — the tail (0.95→1) of
      // every load, fresh or cached. Gated by the same cancellation as onVolume.
      const onUpload = (frac: number) => {
        if (!cancelled) setProgress({ fraction: 0.95 + frac * 0.05, label: "uploading to GPU" });
      };
      const cached = cacheRef.current.get(datasetKey);
      if (cached) {
        setError(null);
        // No fetch/decode, but still chunk the GPU upload so switching to a cached
        // dataset doesn't freeze on one big texImage3D.
        setProgress({ fraction: 0.95, label: "uploading to GPU" });
        await onVolume(cached, onUpload, () => cancelled);
        if (cancelled) return;
        setProgress({ fraction: 1, label: "ready" });
        setTimeout(() => !cancelled && setProgress(null), 280);
        return;
      }
      try {
        setError(null);
        setProgress({ fraction: 0, label: "connecting" });
        const vol = await decodeVolume(
          { kind: "dataset", dataset: ds },
          {
            onProgress: (p) => {
              if (cancelled) return;
              setProgress({ fraction: p.fraction, label: progressLabel(ds, p) });
            },
            onInit: (preview) => {
              if (cancelled) return;
              previewRef.current?.onInit?.(preview);
            },
            onSlab: (z, data) => {
              if (cancelled) return;
              previewRef.current?.onSlab?.(z, data);
            },
          },
        );
        if (cancelled) return;
        cacheRef.current.set(datasetKey, vol);
        setProgress({ fraction: 0.95, label: "uploading to GPU" });
        await nextPaint(); // let the last decode % paint before the upload starts
        if (cancelled) return;
        await onVolume(vol, onUpload, () => cancelled); // chunked, non-blocking GPU upload
        if (cancelled) return;
        setProgress({ fraction: 1, label: "ready" });
        setTimeout(() => !cancelled && setProgress(null), 280);
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        setProgress(null);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [datasetKey, onVolume]);

  // Load user-dropped files: a single .nii/.nii.gz/.dcm, or a folder of DICOM slices.
  const loadFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      const what = files.length > 1 ? `${files.length} DICOM slices` : files[0].name;
      try {
        setError(null);
        setProgress({ fraction: 0.1, label: `reading ${what}` });
        const vol = await decodeVolume(
          { kind: "files", files },
          {
            onProgress: (p) => {
              setProgress({
                fraction: p.fraction,
                label: `${p.phase === "parse" ? "building" : "reading"} ${what}`,
              });
            },
          },
        );
        setProgress({ fraction: 0.95, label: "uploading to GPU" });
        await nextPaint();
        await onVolume(vol, (frac) =>
          setProgress({ fraction: 0.95 + frac * 0.05, label: "uploading to GPU" }),
        );
        setProgress({ fraction: 1, label: "ready" });
        setTimeout(() => setProgress(null), 280);
      } catch (e) {
        setError(`${what}: ${e}`);
        setProgress(null);
      }
    },
    [onVolume],
  );

  return { progress, error, loadFiles };
}
