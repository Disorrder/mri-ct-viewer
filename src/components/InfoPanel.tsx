import { formatCompact } from "../lib/format";
import type { NiftiVolume } from "../nifti";

/** Live readout of the parsed NIfTI-1 header, including the voxel->world affine. */
export function InfoPanel({ volume, mode }: { volume: NiftiVolume; mode: string }) {
  const h = volume.header;
  const fmt = (n: number) => formatCompact(n);
  return (
    <div className="info">
      <h1>NIfTI-1 header</h1>
      <p className="sub">
        What a medical volume actually is — parsed live from the 348-byte header.
      </p>
      <dl>
        <Row k="magic" v={`"${h.magic}"  (single-file .nii)`} />
        <Row k="dimensions" v={`${volume.nx} × ${volume.ny} × ${volume.nz} voxels`} />
        <Row k="datatype" v={`${h.datatype} (${h.bitpix}-bit), code ${h.datatypeCode}`} />
        <Row
          k="voxel spacing"
          v={`${fmt(h.pixdim[1])} × ${fmt(h.pixdim[2])} × ${fmt(h.pixdim[3])} ${h.xyzUnits}`}
        />
        <Row k="scl_slope / inter" v={`${fmt(h.sclSlope)} / ${fmt(h.sclInter)}`} />
        <Row k="display range" v={`${fmt(volume.displayMin)} … ${fmt(volume.displayMax)}`} />
        <Row k="vox_offset" v={`${h.voxOffset} bytes`} />
        <Row k="endianness" v={h.littleEndian ? "little" : "big"} />
        <Row k="orientation" v={`qform=${h.qformCode}, sform=${h.sformCode}`} />
      </dl>
      <div className="affine">
        <div className="affine-title">voxel → world affine (mm, RAS)</div>
        <table>
          <tbody>
            {h.affine.map((row, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static 4x4 affine, never reordered
              <tr key={i}>
                {row.map((c, j) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: static row, never reordered
                  <td key={j}>{fmt(c)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">
        {mode === "Volume"
          ? "Drag to orbit · scroll to zoom. The cube is the whole scan; the ray-marcher walks through every voxel."
          : "The three planes are orthogonal cuts (sagittal / coronal / axial) — the way clinicians actually read scans."}
      </p>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}
