import { describe, expect, it } from "vitest";
import { formatBytes, formatCount, fpsColor, frameStats, shortGpu } from "../../src/lib/gpu";

describe("fpsColor", () => {
  it("is green at 55+, amber 30-54, red below 30", () => {
    expect(fpsColor(60)).toBe("#5ef08a");
    expect(fpsColor(55)).toBe("#5ef08a");
    expect(fpsColor(54)).toBe("#f0d24e");
    expect(fpsColor(30)).toBe("#f0d24e");
    expect(fpsColor(29)).toBe("#f0644e");
    expect(fpsColor(0)).toBe("#f0644e");
  });
});

describe("shortGpu", () => {
  it("extracts the renderer from an ANGLE string", () => {
    expect(shortGpu("ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)")).toBe(
      "Apple M1 Max",
    );
  });

  it("leaves a plain renderer name mostly intact, dropping trailing parens", () => {
    expect(shortGpu("NVIDIA GeForce RTX 3080")).toBe("NVIDIA GeForce RTX 3080");
    expect(shortGpu("Apple M1 (Metal)")).toBe("Apple M1");
  });

  it("truncates very long names to 30 characters with an ellipsis", () => {
    const out = shortGpu("Some Absurdly Long GPU Marketing Name That Will Not Fit");
    expect(out.length).toBe(30);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("formatBytes", () => {
  it("returns '0 B' for zero or negative", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(-5)).toBe("0 B");
  });

  it("keeps bytes whole and scales to KB/MB/GB", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(256 * 256 * 256)).toBe("16 MB"); // a 256³ R8 volume
    expect(formatBytes(1.5 * 1024 ** 3)).toBe("1.5 GB");
  });
});

describe("formatCount", () => {
  it("scales counts to k / M / B with one decimal", () => {
    expect(formatCount(999)).toBe("999");
    expect(formatCount(12000)).toBe("12.0k");
    expect(formatCount(3_400_000)).toBe("3.4M");
    expect(formatCount(2_500_000_000)).toBe("2.5B");
  });
});

describe("frameStats", () => {
  it("returns zeros for an empty buffer", () => {
    expect(frameStats([])).toEqual({ avg: 0, min: 0, low: 0 });
  });

  it("reports a steady ~60fps as avg/min/low all near 60", () => {
    const steady = Array.from({ length: 100 }, () => 1000 / 60);
    const { avg, min, low } = frameStats(steady);
    expect(avg).toBeCloseTo(60, 5);
    expect(min).toBeCloseTo(60, 5);
    expect(low).toBeCloseTo(60, 5);
  });

  it("surfaces a single hitch in min and 1%-low while avg stays high", () => {
    // 99 fast frames (10ms) + one 100ms stall.
    const frames = [...Array.from({ length: 99 }, () => 10), 100];
    const { avg, min, low } = frameStats(frames);
    expect(avg).toBeGreaterThan(80); // the average barely notices
    expect(min).toBeCloseTo(10, 5); // worst frame = 100ms = 10fps
    expect(low).toBeCloseTo(10, 5); // 1%-low catches the stall the average hides
  });
});
