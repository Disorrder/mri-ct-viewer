import { afterEach, describe, expect, it, vi } from "vitest";
import { interleavedOrder, loadDicomSeriesProgressive } from "../../src/dicom";
import type { VolumePreview } from "../../src/volume";
import { type DicomSpec, makeDicom } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

/** A 2×2 single-frame slice spec at patient-z `z`, every voxel = `value`. */
function slice(z: number, value: number, opts: Partial<DicomSpec> = {}): DicomSpec {
  return {
    rows: 2,
    columns: 2,
    pixels: [value, value, value, value],
    position: [0, 0, z],
    pixelSpacing: [0.5, 0.75],
    ...opts,
  };
}

/** Stub fetch to serve a manifest + one .dcm per buffer, keyed by filename suffix. */
function mockSeries(buffers: ArrayBuffer[], manifestUrl = "/series/index.json") {
  const files = buffers.map((_, i) => `slice-${i}.dcm`);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === manifestUrl) return new Response(JSON.stringify(files), { status: 200 });
      const m = /slice-(\d+)\.dcm$/.exec(url);
      if (m) return new Response(buffers[Number(m[1])], { status: 200 });
      return new Response("not found", { status: 404 });
    }),
  );
  return manifestUrl;
}

describe("interleavedOrder", () => {
  it("returns the two ends first, then repeated midpoints", () => {
    expect(interleavedOrder(5)).toEqual([0, 4, 2, 1, 3]);
  });

  it("handles the degenerate sizes", () => {
    expect(interleavedOrder(0)).toEqual([]);
    expect(interleavedOrder(1)).toEqual([0]);
    expect(interleavedOrder(2)).toEqual([0, 1]);
  });

  it("is a complete permutation for any n", () => {
    for (const n of [3, 7, 16, 37, 128]) {
      const order = interleavedOrder(n);
      expect(order.length).toBe(n);
      expect([...order].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it("densifies coarse-to-fine: the largest gap never grows as slices arrive", () => {
    for (const n of [9, 16]) {
      const order = interleavedOrder(n);
      let prevMaxGap = Number.POSITIVE_INFINITY;
      for (let k = 2; k <= n; k++) {
        const sorted = order.slice(0, k).sort((a, b) => a - b);
        let maxGap = 0;
        for (let i = 1; i < sorted.length; i++)
          maxGap = Math.max(maxGap, sorted[i] - sorted[i - 1]);
        expect(maxGap).toBeLessThanOrEqual(prevMaxGap);
        prevMaxGap = maxGap;
      }
    }
  });
});

describe("loadDicomSeriesProgressive", () => {
  it("streams a z-slab per slice and returns the assembled volume", async () => {
    const buffers = Array.from({ length: 5 }, (_, z) => makeDicom(slice(z, z * 50)));
    const url = mockSeries(buffers);

    const slabZ: number[] = [];
    const vol = await loadDicomSeriesProgressive(url, { onSlab: (z) => slabZ.push(z) });

    expect([vol.nx, vol.ny, vol.nz]).toEqual([2, 2, 5]);
    expect(vol.meta.source).toBe("series");
    expect([...slabZ].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
  });

  it("fetches slices in bisection order, not sequentially", async () => {
    const buffers = Array.from({ length: 5 }, (_, z) => makeDicom(slice(z, z * 50)));
    const url = mockSeries(buffers);

    const slabOrder: number[] = [];
    await loadDicomSeriesProgressive(url, { onSlab: (z) => slabOrder.push(z) });

    // Manifest is in z order, so each slab's z equals its fetch index — the order
    // they arrive is the bisection order, the whole point of progressive refinement.
    expect(slabOrder).toEqual([0, 4, 2, 1, 3]);
  });

  it("downloads several slices in parallel, not one at a time", async () => {
    const buffers = Array.from({ length: 12 }, (_, z) => makeDicom(slice(z, z * 10)));
    const files = buffers.map((_, i) => `slice-${i}.dcm`);
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.endsWith("index.json")) return new Response(JSON.stringify(files), { status: 200 });
        const m = /slice-(\d+)\.dcm$/.exec(url);
        if (!m) return new Response("not found", { status: 404 });
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve(); // hold the request open so the pool's wave overlaps
        inFlight--;
        return new Response(buffers[Number(m[1])], { status: 200 });
      }),
    );

    const vol = await loadDicomSeriesProgressive("/series/index.json", {});
    expect(vol.nz).toBe(12); // all slices still land
    expect(maxInFlight).toBeGreaterThanOrEqual(4); // at least 4 downloads overlapped
  });

  it("emits one preview-init sized to the full series before any slab", async () => {
    const buffers = Array.from({ length: 4 }, (_, z) => makeDicom(slice(z, 100)));
    const url = mockSeries(buffers);

    let init: VolumePreview | undefined;
    let slabsBeforeInit = 0;
    await loadDicomSeriesProgressive(url, {
      onInit: (p) => {
        init = p;
      },
      onSlab: () => {
        if (!init) slabsBeforeInit++;
      },
    });

    expect(slabsBeforeInit).toBe(0);
    expect(init).toBeDefined();
    expect([init?.nx, init?.ny, init?.nz]).toEqual([2, 2, 4]);
    expect(init?.spacing).toEqual([0.75, 0.5, 1]); // [col, row, provisional dz]
  });

  it("skips an unreadable companion and assembles only the real slices", async () => {
    const buffers = [
      makeDicom(slice(0, 0)),
      new Uint8Array([1, 2, 3, 4]).buffer as ArrayBuffer, // junk, not a DICOM image
      makeDicom(slice(2, 200)),
    ];
    const url = mockSeries(buffers);

    const slabZ: number[] = [];
    const vol = await loadDicomSeriesProgressive(url, { onSlab: (z) => slabZ.push(z) });

    expect(vol.nz).toBe(2); // the two readable slices stacked
    expect(slabZ.length).toBe(2); // the junk produced no slab
  });

  it("throws on an empty manifest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify([]), { status: 200 })),
    );
    await expect(loadDicomSeriesProgressive("/series/index.json", {})).rejects.toThrow(
      /Empty or invalid/,
    );
  });

  it("throws when the manifest fetch fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(loadDicomSeriesProgressive("/series/index.json", {})).rejects.toThrow(
      /Failed to fetch/,
    );
  });
});
