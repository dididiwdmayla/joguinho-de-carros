/**
 * Keyboard and pointer front-end for InputState.
 *
 * Everything DOM-flavoured about controls lives here. The simulation only ever
 * sees the normalised InputState returned by `sample()` and the queue of
 * discrete actions returned by `drainCommands()`.
 *
 * Pointers (touch, mouse or pen) are tracked one by one, keyed by their
 * pointerId, so steering with one thumb while the other feathers the clutch
 * is just two independent pointers -- there is never an assumption that only
 * one finger is down. Once a pointer starts a control it is captured to the
 * canvas, so it keeps driving that control wherever it wanders on screen
 * until it is lifted or cancelled.
 */
import { clamp } from '../core/math'
import type { Viewport } from '../render/viewport'
import { moveShifter, releaseShifter } from '../ui/shifterGate'
import {
  columnAtX,
  computeTouchLayout,
  containsPoint,
  gateColumns,
  gateGeometry,
  type Rect,
  type TouchLayout,
} from '../ui/touchLayout'
import type { UiButton, UiState } from '../ui/uiState'
import { CLUTCH_ENGAGE_LIMIT, type PowertrainCommand } from '../vehicle/powertrain'
import { createInputState, type InputState } from './input'

/** Pedal reading at the shallow edge, so a light press still does something. */
const PEDAL_FLOOR = 0.1

/** How fast the clutch pedal comes back up once the finger leaves it [1/s]. */
const CLUTCH_RETURN_RATE = 2.5

type ControlId =
  | 'steering'
  | 'throttle'
  | 'brake'
  | 'clutch'
  | 'handbrake'
  | 'shifter'
  | 'volume'
  | UiButton

/** Buttons that act once when touched, rather than being held. */
const MOMENTARY: ReadonlySet<ControlId> = new Set<ControlId>([
  'controls',
  'fullscreen',
  'debug',
  'mute',
  'reverse',
  'neutral',
  'ignition',
  'mode',
  'sequentialUp',
  'sequentialDown',
])

interface ActivePointer {
  control: ControlId
  steer: number
  throttle: number
  brake: number
  clutch: number
}

export interface InputManagerOptions {
  canvas: HTMLCanvasElement
  viewport: Viewport
  ui: UiState
  /** Called from inside the gesture handler, where fullscreen is allowed. */
  onFullscreenRequest: () => void
  /**
   * Called synchronously on the first key or touch of every event, from inside
   * the handler. Opening and resuming an audio device is only allowed there.
   */
  onUserGesture: () => void
}

export class InputManager {
  private readonly canvas: HTMLCanvasElement
  private readonly viewport: Viewport
  private readonly ui: UiState
  private readonly onFullscreenRequest: () => void
  private readonly onUserGesture: () => void
  private readonly state: InputState = createInputState()
  private readonly keys = new Set<string>()
  private readonly pointers = new Map<number, ActivePointer>()
  private commands: PowertrainCommand[] = []
  /** Clutch pedal, kept here because it has to fall back on its own. */
  private clutchPedal = 0

  constructor(options: InputManagerOptions) {
    this.canvas = options.canvas
    this.viewport = options.viewport
    this.ui = options.ui
    this.onFullscreenRequest = options.onFullscreenRequest
    this.onUserGesture = options.onUserGesture
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    this.canvas.addEventListener('pointerdown', this.onPointerDown)
    this.canvas.addEventListener('pointermove', this.onPointerMove)
    this.canvas.addEventListener('pointerup', this.onPointerUp)
    this.canvas.addEventListener('pointercancel', this.onPointerUp)
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.canvas.removeEventListener('pointerdown', this.onPointerDown)
    this.canvas.removeEventListener('pointermove', this.onPointerMove)
    this.canvas.removeEventListener('pointerup', this.onPointerUp)
    this.canvas.removeEventListener('pointercancel', this.onPointerUp)
  }

