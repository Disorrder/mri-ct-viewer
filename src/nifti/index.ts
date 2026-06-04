/**
 * Minimal, dependency-free NIfTI-1 reader written for learning. The public
 * surface is intentionally small; see docs/nifti-format.md for the format and
 * the behaviour each export guarantees.
 */
export { maybeGunzip, parseNifti } from "./decode";
export { loadNiftiFromUrl } from "./loader";
export type { LoadPhase, LoadProgress, NiftiHeader, NiftiVolume } from "./types";
