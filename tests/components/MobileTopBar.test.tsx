import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MobileTopBar } from "../../src/components/MobileTopBar";

describe("<MobileTopBar>", () => {
  it("renders the four view tabs and marks the active one", () => {
    render(<MobileTopBar active="axial" onSelect={() => {}} />);
    for (const label of ["3D", "Axial", "Coronal", "Sagittal"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Axial" }).className).toContain("active");
    expect(screen.getByRole("button", { name: "3D" }).className).not.toContain("active");
  });

  it("calls onSelect with the layout key when a tab is clicked", () => {
    const onSelect = vi.fn();
    render(<MobileTopBar active="3D" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Coronal" }));
    expect(onSelect).toHaveBeenCalledWith("coronal");
  });
});
