import { describe, expect, it } from "vitest";
import { fpsColor, shortGpu } from "../../src/lib/gpu";

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
