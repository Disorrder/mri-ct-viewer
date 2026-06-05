import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SliceScrubber } from "../../src/components/SliceScrubber";

describe("<SliceScrubber>", () => {
  it("labels each plane with its through-plane (depth) axis", () => {
    const { rerender } = render(<SliceScrubber plane="axial" value={0.5} onChange={() => {}} />);
    expect(screen.getByText("Z")).toBeInTheDocument();
    rerender(<SliceScrubber plane="coronal" value={0.5} onChange={() => {}} />);
    expect(screen.getByText("Y")).toBeInTheDocument();
    rerender(<SliceScrubber plane="sagittal" value={0.5} onChange={() => {}} />);
    expect(screen.getByText("X")).toBeInTheDocument();
  });

  it("reflects the current slice fraction on the slider", () => {
    render(<SliceScrubber plane="axial" value={0.75} onChange={() => {}} />);
    expect(screen.getByRole("slider")).toHaveValue("0.75");
  });

  it("reports the new fraction as a number when dragged", () => {
    const onChange = vi.fn();
    render(<SliceScrubber plane="sagittal" value={0.5} onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "0.2" } });
    expect(onChange).toHaveBeenCalledWith(0.2);
  });
});
