import type { Layout } from "../rendering";

/** The three single orthogonal planes (the phone top-bar fullscreen views). */
export const SINGLE_PLANES = ["axial", "coronal", "sagittal"] as const;
export type SinglePlane = (typeof SINGLE_PLANES)[number];

export const isSinglePlane = (l: string): l is SinglePlane =>
  (SINGLE_PLANES as readonly string[]).includes(l);

/** Any 2D slice layout — the MPR grid or one fullscreen plane (slice controls + crosshair apply). */
export const isOrtho = (l: string) => l === "MPR" || isSinglePlane(l);

/** A single top-bar view tab. */
export type ViewTab = { key: Layout; label: string };

/** The four views the phone top bar switches between. */
export const PHONE_TABS: ViewTab[] = [
  { key: "3D", label: "3D" },
  { key: "axial", label: "Axial" },
  { key: "coronal", label: "Coronal" },
  { key: "sagittal", label: "Sagittal" },
];

/** The two views the desktop top bar switches between (single planes stay phone-only). */
export const DESKTOP_TABS: ViewTab[] = [
  { key: "3D", label: "3D" },
  { key: "MPR", label: "2×2 MPR" },
];
