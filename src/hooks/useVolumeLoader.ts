import { useCallback, useEffect, useRef, useState } from "react";
import { DATASETS } from "../config/datasets";
import { loadNiftiFromUrl, type NiftiVolume, parseNifti } from "../nifti";

export interface LoadState {
  fraction: number;
  label: string;
}

/**
 * Owns dataset loading: fetches + parses the selected dataset (cached after the
 * first load) with progress reporting, and exposes loadFile for drag-and-dropped
 * volumes. Calls onVolume with each parsed volume; surfaces progress + error for
 * the UI. The dataset fetch is cancellable so a quick dataset switch can't apply
 * a stale volume.
 */
export function useVolumeLoader(datasetKey: string, onVolume: (vol: NiftiVolume) => void) {
  const cacheRef = useRef<Map<string, NiftiVolume>>(new Map());
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
        const vol = await loadNiftiFromUrl(ds.url, (p) => {
          if (cancelled) return;
          const mb = (b: number) => (b / 1048576).toFixed(1);
          const label =
            p.phase === "download"
              ? p.total
                ? `downloading  ${mb(p.loaded)} / ${mb(p.total)} MB`
                : `downloading  ${mb(p.loaded)} MB`
              : p.phase === "decompress"
                ? "decompressing (gunzip)"
                : "parsing header + voxels";
          setProgress({ fraction: p.fraction, label });
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

  // Load a user-dropped .nii / .nii.gz (our parser already takes an ArrayBuffer).
  const loadFile = useCallback(
    async (file: File) => {
      try {
        setError(null);
        setProgress({ fraction: 0.25, label: `reading ${file.name}` });
        const buf = await file.arrayBuffer();
        setProgress({ fraction: 0.6, label: `parsing ${file.name}` });
        const vol = await parseNifti(buf);
        setProgress({ fraction: 0.97, label: "building scene" });
        await new Promise((r) => requestAnimationFrame(r));
        onVolume(vol);
        setProgress({ fraction: 1, label: "ready" });
        setTimeout(() => setProgress(null), 280);
      } catch (e) {
        setError(`${file.name}: ${e}`);
        setProgress(null);
      }
    },
    [onVolume],
  );

  return { progress, error, loadFile };
}
