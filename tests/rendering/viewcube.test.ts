import { describe, it, expect } from "vitest";
// These pure helpers currently live in VolumeViewer.ts; the refactor moves them
// to src/rendering/viewcube.ts and this import path follows.
import {
  axisAnatomy,
  faceLabelsFromAffine,
  triNormal,
  buildViewCubeGeometry,
} from "../../src/VolumeViewer";

describe("triNormal", () => {
  it("returns the cross product of the two triangle edges", () => {
    expect(triNormal([0, 0, 0], [1, 0, 0], [0, 1, 0])).toEqual([0, 0, 1]);
    expect(triNormal([0, 0, 0], [0, 1, 0], [0, 0, 1])).toEqual([1, 0, 0]);
  });
});

describe("axisAnatomy", () => {
  it("labels a column by its dominant RAS axis and sign", () => {
    expect(axisAnatomy([1, 0, 0])).toEqual(["R", "L"]);
    expect(axisAnatomy([-1, 0, 0])).toEqual(["L", "R"]);
    expect(axisAnatomy([0, 2, 0])).toEqual(["A", "P"]);
    expect(axisAnatomy([0, -2, 0])).toEqual(["P", "A"]);
    expect(axisAnatomy([0, 0, 3])).toEqual(["S", "I"]);
    expect(axisAnatomy([0, 0, -3])).toEqual(["I", "S"]);
  });

  it("picks the largest-magnitude component when axes mix", () => {
    expect(axisAnatomy([0.2, -0.9, 0.1])).toEqual(["P", "A"]); // y dominates, negative
  });
});

describe("faceLabelsFromAffine", () => {
  it("maps an identity (RAS) affine to R,L,A,P,S,I", () => {
    const identity = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    expect(faceLabelsFromAffine(identity)).toEqual(["R", "L", "A", "P", "S", "I"]);
  });

  it("flips a face pair when an axis is negated (radiological X)", () => {
    const flipX = [
      [-1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ];
    expect(faceLabelsFromAffine(flipX)).toEqual(["L", "R", "A", "P", "S", "I"]);
  });

  it("follows a permuted affine (voxel X along the superior axis)", () => {
    const permuted = [
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [1, 0, 0, 0],
      [0, 0, 0, 1],
    ];
    // col0 = (0,0,1) -> S/I, col1 = (1,0,0) -> R/L, col2 = (0,1,0) -> A/P
    expect(faceLabelsFromAffine(permuted)).toEqual(["S", "I", "R", "L", "A", "P"]);
  });
});

describe("buildViewCubeGeometry", () => {
  it("produces 26 facets: 6 faces + 12 edge + 8 corner bevels", () => {
    const { geometry, kinds } = buildViewCubeGeometry(0.62, 0.4);
    expect(kinds).toHaveLength(26);
    expect(kinds.filter((k) => k === "face")).toHaveLength(6);
    expect(kinds.filter((k) => k === "bevel")).toHaveLength(20);
    expect(geometry.groups).toHaveLength(26);
    expect(geometry.getAttribute("position")).toBeTruthy();
  });
});
