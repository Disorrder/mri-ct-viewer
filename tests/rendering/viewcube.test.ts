import { describe, expect, it } from "vitest";
import {
  axisAnatomy,
  buildViewCubeGeometry,
  faceLabelsFromAffine,
  homeCameraDirs,
  triNormal,
} from "../../src/rendering/viewcube";

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

describe("homeCameraDirs", () => {
  const identity = [
    [1, 0, 0, 0],
    [0, 1, 0, 0],
    [0, 0, 1, 0],
    [0, 0, 0, 1],
  ];
  const near = (a: number[], b: number[]) => {
    for (let i = 0; i < a.length; i++) expect(a[i]).toBeCloseTo(b[i], 6);
  };

  it("puts the camera on the anterior+superior+right side of an RAS volume", () => {
    const { dir, up } = homeCameraDirs(identity);
    // RAS [0.6, 1, 0.5] normalized — anterior dominant, looking the patient in the face.
    const n = Math.hypot(0.6, 1, 0.5);
    near(dir, [0.6 / n, 1 / n, 0.5 / n]);
    expect(dir[1]).toBeGreaterThan(0); // anterior side, not behind the head
    near(up, [0, 0, 1]); // up follows superior
  });

  it("returns unit vectors", () => {
    const { dir, up } = homeCameraDirs(identity);
    expect(Math.hypot(...dir)).toBeCloseTo(1, 6);
    expect(Math.hypot(...up)).toBeCloseTo(1, 6);
  });

  it("follows the affine so it still faces anterior when axes are flipped/scaled", () => {
    // Voxel +Y points posterior (-A), +Z points inferior (-S), with 2mm spacing.
    const flipped = [
      [2, 0, 0, 0],
      [0, -2, 0, 0],
      [0, 0, -2, 0],
      [0, 0, 0, 1],
    ];
    const { dir, up } = homeCameraDirs(flipped);
    expect(dir[1]).toBeLessThan(0); // camera swings to box -Y, which is the anterior side
    near(up, [0, 0, -1]); // superior is box -Z here, so up flips to match
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
