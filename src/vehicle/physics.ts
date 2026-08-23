/**
 * Bicycle model with slip angles, longitudinal weight transfer and a
 * kinematic blend at walking pace.
 *
 * Frames: the car carries a body frame with +x out the nose and +y out the
 * passenger side (world +Y is down, so +y body is the car's right). The yaw
 * rate r turns the nose towards +y body.
 */
import { GRAVITY } from '../core/constants'
import { clamp, lerp, signum, wrapAngle } from '../core/math'
import type { InputState } from '../input/input'
import type { CarParams } from './carParams'
import type { VehicleState } from './vehicleState'

/**
 * Speed at which the model is fully dynamic [m/s]. Below it the tyre model is
 * mixed with a pure kinematic car, because the linear slip-angle formulation
 * divides by forward speed and turns into nonsense as it approaches zero:
 * slip angles explode, the tyres saturate against each other and the car
 * shivers, spins in place and skates off. A parking game lives almost entirely
 * under 10 km/h, so this blend is the main case, not an edge case.
 */
export const LOW_SPEED_BLEND_SPEED = 2.0

/** Everything the debug overlay needs to read out of one physics step. */
export interface VehicleTelemetry {
  /** Magnitude of the body-frame velocity [m/s]. */
  speed: number
  /** Front/rear axle slip angles [rad]. */
  slipFront: number
  slipRear: number
  /** Front/rear vertical loads [N]. */
  loadFront: number
  loadRear: number
  /** Front/rear lateral tyre forces [N], positive towards the car's right. */
  lateralFront: number
  lateralRear: number
  /** 0 = pure kinematic, 1 = pure dynamic. */
  blend: number
  /** Longitudinal acceleration of this step [m/s^2]. */
  longitudinalAcceleration: number
}

export function createTelemetry(): VehicleTelemetry {
  return {
    speed: 0,
    slipFront: 0,
    slipRear: 0,
    loadFront: 0,
    loadRear: 0,
    lateralFront: 0,
    lateralRear: 0,
    blend: 0,
    longitudinalAcceleration: 0,
  }
}

/**
 * Advances one car by exactly `dt` seconds. Mutates `state` and writes the
 * readouts of this step into `telemetry`.
 */
