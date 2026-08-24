/** Screen-layer state: what is on show and what is being pressed right now. */
import { DEFAULT_VOLUME } from '../audio/engineAudio'
import {
  CLUTCH_ENGAGE_LIMIT,
  NEUTRAL_GEAR,
  type TransmissionMode,
} from '../vehicle/powertrain'
import { gearSeat, type ShifterPattern } from './shifterPattern'

export type UiButton =
  | 'controls'
  | 'fullscreen'
  | 'debug'
  | 'reverse'
  | 'neutral'
  | 'ignition'
  | 'mode'
  | 'mute'
  | 'sequentialUp'
  | 'sequentialDown'

/**
 * The gear lever, as a position in the gate rather than a gear.
 *
 * It is the lever that is dragged and the gear that follows, never the other
 * way round -- which is the whole reason a lever can sit in the corridor, or
 * be pushed against a gate it is not allowed through.
 */
export interface ShifterState {
  /** Continuous column, 0 .. columns - 1. */
  column: number
  /** -1 fully into the upper lane, 0 the corridor, +1 the lower lane. */
  lane: number
  /** True while a finger or the cursor owns it. */
  dragging: boolean
  /** True while the gate is refusing the gear because the clutch is out. */
  blocked: boolean
  /**
   * Column the lever came out of during this drag, if any. In the corridor the
   * only movement is horizontal, so a lever that has just left a gear cannot
   * drop straight back into the other lane of the same column: it has to
   * arrive somewhere else first, or be let go of.
   */
  lockedColumn: number | null
  /** Gear the lever last asked for, so a request is sent once. */
  requested: number
}

export interface UiState {
  /** Touch control layer. Hidden by default when there is no touch screen. */
  controlsVisible: boolean
  /** First-run instructions, dismissed by the first key or touch. */
  instructionsVisible: boolean
  debugVisible: boolean
  /** Sound switch. The audio layer reads it; nothing else does. */
  muted: boolean
  /** Master volume, 0..1. */
  volume: number
  fullscreenActive: boolean
  /** True once the orientation could actually be locked to landscape. */
  orientationLocked: boolean
  /** Asks the player to rotate when the lock is unavailable and we are upright. */
  rotateHintVisible: boolean
  /**
   * Buttons held down right now. A set rather than one slot, because the
   * gearbox controls are meant to be used with a thumb already on a pedal.
   */
  readonly pressedButtons: Set<UiButton>
  /** True while a finger owns the steering control. */
  steeringActive: boolean

  readonly shifter: ShifterState
  /** Where every gear sits in the gate: the rule and the drawing both read it. */
  readonly gatePattern: ShifterPattern
  /** How many forward gears the gate has to lay out. */
  forwardGears: number

  // Mirrored from the powertrain once per frame, so the input layer can lay
  // out the gearbox and refuse a gear without reaching into the simulation.
  mode: TransmissionMode
  gear: number
  /** Clutch pedal position, 1 released .. 0 on the floor. */
  clutchPedal: number
}

export function createUiState(
  controlsVisible: boolean,
  mode: TransmissionMode,
  forwardGears: number,
  gatePattern: ShifterPattern,
): UiState {
  return {
    controlsVisible,
    instructionsVisible: true,
    debugVisible: false,
    muted: false,
    volume: DEFAULT_VOLUME,
    fullscreenActive: false,
    orientationLocked: false,
    rotateHintVisible: false,
    pressedButtons: new Set<UiButton>(),
    steeringActive: false,
    shifter: {
      column: 0,
      lane: 0,
      dragging: false,
      blocked: false,
      lockedColumn: null,
      requested: NEUTRAL_GEAR,
    },
    gatePattern,
    forwardGears,
    mode,
    gear: NEUTRAL_GEAR,
    clutchPedal: 1,
  }
}

/**
 * Puts the lever where the gearbox actually is. Called whenever nobody is
 * dragging it, so a gear picked with the number keys moves the lever too.
 */
export function syncShifterToGear(ui: UiState): void {
  if (ui.shifter.dragging) return
  const seat = gearSeat(ui.gatePattern, ui.gear)
  ui.shifter.column = seat.column
  ui.shifter.lane = seat.lane
  ui.shifter.requested = ui.gear
  ui.shifter.blocked = false
  ui.shifter.lockedColumn = null
}

/**
 * Whether the gate would take a gear right now. Only the manual box has a
 * clutch to wait for; the others are always ready. Both the input layer and
 * the drawing ask this, so the condition exists once.
 */
export function gateEngageable(ui: Readonly<UiState>): boolean {
  return ui.mode !== 'manual' || ui.clutchPedal <= CLUTCH_ENGAGE_LIMIT
}

/**
 * Whether this machine is likely to be driven by fingers. Used only to pick the
 * initial visibility of the touch layer -- no code path depends on it, so a
 * wrong answer costs a button press, never a broken start.
 */
export function prefersTouchControls(): boolean {
  try {
    // The primary pointer, not merely the presence of a touch screen: a laptop
    // with a touch display is still driven with the keyboard.
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(pointer: coarse)').matches
    }
    return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
  } catch {
    return false
  }
}
