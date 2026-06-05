import { fireEvent, render, screen } from "@testing-library/react";
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { ViewThumbStrip } from "../../src/components/ViewThumbStrip";
import { PHONE_TABS } from "../../src/lib/layout";
import type { VolumeViewer } from "../../src/rendering";

const fakeViewer = () => ({ setThumbnails: vi.fn() }) as unknown as VolumeViewer;
const hostRef = () => createRef<HTMLDivElement>() as { current: HTMLDivElement };

describe("<ViewThumbStrip>", () => {
  it("shows a preview for each view except the active one", () => {
    const ref = hostRef();
    ref.current = document.createElement("div");
    render(
      <ViewThumbStrip
        viewer={fakeViewer()}
        hostRef={ref}
        views={PHONE_TABS}
        active="axial"
        onSelect={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: "Switch to 3D" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to Coronal" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Switch to Sagittal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Switch to Axial" })).not.toBeInTheDocument();
  });

  it("calls onSelect with the layout key when a preview is tapped", () => {
    const onSelect = vi.fn();
    const ref = hostRef();
    ref.current = document.createElement("div");
    render(
      <ViewThumbStrip
        viewer={fakeViewer()}
        hostRef={ref}
        views={PHONE_TABS}
        active="3D"
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Switch to Sagittal" }));
    expect(onSelect).toHaveBeenCalledWith("sagittal");
  });

  it("reports the inactive views' rects to the viewer", () => {
    const viewer = fakeViewer();
    const ref = hostRef();
    ref.current = document.createElement("div");
    render(
      <ViewThumbStrip
        viewer={viewer}
        hostRef={ref}
        views={PHONE_TABS}
        active="axial"
        onSelect={() => {}}
      />,
    );
    expect(viewer.setThumbnails).toHaveBeenCalled();
    const thumbs = (viewer.setThumbnails as ReturnType<typeof vi.fn>).mock.lastCall?.[0];
    expect(thumbs.map((t: { kind: string }) => t.kind)).toEqual(["3D", "coronal", "sagittal"]);
  });
});
