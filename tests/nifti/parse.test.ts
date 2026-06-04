import { describe, expect, it } from "vitest";
import { parseNifti } from "../../src/nifti";
import { makeNifti } from "./fixtures";

describe("parseNifti — header", () => {
  it("parses a minimal little-endian uint8 volume", async () => {
    const vol = await parseNifti(
      makeNifti({ dim: [2, 2, 2], pixdim: [1.5, 2, 3], voxels: [0, 1, 2, 3, 4, 5, 6, 7] }),
    );
    const h = vol.header;
    expect(h.sizeofHdr).toBe(348);
    expect(h.littleEndian).toBe(true);
    expect(h.datatypeCode).toBe(2);
    expect(h.datatype).toBe("uint8");
    expect(h.bitpix).toBe(8);
    expect(h.magic).toBe("n+1");
    expect(h.xyzUnits).toBe("mm");
    expect([vol.nx, vol.ny, vol.nz]).toEqual([2, 2, 2]);
    expect([h.pixdim[1], h.pixdim[2], h.pixdim[3]]).toEqual([1.5, 2, 3]);
  });

  it("reads descrip and the ni1 magic", async () => {
    const vol = await parseNifti(
      makeNifti({ dim: [1, 1, 1], magic: "ni1", descrip: "hello scan", voxels: [42] }),
    );
    expect(vol.header.magic).toBe("ni1");
    expect(vol.header.description).toBe("hello scan");
  });

  it("maps spatial unit codes", async () => {
    const um = await parseNifti(makeNifti({ dim: [1, 1, 1], xyztUnits: 3, voxels: [1] }));
    expect(um.header.xyzUnits).toBe("um");
    const m = await parseNifti(makeNifti({ dim: [1, 1, 1], xyztUnits: 1, voxels: [1] }));
    expect(m.header.xyzUnits).toBe("m");
  });

  it("detects big-endian files by re-reading sizeof_hdr", async () => {
    const vol = await parseNifti(
      makeNifti({ littleEndian: false, dim: [2, 1, 1], datatypeCode: 4, voxels: [100, 4000] }),
    );
    expect(vol.header.littleEndian).toBe(false);
    expect(vol.header.datatype).toBe("int16");
    expect(vol.displayMax).toBe(4000);
  });

  it("rejects a buffer whose sizeof_hdr is not 348 in either endianness", async () => {
    const buf = makeNifti({ dim: [1, 1, 1], voxels: [1] });
    new DataView(buf).setInt32(0, 12345, true);
    await expect(parseNifti(buf)).rejects.toThrow(/Not a NIfTI-1/);
  });
});

describe("parseNifti — affine", () => {
  it("uses srow rows verbatim when sform_code > 0 (method 3)", async () => {
    const srow: [number[], number[], number[]] = [
      [1, 0, 0, 10],
      [0, 2, 0, 20],
      [0, 0, 3, 30],
    ];
    const vol = await parseNifti(makeNifti({ dim: [1, 1, 1], sformCode: 1, srow, voxels: [1] }));
    expect(vol.header.affine).toEqual([
      [1, 0, 0, 10],
      [0, 2, 0, 20],
      [0, 0, 3, 30],
      [0, 0, 0, 1],
    ]);
  });

  it("builds a scaled identity from an identity quaternion (method 2)", async () => {
    // quat (0,0,0) -> a=1 -> rotation is identity; affine = diag(pixdim) + offset.
    const vol = await parseNifti(
      makeNifti({
        dim: [1, 1, 1],
        qformCode: 1,
        pixdim: [2, 3, 4],
        qoffset: [5, 6, 7],
        voxels: [1],
      }),
    );
    const a = vol.header.affine;
    expect(a[0][0]).toBeCloseTo(2);
    expect(a[1][1]).toBeCloseTo(3);
    expect(a[2][2]).toBeCloseTo(4);
    expect([a[0][3], a[1][3], a[2][3]]).toEqual([5, 6, 7]);
    expect(a[3]).toEqual([0, 0, 0, 1]);
  });

  it("negates the third column when qfac is negative", async () => {
    const pos = await parseNifti(
      makeNifti({ dim: [1, 1, 1], qformCode: 1, pixdim: [1, 1, 5], qfac: 1, voxels: [1] }),
    );
    const neg = await parseNifti(
      makeNifti({ dim: [1, 1, 1], qformCode: 1, pixdim: [1, 1, 5], qfac: -1, voxels: [1] }),
    );
    expect(pos.header.affine[2][2]).toBeCloseTo(5);
    expect(neg.header.affine[2][2]).toBeCloseTo(-5);
  });

  it("falls back to a diagonal scale when no orientation code is set", async () => {
    // Spacing values chosen to be exactly representable as float32.
    const vol = await parseNifti(makeNifti({ dim: [1, 1, 1], pixdim: [1.5, 2.5, 4], voxels: [1] }));
    expect(vol.header.affine).toEqual([
      [1.5, 0, 0, 0],
      [0, 2.5, 0, 0],
      [0, 0, 4, 0],
      [0, 0, 0, 1],
    ]);
  });

  it("prefers sform over qform when both are present", async () => {
    const srow: [number[], number[], number[]] = [
      [9, 0, 0, 0],
      [0, 9, 0, 0],
      [0, 0, 9, 0],
    ];
    const vol = await parseNifti(
      makeNifti({
        dim: [1, 1, 1],
        sformCode: 1,
        qformCode: 1,
        pixdim: [2, 2, 2],
        srow,
        voxels: [1],
      }),
    );
    expect(vol.header.affine[0][0]).toBe(9); // sform, not the pixdim=2 qform
  });
});

