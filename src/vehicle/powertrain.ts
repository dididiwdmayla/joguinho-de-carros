/**
 * Engine, clutch and gearbox: everything between the throttle and the tyre.
 *
 * The chain is always the same, in both directions. The engine makes torque
 * from its curve; the clutch passes part of it on according to how fast the two
 * plates are sliding past each other; the gear and the differential multiply
 * it; the rolling radius turns it into a force at the road. What the clutch
 * lets through is also what it takes back off the engine, which is why letting
 * it out too fast at a standstill kills the engine instead of moving the car.
 *
 * Two rotational states matter: the engine's rpm, and how much faster the
 * driven wheels are turning than the car is travelling (`wheelSlip`). The
 * second one is what makes wheelspin readable -- the rpm runs away from the
 * speedometer -- without a full longitudinal slip model.
 */
import { clamp, lerp, signum } from '../core/math'
import type { PowertrainParams, TorquePoint } from './carParams'

/** rad/s -> rpm. */
const RPM_PER_RAD_S = 60 / (Math.PI * 2)

/** Pedal travel where the plates first touch: below it nothing is transmitted. */
const BITE_START = 0.25
/** Pedal travel where the clutch is fully clamped. */
const BITE_END = 0.6
/**
 * A gear only goes in with the pedal below this. It is the same number as the
 * start of the bite, and it is the whole lesson of a manual gearbox: the shaft
 * has to be free before the dog can slide onto it.
 */
export const CLUTCH_ENGAGE_LIMIT = BITE_START

/**
 * Engagement above which the clutch counts as home: the engine is tied to the
 * gearbox, so it can be stalled and the idle governor has no business
 * propping it up. Not to be confused with CLUTCH_ENGAGE_LIMIT, which is a
 * pedal position -- this one is how much torque the plates can carry.
 */
export const ENGAGED_THRESHOLD = 0.25

/** Pedal travel over which the plates take hold, for drawing the bite band. */
export const CLUTCH_BITE_START = BITE_START
export const CLUTCH_BITE_END = BITE_END

/** Rotational difference under which a clamped clutch counts as one shaft [rpm]. */
const LOCK_DELTA_RPM = 40
/** Engagement needed before the clutch may lock solid. */
const LOCK_ENGAGEMENT = BITE_END

/** How quickly a spinning wheel is pulled back into step with the road [1/s]. */
const SLIP_RELAX_RATE = 9
/** Surface slip above which the overlay calls it wheelspin [m/s]. */
const WHEELSPIN_SLIP = 0.4
/** Wheelspin can never run away further than this [m/s]. */
const MAX_WHEEL_SLIP = 30

/** Idle governor gains: proportional, integral [1/s], and its authority. */
const IDLE_GAIN_P = 1.4
const IDLE_GAIN_I = 2.6
const IDLE_MAX_THROTTLE = 0.55

/** How fast the automatic clutch works its own pedal [1/s]. */
const AUTO_CLUTCH_GAIN = 4.5
/**
 * How far the automatic clutch lets the engine sag under idle before it stops
 * closing [rpm]. It is what makes the car creep: the clutch keeps taking hold
 * until the engine is pulling this much below its idle speed.
 */
const AUTO_IDLE_DROOP = 60
/** Band under idle over which the automatic clutch gives up its grip [rpm]. */
const AUTO_STALL_BAND = 150
/** Torque the automatic clutch always dares to pass, so the car creeps [N*m]. */
const AUTO_CREEP_TORQUE = 28

/** Above this speed the gearbox refuses the opposite direction [m/s]. */
const DIRECTION_CHANGE_SPEED = 3

/**
 * How much faster a revving engine warms than one left to idle: at the
 * limiter, two and a half times. It is the one thing a driver can do about a
 * cold engine, so it is worth something.
 */
const REV_WARM_GAIN = 1.5

export type TransmissionMode = 'automatic' | 'sequential' | 'manual'

/** Cycling order of the mode key and the on-screen selector. */
export const TRANSMISSION_MODES: readonly TransmissionMode[] = [
  'automatic',
  'sequential',
  'manual',
]

