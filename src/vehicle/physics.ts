/**
 * Single-track (bicycle) model: slip angles, longitudinal weight transfer and
 * Coulomb rolling resistance, in one set of equations that holds from a
 * standstill up.
 *
 * Frames: the car carries a body frame with +x out the nose and +y out the
 * passenger side (world +Y is down, so +y body is the car's right). The yaw
 * rate r turns the nose towards +y body.
 *
 * There is deliberately no second model to fade into at walking pace. A tyre
 * force is C*alpha with alpha the ratio of how fast the contact patch slides
 * sideways to how fast it rolls, so it is the same thing as a lateral damper
 * of coefficient C/roll: written that way, the only quantity that misbehaves
 * as the car stops is that coefficient, and a coefficient can simply be held
 * at the value it has at `SLIP_REFERENCE_SPEED`. What comes out is a model
 * whose rest point is the kinematic car -- both tyres rolling without sliding,
 * the rear following the front -- arrived at through forces instead of pasted
 * over them.
 */
import { GRAVITY } from '../core/constants'
import { clamp, signum, wrapAngle } from '../core/math'
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
 * Speed below which a tyre's lateral damping stops rising [m/s].
 *
 * The linear tyre force divides the sliding speed by the rolling speed, and
 * that division is the whole low-speed problem: at 0.1 m/s a millimetre per
 * second of slide is already a saturated tyre, and two axles saturated against
 * each other shiver, spin the car in place and skate it off. Below this speed
 * the division stops, and the damping stays at the value it reached here.
 *
 * It cannot move the model's rest point, only how long the car takes to settle
 * onto it: whatever the coefficients are, the forces vanish exactly where both
 * tyres stop sliding, and both tyres not sliding *is* the kinematic car. At
 * this value the sedan settles in about 25 ms, which at 60 Hz is a step and a
 * half -- fast enough to be invisible while manoeuvring.
 */
