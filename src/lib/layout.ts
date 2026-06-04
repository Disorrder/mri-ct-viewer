import type { Layout } from "../rendering";

/** The three single orthogonal planes (the phone top-bar fullscreen views). */
export const SINGLE_PLANES = ["axial", "coronal", "sagittal"] as const;
export type SinglePlane = (typeof SINGLE_PLANES)[number];

export const isSinglePlane = (l: string): l is SinglePlane =>
  (SINGLE_PLANES as readonly string[]).includes(l);

/** Any 2D slice layout — the MPR grid or one fullscreen plane (slice controls + crosshair apply). */
export const isOrtho = (l: string) => l === "MPR" || isSinglePlane(l);

/** The four views the phone top bar switches between. */
export const PHONE_TABS: { key: Layout; label: string }[] = [
  { key: "3D", label: "3D" },
  { key: "axial", label: "Axial" },
  { key: "coronal", label: "Coronal" },
  { key: "sagittal", label: "Sagittal" },
];
