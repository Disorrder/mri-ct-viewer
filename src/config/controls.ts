import { COLORMAPS, SLAB_PROJECTIONS, TECHNIQUES, type ViewerParams } from "../rendering";

/**
 * The Leva control values the app reads. Named maps (technique / colormap /
 * slab projection) are strings here and become numeric indices in ViewerParams;
 * the two-thumb interval sliders (window / clip*) are [low, high] pairs.
 */
export interface ControlValues {
  layout: string;
  mode: string;
  technique: string;
  colormap: string;
  steps: number;
  window: number[];
  iso: number;
  density: number;
  sliceX: number;
  sliceY: number;
  sliceZ: number;
  showX: boolean;
  showY: boolean;
  showZ: boolean;
  clipEnabled: boolean;
  clipX: number[];
  clipY: number[];
  clipZ: number[];
  clipInvert: boolean;
  thickness: number;
  slabMode: string;
  autoRotate: boolean;
  background: string;
}

/** Map raw Leva control values to the numeric ViewerParams the renderer expects. */
export function toViewerParams(p: ControlValues): ViewerParams {
  return {
    layout: p.layout as ViewerParams["layout"],
    mode: p.mode as ViewerParams["mode"],
    technique: TECHNIQUES.indexOf(p.technique as (typeof TECHNIQUES)[number]),
    colormap: COLORMAPS.indexOf(p.colormap as (typeof COLORMAPS)[number]),
    steps: p.steps,
    windowLow: p.window[0],
    windowHigh: p.window[1],
    iso: p.iso,
    density: p.density,
    sliceX: p.sliceX,
    sliceY: p.sliceY,
    sliceZ: p.sliceZ,
    showX: p.showX,
    showY: p.showY,
    showZ: p.showZ,
    clipEnabled: p.clipEnabled,
    clipMin: [p.clipX[0], p.clipY[0], p.clipZ[0]],
    clipMax: [p.clipX[1], p.clipY[1], p.clipZ[1]],
    clipInvert: p.clipInvert,
    thickness: p.thickness,
    slabProjection: SLAB_PROJECTIONS.indexOf(p.slabMode as (typeof SLAB_PROJECTIONS)[number]),
    autoRotate: p.autoRotate,
    background: p.background,
  };
}
