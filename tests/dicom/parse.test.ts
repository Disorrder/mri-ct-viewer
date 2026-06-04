import { describe, expect, it } from "vitest";
import { hasDicomMagic, readDicomImage } from "../../src/dicom";
import { makeDicom } from "./fixtures";

describe("readDicomImage — metadata", () => {
  it("parses an Explicit VR Little Endian image", () => {
    const img = readDicomImage(
      makeDicom({
        rows: 2,
        columns: 3,
        pixels: [0, 1, 2, 3, 4, 5],
        pixelSpacing: [0.5, 0.75],
        sliceThickness: 2,
        position: [10, 20, 30],
        rescaleSlope: 1,
        rescaleIntercept: -1024,
        windowCenter: 40,
        windowWidth: 400,
      }),
    );
    expect(img.columns).toBe(3);
    expect(img.rows).toBe(2);
    expect(img.frames).toBe(1);
    expect(img.bitsAllocated).toBe(16);
    expect(img.signed).toBe(false);
    expect(img.pixelSpacing).toEqual([0.5, 0.75]);
    expect(img.sliceThickness).toBe(2);
    expect(img.position).toEqual([10, 20, 30]);
    expect(img.orientation).toEqual([1, 0, 0, 0, 1, 0]);
    expect(img.rescaleIntercept).toBe(-1024);
    expect(img.windowCenter).toBe(40);
    expect(img.windowWidth).toBe(400);
    expect(img.modality).toBe("CT");
    expect(img.transferSyntaxName).toBe("Explicit VR Little Endian");
    expect(Array.from(img.readFrame(0))).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("parses Implicit VR Little Endian (no VR in the stream)", () => {
    const img = readDicomImage(
      makeDicom({ rows: 1, columns: 4, pixels: [5, 6, 7, 8], explicitVR: false }),
    );
    expect(img.transferSyntaxName).toBe("Implicit VR Little Endian");
    expect(img.columns).toBe(4);
    expect(Array.from(img.readFrame(0))).toEqual([5, 6, 7, 8]);
  });

  it("parses Explicit VR Big Endian", () => {
    const img = readDicomImage(
      makeDicom({ rows: 1, columns: 3, pixels: [100, 4000, 65000], littleEndian: false }),
    );
    expect(img.transferSyntaxName).toBe("Explicit VR Big Endian");
    expect(img.littleEndian).toBe(false);
    expect(Array.from(img.readFrame(0))).toEqual([100, 4000, 65000]);
  });

  it("reads 8-bit unsigned pixels", () => {
    const img = readDicomImage(
      makeDicom({ rows: 1, columns: 3, pixels: [0, 128, 255], bitsAllocated: 8 }),
    );
    expect(img.bitsAllocated).toBe(8);
    expect(Array.from(img.readFrame(0))).toEqual([0, 128, 255]);
  });

  it("reads signed 16-bit pixels (two's complement)", () => {
    const img = readDicomImage(
      makeDicom({ rows: 1, columns: 3, pixels: [-1000, 0, 2000], signed: true }),
    );
    expect(img.signed).toBe(true);
    expect(Array.from(img.readFrame(0))).toEqual([-1000, 0, 2000]);
  });

  it("skips sequences (defined and undefined length) before PixelData", () => {
    for (const mode of ["defined", "undefined"] as const) {
      const img = readDicomImage(
        makeDicom({ rows: 1, columns: 3, pixels: [7, 8, 9], sequence: mode }),
      );
      expect(Array.from(img.readFrame(0))).toEqual([7, 8, 9]);
    }
  });

  it("reads a multi-frame file frame by frame", () => {
    const img = readDicomImage(
      makeDicom({ rows: 1, columns: 2, frames: 3, pixels: [0, 1, 10, 11, 20, 21] }),
    );
    expect(img.frames).toBe(3);
    expect(Array.from(img.readFrame(0))).toEqual([0, 1]);
    expect(Array.from(img.readFrame(1))).toEqual([10, 11]);
    expect(Array.from(img.readFrame(2))).toEqual([20, 21]);
  });
});

describe("readDicomImage — rejections", () => {
  it("rejects compressed transfer syntaxes", () => {
    expect(() =>
      readDicomImage(
        makeDicom({ rows: 1, columns: 1, pixels: [1], transferSyntax: "1.2.840.10008.1.2.4.90" }),
      ),
    ).toThrow(/Unsupported DICOM transfer syntax/);
  });

  it("rejects multi-channel (color) images", () => {
    expect(() =>
      readDicomImage(makeDicom({ rows: 1, columns: 1, pixels: [1], samplesPerPixel: 3 })),
    ).toThrow(/single-channel/);
  });
});

describe("hasDicomMagic", () => {
  it("detects the DICM magic at byte 128", () => {
    expect(hasDicomMagic(makeDicom({ rows: 1, columns: 1, pixels: [1] }))).toBe(true);
  });

  it("returns false for a non-DICOM buffer", () => {
    expect(hasDicomMagic(new Uint8Array(200).buffer)).toBe(false);
  });
});
