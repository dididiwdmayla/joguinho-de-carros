/** Screen-layer state: what is on show and what is being pressed right now. */
import { DEFAULT_VOLUME } from '../audio/engineAudio'
import { smoothingFactor } from '../core/math'
import type { FuelCatalog } from '../vehicle/fuel'
import { CLUTCH_ENGAGE_LIMIT, NEUTRAL_GEAR, type TransmissionMode } from '../vehicle/powertrain'
import { OPACITY_SLOTS, type ControlConfig, type ControlSlot, type OpacitySlot } from './controlLayout'
import { gearSeat, neutralColumn, type ShifterPattern } from './shifterPattern'
import type { VehicleSettings } from './vehicleSettings'

export type UiButton =
  | 'menu'
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
 * Which screen is in front of the game, if any. The editor is a screen rather
 * than a flag because everything changes inside it: the controls stop driving
 * the car and start being furniture to be pushed around.
 */
export type MenuScreen = 'none' | 'main' | 'edit'

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
   * Column whose slot the lever is travelling in, or null while it is loose in
   * the corridor. A lever that has come out of a gear is still in that
   * column's slot even at the exact moment it passes the middle, which is what
   * lets a pull straight through carry on into the gear on the other side
   * instead of being caught by the corridor on the way past.
   */
  slotColumn: number | null
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

  /**
   * Which drawn controls have a live pointer on them right now. Mutated in
   * place by the input layer every frame, never a latch: a control left
   * holding itself down is not a finger the player can see on it.
   */
  readonly activeControls: Set<OpacitySlot>
  /**
   * Opacity actually drawn for each control this frame: eased every frame
   * towards 1 while it is active, or towards the configured value otherwise,
   * so a finger lifting off a control fades rather than snaps.
   */
  readonly controlOpacity: Record<OpacitySlot, number>

  /** Settings, or the control editor, or neither. */
  menu: MenuScreen
  /**
   * The player's own control layout. Mutated in place by the editor and
   * written to localStorage on every change, so a phone that is closed
   * mid-session still opens where it left off.
   */
  readonly controls: ControlConfig
  /**
   * What the player has done to the car itself. Mutated by the menu and read
   * by the loop, which reloads the engine's numbers when the fuel changes.
   */
  readonly vehicle: VehicleSettings
  /**
   * Every fuel there is. It lives here because the menu is what picks from
   * it -- the game only ever wants the one entry the player has chosen.
   */
  readonly fuels: FuelCatalog
  /** Control being edited, null while nothing is selected. */
  editing: ControlSlot | null
  /**
   * Controls left holding themselves down, and at what value. This is what
   * buys the third finger: a clutch latched on the floor stays there while
   * both thumbs go and find a gear.
   */
  readonly latched: Map<ControlSlot, number>

  // Mirrored from the powertrain once per frame, so the input layer can lay
  // out the gearbox and refuse a gear without reaching into the simulation.
  mode: TransmissionMode
  gear: number
  /** Clutch pedal position, 1 released .. 0 on the floor. */
  clutchPedal: number
}

export interface UiStateOptions {
  /** Whether the touch layer starts on. */
  readonly controlsVisible: boolean
  /** How many forward gears the gate has to lay out. */
  readonly forwardGears: number
  /** Where every gear sits in the gate: the rule and the drawing both read it. */
  readonly gatePattern: ShifterPattern
  readonly controls: ControlConfig
  readonly vehicle: VehicleSettings
  readonly fuels: FuelCatalog
}

export function createUiState(options: UiStateOptions): UiState {
  const { controls, forwardGears, gatePattern, vehicle } = options
  return {
    controlsVisible: options.controlsVisible,
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
      column: neutralColumn(gatePattern),
      lane: 0,
      dragging: false,
      blocked: false,
      slotColumn: null,
      requested: NEUTRAL_GEAR,
    },
    gatePattern,
    forwardGears,
    activeControls: new Set<OpacitySlot>(),
    controlOpacity: initialControlOpacity(controls.controlsOpacity),
    menu: 'none',
    controls,
    vehicle,
    fuels: options.fuels,
    editing: null,
    latched: new Map<ControlSlot, number>(),
    mode: vehicle.transmission,
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
  ui.shifter.slotColumn = null
}

/**
 * Whether the gate would take a gear right now. Only the manual box has a
 * clutch to wait for; the others are always ready. Both the input layer and
 * the drawing ask this, so the condition exists once.
 */
export function gateEngageable(ui: Readonly<UiState>): boolean {
  return ui.mode !== 'manual' || ui.clutchPedal <= CLUTCH_ENGAGE_LIMIT
}

function initialControlOpacity(configured: number): Record<OpacitySlot, number> {
  const opacity = {} as Record<OpacitySlot, number>
  for (const slot of OPACITY_SLOTS) opacity[slot] = configured
  return opacity
}

/**
 * How fast a control's drawn opacity chases its target [1/s]. High enough
 * that a touch reads as instant and a release fades in well under a quarter
 * second, never so high that it is indistinguishable from a snap.
 */
const OPACITY_CHASE_RATE = 18
/** Once this close, snap rather than keep nudging a value nobody can see move. */
const OPACITY_SETTLED = 0.002

/**
 * Eases every control's drawn opacity towards where it belongs this frame: 1
 * while a finger is on it, the configured level otherwise. Called once a
 * frame with real elapsed time, so the fade back after letting go takes the
 * same instant regardless of the display's refresh rate.
 */
export function updateControlOpacity(ui: UiState, dt: number): void {
  const configured = ui.controls.controlsOpacity
  const rate = smoothingFactor(OPACITY_CHASE_RATE, dt)
  for (const slot of OPACITY_SLOTS) {
    const target = ui.activeControls.has(slot) ? 1 : configured
    const current = ui.controlOpacity[slot]
    ui.controlOpacity[slot] = Math.abs(target - current) <= OPACITY_SETTLED
      ? target
      : current + (target - current) * rate
  }
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
