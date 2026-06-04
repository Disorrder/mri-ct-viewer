/** Shared compact number formatting for the readout panels. Pure + unit-tested. */

export interface CompactOptions {
  /** Decimal places for the plain (non-exponential) form. */
  fixed: number;
  /** Significant decimals for the exponential form. */
  exp: number;
  /** Also switch to exponential for tiny non-zero magnitudes (< 0.01). */
  tiny?: boolean;
}

/**
 * Format a number compactly: exponential for large magnitudes (≥ 1000) and,
 * optionally, tiny non-zero ones (< 0.01); otherwise a fixed-decimal number.
 * Returns a `number` for the plain form (so trailing zeros are dropped) and a
 * `string` for the exponential form.
 */
export function formatCompact(
  n: number,
  { fixed, exp, tiny = true }: CompactOptions = { fixed: 3, exp: 2, tiny: true },
): number | string {
  const big = Math.abs(n) >= 1000;
  const small = tiny && n !== 0 && Math.abs(n) < 0.01;
  return big || small ? n.toExponential(exp) : +n.toFixed(fixed);
}
