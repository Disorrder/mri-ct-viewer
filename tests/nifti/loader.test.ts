import { describe, it, expect, vi, afterEach } from "vitest";
import { maybeGunzip, loadNiftiFromUrl, type LoadProgress } from "../../src/nifti";
import { makeNifti, gzip } from "./fixtures";

afterEach(() => vi.restoreAllMocks());

describe("maybeGunzip", () => {
  it("inflates a gzip buffer back to the original bytes", async () => {
    const original = makeNifti({ dim: [2, 1, 1], voxels: [7, 9] });
    const compressed = await gzip(original);
    expect(compressed.byteLength).not.toBe(original.byteLength); // actually gzipped
    const out = await maybeGunzip(compressed);
    expect(new Uint8Array(out)).toEqual(new Uint8Array(original));
  });

  it("passes a non-gzip buffer through untouched", async () => {
    const plain = makeNifti({ dim: [1, 1, 1], voxels: [3] });
    const out = await maybeGunzip(plain);
    expect(new Uint8Array(out)).toEqual(new Uint8Array(plain));
  });
});

describe("loadNiftiFromUrl", () => {
  function mockFetch(buf: ArrayBuffer, headers: Record<string, string> = {}): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(buf, { status: 200, headers })),
    );
  }

  it("fetches, parses, and reports streamed progress phases", async () => {
    const buf = makeNifti({ dim: [2, 2, 1], datatypeCode: 4, voxels: [0, 100, 200, 300] });
    mockFetch(buf, { "content-length": String(buf.byteLength) });

    const phases: LoadProgress["phase"][] = [];
    const vol = await loadNiftiFromUrl("/scan.nii", (p) => phases.push(p.phase));

    expect([vol.nx, vol.ny, vol.nz]).toEqual([2, 2, 1]);
    expect(vol.header.datatype).toBe("int16");
    expect(phases).toContain("download");
    expect(phases).toContain("decompress");
    expect(phases).toContain("parse");
  });

  it("decompresses a gzipped response on the way through", async () => {
    const original = makeNifti({ dim: [2, 1, 1], voxels: [10, 250] });
    const buf = await gzip(original);
    mockFetch(buf, { "content-length": String(buf.byteLength) });

    const vol = await loadNiftiFromUrl("/scan.nii.gz", () => {});
    expect([vol.nx, vol.ny, vol.nz]).toEqual([2, 1, 1]);
    expect(vol.displayMax).toBe(250);
  });

  it("works without a progress callback (buffered path)", async () => {
    const buf = makeNifti({ dim: [1, 1, 1], voxels: [5] });
    mockFetch(buf);
    const vol = await loadNiftiFromUrl("/scan.nii");
    expect(vol.nx).toBe(1);
  });

  it("reports monotonic, in-range progress fractions", async () => {
    const buf = makeNifti({ dim: [4, 4, 1], voxels: Array.from({ length: 16 }, (_, i) => i * 4) });
    mockFetch(buf, { "content-length": String(buf.byteLength) });

    const fractions: number[] = [];
    await loadNiftiFromUrl("/scan.nii", (p) => fractions.push(p.fraction));

    expect(fractions.length).toBeGreaterThan(0);
    for (const f of fractions) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
    }
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    }
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(loadNiftiFromUrl("/missing.nii")).rejects.toThrow(/Failed to fetch/);
  });
});