export const REVERSE_GEAR = -1
export const NEUTRAL_GEAR = 0

/** Short label for the mode button; the HUD will want its own wording later. */
export function transmissionModeLabel(mode: TransmissionMode): string {
  switch (mode) {
    case 'automatic':
      return 'AUT'
    case 'sequential':
      return 'SEQ'
    case 'manual':
      return 'MAN'
  }
}

/** Full name of the mode, for the settings menu rather than the button. */
export function transmissionModeName(mode: TransmissionMode): string {
  switch (mode) {
    case 'automatic':
      return 'AUTOMATICO'
    case 'sequential':
      return 'SEQUENCIAL'
    case 'manual':
      return 'MANUAL'
  }
}

/** The mode after this one, wrapping round. */
export function nextTransmissionMode(mode: TransmissionMode): TransmissionMode {
  const index = TRANSMISSION_MODES.indexOf(mode)
  return TRANSMISSION_MODES[(index + 1) % TRANSMISSION_MODES.length]
}

/** 'R', 'N' or the gear number. */
export function gearLabel(gear: number): string {
  if (gear === REVERSE_GEAR) return 'R'
  if (gear === NEUTRAL_GEAR) return 'N'
  return String(gear)
}

/** Discrete driver actions. Continuous ones (throttle, clutch) are not here. */
export type PowertrainCommand =
  | { readonly kind: 'shiftUp' }
  | { readonly kind: 'shiftDown' }
  /** -1 reverse, 0 neutral, 1..n a forward gear. */
  | { readonly kind: 'selectGear'; readonly gear: number }
  | { readonly kind: 'start' }
  | { readonly kind: 'cycleMode' }
  /** Straight to one mode, the way the settings menu picks it. */
  | { readonly kind: 'setMode'; readonly mode: TransmissionMode }

export interface PowertrainState {
  mode: TransmissionMode
  /** -1 reverse, 0 neutral, 1..n a forward gear. */
  gear: number
  rpm: number
  running: boolean
  /** True from the moment the engine dies until it is running again. */
  stalled: boolean
  /** Seconds left on the starter; 0 when it is not cranking. */
  starter: number
  /** Pedal position: 0 fully pressed (open), 1 fully released (closed). */
  clutch: number
  /** How much of the clutch's torque capacity is available, 0..1. */
  engagement: number
  /** Seconds left of the torque cut of a clutchless shift. */
  shiftCut: number
  /** Seconds before the automatic mode may pick another gear. */
  shiftGuard: number
  /** Idle governor's integral term: throttle it holds on its own. */
  idleTrim: number
  /** Driven wheel surface speed minus car speed [m/s]. */
  wheelSlip: number
  /** True while the driven axle is asked for more force than it can hold. */
  wheelspin: boolean
  /** True while engine and gearbox are turning as one shaft. */
  locked: boolean
  /**
   * Working temperature, 0 stone cold .. 1 warmed through. Not a simulation of
   * anything: one number that climbs while the engine runs, and the only thing
   * that reads it is the stall speed.
   */
  warmth: number
}

export function createPowertrainState(mode: TransmissionMode, idleRpm: number): PowertrainState {
  return {
    mode,
    gear: mode === 'manual' ? NEUTRAL_GEAR : 1,
    rpm: idleRpm,
    running: true,
    stalled: false,
    starter: 0,
    clutch: 1,
    engagement: 0,
    shiftCut: 0,
    shiftGuard: 0,
    idleTrim: 0,
    wheelSlip: 0,
    wheelspin: false,
    locked: false,
    warmth: 0,
  }
}

/** Back to stone cold. An engine handed a new set of numbers is a new engine. */
export function resetEngineWarmth(state: PowertrainState): void {
  state.warmth = 0
}

