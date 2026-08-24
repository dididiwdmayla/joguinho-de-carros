/**
 * How a gear lever is allowed to move.
 *
 * A real gate is two slots at right angles, and the lever can only be in one
 * of them at a time. Out of the corridor the column is fixed and only the lane
 * moves; in the corridor only the column moves, until the finger pulls hard
 * enough towards a lane that has a gear in it. There is no diagonal.
 *
 * What there is no such thing as, either, is a detent in the middle. The two
 * channels of a column are one slot passing through the corridor, so first to
 * second is a single unbroken pull: out of the top, straight through, into the
 * bottom, without ever stopping. Neutral is not a place the lever passes
 * through on the way somewhere else -- it is where the lever is left. Which is
 * why nothing but a seated gear is ever asked for while the finger is down,
 * and letting go in the corridor is what selects neutral.
 *
 * Pure on purpose -- the rule is the interesting part, and it is worth being
 * able to test it without a canvas or a finger.
 */
import { NEUTRAL_GEAR } from '../vehicle/powertrain'
import { gearAt, neutralColumn, type ShifterPattern } from './shifterPattern'
import type { ShifterState } from './uiState'

/** How far into a lane the lever has to be before the gear goes in. */
export const SEAT_DEPTH = 0.8
/** How far a gate that is refusing lets the lever in before it stops. */
export const BLOCKED_DEPTH = 0.55
/** Lever displacement under which it counts as being in the corridor. */
export const CORRIDOR_EPSILON = 0.02
/**
 * Pull needed before a lever loose in the corridor turns into a lane. It is
 * there so that a finger sliding sideways across the plate is not caught by
 * every channel it passes over; a lever already in a column's slot is not
 * sliding across anything, so it does not apply to one.
 */
const LANE_ENTRY = 0.18
/** How close to a column the lever has to be to drop into its lane. */
const COLUMN_SNAP = 0.45

export interface ShifterMove {
  /** Where the finger is, in columns from the first one. */
  readonly targetColumn: number
  /** Where the finger is, -1 fully up, +1 fully down, 0 the corridor. */
  readonly targetLane: number
  /** Where the gears are: the same definition the gate is drawn from. */
  readonly pattern: ShifterPattern
  readonly forwardGears: number
  /** False while the clutch is out: the lever moves, but nothing goes in. */
  readonly engageable: boolean
  /** Gear the box is actually in, which the lever may always leave. */
  readonly currentGear: number
}

/**
 * Moves the lever under the gate's rules and returns the gear it is now asking
 * for -- null while it is somewhere that asks for nothing, which is anywhere
 * short of a fully seated gear.
 */
export function moveShifter(shifter: ShifterState, move: ShifterMove): number | null {
  const { targetColumn, targetLane, pattern, forwardGears } = move
  const columns = pattern.columns

  if (Math.abs(shifter.lane) > CORRIDOR_EPSILON) {
    // Out of the corridor: the column is held and only the lane may move. The
    // two channels of a column are one slot, so a finger carrying straight on
    // through the middle slides into the gear on the other side without
    // pausing there -- and is stopped at the corridor only when that side has
    // no channel to carry on into, which is the plate itself in the way.
    const column = Math.round(shifter.column)
    shifter.slotColumn = column
    const wanted = clampLane(targetLane)
    const crossing = wanted * shifter.lane < 0
    const walled = crossing && gearAt(pattern, column, Math.sign(wanted), forwardGears) === null
    shifter.lane = walled ? 0 : wanted
  } else {
    // In the corridor: slide between columns, and drop into a lane only when
    // the finger is both pulling and over a column that has a gear there.
    shifter.column = clampRange(targetColumn, 0, columns - 1)
    const column = Math.round(shifter.column)
    // Arriving over another column is what leaves the old slot behind. Until
    // then the lever is still in it, only passing its middle -- so there is no
    // pull to overcome before it may carry on, and the movement through the
    // corridor is one piece.
    if (shifter.slotColumn !== column) shifter.slotColumn = null
    const entry = shifter.slotColumn === column ? 0 : LANE_ENTRY
    const side = Math.abs(targetLane) > entry ? Math.sign(targetLane) : 0
    const reachable = side !== 0 && gearAt(pattern, column, side, forwardGears) !== null
    if (reachable && Math.abs(shifter.column - column) <= COLUMN_SNAP) {
      shifter.column = column
      shifter.lane = clampLane(targetLane)
    } else {
      shifter.lane = 0
    }
  }

  const column = Math.round(shifter.column)
  const side = Math.sign(shifter.lane)
  const here = gearAt(pattern, column, side, forwardGears)

  // A gate that will not take the gear still lets the lever move; it just will
  // not let it seat. Coming out of the gear already in is always allowed.
  const alreadyIn = here !== null && here === move.currentGear
  shifter.blocked = false
  if (!move.engageable && !alreadyIn && Math.abs(shifter.lane) > BLOCKED_DEPTH) {
    shifter.lane = side * BLOCKED_DEPTH
    shifter.blocked = true
  }

  // Nothing but a seated gear, ever: on the way past the corridor the box is
  // asked for nothing at all, so crossing it costs neither a stop nor an N.
  return Math.abs(shifter.lane) >= SEAT_DEPTH ? here : null
}

/**
 * Let go of the lever. Anywhere short of a seated gear it springs back to
 * where a real one rests -- the middle of the corridor, in the middle of the
 * plate -- and that, and only that, is what selects neutral.
 */
export function releaseShifter(
  shifter: ShifterState,
  pattern: ShifterPattern,
): number | null {
  shifter.dragging = false
  shifter.slotColumn = null
  if (Math.abs(shifter.lane) >= SEAT_DEPTH) return null
  shifter.column = neutralColumn(pattern)
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
