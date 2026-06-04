import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ViewTabBar } from "../../src/components/ViewTabBar";
import { DESKTOP_TABS, PHONE_TABS } from "../../src/lib/layout";

describe("<ViewTabBar>", () => {
  it("renders the phone view tabs and marks the active one", () => {
    render(<ViewTabBar tabs={PHONE_TABS} active="axial" onSelect={() => {}} />);
    for (const label of ["3D", "Axial", "Coronal", "Sagittal"]) {
      expect(screen.getByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("button", { name: "Axial" }).className).toContain("active");
    expect(screen.getByRole("button", { name: "3D" }).className).not.toContain("active");
  });

  it("renders the desktop 3D / MPR tabs", () => {
    render(<ViewTabBar tabs={DESKTOP_TABS} active="MPR" onSelect={() => {}} />);
    expect(screen.getByRole("button", { name: "3D" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "2×2 MPR" }).className).toContain("active");
    expect(screen.queryByRole("button", { name: "Axial" })).not.toBeInTheDocument();
  });

  it("calls onSelect with the layout key when a tab is clicked", () => {
    const onSelect = vi.fn();
    render(<ViewTabBar tabs={PHONE_TABS} active="3D" onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: "Coronal" }));
    expect(onSelect).toHaveBeenCalledWith("coronal");
  });

  it("applies an extra className to the bar (desktop positioning)", () => {
    const { container } = render(
      <ViewTabBar tabs={DESKTOP_TABS} className="topbar-desktop" active="3D" onSelect={() => {}} />,
    );
    expect(container.querySelector(".topbar")?.className).toContain("topbar-desktop");
  });
});
