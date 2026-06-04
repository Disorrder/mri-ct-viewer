import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LoadBar } from "../../src/components/LoadBar";

describe("<LoadBar>", () => {
  it("shows the label and the rounded percentage", () => {
    const { container } = render(<LoadBar fraction={0.567} label="downloading" />);
    expect(screen.getByText("downloading")).toBeInTheDocument();
    expect(screen.getByText("57%")).toBeInTheDocument();
    const fill = container.querySelector(".loader-fill") as HTMLElement;
    expect(Number.parseFloat(fill.style.width)).toBeCloseTo(56.7);
  });

  it("keeps a minimum visible fill at 0%", () => {
    const { container } = render(<LoadBar fraction={0} label="connecting" />);
    expect(screen.getByText("0%")).toBeInTheDocument();
    const fill = container.querySelector(".loader-fill") as HTMLElement;
    expect(fill.style.width).toBe("3%");
  });
});
