/** Small numeric helpers shared by simulation and render code. */

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}

export function lerp(from: number, to: number, t: number): number {
  return from + (to - from) * t
}

/** Signum that returns exactly 0 for 0, so "no motion" never picks a side. */
export function signum(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0
}

/** Wraps an angle into (-PI, PI], keeping float precision bounded. */
export function wrapAngle(angle: number): number {
  const wrapped = (angle + Math.PI) % (Math.PI * 2)
  return (wrapped < 0 ? wrapped + Math.PI * 2 : wrapped) - Math.PI
}

/** Interpolates angles along the shortest arc, so wrapping never spins. */
export function lerpAngle(from: number, to: number, t: number): number {
  return from + wrapAngle(to - from) * t
}

/**
 * Frame-rate independent exponential smoothing factor.
 *
 * `rate` is the reciprocal of the time constant [1/s]: the higher it is, the
 * faster the value chases its target. Using 1 - e^(-rate*dt) instead of a raw
 * per-frame constant keeps the motion identical at any step length.
 */
export function smoothingFactor(rate: number, dt: number): number {
  return 1 - Math.exp(-rate * dt)
}

export function radToDeg(radians: number): number {
  return (radians * 180) / Math.PI
}
