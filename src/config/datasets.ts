/** The sample volumes served from /public, shown in the dataset picker. */
export interface Dataset {
  url: string;
  label: string;
}

export const DATASETS: Record<string, Dataset> = {
  chris_t1: { url: "/chris_t1.nii.gz", label: "MRI T1 — brain (uint8)" },
  mni152: { url: "/mni152.nii.gz", label: "MRI — MNI152 template (uint8)" },
  ct_abdo: { url: "/CT_Abdo.nii.gz", label: "CT — abdomen (int16, HU)" },
};
