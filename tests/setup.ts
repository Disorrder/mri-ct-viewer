import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// Unmount React trees between tests so DOM assertions never leak across cases.
afterEach(() => cleanup());

// jsdom ships neither matchMedia nor a real canvas. The app reads matchMedia for
// its responsive breakpoints, and several overlays draw to a 2D canvas. We stub
// just enough for components to mount and run their effects without throwing —
// pixels are never asserted (see docs/testing.md).
if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
}

// jsdom has no ResizeObserver; ScenePerf observes its canvas to size the graph.
if (!window.ResizeObserver) {
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// A no-op 2D context: every method is a function, measureText returns a width,
// getImageData returns an empty buffer. Enough for histogram/ruler effects.
const stub2d = new Proxy(
  {
    measureText: () => ({ width: 0 }),
    getImageData: () => ({ data: new Uint8ClampedArray(4) }),
    createLinearGradient: () => ({ addColorStop: () => {} }),
    canvas: null as unknown,
  },
  {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return () => {};
    },
    set() {
      return true;
    },
  },
);

HTMLCanvasElement.prototype.getContext = vi.fn(
  () => stub2d,
) as unknown as HTMLCanvasElement["getContext"];
HTMLCanvasElement.prototype.toDataURL = vi.fn(() => "data:image/png;base64,");
