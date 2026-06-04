import { describe, expect, it } from "vitest";
// Source currently lives in App.tsx; the refactor moves it to src/lib/ruler.ts
// and this import path updates with it.
import { fmtCm, niceCmStep, rulerScheme } from "../../src/App";

describe("niceCmStep", () => {
  it("snaps up to the nearest 1/2/5 * 10^k that is at least minPx wide", () => {
    expect(niceCmStep(16, 100)).toBeCloseTo(0.2); // minCm 0.16 -> 0.2
    expect(niceCmStep(16, 10)).toBeCloseTo(2); // minCm 1.6 -> 2
    expect(niceCmStep(16, 1000)).toBeCloseTo(0.02); // minCm 0.016 -> 0.02
    expect(niceCmStep(16, 1)).toBeCloseTo(20); // minCm 16 -> 20
  });

  it("returns the exact step when minCm is already a nice value", () => {
    expect(niceCmStep(100, 100)).toBeCloseTo(1); // minCm exactly 1
  });

  it("only ever returns 1/2/5 mantissas", () => {
    for (let pxPerCm = 2; pxPerCm < 400; pxPerCm += 7) {
      const step = niceCmStep(20, pxPerCm);
      const mant = step / 10 ** Math.floor(Math.log10(step) + 1e-9);
      expect([1, 2, 5]).toContain(Math.round(mant));
    }
  });
});

describe("rulerScheme", () => {
  it("subdivides a nice label step into perLabel minor ticks", () => {
    const s = rulerScheme(100, 16);
    expect(s.labelCm).toBeCloseTo(0.2);
    expect(s.stepCm * s.perLabel).toBeCloseTo(s.labelCm);
    expect(s.perLabel).toBeGreaterThanOrEqual(1);
  });

  it("drops minor ticks once they would be denser than ~5px", () => {
    // labelCm=5 (mant 5 -> 5 subdivisions); minor=1cm=4px < 5px, so it collapses.
    const s = rulerScheme(4, 16);
    expect(s.labelCm).toBeCloseTo(5);
    expect(s.perLabel).toBe(1);
    expect(s.stepCm).toBeCloseTo(s.labelCm);
  });

  it("keeps labelCm on the 1/2/5 ladder at any zoom", () => {
    for (const pxPerCm of [1, 5, 20, 50, 120, 400]) {
      const { labelCm } = rulerScheme(pxPerCm, 28);
      const mant = labelCm / 10 ** Math.floor(Math.log10(labelCm) + 1e-9);
      expect([1, 2, 5]).toContain(Math.round(mant));
    }
  });
});

describe("fmtCm", () => {
  it("uses just enough decimals for the step size", () => {
    expect(fmtCm(5, 1)).toBe("5");
    expect(fmtCm(1.5, 0.5)).toBe("1.5");
    expect(fmtCm(0.15, 0.05)).toBe("0.15");
    expect(fmtCm(0.2, 0.2)).toBe("0.2");
    expect(fmtCm(2, 2)).toBe("2");
  });

  it("caps at 4 decimals", () => {
    expect(fmtCm(0.0001, 0.0001).split(".")[1]?.length ?? 0).toBeLessThanOrEqual(4);
  });
});
