import { describe, expect, it } from "vitest";
import { formatCompact } from "../../src/lib/format";

describe("formatCompact", () => {
  it("returns a plain number with the requested decimals for mid-range values", () => {
    expect(formatCompact(1.23456)).toBe(1.235); // default fixed=3
    expect(formatCompact(0, { fixed: 1, exp: 1, tiny: false })).toBe(0);
    expect(formatCompact(42.5, { fixed: 1, exp: 1, tiny: false })).toBe(42.5);
  });

  it("drops trailing zeros by returning a number", () => {
    expect(formatCompact(2.5)).toBe(2.5);
    expect(formatCompact(7)).toBe(7);
  });

  it("uses exponential for large magnitudes", () => {
    expect(formatCompact(3302)).toBe("3.30e+3");
    expect(formatCompact(5000, { fixed: 1, exp: 1, tiny: false })).toBe("5.0e+3");
  });

  it("uses exponential for tiny non-zero magnitudes only when tiny is enabled", () => {
    expect(formatCompact(0.001)).toBe("1.00e-3"); // default tiny=true
    expect(formatCompact(0.001, { fixed: 1, exp: 1, tiny: false })).toBe(0); // rounds to 0.0
  });

  it("never treats exact zero as tiny", () => {
    expect(formatCompact(0)).toBe(0);
  });
});
