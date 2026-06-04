/**
 * JS port of the GLSL colormaps in glsl.ts, used to draw the colorbar legend
 * and tint the histogram on a 2D canvas. Index order matches COLORMAPS.
 */
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const VIRIDIS = [
  [0.2777, 0.0054, 0.3341],
  [0.1051, 1.4046, 1.3846],
  [-0.3309, 0.2148, 0.0951],
  [-4.6342, -5.7991, -19.3324],
  [6.2283, 14.1799, 56.6906],
  [4.7764, -13.7451, -65.353],
  [-5.4355, 4.6459, 26.3124],
];

/** Returns [r,g,b] in 0..255 for a normalized value x in [0,1]. */
export function colormapRGB(mode: number, x: number): [number, number, number] {
  let r: number, g: number, b: number;
  switch (mode) {
    case 0: // gray
      r = g = b = x;
      break;
    case 1: // bone
      r = x * 0.95;
      g = x * 0.97;
      b = x * 1.06 + 0.02;
      break;
    case 2: // hot
      r = 3 * x;
      g = 3 * x - 1;
      b = 3 * x - 2;
      break;
    case 3: {
      // viridis (Horner evaluation of the polynomial)
      const out = [0, 0, 0];
      for (let i = 0; i < 3; i++) {
        let v = VIRIDIS[6][i];
        for (let k = 5; k >= 0; k--) v = v * x + VIRIDIS[k][i];
        out[i] = v;
      }
      [r, g, b] = out;
      break;
    }
    default: // jet
      r = 1.5 - Math.abs(4 * x - 3);
      g = 1.5 - Math.abs(4 * x - 2);
      b = 1.5 - Math.abs(4 * x - 1);
  }
  return [clamp01(r) * 255, clamp01(g) * 255, clamp01(b) * 255];
}