  /**
   * Merges every source into the current control state. `dt` is the frame time,
   * which the clutch needs: released, it comes back up at its own rate rather
   * than snapping to the top.
   */
  sample(dt: number): Readonly<InputState> {
    const keyThrottle = this.anyKey('KeyW', 'ArrowUp') ? 1 : 0
    const keyBrake = this.anyKey('KeyS', 'ArrowDown') ? 1 : 0
    const keySteer =
      (this.anyKey('KeyD', 'ArrowRight') ? 1 : 0) - (this.anyKey('KeyA', 'ArrowLeft') ? 1 : 0)

    let pointerThrottle = 0
    let pointerBrake = 0
    let pointerSteer = 0
    let steering = false
    let pointerHandbrake = false
    let clutchHeld: number | null = null
    for (const pointer of this.pointers.values()) {
      switch (pointer.control) {
        case 'steering':
          pointerSteer = pointer.steer
          steering = true
          break
        case 'throttle':
          pointerThrottle = Math.max(pointerThrottle, pointer.throttle)
          break
        case 'brake':
          pointerBrake = Math.max(pointerBrake, pointer.brake)
          break
        case 'clutch':
          clutchHeld = Math.max(clutchHeld ?? 0, pointer.clutch)
          break
        case 'handbrake':
          pointerHandbrake = true
          break
        default:
          break
      }
    }

    // The key has no travel, so it means the floor; a finger means wherever it
    // is sitting. With neither, the pedal climbs back at a fixed rate.
    if (this.keys.has('KeyC')) this.clutchPedal = 1
    else if (clutchHeld !== null) this.clutchPedal = clutchHeld
    else this.clutchPedal = Math.max(0, this.clutchPedal - CLUTCH_RETURN_RATE * dt)

    this.ui.steeringActive = steering
    this.state.throttle = Math.max(keyThrottle, pointerThrottle)
    this.state.brake = Math.max(keyBrake, pointerBrake)
    this.state.steer = steering ? pointerSteer : keySteer
    this.state.handbrake = this.keys.has('Space') || pointerHandbrake
    this.state.clutchPress = this.clutchPedal
    return this.state
  }

  /**
   * Hands over the gear changes, starter presses and mode switches collected
   * since the last call, and forgets them. Called once per frame: a press must
   * act once, however many physics steps that frame turns out to run.
   */
  drainCommands(): readonly PowertrainCommand[] {
    if (this.commands.length === 0) return EMPTY_COMMANDS
    const drained = this.commands
    this.commands = []
    return drained
  }

  private anyKey(...codes: readonly string[]): boolean {
    for (const code of codes) if (this.keys.has(code)) return true
    return false
  }

  private layout(): TouchLayout {
    return computeTouchLayout(this.viewport)
  }