export function stepVehicle(
  state: VehicleState,
  params: CarParams,
  input: InputState,
  dt: number,
  telemetry: VehicleTelemetry,
): void {
  const a = params.cgToFront // CG -> front axle [m]
  const b = params.cgToRear // CG -> rear axle [m]
  const L = params.axleSpan // wheelbase, a + b [m]

  // --- Steering actuator --------------------------------------------------
  // The input is a target, not the angle itself: the wheels chase it at a
  // limited rate, and recentre at that same rate when the input is released.
  const steerTarget = clamp(input.steer, -1, 1) * params.maxSteerAngle
  const steerDelta = params.steerRate * dt
  state.steer += clamp(steerTarget - state.steer, -steerDelta, steerDelta)

  // --- 1. Longitudinal weight transfer ------------------------------------
  // Braking pitches the car forward and presses the front axle into the road;
  // accelerating does the opposite. The couple is m*ax acting at CG height h,
  // reacted by the axles L apart. Uses the acceleration measured last step,
  // which is what makes it a feedback loop instead of an implicit equation.
  const weight = params.mass * GRAVITY // total static load [N]
  const transfer = params.mass * state.ax * (params.cgHeight / L) // [N]
  // Clamped at zero: an axle can push down on the road, never pull up on it.
  const loadFront = Math.max(0, weight * (b / L) - transfer)
  const loadRear = Math.max(0, weight * (a / L) + transfer)

  // --- 2. Slip angles -----------------------------------------------------
  // Angle between where each axle points and where it is actually travelling.
  // The axle's lateral velocity is the CG's vy plus the rotation of the body
  // about the CG (+a in front of it, -b behind it).
  const forwardSpeed = Math.abs(state.vx)
  const travelSign = signum(state.vx) // 0 when stopped: no direction, no steer effect
  const slipFront = Math.atan2(state.vy + a * state.yawRate, forwardSpeed) - state.steer * travelSign
  const slipRear = Math.atan2(state.vy - b * state.yawRate, forwardSpeed)

  // --- 3. Lateral tyre forces ---------------------------------------------
  // Linear in slip angle (stiffness C) until the friction circle runs out:
  // an axle can never produce more grip than mu times the load on it.
  const gripFront = params.mu * loadFront // [N]
  const gripRear = params.mu * loadRear // [N]
  const lateralFront = -clamp(params.corneringStiffnessFront * slipFront, -gripFront, gripFront)
  const lateralRear = -clamp(params.corneringStiffnessRear * slipRear, -gripRear, gripRear)

  // --- 4. Longitudinal force ----------------------------------------------
  // No engine and no gearbox yet: the throttle is direct force at the wheels.
  const throttle = clamp(input.throttle, 0, 1)
  // Until the rear axle gets a proper lock model, the handbrake is simply a
  // full brake application.
  const brake = Math.max(clamp(input.brake, 0, 1), input.handbrake ? 1 : 0)
  let longitudinalForce = throttle * params.maxDriveForce
  longitudinalForce -= travelSign * brake * params.maxBrakeForce // brakes oppose travel
  longitudinalForce -= params.dragCoefficient * state.vx * forwardSpeed // aero drag ~ v^2
  longitudinalForce -= params.rollingResistance * state.vx // rolling resistance ~ v
  const ax = longitudinalForce / params.mass

  // --- 5. Integrate in the body frame -------------------------------------
  // A rotating frame adds Coriolis terms: the velocity vector is carried
  // around by the yaw rate even when no force acts on it.
  //   dvx/dt = Fx/m + r*vy
  //   dvy/dt = Fy/m - r*vx
  let vx = state.vx + dt * (ax + state.vy * state.yawRate)
  // The brakes stop the car, they never reverse it: if the velocity would
  // cross zero while braking, it lands on zero instead.
  if (brake > 0 && travelSign !== 0 && vx * travelSign <= 0) vx = 0

  // Longitudinal acceleration actually realised this step, a_x = dvx/dt - r*vy,
  // evaluated on the pre-step velocity. Equals Fx/m unless the clamp above
  // truncated the step, so the weight transfer of the next step is never fed a
  // deceleration the car did not really experience.
  const realisedAx = (vx - state.vx) / dt - state.vy * state.yawRate

  const lateralTotal = lateralFront + lateralRear
  const vyDynamic = state.vy + dt * (lateralTotal / params.mass - state.vx * state.yawRate)

  // Yaw acceleration from the moment of the two axle forces about the CG.
  const yawMoment = a * lateralFront - b * lateralRear // [N*m]
  const yawRateDynamic = state.yawRate + dt * (yawMoment / params.yawInertia)

  // --- Low-speed blend ----------------------------------------------------
  // Kinematic car: the wheels roll without sliding, so the rear simply
  // follows the front and the body has no lateral velocity of its own.
  // vx carries the sign so that reversing steers the way it should.
  const speed = Math.hypot(state.vx, state.vy)
  const blend = clamp(speed / LOW_SPEED_BLEND_SPEED, 0, 1)
  const yawRateKinematic = (state.vx * Math.tan(state.steer)) / L
  const vyKinematic = 0

  state.vx = vx
  state.vy = lerp(vyKinematic, vyDynamic, blend)
  state.yawRate = lerp(yawRateKinematic, yawRateDynamic, blend)

  // At a standstill both branches are zero, so a steered wheel on a parked
  // car moves nothing and rotates nothing.

  state.ax = realisedAx

  state.yaw = wrapAngle(state.yaw + state.yawRate * dt)

  // Body velocity -> world velocity.
  const cosYaw = Math.cos(state.yaw)
  const sinYaw = Math.sin(state.yaw)
  state.x += (state.vx * cosYaw - state.vy * sinYaw) * dt
  state.y += (state.vx * sinYaw + state.vy * cosYaw) * dt

  telemetry.speed = Math.hypot(state.vx, state.vy)
  telemetry.slipFront = slipFront
  telemetry.slipRear = slipRear
  telemetry.loadFront = loadFront
  telemetry.loadRear = loadRear
  telemetry.lateralFront = lateralFront
  telemetry.lateralRear = lateralRear
  telemetry.blend = blend
  telemetry.longitudinalAcceleration = state.ax
}
