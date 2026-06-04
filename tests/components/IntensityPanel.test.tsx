import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { IntensityPanel } from "../../src/components/IntensityPanel";
import { parseNifti } from "../../src/nifti";
import { makeNifti } from "../nifti/fixtures";

describe("<IntensityPanel>", () => {
  it("renders the histogram title, a canvas, and display-value labels", async () => {
    const volume = await parseNifti(
      makeNifti({ dim: [4, 4, 1], voxels: Array.from({ length: 16 }, (_, i) => i * 16) }),
    );
    const { container } = render(
      <IntensityPanel volume={volume} low={0.2} high={0.8} colormap={0} visible />,
    );
    expect(screen.getByText("intensity histogram · window")).toBeInTheDocument();
    expect(container.querySelector("canvas.intensity-canvas")).toBeInTheDocument();
    expect(screen.getByText("display value →")).toBeInTheDocument();
  });

  it("toggles the .visible class from the visible prop", async () => {
    const volume = await parseNifti(makeNifti({ dim: [2, 2, 1], voxels: [0, 50, 150, 255] }));
    const { container, rerender } = render(
      <IntensityPanel volume={volume} low={0} high={1} colormap={0} visible={false} />,
    );
    expect(container.querySelector(".intensity")).not.toHaveClass("visible");
    rerender(<IntensityPanel volume={volume} low={0} high={1} colormap={0} visible />);
    expect(container.querySelector(".intensity")).toHaveClass("visible");
  });

  it("re-renders without throwing when the window changes", async () => {
    const volume = await parseNifti(makeNifti({ dim: [2, 2, 1], voxels: [0, 50, 150, 255] }));
    const { rerender } = render(
      <IntensityPanel volume={volume} low={0} high={1} colormap={3} visible />,
    );
    expect(() =>
      rerender(<IntensityPanel volume={volume} low={0.3} high={0.6} colormap={4} visible />),
    ).not.toThrow();
  });
});
