import { describe, it, expect } from "vitest";
import { colormapRGB } from "../../src/colormaps";
import { COMMON, COLORMAPS } from "../../src/glsl";

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const inByte = (v: number) => v >= 0 && v <= 255;

describe("colormapRGB — names and ranges", () => {
  it("has a JS implementation for every named GLSL colormap", () => {
    expect(COLORMAPS).toEqual(["gray", "bone", "hot", "viridis", "jet"]);
  });

  it("returns components clamped to 0..255 across all maps and inputs", () => {
    for (let mode = 0; mode < COLORMAPS.length; mode++) {
      for (let i = 0; i <= 20; i++) {
        const rgb = colormapRGB(mode, i / 20);
        expect(rgb).toHaveLength(3);
        for (const c of rgb) expect(inByte(c)).toBe(true);
      }
    }
  });
});

describe("colormapRGB — per-map behaviour matches the GLSL formulas", () => {
  it("gray is the identity ramp", () => {
    expect(colormapRGB(0, 0)).toEqual([0, 0, 0]);
    expect(colormapRGB(0, 1)).toEqual([255, 255, 255]);
    expect(colormapRGB(0, 0.5)).toEqual([127.5, 127.5, 127.5]);
  });

  it("hot clamps each channel: 3x, 3x-1, 3x-2", () => {
    expect(colormapRGB(2, 0)).toEqual([0, 0, 0]);
    expect(colormapRGB(2, 1)).toEqual([255, 255, 255]);
    const mid = colormapRGB(2, 1 / 3); // r=1, g=0, b=-1 -> clamp
    expect(mid[0]).toBeCloseTo(255);
    expect(mid[1]).toBeCloseTo(0);
    expect(mid[2]).toBe(0);
  });

  it("bone follows x*0.95 / x*0.97 / x*1.06+0.02", () => {
    const [r, g, b] = colormapRGB(1, 0.5);
    expect(r).toBeCloseTo(clamp01(0.5 * 0.95) * 255);
    expect(g).toBeCloseTo(clamp01(0.5 * 0.97) * 255);
    expect(b).toBeCloseTo(clamp01(0.5 * 1.06 + 0.02) * 255);
  });

  it("jet peaks green in the middle and clamps the ends", () => {
    const mid = colormapRGB(4, 0.5);
    expect(mid[1]).toBeCloseTo(255); // green channel = 1.5 - |2-2| = 1.5 -> clamp 1
  });

  it("viridis runs dark purple -> yellow", () => {
    const lo = colormapRGB(3, 0);
    const hi = colormapRGB(3, 1);
    expect(lo[0]).toBeCloseTo(70.8, 0); // ~ c0 * 255
    expect(lo[2]).toBeGreaterThan(lo[0]); // bluer than red at the dark end
    expect(hi[0]).toBeGreaterThan(200); // yellow: high red + green, low blue
    expect(hi[1]).toBeGreaterThan(200);
    expect(hi[2]).toBeLessThan(80);
  });
});

describe("colormapRGB — parity with the GLSL source (anti-drift)", () => {
  it("uses the same viridis polynomial coefficients as the shader", () => {
    // Extract the seven `const vec3 cN = vec3(...)` from the GLSL COMMON chunk
    // and evaluate the same Horner polynomial, so the duplicated coefficients in
    // glsl.ts and colormaps.ts cannot silently diverge.
    const coeffs = [...COMMON.matchAll(/vec3\s+c(\d)\s*=\s*vec3\(([^)]+)\)/g)]
      .map((m) => m[2].split(",").map((s) => Number.parseFloat(s.trim())));
    expect(coeffs).toHaveLength(7);

    const glslViridis = (x: number): [number, number, number] => {
      const out = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        let v = coeffs[6][i];
        for (let k = 5; k >= 0; k--) v = v * x + coeffs[k][i];
        out[i] = clamp01(v) * 255;
      }
      return out as [number, number, number];
    };

    for (const x of [0, 0.2, 0.4, 0.6, 0.8, 1]) {
      const js = colormapRGB(3, x);
      const glsl = glslViridis(x);
      for (let i = 0; i < 3; i++) expect(js[i]).toBeCloseTo(glsl[i], 4);
    }
  });
});
