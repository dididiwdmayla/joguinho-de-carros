/**
 * Deterministic pseudo-random numbers.
 *
 * Every bit of variation in a level -- the colour of a parked car, the wear on
 * a painted line -- comes from here, seeded by the number the level file
 * carries. A level therefore looks exactly the same on every machine and on
 * every reload, which is the only way a scene built from random numbers can be
 * called authored at all.
 */

/** One stream of numbers. Cheap, small, and good enough for looks. */
export interface Random {
  /** Next value in [0, 1). */
  next(): number
}

/**
 * mulberry32: one 32-bit word of state, three multiplies per draw. Chosen for
 * being short enough to read in one sitting and stable across engines -- all
 * of the arithmetic below stays inside 32 bits on purpose.
 */
export function createRandom(seed: number): Random {
  let state = (Math.trunc(seed) | 0) >>> 0
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0
      let t = state
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    },
  }
}

/** Next value in [min, max). */
export function randomBetween(random: Random, min: number, max: number): number {
  return min + (max - min) * random.next()
}

/**
 * A second stream derived from a seed and a label, so two things seeded from
 * the same level never march in step: the paint would take its wear from the
 * same draws that picked the car colours, and adding a car would repaint every
 * line in the lot.
 */
export function streamFor(seed: number, label: string): Random {
  let hash = seed | 0
  for (let i = 0; i < label.length; i++) {
    hash = (Math.imul(hash ^ label.charCodeAt(i), 0x01000193) | 0) >>> 0
  }
  return createRandom(hash)
}
