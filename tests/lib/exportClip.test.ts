import { describe, expect, it } from "vitest";
import { type ClipBox, cropToClip, exportClippedNifti, FULL_BOX } from "../../src/lib/exportClip";
import { type EncodableVolume, encodeNifti1, parseNifti } from "../../src/nifti";

/** What exportClippedNifti writes, but as a raw ArrayBuffer (jsdom's Blob can't unwrap). */
function encodeCrop(vol: EncodableVolume, box: ClipBox): ArrayBuffer {
  const c = cropToClip(vol, box);
  return encodeNifti1({
    nx: c.nx,
    ny: c.ny,
    nz: c.nz,
    spacing: c.spacing,
    affine: c.affine,
    sclSlope: c.sclSlope,
    sclInter: c.sclInter,
    data: c.texture,
  });
}

/**
 * Build a tiny synthetic volume whose voxel at (x,y,z) equals its flat index, so
 * crop extraction is trivial to assert against. Identity affine + unit spacing.
 */
function makeVolume(nx: number, ny: number, nz: number): EncodableVolume {
  const texture = new Uint8Array(nx * ny * nz);
  for (let i = 0; i < texture.length; i++) texture[i] = i;
  return {
    nx,
    ny,
    nz,
    texture: texture as Uint8Array<ArrayBuffer>,
    spacing: [1, 1, 1],
    affine: [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [0, 0, 1, 0],
      [0, 0, 0, 1],
    ],
    displayMin: 0,
    displayMax: 255,
  };
}

describe("cropToClip", () => {
  it("extracts the box sub-volume with the right voxels", () => {
    const vol = makeVolume(4, 4, 4);
    // Box [0.25,0.75] on each axis → voxel index range [1,3) → a 2×2×2 block.
    const c = cropToClip(vol, { min: [0.25, 0.25, 0.25], max: [0.75, 0.75, 0.75] });
    expect([c.nx, c.ny, c.nz]).toEqual([2, 2, 2]);
    // First kept voxel is old (1,1,1) = 1 + 1*4 + 1*16 = 21.
    expect(c.texture[0]).toBe(21);
    // Walk the whole block and confirm every value matches the source layout.
    let w = 0;
    for (let z = 1; z < 3; z++)
      for (let y = 1; y < 3; y++)
        for (let x = 1; x < 3; x++) expect(c.texture[w++]).toBe(x + y * 4 + z * 16);
  });

  it("shifts the affine origin to the first kept voxel", () => {
    const vol = makeVolume(4, 4, 4);
    vol.spacing = [2, 2, 2];
    vol.affine = [
      [2, 0, 0, 10],
      [0, 2, 0, 20],
      [0, 0, 2, 30],
      [0, 0, 0, 1],
    ];
    const c = cropToClip(vol, { min: [0.25, 0.25, 0.25], max: [0.75, 0.75, 0.75] });
    // New origin = old voxel (1,1,1) in world = base + 2*1 per axis.
    expect([c.affine[0][3], c.affine[1][3], c.affine[2][3]]).toEqual([12, 22, 32]);
    // Linear part is untouched.
    expect([c.affine[0][0], c.affine[1][1], c.affine[2][2]]).toEqual([2, 2, 2]);
  });

  it("never produces an empty axis for a degenerate range", () => {
    const vol = makeVolume(4, 4, 4);
    const c = cropToClip(vol, { min: [0.5, 0.5, 0.5], max: [0.5, 0.5, 0.5] });
    expect([c.nx, c.ny, c.nz]).toEqual([1, 1, 1]);
  });

  it("derives a slope/intercept that recovers the display range", () => {
    const vol = makeVolume(2, 2, 2);
    vol.displayMin = -1000;
    vol.displayMax = 2000;
    const c = cropToClip(vol, FULL_BOX);
    expect(c.sclInter).toBe(-1000);
    expect(c.sclSlope).toBeCloseTo(3000 / 255, 6);
  });
});

describe("encode → decode round-trip through the real NIfTI reader", () => {
  it("re-reads to the cropped dimensions, spacing, and affine", async () => {
    const vol = makeVolume(4, 4, 4);
    vol.spacing = [1.5, 2, 2.5];
    vol.affine = [
      [1.5, 0, 0, 5],
      [0, 2, 0, 6],
      [0, 0, 2.5, 7],
      [0, 0, 0, 1],
    ];
    const buf = encodeCrop(vol, { min: [0.25, 0.25, 0.25], max: [0.75, 0.75, 0.75] });
    const reloaded = await parseNifti(buf);

    expect([reloaded.nx, reloaded.ny, reloaded.nz]).toEqual([2, 2, 2]);
    expect(reloaded.spacing).toEqual([1.5, 2, 2.5]);
    // Affine origin shifted to old voxel (1,1,1): 5+1.5, 6+2, 7+2.5.
    expect(reloaded.affine[0][3]).toBeCloseTo(6.5, 5);
    expect(reloaded.affine[1][3]).toBeCloseTo(8, 5);
    expect(reloaded.affine[2][3]).toBeCloseTo(9.5, 5);
    expect(reloaded.header.datatype).toBe("uint8");
    expect(reloaded.header.magic).toBe("n+1");
  });

  it("round-trips the full volume for the FULL_BOX selection", async () => {
    const vol = makeVolume(3, 3, 3);
    const reloaded = await parseNifti(encodeCrop(vol, FULL_BOX));
    expect([reloaded.nx, reloaded.ny, reloaded.nz]).toEqual([3, 3, 3]);
  });
});

describe("exportClippedNifti — Blob wrapper", () => {
  it("returns an octet-stream Blob sized header + voxels", () => {
    const vol = makeVolume(3, 3, 3);
    const blob = exportClippedNifti(vol, FULL_BOX);
    expect(blob.type).toBe("application/octet-stream");
    expect(blob.size).toBe(352 + 27); // 352-byte header/extension prefix + 3*3*3 voxels
  });
});