/** Everything the debug overlay reads out of one powertrain step. */
export interface PowertrainTelemetry {
  rpm: number
  gear: number
  mode: TransmissionMode
  /** Pedal position, 0 pressed .. 1 released. */
  clutch: number
  engagement: number
  /** Engine rpm minus gearbox input rpm. */
  deltaRpm: number
  /** Torque the engine is making right now [N*m]. */
  engineTorque: number
  /** Torque crossing the clutch [N*m]. */
  clutchTorque: number
  /** Longitudinal force the driven axle puts on the road [N]. */
  driveForce: number
  /** Grip available on the driven axle, mu*Fz [N]. */
  tractionLimit: number
  /** Driven wheel surface speed minus car speed [m/s]. */
  wheelSlip: number
  wheelspin: boolean
  locked: boolean
  running: boolean
  stalled: boolean
  /** Working temperature, 0 cold .. 1 warm. */
  warmth: number
  /** Stall speed actually in force this step, cold bonus included [rpm]. */
  stallRpm: number
  /**
   * The four conditions of a stall, reported one by one so it is always
   * visible which of them is the one not met.
   */
  stallBelowRpm: boolean
  stallRunning: boolean
  stallEngaged: boolean
  stallInGear: boolean
}

export function createPowertrainTelemetry(mode: TransmissionMode): PowertrainTelemetry {
  return {
    rpm: 0,
    gear: NEUTRAL_GEAR,
    mode,
    clutch: 1,
    engagement: 0,
    deltaRpm: 0,
    engineTorque: 0,
    clutchTorque: 0,
    driveForce: 0,
    tractionLimit: 0,
    wheelSlip: 0,
    wheelspin: false,
    locked: false,
    running: true,
    stalled: false,
    warmth: 0,
    stallRpm: 0,
    stallBelowRpm: false,
    stallRunning: true,
    stallEngaged: false,
    stallInGear: false,
  }
}

/** Driver controls the powertrain reads directly. */
export interface PowertrainInputs {
  /** 0..1. */
  readonly throttle: number
  /** 0..1, 1 = clutch pedal on the floor. */
  readonly clutchPress: number
}

/** What the car around the powertrain is doing this step. */
export interface PowertrainLoad {
  /** Longitudinal body velocity [m/s]. */
  readonly vx: number
  /** Grip available on the driven axle, mu*Fz [N]. */
  readonly tractionLimit: number
  /** Every other longitudinal force acting on the car this step [N]. */
  readonly resistForce: number
  /** Car mass [kg]. */
  readonly mass: number
}

/** Overall ratio of a gear, differential included. 0 in neutral. */
export function totalRatio(params: PowertrainParams, gear: number): number {
  if (gear === NEUTRAL_GEAR) return 0
  const ratio = gear === REVERSE_GEAR ? params.reverseRatio : params.gearRatios[gear - 1]
  if (ratio === undefined) return 0
  return ratio * params.finalDrive
}

/** Gearbox input speed for a given wheel surface speed [rpm]. */
function transmissionRpm(params: PowertrainParams, total: number, wheelSpeed: number): number {
  if (total === 0) return 0
  return (wheelSpeed * total * 60) / (Math.PI * 2 * params.wheelRadius)
}

/** Full-throttle torque at this speed, linear between the authored points. */
function curveTorque(curve: readonly TorquePoint[], rpm: number): number {
  const first = curve[0]
  const last = curve[curve.length - 1]
  if (rpm <= first.rpm) return first.torque
  if (rpm >= last.rpm) return last.torque
  for (let i = 1; i < curve.length; i++) {
    const upper = curve[i]
    if (rpm <= upper.rpm) {
      const lower = curve[i - 1]
      const t = (rpm - lower.rpm) / (upper.rpm - lower.rpm)
      return lower.torque + (upper.torque - lower.torque) * t
    }
  }
  return last.torque
}

/**
 * How much of the clutch's capacity the pedal is applying.
 *
 * Nothing happens over the first quarter of the travel, the plates bite over
 * the next third and are fully clamped past 60%. That narrow band is the
 * friction point, and it is the only reason a manual gearbox is worth driving.
 */
