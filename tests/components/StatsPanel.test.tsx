import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { StatsPanel } from "../../src/StatsPanel";
import type { VolumeViewer } from "../../src/VolumeViewer";

// A lightweight stand-in for the renderer: StatsPanel only reads these fields.
function stubViewer(overrides: Partial<VolumeViewer> = {}): VolumeViewer {
  return {
    gpuName: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)",
    gpuTimingSupported: true,
    stats: {
      fps: 60,
      cpuMs: 1.2,
      gpuMs: 0.8,
      drawCalls: 4,
      triangles: 12000,
      textures: 1,
      geometries: 3,
      programs: 2,
      jsHeapMB: 50,
      jsHeapLimitMB: 4096,
    },
    ...overrides,
  } as unknown as VolumeViewer;
}

describe("<StatsPanel>", () => {
  it("mounts and shows the FPS label and shortened GPU name", () => {
    const { container } = render(<StatsPanel viewer={stubViewer()} />);
    expect(container.querySelector(".stats")).toBeInTheDocument();
    expect(screen.getByText("FPS")).toBeInTheDocument();
    expect(screen.getByText("Apple M1 Max")).toBeInTheDocument();
  });

  it("does not throw when GPU timing is unsupported", () => {
    expect(() =>
      render(<StatsPanel viewer={stubViewer({ gpuTimingSupported: false })} />),
    ).not.toThrow();
  });
});
