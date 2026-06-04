import { describe, expect, it } from "vitest";
import { type ControlValues, toViewerParams } from "../../src/config/controls";

const base: ControlValues = {
  layout: "MPR",
  mode: "Slices",
  technique: "DVR",
  colormap: "viridis",
  steps: 256,
  window: [0.1, 0.85],
  iso: 0.32,
  density: 0.4,
  sliceX: 0.5,
  sliceY: 0.4,
  sliceZ: 0.6,
  showX: true,
  showY: false,
  showZ: true,
  clipEnabled: true,
  clipX: [0.1, 0.9],
  clipY: [0.2, 0.8],
  clipZ: [0.3, 0.7],
  clipInvert: false,
  thickness: 2,
  slabMode: "MIP",
  autoRotate: true,
  background: "#0a0c11",
};

describe("toViewerParams", () => {
  it("maps named controls to their numeric indices", () => {
    const p = toViewerParams(base);
    expect(p.technique).toBe(2); // MIP, Isosurface, DVR
    expect(p.colormap).toBe(3); // gray, bone, hot, viridis, jet
    expect(p.slabProjection).toBe(1); // mean, MIP, MinIP
  });

  it("splits the interval sliders into low/high and min/max", () => {
    const p = toViewerParams(base);
    expect(p.windowLow).toBe(0.1);
    expect(p.windowHigh).toBe(0.85);
    expect(p.clipMin).toEqual([0.1, 0.2, 0.3]);
    expect(p.clipMax).toEqual([0.9, 0.8, 0.7]);
  });

  it("passes scalar and boolean fields through unchanged", () => {
    const p = toViewerParams(base);
    expect(p.layout).toBe("MPR");
    expect(p.mode).toBe("Slices");
    expect(p.steps).toBe(256);
    expect(p.iso).toBe(0.32);
    expect(p.showY).toBe(false);
    expect(p.clipInvert).toBe(false);
    expect(p.autoRotate).toBe(true);
    expect(p.background).toBe("#0a0c11");
  });
});
