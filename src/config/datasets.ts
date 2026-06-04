/** The sample volumes shown in the dataset picker. */
export interface Dataset {
  label: string;
  format: "nifti" | "dicom";
  /** Single-file fetch: a .nii(.gz) volume, or a multi-frame .dcm file. */
  url?: string;
  /** DICOM series: URL of an index.json listing the per-slice .dcm files. */
  manifest?: string;
}

/**
 * Base URL the dataset assets are fetched from. Empty (the default) keeps the
 * same-origin `/public` paths used in local dev; set `VITE_DATA_BASE` to serve
 * them from object storage — e.g. a public Supabase Storage bucket — so the
 * deploy doesn't have to ship the volumes itself.
 */
const DATA_BASE = (import.meta.env.VITE_DATA_BASE ?? "").replace(/\/+$/, "");

/** Resolve a `/`-rooted dataset path against `DATA_BASE`. */
const asset = (path: string) => `${DATA_BASE}${path}`;

export const DATASETS: Record<string, Dataset> = {
  chris_t1: {
    format: "nifti",
    url: asset("/nifti-mri-brain/chris_t1.nii.gz"),
    label: "MRI T1 — brain (uint8)",
  },
  mni152: {
    format: "nifti",
    url: asset("/nifti-mri-mni152/mni152.nii.gz"),
    label: "MRI — MNI152 template (uint8)",
  },
  ct_abdo: {
    format: "nifti",
    url: asset("/nifti-ct-abdomen/CT_Abdo.nii.gz"),
    label: "CT — abdomen (int16, HU)",
  },
  icat_cbct: {
    format: "dicom",
    manifest: asset("/dicom-ct-dental/index.json"),
    label: "DICOM — real dental CBCT (i-CAT)",
  },
};
