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
import {
  createPowertrainTelemetry,
  stepPowertrain,
  type PowertrainState,
  type PowertrainTelemetry,
} from './powertrain'
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
  /** Total longitudinal force of this step [N]. */
  longitudinalForce: number
  /**
   * Kinetic energy of the chassis [J], the sliding and the spinning together:
   * m*v^2/2 + Iz*r^2/2. Nothing in the model reads it -- it is the audit. With
   * the powertrain not driving, every force on the car is dissipative, so this
   * number may only ever fall; if it climbs, the model is making energy.
   */
  kineticEnergy: number
  /** How fast that energy is changing [W]. Positive without drive is a bug. */
  kineticEnergyRate: number
  /** Engine, clutch and gearbox readouts. */
  readonly powertrain: PowertrainTelemetry
}

export function createTelemetry(powertrain: PowertrainState): VehicleTelemetry {
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
    longitudinalForce: 0,
    kineticEnergy: 0,
    kineticEnergyRate: 0,
    powertrain: createPowertrainTelemetry(powertrain.mode),
  }
}

/** Chassis kinetic energy [J]: the body sliding, plus the body spinning. */
function kineticEnergy(state: VehicleState, params: CarParams): number {
  const translation = 0.5 * params.mass * (state.vx * state.vx + state.vy * state.vy)
  const rotation = 0.5 * params.yawInertia * state.yawRate * state.yawRate
  return translation + rotation
}

/**
 * Advances one car by exactly `dt` seconds. Mutates `state` and writes the
 * readouts of this step into `telemetry`.
 */
