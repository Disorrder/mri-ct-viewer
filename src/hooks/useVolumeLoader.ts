import { useCallback, useEffect, useRef, useState } from "react";
import { DATASETS } from "../config/datasets";
import { loadDataset, loadDroppedFiles, progressLabel } from "../lib/loadVolume";
import type { Volume } from "../volume";

export interface LoadState {
  fraction: number;
  label: string;
}

/**
 * Owns dataset loading: fetches + decodes the selected dataset (cached after the
 * first load) with progress reporting, and exposes loadFiles for drag-and-dropped
 * volumes — a single .nii/.dcm, or a folder of DICOM slices. Calls onVolume with
 * each decoded volume; surfaces progress + error for the UI. The dataset fetch is
 * cancellable so a quick dataset switch can't apply a stale volume.
 */
export function useVolumeLoader(datasetKey: string, onVolume: (vol: Volume) => void) {
  const cacheRef = useRef<Map<string, Volume>>(new Map());
  const [progress, setProgress] = useState<LoadState | null>({ fraction: 0, label: "connecting" });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const ds = DATASETS[datasetKey];

    (async () => {
      const cached = cacheRef.current.get(datasetKey);
      if (cached) {
        setError(null);
        onVolume(cached); // instant — no fetch, no progress bar
        setProgress(null);
        return;
      }
      try {
        setError(null);
        setProgress({ fraction: 0, label: "connecting" });
        const vol = await loadDataset(ds, (p) => {
          if (cancelled) return;
          setProgress({ fraction: p.fraction, label: progressLabel(ds, p) });
        });
        if (cancelled) return;
        cacheRef.current.set(datasetKey, vol);
        setProgress({ fraction: 0.97, label: "building scene (GPU upload)" });
        await new Promise((r) => requestAnimationFrame(r)); // let 97% paint first
        if (cancelled) return;
        onVolume(vol);
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
        setProgress({ fraction: 0.3, label: `reading ${what}` });
        const vol = await loadDroppedFiles(files);
        setProgress({ fraction: 0.97, label: "building scene" });
        await new Promise((r) => requestAnimationFrame(r));
        onVolume(vol);
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