export const SLIP_REFERENCE_SPEED = 2.0

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
  /**
   * Fraction of the front tyre's true cornering stiffness in play this step:
   * 1 is the unmodified linear tyre, and it falls towards 0 as the car stops.
   */
  slipRegularization: number
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
    slipRegularization: 0,
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
  const cosSteer = Math.cos(state.steer)
  const sinSteer = Math.sin(state.steer)

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

  // --- 2. What each contact patch is doing --------------------------------
  // Patch velocities in the body frame: the CG's own velocity plus the
  // rotation of the body about it (+a in front of the CG, -b behind it).
  const frontLateral = state.vy + a * state.yawRate
  const rearLateral = state.vy - b * state.yawRate
  // The rear wheel points along the nose, so the body axes are already its
  // own. The front one is turned by `steer`, and rotating its patch velocity
  // into the wheel's frame splits it into how fast that tyre rolls and how
  // fast it slides across itself -- the two speeds a slip angle is the ratio
  // of, kept here as the velocities they are instead of as their ratio.
  const frontRoll = state.vx * cosSteer + frontLateral * sinSteer
  const frontSlide = frontLateral * cosSteer - state.vx * sinSteer
  const rearRoll = state.vx
  const rearSlide = rearLateral

  // --- 3. Cornering stiffness, as the damping it really is -----------------
  // C*alpha = C*(slide/roll) = (C/roll)*slide. Nothing about the tyre changed;
  // what changed is that the speed which reaches zero now sits in a
  // coefficient, where it can be held, instead of under a division, where it
  // cannot. Reversing does not flip a tyre's resistance to being dragged
  // sideways, so the rolling speed enters as a magnitude.
  const frontDamping =
    params.corneringStiffnessFront / Math.max(Math.abs(frontRoll), SLIP_REFERENCE_SPEED)
  const rearDamping =
    params.corneringStiffnessRear / Math.max(Math.abs(rearRoll), SLIP_REFERENCE_SPEED)

  // --- 4. Lateral tyre forces ---------------------------------------------
  // Two ceilings sit over that damping, and both of them only ever shorten the
  // force it asks for.
  //
  // The friction circle is the physical one: an axle can never hand over more
  // than mu times the load standing on it.
  //
  // The second belongs to the clock. A force held for a whole step can
  // overshoot the very velocity it is opposing and leave it pointing the other
  // way; a saturated tyre, whose force no longer shrinks as the slide does,
  // then flips sign every step and pumps the car up instead of settling it. So
  // no axle may take more than the impulse that brings its own sliding
  // velocity exactly to zero. That impulse is m_eff*slide, with m_eff the mass
  // the body shows to a force pushing on that contact point -- lighter than
  // the car, because the body can turn away from such a force as well as move
  // with it: 1/m_eff = 1/m + arm^2/Iz, arm being the moment arm of the force
  // about the CG.
  const gripFront = params.mu * loadFront // [N]
  const gripRear = params.mu * loadRear // [N]
  const frontArm = a * cosSteer // [m]
  const frontStop =
    Math.abs(frontSlide) / (dt * (1 / params.mass + (frontArm * frontArm) / params.yawInertia))
  const rearStop = Math.abs(rearSlide) / (dt * (1 / params.mass + (b * b) / params.yawInertia))
  const frontLimit = Math.min(gripFront, frontStop)
  const rearLimit = Math.min(gripRear, rearStop)
  const lateralFront = clamp(-frontDamping * frontSlide, -frontLimit, frontLimit)
  const lateralRear = clamp(-rearDamping * rearSlide, -rearLimit, rearLimit)

  // Under those two ceilings the tyres cannot feed the car, ever. Each force is
  // anti-parallel to the velocity of the patch it acts on, so over a step it
  // takes |impulse * slide| of energy out of the body; the second ceiling holds
  // what that same impulse puts back to no more than half of it. Two axles
  // pulling at once cannot break it either: what they add through each other is
  // bounded by the halves they each left on the table. That is the whole energy
  // argument, and it is why there is no second model to interpolate with -- a
  // state mixed from two models answers to the forces of neither, and can land
  // anywhere, above the energy it started with included.

  // Each of those forces is perpendicular to its own wheel, not to the car.
  // The rear wheel points along the nose, so its force is already body +y; the
  // front one is turned by `steer`, and resolving it onto the body axes leaves
  // a component pointing back along the nose.
  //
  // That component is the drift drag: the price of asking a tyre to travel at
  // an angle to the way it is pointing, and the reason steering a real car in
  // neutral slows it down. It is one vector, and this component, the lateral
  // one above and the yaw moment below are three readings of it -- any of them
  // scaled differently from the others would be force from nowhere.
  const lateralTotal = lateralFront * cosSteer + lateralRear // body +y [N]
  const driftDrag = -lateralFront * sinSteer // body +x [N]

  // --- 5. Longitudinal resistance -----------------------------------------
  // Until the rear axle gets a proper lock model, the handbrake is simply a
  // full brake application -- and so is the automatic's parking pawl, which
  // holds the driven shaft still whether or not anybody is on the pedal.
  const brake = Math.max(
    clamp(input.brake, 0, 1),
    input.handbrake ? 1 : 0,
    powertrain.park ? 1 : 0,
  )
  const forwardSpeed = Math.abs(state.vx)
  const travelSign = signum(state.vx) // 0 when stopped: no direction to oppose

  // Everything that only ever opposes travel, collected as one magnitude.
  //
  // Rolling resistance is Coulomb: a roughly constant force set by the load
  // the tyres carry, not by how fast they are turning. Written as a viscous
  // term instead it halves every time the speed halves, so the car creeps for
  // ever and never actually stops -- which is exactly the wrong failure for a
  // game about parking. The small viscous term that stays is the part that
  // really does grow with speed (bearings, tyre hysteresis) and it is an order
  // of magnitude under the Coulomb term at any speed this car sees.
  const rollingLoad = loadFront + loadRear // what the tyres are actually carrying [N]
  const resistMagnitude =
    brake * params.maxBrakeForce +
    params.rollingResistanceCoefficient * rollingLoad +
    params.rollingDrag * forwardSpeed +
    params.dragCoefficient * forwardSpeed * forwardSpeed

  // A Coulomb force has to be told what to do at rest or it spends every step
  // reversing its own sign about zero. Moving, it opposes travel. Stopped, it
  // is static friction: it cancels whatever is pushing, up to its own
  // magnitude and no further. That second branch is what keeps a car left in
  // neutral on the flat where it was left, and what a brake held at a
  // standstill actually does.
  //
  // The powertrain is handed the moving branch -- it has to know how fast the
  // car itself will be going next step to work out how much the wheels are
  // outrunning it -- and at rest is handed no friction at all, because the
  // static branch cannot be evaluated until the drive force it answers to
  // exists.
  const kineticResist = -travelSign * resistMagnitude

  // Drive comes out of the engine, through the clutch, the gear and the
  // differential, and is capped by the grip the driven axle actually has.
  const driveForce = stepPowertrain(
    powertrain,
    params.powertrain,
    { throttle: clamp(input.throttle, 0, 1), clutchPress: clamp(input.clutchPress, 0, 1) },
    {
      vx: state.vx,
      tractionLimit: gripRear,
      resistForce: kineticResist + driftDrag,
      mass: params.mass,
    },
    dt,
    telemetry.powertrain,
  )

  const pushing = driveForce + driftDrag // everything that is not resistance [N]
  const resistForce =
    travelSign === 0 ? -clamp(pushing, -resistMagnitude, resistMagnitude) : kineticResist
  const longitudinalForce = pushing + resistForce // what the forces are asking for [N]

  // --- 6. Integrate in the body frame -------------------------------------
  // Two different things happen to the velocity vector over one step: the
  // forces change it, and the body frame it is written in turns underneath it.
  // They are applied in that order, one after the other.

  // Forces first, with the frame held still.
  let vxForce: number
  if (travelSign === 0) {
    // Standing still, the static branch above has already answered whatever is
    // pushing, so there is nothing left to cap.
    vxForce = state.vx + (dt * longitudinalForce) / params.mass
  } else {
    // Moving, the resistance is charged as an impulse the travel itself has to
    // be able to pay for: it may take the speed down to zero and stop there,
    // never through it and out the other side. That is the only way a Coulomb
    // force ever comes to rest at 60 Hz -- uncapped it overshoots, reverses,
    // overshoots again, and the car buzzes about zero instead of parking.
    const pushed = state.vx + (dt * pushing) / params.mass
    const slowing = Math.min(
      (resistMagnitude * dt) / params.mass,
      Math.max(0, travelSign * pushed), // the speed there is still left to take
    )
    vxForce = pushed - travelSign * slowing
  }
  const vyForce = state.vy + dt * (lateralTotal / params.mass)

  // Longitudinal acceleration actually realised this step. Equals Fx/m unless
  // the cap above truncated the resistance, so the weight transfer of the next
  // step is never fed a deceleration the car did not really experience.
  const realisedAx = (vxForce - state.vx) / dt

  // Yaw acceleration from the moment of the two axle forces about the CG. The
  // front force enters with the same cosine as above: it is one single vector,
  // and a moment taken from a different one than the force itself would be the
  // moment of nothing.
  const yawMoment = a * lateralFront * cosSteer - b * lateralRear // [N*m]
  state.yawRate += dt * (yawMoment / params.yawInertia)

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
  state.vx = vxForce * cosStep + vyForce * sinStep
  state.vy = vyForce * cosStep - vxForce * sinStep

  state.ax = realisedAx

  state.yaw = wrapAngle(state.yaw + yawStep)

  // Body velocity -> world velocity.
  const cosYaw = Math.cos(state.yaw)
  const sinYaw = Math.sin(state.yaw)
  state.x += (state.vx * cosYaw - state.vy * sinYaw) * dt
  state.y += (state.vx * sinYaw + state.vy * cosYaw) * dt

  telemetry.speed = Math.hypot(state.vx, state.vy)
  // The slip angles are a readout, not an input: the forces above never divide
  // one speed by the other, and this is that division done once, at the end,
  // for whoever is reading the overlay. Unregularised on purpose -- it is the
  // angle the tyre really is at, which is the number worth checking.
  telemetry.slipFront = Math.atan2(frontSlide, Math.abs(frontRoll))
  telemetry.slipRear = Math.atan2(rearSlide, Math.abs(rearRoll))
  telemetry.loadFront = loadFront
  telemetry.loadRear = loadRear
  telemetry.lateralFront = lateralFront
  telemetry.lateralRear = lateralRear
  telemetry.slipRegularization =
    Math.min(Math.abs(frontRoll), SLIP_REFERENCE_SPEED) / SLIP_REFERENCE_SPEED
  telemetry.longitudinalAcceleration = state.ax
  telemetry.longitudinalForce = longitudinalForce
  telemetry.kineticEnergy = kineticEnergy(state, params)
  telemetry.kineticEnergyRate = (telemetry.kineticEnergy - energyBefore) / dt
}
