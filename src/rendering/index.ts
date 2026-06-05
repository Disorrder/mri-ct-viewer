/**
 * Public surface of the rendering layer (Three.js / WebGL2). The app talks to
 * the VolumeViewer class and the shared name tables; the colorbar legend uses
 * the JS colormap port.
 */
export { colormapRGB } from "./colormaps";
export type { Colormap, SlabProjection, Technique } from "./glsl";
export { COLORMAPS, SLAB_PROJECTIONS, TECHNIQUES } from "./glsl";
export {
  type Layout,
  PLANE_COLORS,
  type SliceKey,
  type SlicePick,
  type ViewerParams,
  type ViewerStats,
  type ViewThumb,
  VolumeViewer,
} from "./VolumeViewer";