export function stepVehicle(
  state: VehicleState,
  params: CarParams,
  powertrain: PowertrainState,
  input: InputState,
  dt: number,
  telemetry: VehicleTelemetry,
): void {
  const energyBefore = kineticEnergy(state, params)

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

  // --- 3. How much of the tyre model this speed is worth believing ---------
  // The linear slip formulation divides by forward speed, so at walking pace
  // its forces stop meaning anything. Below the blend speed they are faded out
  // and the kinematic car at the bottom of this function takes over. Every
  // force the tyres make from here down carries this factor, one way or
  // another.
  const speed = Math.hypot(state.vx, state.vy)
  const blend = clamp(speed / LOW_SPEED_BLEND_SPEED, 0, 1)

  // --- 4. Lateral tyre forces ---------------------------------------------
  // Linear in slip angle (stiffness C) until the friction circle runs out:
  // an axle can never produce more grip than mu times the load on it.
  const gripFront = params.mu * loadFront // [N]
  const gripRear = params.mu * loadRear // [N]
  const lateralFront = -clamp(params.corneringStiffnessFront * slipFront, -gripFront, gripFront)
  const lateralRear = -clamp(params.corneringStiffnessRear * slipRear, -gripRear, gripRear)

  // Each of those forces is perpendicular to its own wheel, not to the car.
  // The rear wheel points along the nose, so its force is already body +y; the
  // front one is turned by `steer`, and resolving it onto the body axes leaves
  // a component pointing back along the nose.
  //
  // That component is the drift drag: the price of asking a tyre to travel at
  // an angle to the way it is pointing, and the reason steering a real car in
  // neutral slows it down. Leaving it out does not merely lose some drag --
  // what is left of the lateral force then does net positive work on the body,
  // and the car gains speed with nothing driving it.
  //
  // The blend is on it because it is on the other two components already: the
  // lateral force and the yaw moment only reach the car through the lerps at
  // the end of this function, and one component of a force that outlived the
  // other two would be free energy -- the tyre would push the car along its
  // nose without anything paying for it sideways.
  const cosSteer = Math.cos(state.steer)
  const sinSteer = Math.sin(state.steer)
  const lateralTotal = lateralFront * cosSteer + lateralRear // body +y [N]
  const driftDrag = -lateralFront * sinSteer * blend // body +x [N]

  // --- 5. Longitudinal force ----------------------------------------------
  // Until the rear axle gets a proper lock model, the handbrake is simply a
  // full brake application -- and so is the automatic's parking pawl, which
  // holds the driven shaft still whether or not anybody is on the pedal.
  const brake = Math.max(
    clamp(input.brake, 0, 1),
    input.handbrake ? 1 : 0,
    powertrain.park ? 1 : 0,
  )
  // Everything that slows the car down whatever the engine is doing. The
  // powertrain is handed these too: it has to know how fast the car itself
  // will be going next step to work out how much the wheels are outrunning it.
  const resistForce =
    -travelSign * brake * params.maxBrakeForce - // brakes oppose travel
    params.dragCoefficient * state.vx * forwardSpeed - // aero drag ~ v^2
    params.rollingResistance * state.vx + // rolling resistance ~ v
    driftDrag // the front tyre dragging against its own slip

  // Drive comes out of the engine, through the clutch, the gear and the
  // differential, and is capped by the grip the driven axle actually has.
  const driveForce = stepPowertrain(
    powertrain,
    params.powertrain,
    { throttle: clamp(input.throttle, 0, 1), clutchPress: clamp(input.clutchPress, 0, 1) },
    { vx: state.vx, tractionLimit: gripRear, resistForce, mass: params.mass },
    dt,
    telemetry.powertrain,
  )

  const longitudinalForce = driveForce + resistForce
  const ax = longitudinalForce / params.mass

  // --- 6. Integrate in the body frame -------------------------------------
  // Two different things happen to the velocity vector over one step: the
  // forces change it, and the body frame it is written in turns underneath it.
  // They are applied in that order, one after the other.

  // Forces first, with the frame held still.
  let vxForce = state.vx + dt * ax
  // The brakes stop the car, they never reverse it: if the velocity would
  // cross zero while braking, it lands on zero instead.
  if (brake > 0 && travelSign !== 0 && vxForce * travelSign <= 0) vxForce = 0
  const vyForce = state.vy + dt * (lateralTotal / params.mass)

  // Longitudinal acceleration actually realised this step. Equals Fx/m unless
  // the clamp above truncated the step, so the weight transfer of the next
  // step is never fed a deceleration the car did not really experience.
  const realisedAx = (vxForce - state.vx) / dt

  // Yaw acceleration from the moment of the two axle forces about the CG. The
  // front force enters with the same cosine as above: it is one single vector,
  // and a moment taken from a different one than the force itself would be the
  // moment of nothing.
  const yawMoment = a * lateralFront * cosSteer - b * lateralRear // [N*m]
  const yawRateDynamic = state.yawRate + dt * (yawMoment / params.yawInertia)

  // --- Low-speed blend ----------------------------------------------------
  // Kinematic car: the wheels roll without sliding, so the rear simply
  // follows the front and the body has no lateral velocity of its own.
  // vx carries the sign so that reversing steers the way it should.
  const yawRateKinematic = (state.vx * Math.tan(state.steer)) / L
  const vyKinematic = 0

  // At a standstill both branches are zero, so a steered wheel on a parked
  // car moves nothing and rotates nothing.
  state.yawRate = lerp(yawRateKinematic, yawRateDynamic, blend)

  // Then the frame. Over the step the body turns by yawRate*dt, and a velocity
  // vector that no force is acting on any more is simply carried around with
  // it: written in the new frame, it is the old vector rotated backwards by
  // that angle. This is the Coriolis coupling between the two axes, and taking
  // it as the rotation it actually is -- instead of as the first term of that
  // rotation's series, +r*vy and -r*vx -- is what leaves its length exactly
  // untouched. The linearised form is a shear of determinant 1 + (r*dt)^2, and
  // it inflates the speed by that much on every step the car is turning.
  const yawStep = state.yawRate * dt
  const cosStep = Math.cos(yawStep)
  const sinStep = Math.sin(yawStep)
  const vxDynamic = vxForce * cosStep + vyForce * sinStep
  const vyDynamic = vyForce * cosStep - vxForce * sinStep

  state.vx = vxDynamic
  state.vy = lerp(vyKinematic, vyDynamic, blend)

  state.ax = realisedAx

  state.yaw = wrapAngle(state.yaw + yawStep)

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
  telemetry.longitudinalForce = longitudinalForce
  telemetry.kineticEnergy = kineticEnergy(state, params)
  telemetry.kineticEnergyRate = (telemetry.kineticEnergy - energyBefore) / dt
}
