import { describe, expect, it } from "vitest";
import { buildDicomVolume } from "../../src/dicom";
import { type DicomSpec, makeDicom } from "./fixtures";

/** A 2×2 single-frame slice at patient-z `z`, every voxel = `value`. */
function slice(z: number, value: number, opts: Partial<DicomSpec> = {}): ArrayBuffer {
  return makeDicom({
    rows: 2,
    columns: 2,
    pixels: [value, value, value, value],
    position: [0, 0, z],
    pixelSpacing: [0.5, 0.75], // [row, col]
    ...opts,
  });
}

describe("buildDicomVolume — series", () => {
  it("stacks single-frame slices, sorting by ImagePositionPatient", () => {
    // Slices handed in out of z order — the loader must sort them.
    const vol = buildDicomVolume([slice(4, 200), slice(0, 0), slice(2, 100)]);
    expect(vol.format).toBe("dicom");
    expect([vol.nx, vol.ny, vol.nz]).toEqual([2, 2, 3]);
    expect(vol.meta.source).toBe("series");
    expect(vol.meta.imagePosition).toEqual([0, 0, 0]); // lowest-z slice is first
    expect(vol.spacing).toEqual([0.75, 0.5, 2]); // [col spacing, row spacing, dz]
  });

  it("builds a RAS affine (DICOM LPS with X/Y negated) from identity orientation", () => {
    const vol = buildDicomVolume([slice(0, 1), slice(3, 1)]);
    expect(vol.affine[0][0]).toBeCloseTo(-0.75); // -colSpacing → x
    expect(vol.affine[1][1]).toBeCloseTo(-0.5); // -rowSpacing → y
    expect(vol.affine[2][2]).toBeCloseTo(3); // +dz → z
  });

  it("applies RescaleSlope/Intercept to the display range (Hounsfield units)", () => {
    const vol = buildDicomVolume([
      slice(0, 0, { rescaleSlope: 1, rescaleIntercept: -1024 }),
      slice(2, 2000, { rescaleSlope: 1, rescaleIntercept: -1024 }),
    ]);
    expect(vol.displayMin).toBe(-1024); // 0 * 1 − 1024
    expect(vol.displayMax).toBe(976); // 2000 * 1 − 1024
  });

  it("skips non-image companions in a dropped folder (index.json, README, DICOMDIR)", () => {
    const junk = new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer; // not a DICOM image
    const vol = buildDicomVolume([slice(0, 0), junk, slice(2, 100)]);
    expect(vol.nz).toBe(2); // the two real slices stacked; the junk file dropped
    expect(vol.meta.source).toBe("series");
  });

  it("throws (surfacing the parse error) when no readable image is present", () => {
    const junk = new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer;
    expect(() => buildDicomVolume([junk])).toThrow(/Rows\/Columns|readable/);
  });

  it("rejects a series with mismatched slice dimensions", () => {
    const ok = slice(0, 1);
    const wrong = makeDicom({
      rows: 4,
      columns: 4,
      pixels: new Array(16).fill(1),
      position: [0, 0, 1],
    });
    expect(() => buildDicomVolume([ok, wrong])).toThrow(/differing dimensions/);
  });
});

describe("buildDicomVolume — multi-frame", () => {
  it("treats a single multi-frame file as the whole stack", () => {
    const vol = buildDicomVolume([
      makeDicom({
        rows: 1,
        columns: 2,
        frames: 4,
        pixels: [0, 0, 10, 10, 20, 20, 30, 30],
        spacingBetweenSlices: 1.5,
        pixelSpacing: [0.5, 0.75],
      }),
    ]);
    expect(vol.meta.source).toBe("multiframe");
    expect([vol.nx, vol.ny, vol.nz]).toEqual([2, 1, 4]);
    expect(vol.spacing).toEqual([0.75, 0.5, 1.5]);
  });
});

describe("buildDicomVolume — texture", () => {
  it("quantizes the stacked volume to span 0..255", () => {
    const vol = buildDicomVolume([slice(0, 0), slice(1, 255)]);
    expect(Math.min(...vol.texture)).toBe(0); // global min → 0
    expect(Math.max(...vol.texture)).toBe(255); // global max → 255
  });
});
