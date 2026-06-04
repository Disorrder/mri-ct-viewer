import { formatCompact } from "../lib/format";
import type { Volume } from "../volume";

/**
 * Live readout of the parsed volume's metadata. NIfTI and DICOM store the same
 * concepts very differently (see docs/dicom-vs-nifti.md), so each gets its own
 * field list — but both share the voxel→world affine table and the orbit hint.
 */
export function InfoPanel({ volume, mode }: { volume: Volume; mode: string }) {
  return (
    <div className="info">
      {volume.format === "nifti" ? <NiftiInfo volume={volume} /> : <DicomInfo volume={volume} />}
      <AffineTable affine={volume.affine} />
      <p className="hint">
        {mode === "Volume"
          ? "Drag to orbit · scroll to zoom. The cube is the whole scan; the ray-marcher walks through every voxel."
          : "The three planes are orthogonal cuts (sagittal / coronal / axial) — the way clinicians actually read scans."}
      </p>
    </div>
  );
}

const fmt = (n: number) => formatCompact(n);

/** NIfTI-1: the fixed 348-byte header. */
function NiftiInfo({ volume }: { volume: Extract<Volume, { format: "nifti" }> }) {
  const h = volume.header;
  return (
    <>
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
    </>
  );
}

/** DICOM: the handful of (group,element) tags that define the geometry. */
function DicomInfo({ volume }: { volume: Extract<Volume, { format: "dicom" }> }) {
  const m = volume.meta;
  const sp = volume.spacing;
  const win =
    m.windowCenter !== null && m.windowWidth !== null
      ? `center ${fmt(m.windowCenter)} / width ${fmt(m.windowWidth)}`
      : "—";
  const modality = m.modality
    ? m.seriesDescription
      ? `${m.modality} · ${m.seriesDescription}`
      : m.modality
    : "—";
  const source =
    m.source === "multiframe"
      ? `multi-frame file (${volume.nz} frames)`
      : `series of ${volume.nz} files`;
  return (
    <>
      <h1>DICOM dataset</h1>
      <p className="sub">
        The same concepts as NIfTI — wrapped in (group,element) tags, one volume per series.
      </p>
      <dl>
        <Row k="modality" v={modality} />
        <Row k="source" v={source} />
        <Row k="dimensions" v={`${volume.nx} × ${volume.ny} × ${volume.nz} voxels`} />
        <Row
          k="datatype"
          v={`${m.bitsAllocated}-bit ${m.pixelRepresentation === 1 ? "signed" : "unsigned"} · ${m.photometric}`}
        />
        <Row k="voxel spacing" v={`${fmt(sp[0])} × ${fmt(sp[1])} × ${fmt(sp[2])} mm`} />
        <Row k="rescale slope / inter" v={`${fmt(m.rescaleSlope)} / ${fmt(m.rescaleIntercept)}`} />
        <Row k="window center / width" v={win} />
        <Row k="display range" v={`${fmt(volume.displayMin)} … ${fmt(volume.displayMax)}`} />
        <Row k="transfer syntax" v={m.transferSyntaxName} />
        <Row k="endianness" v={m.littleEndian ? "little" : "big"} />
      </dl>
    </>
  );
}

function AffineTable({ affine }: { affine: number[][] }) {
  return (
    <div className="affine">
      <div className="affine-title">voxel → world affine (mm, RAS)</div>
      <table>
        <tbody>
          {affine.map((row, i) => (
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
