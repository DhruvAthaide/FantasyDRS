/**
 * Seeded pseudorandom number generator for Monte Carlo simulation.
 *
 * Used for statistical parity with the Python engine (see
 * engine.golden.test.ts). The stream is NOT compatible with numpy's
 * PCG64 — we rely on statistical convergence at n_simulations >= 10k
 * rather than per-draw bit equality.
 *
 * Do NOT use for cryptographic purposes.
 */

/**
 * Mulberry32 — 32-bit seedable uniform PRNG.
 *
 * Returns a stateful closure yielding floats in [0, 1).
 * Given the same seed, the returned function produces the same stream
 * every call — the whole point is reproducibility across test runs.
 */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Box–Muller transform — single normal sample from two uniform draws.
 *
 * Stateless: generates a fresh pair per call and discards one. ~2x uniform
 * draws per normal sample vs. a cached variant, but simpler to reason
 * about when the engine interleaves many independent sample streams.
 *
 * Guards against u1 = 0 (log(0) = -inf) by clamping to the smallest
 * positive float Mulberry32 can produce.
 */
export function boxMullerNormal(
  rng: () => number,
  mean: number,
  std: number
): number {
  let u1 = rng();
  if (u1 <= 0) u1 = Number.MIN_VALUE;
  const u2 = rng();
  const mag = std * Math.sqrt(-2.0 * Math.log(u1));
  return mag * Math.cos(2.0 * Math.PI * u2) + mean;
}

/** Convenience: sample an array of n normals with shared (mean, std). */
export function sampleNormalArray(
  rng: () => number,
  mean: number,
  std: number,
  n: number
): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = boxMullerNormal(rng, mean, std);
  }
  return out;
}

/** Convenience: sample an array of n uniforms. */
export function sampleUniformArray(rng: () => number, n: number): number[] {
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    out[i] = rng();
  }
  return out;
}
