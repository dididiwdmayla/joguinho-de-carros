/**
 * Is the car parked?
 *
 * Five things have to be true at the same moment, and then they have to stay
 * true. The list is deliberately strict about the two that a player can fake:
 * the wheels have to be inside the bay, not just the middle of the car, and
 * the whole thing has to hold for a beat -- otherwise a car sliding through
 * the right place at the right angle would be told it had parked, which is the
 * opposite of what this game is about.
 *
 * Every tolerance is read from the level file. Nothing here decides how hard a
 * bay is; it only decides what parking means.
 */
import { wrapAngle } from '../core/math'
import { obbContains, type Obb } from '../collision/obb'
import type { CarParams } from '../vehicle/carParams'
import type { VehicleState } from '../vehicle/vehicleState'
import { NEUTRAL_GEAR, type PowertrainState } from '../vehicle/powertrain'
import type { LevelParams } from './levelSchema'

/** The five conditions, reported one by one so it is clear which one fails. */
export interface ParkingCheck {
  /** Centre of the car inside the bay, and within the centre tolerance. */
  centred: boolean
  /** All four wheels inside the painted rectangle. */
  wheelsInside: boolean
  /** Heading within tolerance of the bay's axis, either way round. */
  aligned: boolean
  /** Standing still. */
  stopped: boolean
  /** Neutral, park, or the handbrake pulled. */
  secured: boolean
  /** All five at once. */
  readonly satisfied: boolean
  /** Distance from the car's centre to the bay's [m]. */
  distance: number
  /** How far off the bay's axis the car is [rad], always positive. */
  angleError: number
}

export function createParkingCheck(): ParkingCheck {
  return {
    centred: false,
    wheelsInside: false,
    aligned: false,
    stopped: false,
    secured: false,
    get satisfied(): boolean {
      return this.centred && this.wheelsInside && this.aligned && this.stopped && this.secured
    },
    distance: Infinity,
    angleError: Math.PI,
  }
}

/** Where the car is on top of the check: how long it has held, and whether. */
export interface ParkingState {
  readonly check: ParkingCheck
  /** Seconds the five conditions have held without a break. */
  held: number
  /** 0..1 of the hold the level asks for. */
  progress: number
  /** True once the hold is complete. Latches: the run is over at that point. */
  done: boolean
}

export function createParkingState(): ParkingState {
  return { check: createParkingCheck(), held: 0, progress: 0, done: false }
}

export function resetParkingState(state: ParkingState): void {
  state.held = 0
  state.progress = 0
  state.done = false
}

/** The four contact patches in world metres, filled into `out` as x,y pairs. */
export function wheelPositions(state: VehicleState, car: CarParams, out: number[]): void {
  const cos = Math.cos(state.yaw)
  const sin = Math.sin(state.yaw)
  const halfTrack = car.trackWidth / 2
  const offsets = [
    [car.cgToFront, -halfTrack],
    [car.cgToFront, halfTrack],
    [-car.cgToRear, -halfTrack],
    [-car.cgToRear, halfTrack],
  ]
  for (let i = 0; i < offsets.length; i++) {
    const [along, across] = offsets[i]
    out[i * 2] = state.x + cos * along - sin * across
    out[i * 2 + 1] = state.y + sin * along + cos * across
  }
}

/** Reused by the check so a frame of parking costs no allocation. */
const wheels = [0, 0, 0, 0, 0, 0, 0, 0]

/**
 * The angle between the car and the bay, ignoring which way round it is: a car
 * reversed into a bay is parked in it just as much as one driven in nose
 * first, and no real car park cares which.
 */
export function axisAngleError(yaw: number, slotAngle: number): number {
  const difference = Math.abs(wrapAngle(yaw - slotAngle))
  return difference > Math.PI / 2 ? Math.PI - difference : difference
}

/** Runs the five tests. Writes into `check` and returns it. */
export function checkParking(
  check: ParkingCheck,
  state: VehicleState,
  car: CarParams,
  powertrain: PowertrainState,
  handbrake: boolean,
  target: Obb,
  params: LevelParams,
): ParkingCheck {
  check.distance = Math.hypot(state.x - target.x, state.y - target.y)
  check.angleError = axisAngleError(state.yaw, target.angle)

  check.centred = check.distance <= params.centerTolerance && obbContains(target, state.x, state.y)

  wheelPositions(state, car, wheels)
  let inside = true
  for (let i = 0; i < 4 && inside; i++) {
    inside = obbContains(target, wheels[i * 2], wheels[i * 2 + 1])
  }
  check.wheelsInside = inside

  check.aligned = check.angleError <= params.angleTolerance
  check.stopped = Math.hypot(state.vx, state.vy) <= params.stopSpeed
  // Anything that means the car has been left rather than merely paused. The
  // pawl and neutral come from the gearbox; the handbrake is the driver's.
  check.secured = powertrain.park || powertrain.gear === NEUTRAL_GEAR || handbrake
  return check
}

/**
 * Advances the hold. The timer only ever runs while every condition is true
 * and is thrown away the instant one is not -- a hold that carried over would
 * let a player collect the last tenth of a second on a second pass.
 */
export function stepParking(state: ParkingState, params: LevelParams, dt: number): void {
  if (state.done) return
  if (!state.check.satisfied) {
    state.held = 0
    state.progress = 0
    return
  }
  state.held += dt
  state.progress = Math.min(1, state.held / params.holdTime)
  if (state.held >= params.holdTime) state.done = true
}