export function clutchEngagement(position: number): number {
  const t = clamp((position - BITE_START) / (BITE_END - BITE_START), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Highest forward gear. */
function topGear(params: PowertrainParams): number {
  return params.gearRatios.length
}

/** Would this gear spin the engine past the limiter at the current speed? */
function overrevs(params: PowertrainParams, gear: number, vx: number): boolean {
  const total = totalRatio(params, gear)
  if (total === 0) return false
  return Math.abs(transmissionRpm(params, total, vx)) > params.maxRpm
}

/**
 * Whether the gearbox takes the gear. Neutral always goes in; everything else
 * needs the clutch (in manual), a speed that is not already running the other
 * way, and a speed the gear can survive.
 */
function accepts(
  state: PowertrainState,
  params: PowertrainParams,
  gear: number,
  vx: number,
): boolean {
  if (gear === NEUTRAL_GEAR) return true
  if (gear === REVERSE_GEAR) {
    if (vx > DIRECTION_CHANGE_SPEED) return false
  } else {
    if (gear < 1 || gear > topGear(params)) return false
    if (vx < -DIRECTION_CHANGE_SPEED) return false
  }
  if (state.mode === 'manual' && state.clutch > CLUTCH_ENGAGE_LIMIT) return false
  return !overrevs(params, gear, vx)
}

/** Puts a gear in, with the torque cut the mode asks for. */
function engage(state: PowertrainState, params: PowertrainParams, gear: number): void {
  state.gear = gear
  switch (state.mode) {
    case 'automatic':
      state.shiftCut = params.automaticShiftTime
      state.shiftGuard = params.automaticShiftTime * 2
      break
    case 'sequential':
      state.shiftCut = params.sequentialShiftTime
      state.shiftGuard = params.sequentialShiftTime
      break
    case 'manual':
      // The driver's own foot is the torque cut.
      break
  }
}

/** Fits another gearbox, leaving the car in a state that mode can hold. */
function changeMode(state: PowertrainState, mode: TransmissionMode, vx: number): void {
  state.mode = mode
  state.shiftCut = 0
  state.shiftGuard = 0
  if (mode === 'manual') {
    // The pedal is up, so a gear left in at a standstill would stall the
    // engine the instant the mode changed. Hand the car over in neutral.
    state.clutch = 1
    if (Math.abs(vx) < 0.5) state.gear = NEUTRAL_GEAR
  } else if (state.gear === NEUTRAL_GEAR && Math.abs(vx) < 0.5) {
    state.gear = 1
  }
}

/**
 * Applies one discrete driver action. Called between frames, never inside the
 * fixed step, so a key press is consumed exactly once however many steps run.
 */
export function applyPowertrainCommand(
  state: PowertrainState,
  params: PowertrainParams,
  command: PowertrainCommand,
  vx: number,
): void {
  switch (command.kind) {
    case 'start':
      if (!state.running && state.starter <= 0) state.starter = params.starterTime
      return
    case 'cycleMode': {
      const index = TRANSMISSION_MODES.indexOf(state.mode)
      changeMode(state, TRANSMISSION_MODES[(index + 1) % TRANSMISSION_MODES.length], vx)
      return
    }
    case 'setMode':
      if (command.mode !== state.mode) changeMode(state, command.mode, vx)
      return
    case 'selectGear': {
      // Only the manual gate has a lever per gear. The clutchless modes take
      // neutral and reverse from their own keys and nothing else: an automatic
      // picks its gears itself, a sequential box walks one at a time.
      if (command.gear > 0 && state.mode !== 'manual') return
      if (command.gear === state.gear || !accepts(state, params, command.gear, vx)) return
      engage(state, params, command.gear)
      return
    }
    case 'shiftUp': {
      // In automatic the two buttons are the R-N-D selector, nothing more.
      const wanted = state.mode === 'automatic' ? Math.min(state.gear + 1, 1) : state.gear + 1
      if (wanted === state.gear || wanted > topGear(params)) return
      if (!accepts(state, params, wanted, vx)) return
      engage(state, params, wanted)
      return
    }
    case 'shiftDown': {
      const wanted = state.gear - 1
      if (wanted < REVERSE_GEAR) return
      if (!accepts(state, params, wanted, vx)) return
      engage(state, params, wanted)
      return
    }
  }
}

/** Automatic mode picks its own gear from the engine speed. */
function stepAutomatic(state: PowertrainState, params: PowertrainParams, vx: number): void {
  if (state.mode !== 'automatic') return
  if (state.gear < 1 || state.shiftCut > 0 || state.shiftGuard > 0 || !state.running) return

  if (state.rpm > params.upshiftRpm && state.gear < topGear(params)) {
    engage(state, params, state.gear + 1)
    return
  }
  // The two thresholds are far enough apart that the rpm after a shift never
  // lands past the opposite one, so the box cannot hunt between two gears.
  if (state.rpm < params.downshiftRpm && state.gear > 1 && !overrevs(params, state.gear - 1, vx)) {
    engage(state, params, state.gear - 1)
  }
}

/**
 * The clutchless modes have the same clutch as the manual one -- they just work
 * the pedal themselves, the way a driver does.
 *
 * The rule is the one a driver actually follows on a hill start: pick an engine
 * speed to hold, then let the pedal out while it stays above and take it back
 * in when it falls below. Off the throttle the speed to hold sits a little
 * under idle, so the clutch keeps biting until the engine is pulling against
 * it -- and the car creeps. On the throttle it is the launch speed, so the
 * engine flares, holds, and the pedal comes out as the car catches up.
 *
 * Coming to a stop the same rule opens the clutch again, which is why nothing
 * in these two modes can ever be dragged under. And once the gearbox is turning
 * fast enough to be driven straight, the pedal is simply out of the way.
 */
function stepAutomaticClutch(
  state: PowertrainState,
  params: PowertrainParams,
  stallRpm: number,
  rpmTrans: number,
  throttle: number,
  dt: number,
): void {
  if (state.gear === NEUTRAL_GEAR || !state.running || state.shiftCut > 0) {
    state.engagement = 0
    return
  }
  const target = lerp(params.idleRpm - AUTO_IDLE_DROOP, params.autoLaunchRpm, throttle)
  const error = (state.rpm - target) / target
  const servo = clamp(state.engagement + error * AUTO_CLUTCH_GAIN * dt, 0, 1)
  // Once the gearbox is turning fast enough to drive the engine rather than be
  // dragged by it, the pedal comes out regardless of what the launch controller
  // thinks -- the limit below is what keeps that safe.
  const driven = clamp((rpmTrans - stallRpm) / (params.autoEngageRpm - stallRpm), 0, 1)

  // And below idle, whatever either of them wants, a slipping clutch can only
  // pass on what the engine is actually making. This is the whole reason these
  // two modes cannot be stalled: the grip gives way before the engine does.
  const headroom = clamp(
    (state.rpm - (params.idleRpm - AUTO_STALL_BAND)) / AUTO_STALL_BAND,
    0,
    1,
  )
  const spare = Math.max(AUTO_CREEP_TORQUE, curveTorque(params.torqueCurve, state.rpm) * throttle)
  const limit = lerp(clamp(spare / params.clutchMaxTorque, 0, 1), 1, headroom)

  state.engagement = Math.min(Math.max(servo, driven), limit)
}

/**
 * Advances the powertrain by `dt` and returns the longitudinal force the driven
 * axle puts on the road [N]. Positive drives the car forward.
 */
export function stepPowertrain(
  state: PowertrainState,
  params: PowertrainParams,
  inputs: PowertrainInputs,
  load: PowertrainLoad,
  dt: number,
  telemetry: PowertrainTelemetry,
): number {
  const manual = state.mode === 'manual'

  if (state.shiftCut > 0) state.shiftCut = Math.max(0, state.shiftCut - dt)
  if (state.shiftGuard > 0) state.shiftGuard = Math.max(0, state.shiftGuard - dt)

  // --- Starter ------------------------------------------------------------
  // Short and free of ceremony: dying is punishment enough, waiting is not.
  if (state.starter > 0) {
    state.starter = Math.max(0, state.starter - dt)
    const progress = 1 - state.starter / params.starterTime
    state.rpm = params.idleRpm * progress
    if (state.starter === 0) {
      state.running = true
      state.stalled = false
      state.rpm = params.idleRpm
      state.idleTrim = 0
    }
  }

  // --- Temperature --------------------------------------------------------
  // One number, climbing while the engine turns and faster the harder it is
  // worked. What it buys is the cold stall speed below, which slides back to
  // the engine's own as the number reaches 1 -- gradually, never as a step.
  if (state.running) {
    const revs = clamp(
      (state.rpm - params.idleRpm) / Math.max(1, params.maxRpm - params.idleRpm),
      0,
      1,
    )
    state.warmth = clamp(
      state.warmth + ((1 + REV_WARM_GAIN * revs) * dt) / params.warmupTime,
      0,
      1,
    )
  }
  // The speed the engine dies below, this step. Everything downstream reads
  // this and never `params.stallRpm`: a cold engine simply has a higher one.
  const stallRpm = params.stallRpm + params.coldStallBonus * (1 - state.warmth)

  const total = totalRatio(params, state.gear)
  const wheelSpeed = load.vx + state.wheelSlip
  const rpmTrans = transmissionRpm(params, total, wheelSpeed)

  // --- Clutch -------------------------------------------------------------
  // Worked out before the engine, because whether the idle governor is allowed
  // to run at all depends on where the clutch is this very step.
  const driverThrottle = clamp(inputs.throttle, 0, 1)
  if (manual) {
    const target = 1 - clamp(inputs.clutchPress, 0, 1)
    const rate = target < state.clutch ? params.clutchPressRate : params.clutchReleaseRate
    state.clutch += clamp(target - state.clutch, -rate * dt, rate * dt)
    state.engagement = state.running ? clutchEngagement(state.clutch) : 0
  } else {
    stepAutomaticClutch(state, params, stallRpm, rpmTrans, driverThrottle, dt)
    // Kept in step with the engagement so the readouts and the on-screen pedal
    // show the same thing whoever is working it.
    state.clutch = BITE_START + (BITE_END - BITE_START) * state.engagement
  }

  // --- Engine torque ------------------------------------------------------
  // Idle governor. Proportional alone would settle below its target, because
  // some throttle is needed just to hold idle against the engine's own drag;
  // the integral term is what removes that droop and parks it on idleRpm.
  //
  // It only runs while the engine is free to idle: clutch out of the way, or
  // no gear for it to be dragged by. In gear with the plates home it is
  // entirely off, and the rpm falls until the engine dies -- propping it up
  // there is exactly what would stop a car stalling when it should.
  //
  // The clutchless modes work their own pedal and have no stall to fall into,
  // so their idle control stays on: without it an automatic could not hold
  // idle against its own converter, and would never creep.
  const governorFree =
    !manual || state.gear === NEUTRAL_GEAR || state.engagement < ENGAGED_THRESHOLD
  const idleError =
    state.running && governorFree ? (params.idleRpm - state.rpm) / params.idleRpm : 0
  state.idleTrim = governorFree
    ? clamp(state.idleTrim + idleError * IDLE_GAIN_I * dt, 0, IDLE_MAX_THROTTLE)
    : 0
  const governor =
    state.running && governorFree
      ? clamp(state.idleTrim + idleError * IDLE_GAIN_P, 0, IDLE_MAX_THROTTLE)
      : 0
  const limiter = state.rpm >= params.maxRpm
  const cut = state.shiftCut > 0 && !manual
  // Only the driver's foot is lifted by the limiter and the shift cut. Idle
  // control runs regardless -- an engine does not sag towards stalling every
  // time the gearbox changes gear.
  const driverPart = state.running && !limiter && !cut ? driverThrottle : 0
  const throttle = state.running ? Math.max(driverPart, governor) : 0

  const engineTorque = state.running
    ? curveTorque(params.torqueCurve, state.rpm) * throttle -
      params.engineBraking * state.rpm * (1 - throttle)
    : 0

  const capacity = params.clutchMaxTorque * state.engagement
  const deltaRpm = state.rpm - rpmTrans

  // Equivalent mass of the rotating parts, measured at the tyre contact patch.
  // The gearbox input is multiplied by the ratio squared, which is why first
  // gear feels so much heavier to spin up than sixth.
  const radius = params.wheelRadius
  const geared = (total * total) / (radius * radius)
  const wheelMass = params.wheelInertia / (radius * radius) + params.drivelineInertia * geared
  const lockedMass = wheelMass + params.engineInertia * geared

  let clutchTorque = 0
  let driveForce = 0
  let wheelAcceleration = 0
  let carAcceleration = load.resistForce / load.mass
  let locked = false
  let saturatedClutch = false
  /** Rotational difference a locked clutch keeps under the torque it carries. */
  let clutchWind = 0

  if (total === 0 || capacity <= 0 || !state.running) {
    // Neutral, pedal on the floor or a dead engine: the wheels roll free and
    // only drag and rolling resistance slow the car down.
    state.rpm += ((engineTorque / params.engineInertia) * RPM_PER_RAD_S) * dt
  } else {
    // Try the solid coupling first: a clamped clutch whose two halves have
    // already converged turns as one shaft, and the engine speed then comes
    // straight off the wheels instead of being integrated on its own. Never
    // onto a wheel that is still spinning, though -- its speed is not the
    // road's, and the engine would be dragged down with it the moment the tyre
    // hooked up again.
    if (
      state.engagement >= LOCK_ENGAGEMENT &&
      Math.abs(state.wheelSlip) <= WHEELSPIN_SLIP &&
      (manual || rpmTrans >= params.idleRpm)
    ) {
      const inputForce = (engineTorque * total) / radius
      const together = (inputForce + load.resistForce) / (load.mass + lockedMass)
      let tyreForce = inputForce - lockedMass * together
      let accel = together
      if (Math.abs(tyreForce) > load.tractionLimit) {
        tyreForce = signum(tyreForce) * load.tractionLimit
        accel = (inputForce - tyreForce) / lockedMass
      }
      // Torque the clutch has to carry to hold the two halves together. Past
      // its capacity the plates give up and the slipping branch takes over.
      const held = engineTorque - params.engineInertia * ((accel * total) / radius)
      // A clutch under load still winds up by held/stiffness, so that is the
      // difference the slipping branch converges on -- not zero. Locking once
      // the difference has reached it, and keeping the same wind-up while
      // locked, means neither the rpm nor the torque jumps at the handover.
      const wind = held / params.clutchStiffness
      if (Math.abs(held) <= capacity && Math.abs(deltaRpm - wind) <= LOCK_DELTA_RPM) {
        locked = true
        clutchWind = wind
        clutchTorque = held
        driveForce = tyreForce
        wheelAcceleration = accel
        carAcceleration = (tyreForce + load.resistForce) / load.mass
      }
    }

    if (!locked) {
      // Slipping: the plates drag against each other in proportion to how fast
      // they are sliding, up to what the clamp force can hold.
      const demand = deltaRpm * params.clutchStiffness
      clutchTorque = clamp(demand, -capacity, capacity)
      saturatedClutch = Math.abs(demand) > capacity

      const inputForce = (clutchTorque * total) / radius
      const together = (inputForce + load.resistForce) / (load.mass + wheelMass)
      let tyreForce = inputForce - wheelMass * together
      let accel = together
      if (Math.abs(tyreForce) > load.tractionLimit) {
        // More force than the axle can hold: the road takes what it can and
        // the rest spins the wheels up, which is exactly what the rpm shows.
        tyreForce = signum(tyreForce) * load.tractionLimit
        accel = (inputForce - tyreForce) / wheelMass
      }
      driveForce = tyreForce
      wheelAcceleration = accel
      carAcceleration = (tyreForce + load.resistForce) / load.mass

      // The clutch torque falls as the two speeds converge. Folding that
      // response into the step keeps the coupling stable at 60 Hz instead of
      // letting engine and gearbox trade ever bigger overshoots.
      let engineStep =
        ((engineTorque - clutchTorque) / params.engineInertia) * RPM_PER_RAD_S * dt
      let slipStep = (wheelAcceleration - carAcceleration) * dt
      if (!saturatedClutch) {
        const stiffness = params.clutchStiffness * RPM_PER_RAD_S
        engineStep /= 1 + (dt * stiffness) / params.engineInertia
        const perSpeed =
          Math.abs(params.clutchStiffness * transmissionRpm(params, total, 1) * total) / radius
        slipStep /= 1 + (dt * perSpeed) / wheelMass
      }
      state.rpm += engineStep
      state.wheelSlip += slipStep
    }
  }

  // --- Wheel slip ---------------------------------------------------------
  // Once the axle has grip again the tyre pulls the wheel back into step with
  // the road, so the slip always decays towards nothing.
  const relax = 1 - Math.exp(-SLIP_RELAX_RATE * dt)
  state.wheelSlip = clamp(state.wheelSlip * (1 - relax), -MAX_WHEEL_SLIP, MAX_WHEEL_SLIP)
  if (total === 0 || !state.running) state.wheelSlip = 0
  state.wheelspin =
    Math.abs(state.wheelSlip) > WHEELSPIN_SLIP && Math.abs(driveForce) >= load.tractionLimit - 1

  if (locked) {
    // Engine speed is not integrated while locked: it is whatever the wheels
    // are turning, which is what keeps the two from drifting apart.
    const nextWheelSpeed = load.vx + state.wheelSlip + wheelAcceleration * dt
    state.rpm = transmissionRpm(params, total, nextWheelSpeed) + clutchWind
    state.wheelSlip = nextWheelSpeed - (load.vx + carAcceleration * dt)
  }
  state.locked = locked

  // --- Stalling -----------------------------------------------------------
  // The clutchless modes have no stall to fall into, so nothing may drag the
  // engine below the speed it can recover from on its own. Applied before the
  // test rather than after it, so those modes simply never reach the first
  // condition and the test below is free of any mode of its own.
  if (!manual && state.running) state.rpm = Math.max(state.rpm, stallRpm)

  // Four conditions, and nothing else: the engine is turning too slowly to
  // keep itself alive, it is still running, the plates are carrying, and there
  // is a gear for the car to drag it through.
  const stallBelowRpm = state.rpm < stallRpm
  const stallRunning = state.running
  const stallEngaged = state.engagement > ENGAGED_THRESHOLD
  const stallInGear = state.gear !== NEUTRAL_GEAR
  if (stallBelowRpm && stallRunning && stallEngaged && stallInGear) {
    state.running = false
    state.stalled = true
    state.rpm = 0
    state.idleTrim = 0
    clutchTorque = 0
    driveForce = 0
  }
  if (!state.running && state.starter <= 0) state.rpm = 0
  state.rpm = clamp(state.rpm, 0, params.maxRpm)

  stepAutomatic(state, params, load.vx)

  telemetry.rpm = state.rpm
  telemetry.gear = state.gear
  telemetry.mode = state.mode
  telemetry.clutch = state.clutch
  telemetry.engagement = state.engagement
  telemetry.deltaRpm = deltaRpm
  telemetry.engineTorque = engineTorque
  telemetry.clutchTorque = clutchTorque
  telemetry.driveForce = driveForce
  telemetry.tractionLimit = load.tractionLimit
  telemetry.wheelSlip = state.wheelSlip
  telemetry.wheelspin = state.wheelspin
  telemetry.locked = state.locked
  telemetry.running = state.running
  telemetry.stalled = state.stalled
  telemetry.warmth = state.warmth
  telemetry.stallRpm = stallRpm
  telemetry.stallBelowRpm = stallBelowRpm
  telemetry.stallRunning = stallRunning
  telemetry.stallEngaged = stallEngaged
  telemetry.stallInGear = stallInGear

  return driveForce
}