  // ---------------------------------------------------------------- keyboard

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat) this.onUserGesture()
    if (this.ui.instructionsVisible && !event.repeat) {
      this.ui.instructionsVisible = false
    }
    if (event.code === 'F3' || event.code === 'Backquote') {
      if (!event.repeat) this.ui.debugVisible = !this.ui.debugVisible
      event.preventDefault()
      return
    }
    if (event.code === 'KeyM') {
      if (!event.repeat) this.ui.muted = !this.ui.muted
      event.preventDefault()
      return
    }
    const command = COMMAND_KEYS[event.code]
    if (command !== undefined) {
      // Held keys must not repeat: one press is one gear.
      if (!event.repeat) this.commands.push(command)
      event.preventDefault()
      return
    }
    if (CONTROL_KEYS.has(event.code)) {
      this.keys.add(event.code)
      event.preventDefault()
    }
  }

  private readonly onKeyUp = (event: KeyboardEvent): void => {
    if (this.keys.delete(event.code)) event.preventDefault()
  }

  /** Losing focus must not leave a key or a finger stuck down. */
  private readonly onBlur = (): void => {
    this.keys.clear()
    this.pointers.clear()
    this.ui.pressedButtons.clear()
    this.ui.shifter.dragging = false
  }

  // ----------------------------------------------------------------- pointer
  // One event family for touch, mouse and pen alike. A pointer that starts a
  // control is captured to the canvas, so it keeps driving that control no
  // matter where it wanders on screen until it is lifted or cancelled.

  private readonly onPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    const control = this.beginPointer(
      event.pointerId,
      event.clientX - rect.left,
      event.clientY - rect.top,
    )
    if (control !== null) this.canvas.setPointerCapture(event.pointerId)
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    event.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    this.movePointer(event.pointerId, event.clientX - rect.left, event.clientY - rect.top)
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    this.endPointer(event.pointerId)
  }

  // --------------------------------------------------------------- pointers

  private beginPointer(id: number, x: number, y: number): ControlId | null {
    this.onUserGesture()
    // The first press anywhere only dismisses the instructions.
    if (this.ui.instructionsVisible) {
      this.ui.instructionsVisible = false
      return null
    }

    const control = this.hitTest(x, y)
    if (control === null) return null

    if (MOMENTARY.has(control)) {
      this.ui.pressedButtons.add(control as UiButton)
      this.pointers.set(id, { control, steer: 0, throttle: 0, brake: 0, clutch: 0 })
      this.activateButton(control as UiButton)
      return control
    }

    if (control === 'shifter') this.ui.shifter.dragging = true
    const pointer: ActivePointer = { control, steer: 0, throttle: 0, brake: 0, clutch: 0 }
    this.updatePointer(pointer, x, y)
    this.pointers.set(id, pointer)
    return control
  }

  private movePointer(id: number, x: number, y: number): void {
    const pointer = this.pointers.get(id)
    if (pointer === undefined) return
    this.updatePointer(pointer, x, y)
  }

  private endPointer(id: number): void {
    const pointer = this.pointers.get(id)
    if (pointer === undefined) return
    if (pointer.control === 'shifter') this.releaseShifter()
    this.ui.pressedButtons.delete(pointer.control as UiButton)
    this.pointers.delete(id)
  }

  private activateButton(button: UiButton): void {
    switch (button) {
      case 'controls':
        this.ui.controlsVisible = !this.ui.controlsVisible
        // Releasing the layer must not leave a pedal held down.
        this.pointers.clear()
        this.ui.pressedButtons.clear()
        this.ui.shifter.dragging = false
        break
      case 'debug':
        this.ui.debugVisible = !this.ui.debugVisible
        break
      case 'fullscreen':
        this.onFullscreenRequest()
        break
      case 'sequentialUp':
        this.commands.push({ kind: 'shiftUp' })
        break
      case 'sequentialDown':
        this.commands.push({ kind: 'shiftDown' })
        break
      case 'reverse':
        this.commands.push({ kind: 'selectGear', gear: -1 })
        break
      case 'neutral':
        this.commands.push({ kind: 'selectGear', gear: 0 })
        break
      case 'ignition':
        this.commands.push({ kind: 'start' })
        break
      case 'mode':
        this.commands.push({ kind: 'cycleMode' })
        break
      case 'mute':
        this.ui.muted = !this.ui.muted
        break
      default:
        break
    }
  }

  private hitTest(x: number, y: number): ControlId | null {
    const layout = this.layout()
    // Buttons that stay reachable even with the control layer hidden.
    if (containsPoint(layout.controlsButton, x, y)) return 'controls'
    if (containsPoint(layout.debugButton, x, y)) return 'debug'
    if (containsPoint(layout.muteButton, x, y)) return 'mute'
    if (!this.ui.controlsVisible) return null

    if (containsPoint(layout.fullscreenButton, x, y)) return 'fullscreen'
    if (containsPoint(layout.volume, x, y)) return 'volume'
    if (containsPoint(layout.handbrake, x, y)) return 'handbrake'
    if (containsPoint(layout.throttle, x, y)) return 'throttle'
    if (containsPoint(layout.brake, x, y)) return 'brake'
    if (containsPoint(layout.mode, x, y)) return 'mode'
    if (containsPoint(layout.ignition, x, y)) return 'ignition'

    // The middle of the screen belongs to whichever gearbox is fitted.
    switch (this.ui.mode) {
      case 'manual':
        if (containsPoint(layout.gate, x, y)) return 'shifter'
        break
      case 'sequential':
        if (containsPoint(layout.sequentialUp, x, y)) return 'sequentialUp'
        if (containsPoint(layout.sequentialDown, x, y)) return 'sequentialDown'
        break
      case 'automatic':
        if (containsPoint(layout.reverse, x, y)) return 'reverse'
        if (containsPoint(layout.neutral, x, y)) return 'neutral'
        break
    }

    // Before the steering bar: its grab area reaches up towards the clutch.
    if (containsPoint(layout.clutch, x, y)) return 'clutch'
    if (containsPoint(layout.steeringGrab, x, y)) return 'steering'
    return null
  }

  private updatePointer(pointer: ActivePointer, x: number, y: number): void {
    const layout = this.layout()
    switch (pointer.control) {
      case 'steering': {
        // Proportional to how far the finger sits from the bar's centre.
        const centre = layout.steering.x + layout.steering.width / 2
        pointer.steer = clamp((x - centre) / layout.steeringTravel, -1, 1)
        break
      }
      case 'throttle':
        pointer.throttle = pedalAmount(layout.throttle, y, 'up')
        break
      case 'brake':
        pointer.brake = pedalAmount(layout.brake, y, 'down')
        break
      case 'clutch':
        // Same travel as the other two pedals: top is floored, base is out,
        // and everything between is where the friction point is found.
        pointer.clutch = clamp(1 - (y - layout.clutch.y) / layout.clutch.height, 0, 1)
        break
      case 'volume':
        this.ui.volume = clamp((x - layout.volume.x) / layout.volume.width, 0, 1)
        break
      case 'shifter':
        this.updateShifter(layout, x, y)
        break
      default:
        break
    }
  }

  // ------------------------------------------------------------------- gate

  /** Turns the finger's position into gate coordinates and lets the rule move. */
  private updateShifter(layout: TouchLayout, x: number, y: number): void {
    const gate = gateGeometry(layout, this.ui.forwardGears)
    const gear = moveShifter(this.ui.shifter, {
      targetColumn: columnAtX(gate, x),
      targetLane: (y - gate.corridorY) / gate.laneReach,
      columns: gate.columns,
      forwardGears: this.ui.forwardGears,
      // Only the manual gate has a clutch to wait for.
      engageable: this.ui.mode !== 'manual' || this.ui.clutchPedal <= CLUTCH_ENGAGE_LIMIT,
      currentGear: this.ui.gear,
    })
    this.requestGear(gear)
  }

  private releaseShifter(): void {
    this.requestGear(releaseShifter(this.ui.shifter))
  }

  private requestGear(gear: number | null): void {
    if (gear === null || gear === this.ui.shifter.requested) return
    this.ui.shifter.requested = gear
    this.commands.push({ kind: 'selectGear', gear })
  }
}