describe("parseNifti — voxel datatypes", () => {
  const cases: Array<[string, number, number[], number, number]> = [
    // [label, datatypeCode, voxels, expectedMin, expectedMax]
    ["uint8", 2, [0, 255], 0, 255],
    ["int8", 256, [-128, 127], -128, 127],
    ["int16 (HU-like)", 4, [-1000, 2000], -1000, 2000],
    ["uint16", 512, [0, 60000], 0, 60000],
    ["int32", 8, [-100000, 100000], -100000, 100000],
    ["uint32", 768, [0, 4000000], 0, 4000000],
    ["float32", 16, [-1.5, 2.5], -1.5, 2.5],
    ["float64", 64, [-0.25, 0.75], -0.25, 0.75],
  ];

  it.each(cases)("reads %s voxels", async (_label, code, voxels, lo, hi) => {
    const vol = await parseNifti(makeNifti({ dim: [2, 1, 1], datatypeCode: code, voxels }));
    expect(vol.displayMin).toBeCloseTo(lo);
    expect(vol.displayMax).toBeCloseTo(hi);
  });

  it("throws on an unsupported datatype code", async () => {
    const buf = makeNifti({ dim: [1, 1, 1], voxels: [1] });
    new DataView(buf).setInt16(70, 1024, true); // not in the datatype table
    await expect(parseNifti(buf)).rejects.toThrow(/Unsupported datatype/);
  });
});

describe("parseNifti — scaling, texture, histogram, window", () => {
  it("applies scl_slope and scl_inter to the display range", async () => {
    const vol = await parseNifti(
      makeNifti({ dim: [2, 1, 1], sclSlope: 2, sclInter: 10, voxels: [0, 10] }),
    );
    expect(vol.displayMin).toBe(10); // 0*2 + 10
    expect(vol.displayMax).toBe(30); // 10*2 + 10
  });

  it("treats scl_slope = 0 as 1 (the NIfTI convention)", async () => {
    const vol = await parseNifti(
      makeNifti({ dim: [2, 1, 1], sclSlope: 0, sclInter: 0, voxels: [5, 15] }),
    );
    expect(vol.displayMin).toBe(5);
    expect(vol.displayMax).toBe(15);
  });

  it("quantizes voxels to a 0..255 R8 texture", async () => {
    const vol = await parseNifti(makeNifti({ dim: [2, 2, 1], voxels: [0, 0, 100, 200] }));
    expect(vol.texture).toBeInstanceOf(Uint8Array);
    expect(vol.texture.length).toBe(4);
    // lo=0, hi=200, span=200 -> round(v/200*255)
    expect(Array.from(vol.texture)).toEqual([0, 0, 128, 255]);
  });

  it("builds a 256-bin histogram that sums to the voxel count", async () => {
    const vol = await parseNifti(makeNifti({ dim: [2, 2, 1], voxels: [0, 0, 100, 200] }));
    expect(vol.histogram.length).toBe(256);
    const sum = vol.histogram.reduce((a, b) => a + b, 0);
    expect(sum).toBe(4);
    expect(vol.histogram[0]).toBe(2); // the two zeros land in bin 0
    expect(vol.histogram[255]).toBe(1);
  });

  it("returns a suggested window inside [0,1] with low <= high", async () => {
    const voxels = Array.from({ length: 100 }, (_, i) => i); // a spread distribution
    const vol = await parseNifti(makeNifti({ dim: [10, 10, 1], voxels }));
    const [low, high] = vol.suggestedWindow;
    expect(low).toBeGreaterThanOrEqual(0);
    expect(high).toBeLessThanOrEqual(1);
    expect(low).toBeLessThan(high);
  });
});
