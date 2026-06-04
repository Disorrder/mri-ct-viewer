/**
 * The orientation cube (ViewCube): geometry, anatomical labelling, and the small
 * bits of pure math behind them. Kept separate from VolumeViewer so the affine
 * -> face-label logic and the chamfered-cube construction can be unit-tested
 * without a WebGL context.
 */
import * as THREE from "three";

const RAS_PAIRS: ReadonlyArray<readonly [string, string]> = [
  ["R", "L"],
  ["A", "P"],
  ["S", "I"],
];

/** Full-word labels for the six anatomical faces (the cube shows words, not single letters). */
export const ANATOMY_WORDS: Record<string, string> = {
  R: "RIGHT",
  L: "LEFT",
  A: "ANTERIOR",
  P: "POSTERIOR",
  S: "SUPERIOR",
  I: "INFERIOR",
};

// ViewCube palette: faces light, bevels (cut corners/edges) a touch darker, blue on hover.
export const GIZMO_FACE = new THREE.Color(0xd0d3d9);
export const GIZMO_BEVEL = new THREE.Color(0xaab0bb);
export const GIZMO_EDGE = new THREE.Color(0x4a4f59);
export const GIZMO_HOVER = new THREE.Color(0x5aa2ff);

/** Anatomical labels (+/-) for an object axis, from its world (RAS) direction. */
export function axisAnatomy(col: [number, number, number]): [string, string] {
  const a = [Math.abs(col[0]), Math.abs(col[1]), Math.abs(col[2])];
  const k = a[0] >= a[1] && a[0] >= a[2] ? 0 : a[1] >= a[2] ? 1 : 2; // dominant RAS axis
  const [pos, neg] = RAS_PAIRS[k];
  return col[k] >= 0 ? [pos, neg] : [neg, pos];
}

/** Face labels in BoxGeometry order [+X,-X,+Y,-Y,+Z,-Z] from the voxel->world affine. */
export function faceLabelsFromAffine(affine: number[][]): string[] {
  const col = (j: number): [number, number, number] => [affine[0][j], affine[1][j], affine[2][j]];
  const [xp, xn] = axisAnatomy(col(0));
  const [yp, yn] = axisAnatomy(col(1));
  const [zp, zn] = axisAnatomy(col(2));
  return [xp, xn, yp, yn, zp, zn];
}

/** A dark anatomical word on a transparent tile, auto-fit to fit the cube face. */
export function makeLabelTexture(text: string): THREE.CanvasTexture {
  const s = 256;
  const c = document.createElement("canvas");
  c.width = c.height = s;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#10151d";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  let font = 76; // shrink until the (possibly long) word fits with a margin
  do {
    ctx.font = `bold ${font}px ui-sans-serif, system-ui, sans-serif`;
    if (ctx.measureText(text).width <= s - 36) break;
    font -= 4;
  } while (font > 14);
  ctx.fillText(text, s / 2, s / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Outward geometric normal of triangle (a,b,c). */
export function triNormal(a: number[], b: number[], c: number[]): number[] {
  const ux = b[0] - a[0],
    uy = b[1] - a[1],
    uz = b[2] - a[2];
  const vx = c[0] - a[0],
    vy = c[1] - a[1],
    vz = c[2] - a[2];
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/**
 * A rhombicuboctahedron (a cube with its 8 corners and 12 edges sliced flat) —
 * the classic ViewCube shape. 26 facets, each its own material group so it can
 * be picked, colored and hover-highlighted independently:
 *   groups 0-5   the six square faces, in BoxGeometry order [+X,-X,+Y,-Y,+Z,-Z]
 *   groups 6-17  the twelve edge bevels
 *   groups 18-25 the eight corner cuts
 * Every facet's geometric normal points along its snap direction, so a click
 * raycast yields the camera direction directly (corners -> diagonal views).
 */
export function buildViewCubeGeometry(
  H: number,
  G: number,
): { geometry: THREE.BufferGeometry; kinds: ("face" | "bevel")[] } {
  const pos: number[] = [];
  const kinds: ("face" | "bevel")[] = [];
  const geometry = new THREE.BufferGeometry();
  let vAt = 0;

  const facet = (verts: number[][], out: number[], kind: "face" | "bevel") => {
    const start = vAt;
    const tris =
      verts.length === 3
        ? [[0, 1, 2]]
        : [
            [0, 1, 2],
            [0, 2, 3],
          ];
    for (const [i, j, k] of tris) {
      let [p0, p1, p2] = [verts[i], verts[j], verts[k]];
      const n = triNormal(p0, p1, p2);
      if (n[0] * out[0] + n[1] * out[1] + n[2] * out[2] < 0) [p1, p2] = [p2, p1]; // wind outward
      pos.push(...p0, ...p1, ...p2);
      vAt += 3;
    }
    geometry.addGroup(start, vAt - start, kinds.length);
    kinds.push(kind);
  };

  // Six square faces, in [+X,-X,+Y,-Y,+Z,-Z] order to match faceLabelsFromAffine.
  for (let a = 0; a < 3; a++) {
    for (const s of [1, -1]) {
      const [b, c] = [0, 1, 2].filter((x) => x !== a);
      const out = [0, 0, 0];
      out[a] = s;
      const verts = [
        [-G, -G],
        [G, -G],
        [G, G],
        [-G, G],
      ].map(([vb, vc]) => {
        const p = [0, 0, 0];
        p[a] = s * H;
        p[b] = vb;
        p[c] = vc;
        return p;
      });
      facet(verts, out, "face");
    }
  }

  // Twelve edge bevels (one per cube edge): a rectangle bridging two faces.
  for (let a = 0; a < 3; a++) {
    for (let b = a + 1; b < 3; b++) {
      const c = 3 - a - b;
      for (const sa of [1, -1]) {
        for (const sb of [1, -1]) {
          const out = [0, 0, 0];
          out[a] = sa;
          out[b] = sb;
          const mk = (va: number, vb: number, vc: number) => {
            const p = [0, 0, 0];
            p[a] = va;
            p[b] = vb;
            p[c] = vc;
            return p;
          };
          facet(
            [
              mk(sa * H, sb * G, -G),
              mk(sa * H, sb * G, G),
              mk(sa * G, sb * H, G),
              mk(sa * G, sb * H, -G),
            ],
            out,
            "bevel",
          );
        }
      }
    }
  }

  // Eight corner cuts (one per cube corner): a triangle joining three faces.
  for (const sx of [1, -1]) {
    for (const sy of [1, -1]) {
      for (const sz of [1, -1]) {
        facet(
          [
            [sx * H, sy * G, sz * G],
            [sx * G, sy * H, sz * G],
            [sx * G, sy * G, sz * H],
          ],
          [sx, sy, sz],
          "bevel",
        );
      }
    }
  }

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return { geometry, kinds };
}

/** Orient a label plane so its +Z faces `normal` and its +Y aligns with `up`. */
export function orientGizmoLabel(plane: THREE.Object3D, normal: THREE.Vector3, up: THREE.Vector3) {
  const f = normal.clone().normalize();
  const u = up
    .clone()
    .sub(f.clone().multiplyScalar(up.dot(f)))
    .normalize();
  const r = new THREE.Vector3().crossVectors(u, f).normalize();
  plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(r, u, f));
}
