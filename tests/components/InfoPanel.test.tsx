import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InfoPanel } from "../../src/components/InfoPanel";
import { parseNifti } from "../../src/nifti";
import { makeNifti } from "../nifti/fixtures";

describe("<InfoPanel>", () => {
  it("renders header fields parsed from the volume", async () => {
    const volume = await parseNifti(
      makeNifti({ dim: [2, 3, 4], pixdim: [1, 1, 1], voxels: Array.from({ length: 24 }, () => 1) }),
    );
    render(<InfoPanel volume={volume} mode="Volume" />);
    expect(screen.getByRole("heading", { name: "NIfTI-1 header" })).toBeInTheDocument();
    expect(screen.getByText("dimensions")).toBeInTheDocument();
    expect(screen.getByText("2 × 3 × 4 voxels")).toBeInTheDocument();
    expect(screen.getByText(/uint8/)).toBeInTheDocument();
  });

  it("renders the 4x4 affine as a table", async () => {
    const volume = await parseNifti(makeNifti({ dim: [1, 1, 1], voxels: [1] }));
    const { container } = render(<InfoPanel volume={volume} mode="Slices" />);
    expect(container.querySelectorAll("table tbody tr")).toHaveLength(4);
    expect(container.querySelectorAll("table td")).toHaveLength(16);
  });

  it("switches the hint text with the render mode", async () => {
    const volume = await parseNifti(makeNifti({ dim: [1, 1, 1], voxels: [1] }));
    const { rerender } = render(<InfoPanel volume={volume} mode="Volume" />);
    expect(screen.getByText(/ray-marcher walks through every voxel/)).toBeInTheDocument();
    rerender(<InfoPanel volume={volume} mode="Slices" />);
    expect(screen.getByText(/orthogonal cuts/)).toBeInTheDocument();
  });
});
