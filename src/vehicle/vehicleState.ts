/**
 * Rigid-body state of one car. Positions are world metres, velocities are in
 * the car's own body frame (vx along the nose, vy out the passenger side).
 */
export interface VehicleState {
  /** Centre of gravity, world [m]. */
  x: number
  y: number
  /** Longitudinal velocity in the body frame, forward positive [m/s]. */
  vx: number
  /** Lateral velocity in the body frame, to the car's right positive [m/s]. */
  vy: number
  /** Heading [rad]; 0 points at world +X. */
  yaw: number
  /** Heading rate [rad/s]; positive turns the nose to the car's right. */
  yawRate: number
  /** Actual front wheel angle [rad], chases the steering input. */
  steer: number
  /**
   * Longitudinal acceleration measured on the previous step [m/s^2], kept so
   * the next step can compute weight transfer from it.
   */
  ax: number
}

export function createVehicleState(x: number, y: number, yaw: number): VehicleState {
  return { x, y, vx: 0, vy: 0, yaw, yawRate: 0, steer: 0, ax: 0 }
}

/** Snapshots `from` into `to` without allocating (used for render interpolation). */
export function copyVehicleState(from: VehicleState, to: VehicleState): void {
  to.x = from.x
  to.y = from.y
  to.vx = from.vx
  to.vy = from.vy
  to.yaw = from.yaw
  to.yawRate = from.yawRate
  to.steer = from.steer
  to.ax = from.ax
}
