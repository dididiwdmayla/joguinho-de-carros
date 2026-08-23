/**
 * How a gear lever is allowed to move.
 *
 * A real gate is two slots at right angles, and the lever can only be in one
 * of them at a time. Out of the corridor the column is fixed and only the lane
 * moves, so the only way out of a gear is back the way it went in. In the
 * corridor only the column moves, until the finger pulls hard enough towards a
 * lane that has a gear in it. There is no diagonal, and there is no jumping
 * from one gear straight to another: first to second goes through the middle.
 *
 * Pure on purpose -- the rule is the interesting part, and it is worth being
 * able to test it without a canvas or a finger.
 */
import { NEUTRAL_GEAR } from '../vehicle/powertrain'
import { gateGear } from './touchLayout'
import type { ShifterState } from './uiState'

/** How far into a lane the lever has to be before the gear goes in. */
export const SEAT_DEPTH = 0.8
/** How far a gate that is refusing lets the lever in before it stops. */
export const BLOCKED_DEPTH = 0.55
/** Lever displacement under which it counts as being in the corridor. */
const CORRIDOR_EPSILON = 0.02
/** Pull needed before the lever leaves the corridor for a lane. */
const LANE_ENTRY = 0.18
/** How close to a column the lever has to be to drop into its lane. */
const COLUMN_SNAP = 0.45

export interface ShifterMove {
  /** Where the finger is, in columns from the first one. */
  readonly targetColumn: number
  /** Where the finger is, -1 fully up, +1 fully down, 0 the corridor. */
  readonly targetLane: number
  readonly columns: number
  readonly forwardGears: number
  /** False while the clutch is out: the lever moves, but nothing goes in. */
  readonly engageable: boolean
  /** Gear the box is actually in, which the lever may always leave. */
  readonly currentGear: number
}

/**
 * Moves the lever under the gate's rules and returns the gear it is now asking
 * for -- null when it is somewhere that asks for nothing.
 */
export function moveShifter(shifter: ShifterState, move: ShifterMove): number | null {
  const { targetColumn, targetLane, columns, forwardGears } = move

  if (Math.abs(shifter.lane) > CORRIDOR_EPSILON) {
    // Out of the corridor: the column is held and only the lane may move.
    const side = Math.sign(shifter.lane)
    if (targetLane * side <= 0) {
      // Back in the middle. The column it came out of is now shut: from here
      // the only movement is along the corridor, so a finger carrying straight
      // on through lands in neutral, not in the gear on the other side.
      shifter.lane = 0
      shifter.lockedColumn = Math.round(shifter.column)
    } else {
      shifter.lane = clampLane(targetLane)
    }
  } else {
    // In the corridor: slide between columns, and drop into a lane only when
    // the finger is both pulling and over a column that has a gear there.
    shifter.column = clampRange(targetColumn, 0, columns - 1)
    const column = Math.round(shifter.column)
    if (shifter.lockedColumn !== null && shifter.lockedColumn !== column) {
      // Arrived at another column: that is the horizontal move the gate was
      // waiting for, and the lever is free to go down again.
      shifter.lockedColumn = null
    }
    const side = Math.abs(targetLane) > LANE_ENTRY ? Math.sign(targetLane) : 0
    const reachable =
      side !== 0 && shifter.lockedColumn !== column && gateGear(column, side, forwardGears) !== null
    if (reachable && Math.abs(shifter.column - column) <= COLUMN_SNAP) {
      shifter.column = column
      shifter.lane = clampLane(targetLane)
    } else {
      shifter.lane = 0
    }
  }

  const column = Math.round(shifter.column)
  const side = Math.sign(shifter.lane)
  const here = gateGear(column, side, forwardGears)

  // A gate that will not take the gear still lets the lever move; it just will
  // not let it seat. Coming out of the gear already in is always allowed.
  const alreadyIn = here !== null && here === move.currentGear
  shifter.blocked = false
  if (!move.engageable && !alreadyIn && Math.abs(shifter.lane) > BLOCKED_DEPTH) {
    shifter.lane = side * BLOCKED_DEPTH
    shifter.blocked = true
  }

  return Math.abs(shifter.lane) >= SEAT_DEPTH ? here : NEUTRAL_GEAR
}

/**
 * Let go of the lever. Anywhere short of a seated gear it falls back into the
 * corridor, which means neutral.
 */
export function releaseShifter(shifter: ShifterState): number | null {
  shifter.dragging = false
  // Letting go is the other way to open the column again.
  shifter.lockedColumn = null
  if (Math.abs(shifter.lane) >= SEAT_DEPTH) return null
  shifter.lane = 0
  shifter.blocked = false
  return NEUTRAL_GEAR
}

function clampLane(value: number): number {
  return clampRange(value, -1, 1)
}

function clampRange(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value
}