/**
 * How hard a pedal is being pressed: shallow at the edge nearest the palm,
 * full at the far edge, and held for as long as the finger stays down.
 */
function pedalAmount(rect: Rect, y: number, direction: 'up' | 'down'): number {
  const travel = direction === 'up' ? rect.y + rect.height - y : y - rect.y
  const ratio = clamp(travel / rect.height, 0, 1)
  return PEDAL_FLOOR + (1 - PEDAL_FLOOR) * ratio
}

const EMPTY_COMMANDS: readonly PowertrainCommand[] = []

const CONTROL_KEYS: ReadonlySet<string> = new Set<string>([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Space',
  'KeyC',
])

/** Keys that fire once per press. R turns the key, T walks the modes. */
const COMMAND_KEYS: Readonly<Record<string, PowertrainCommand>> = {
  KeyE: { kind: 'shiftUp' },
  KeyQ: { kind: 'shiftDown' },
  KeyR: { kind: 'start' },
  KeyT: { kind: 'cycleMode' },
  KeyN: { kind: 'selectGear', gear: 0 },
  KeyX: { kind: 'selectGear', gear: -1 },
  Digit0: { kind: 'selectGear', gear: 0 },
  Digit1: { kind: 'selectGear', gear: 1 },
  Digit2: { kind: 'selectGear', gear: 2 },
  Digit3: { kind: 'selectGear', gear: 3 },
  Digit4: { kind: 'selectGear', gear: 4 },
  Digit5: { kind: 'selectGear', gear: 5 },
  Digit6: { kind: 'selectGear', gear: 6 },
}

/** Re-exported so callers can size the gate without importing the layout. */
export { gateColumns }
