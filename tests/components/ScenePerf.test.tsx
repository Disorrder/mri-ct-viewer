import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ScenePerf } from "../../src/components/ScenePerf";
import type { VolumeViewer } from "../../src/rendering/VolumeViewer";

// A lightweight stand-in for the renderer: ScenePerf only reads these fields.
function stubViewer(overrides: Partial<VolumeViewer> = {}): VolumeViewer {
  return {
    gpuName: "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Max, Unspecified Version)",
    gpuTimingSupported: true,
    stats: {
      fps: 60,
      frameMs: 16.7,
      cpuMs: 1.2,
      gpuMs: 0.8,
      drawCalls: 4,
      triangles: 12000,
      lines: 0,
      points: 0,
      textures: 1,
      geometries: 3,
      programs: 2,
      jsHeapMB: 50,
      jsHeapLimitMB: 4096,
      texBytes: 16777216,
      steps: 256,
      volumePixels: 2073600,
      viewports: 1,
      drawW: 1920,
      drawH: 1080,
      dpr: 2,
    },
    ...overrides,
  } as unknown as VolumeViewer;
}

describe("<ScenePerf>", () => {
  it("shows the FPS label, GPU name, and the CPU/GPU/RAM strip", () => {
    const { container } = render(<ScenePerf viewer={stubViewer()} detail="compact" />);
    expect(container.querySelector(".scene-perf")).toBeInTheDocument();
    expect(screen.getByText("FPS")).toBeInTheDocument();
    expect(screen.getByText("Apple M1 Max")).toBeInTheDocument();
    expect(screen.getByText("CPU")).toBeInTheDocument();
    expect(screen.getByText("GPU")).toBeInTheDocument();
    expect(screen.getByText("RAM")).toBeInTheDocument();
  });

  it("does not throw when GPU timing is unsupported", () => {
    expect(() =>
      render(<ScenePerf viewer={stubViewer({ gpuTimingSupported: false })} detail="full" />),
    ).not.toThrow();
  });

  it("adds the rate / scene / volume sections only in the full layout", () => {
    const { rerender } = render(<ScenePerf viewer={stubViewer()} detail="compact" />);
    expect(screen.queryByText("scene")).not.toBeInTheDocument();
    expect(screen.queryByText("samples")).not.toBeInTheDocument();

    rerender(<ScenePerf viewer={stubViewer()} detail="full" />);
    expect(screen.getByText("scene")).toBeInTheDocument();
    expect(screen.getByText("volume")).toBeInTheDocument();
    expect(screen.getByText("samples")).toBeInTheDocument();
    expect(screen.getByText("draws")).toBeInTheDocument();
    // The CPU/GPU/RAM strip stays in both layouts.
    expect(screen.getByText("CPU")).toBeInTheDocument();
  });
});
