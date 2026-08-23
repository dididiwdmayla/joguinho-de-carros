/**
 * Keyboard, touch and mouse front-end for InputState.
 *
 * Everything DOM-flavoured about controls lives here. The simulation only ever
 * sees the normalised InputState returned by `sample()`.
 *
 * Touches are tracked one by one, keyed by their identifier, so steering with
 * one thumb while the other holds the throttle is just two independent
 * pointers -- there is never an assumption that only one finger is down.
 */
import { clamp } from '../core/math'
import type { Viewport } from '../render/viewport'
import {
  computeTouchLayout,
  containsPoint,
  type Rect,
  type TouchLayout,
} from '../ui/touchLayout'
import type { UiButton, UiState } from '../ui/uiState'
import { createInputState, type InputState } from './input'

/** Pedal reading at the shallow edge, so a light press still does something. */
const PEDAL_FLOOR = 0.25

type ControlId = 'steering' | 'throttle' | 'brake' | 'handbrake' | UiButton

/** Identifier used for the mouse, which never collides with a touch id. */
const MOUSE_POINTER_ID = -1

interface ActivePointer {
  control: ControlId
  steer: number
  throttle: number
  brake: number
}

export interface InputManagerOptions {
  canvas: HTMLCanvasElement
  viewport: Viewport
  ui: UiState
  /** Called from inside the gesture handler, where fullscreen is allowed. */
  onFullscreenRequest: () => void
}

export class InputManager {
  private readonly canvas: HTMLCanvasElement
  private readonly viewport: Viewport
  private readonly ui: UiState
  private readonly onFullscreenRequest: () => void
  private readonly state: InputState = createInputState()
  private readonly keys = new Set<string>()
  private readonly pointers = new Map<number, ActivePointer>()

  constructor(options: InputManagerOptions) {
    this.canvas = options.canvas
    this.viewport = options.viewport
    this.ui = options.ui
    this.onFullscreenRequest = options.onFullscreenRequest
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false })
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false })
    this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: false })
    this.canvas.addEventListener('touchcancel', this.onTouchEnd, { passive: false })
    this.canvas.addEventListener('mousedown', this.onMouseDown)
    window.addEventListener('mousemove', this.onMouseMove)
    window.addEventListener('mouseup', this.onMouseUp)
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.canvas.removeEventListener('touchstart', this.onTouchStart)
    this.canvas.removeEventListener('touchmove', this.onTouchMove)
    this.canvas.removeEventListener('touchend', this.onTouchEnd)
    this.canvas.removeEventListener('touchcancel', this.onTouchEnd)
    this.canvas.removeEventListener('mousedown', this.onMouseDown)
    window.removeEventListener('mousemove', this.onMouseMove)
    window.removeEventListener('mouseup', this.onMouseUp)
  }

  /** Merges every source into the current control state. */
  sample(): Readonly<InputState> {
    const keyThrottle = this.anyKey('KeyW', 'ArrowUp') ? 1 : 0
    const keyBrake = this.anyKey('KeyS', 'ArrowDown') ? 1 : 0
    const keySteer =
      (this.anyKey('KeyD', 'ArrowRight') ? 1 : 0) - (this.anyKey('KeyA', 'ArrowLeft') ? 1 : 0)

    let pointerThrottle = 0
    let pointerBrake = 0
    let pointerSteer = 0
    let steering = false
    let pointerHandbrake = false
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
        case 'handbrake':
          pointerHandbrake = true
          break
        default:
          break
      }
    }

    this.ui.steeringActive = steering
    this.state.throttle = Math.max(keyThrottle, pointerThrottle)
    this.state.brake = Math.max(keyBrake, pointerBrake)
    this.state.steer = steering ? pointerSteer : keySteer
    this.state.handbrake = this.keys.has('Space') || pointerHandbrake
    return this.state
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
    if (this.ui.instructionsVisible && !event.repeat) {
      this.ui.instructionsVisible = false
    }
    if (event.code === 'F3' || event.code === 'Backquote') {
      if (!event.repeat) this.ui.debugVisible = !this.ui.debugVisible
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
    this.ui.pressedButton = null
  }

  // ------------------------------------------------------------------- touch

  private readonly onTouchStart = (event: TouchEvent): void => {
    event.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    for (const touch of Array.from(event.changedTouches)) {
      this.beginPointer(touch.identifier, touch.clientX - rect.left, touch.clientY - rect.top)
    }
  }

  private readonly onTouchMove = (event: TouchEvent): void => {
    event.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    for (const touch of Array.from(event.changedTouches)) {
      this.movePointer(touch.identifier, touch.clientX - rect.left, touch.clientY - rect.top)
    }
  }

  private readonly onTouchEnd = (event: TouchEvent): void => {
    event.preventDefault()
    for (const touch of Array.from(event.changedTouches)) this.endPointer(touch.identifier)
  }

  // ------------------------------------------------------------------- mouse
  // The same controls, so the on-screen buttons are usable with a cursor.

  private readonly onMouseDown = (event: MouseEvent): void => {
    const rect = this.canvas.getBoundingClientRect()
    this.beginPointer(MOUSE_POINTER_ID, event.clientX - rect.left, event.clientY - rect.top)
  }

  private readonly onMouseMove = (event: MouseEvent): void => {
    if (!this.pointers.has(MOUSE_POINTER_ID)) return
    const rect = this.canvas.getBoundingClientRect()
    this.movePointer(MOUSE_POINTER_ID, event.clientX - rect.left, event.clientY - rect.top)
  }

  private readonly onMouseUp = (): void => {
    this.endPointer(MOUSE_POINTER_ID)
  }

  // --------------------------------------------------------------- pointers

  private beginPointer(id: number, x: number, y: number): void {
    // The first press anywhere only dismisses the instructions.
    if (this.ui.instructionsVisible) {
      this.ui.instructionsVisible = false
      return
    }

    const control = this.hitTest(x, y)
    if (control === null) return

    if (control === 'controls' || control === 'fullscreen' || control === 'debug') {
      this.ui.pressedButton = control
      this.pointers.set(id, { control, steer: 0, throttle: 0, brake: 0 })
      this.activateButton(control)
      return
    }

    const pointer: ActivePointer = { control, steer: 0, throttle: 0, brake: 0 }
    this.updatePointer(pointer, x, y)
    this.pointers.set(id, pointer)
  }

  private movePointer(id: number, x: number, y: number): void {
    const pointer = this.pointers.get(id)
    if (pointer === undefined) return
    this.updatePointer(pointer, x, y)
  }

  private endPointer(id: number): void {
    const pointer = this.pointers.get(id)
    if (pointer === undefined) return
    if (this.ui.pressedButton === pointer.control) this.ui.pressedButton = null
    this.pointers.delete(id)
  }

  private activateButton(button: UiButton): void {
    switch (button) {
      case 'controls':
        this.ui.controlsVisible = !this.ui.controlsVisible
        // Releasing the layer must not leave a pedal held down.
        this.pointers.clear()
        this.ui.pressedButton = null
        break
      case 'debug':
        this.ui.debugVisible = !this.ui.debugVisible
        break
      case 'fullscreen':
        this.onFullscreenRequest()
        break
    }
  }

  private hitTest(x: number, y: number): ControlId | null {
    const layout = this.layout()
    // Buttons that stay reachable even with the control layer hidden.
    if (containsPoint(layout.controlsButton, x, y)) return 'controls'
    if (containsPoint(layout.debugButton, x, y)) return 'debug'
    if (!this.ui.controlsVisible) return null

    if (containsPoint(layout.fullscreenButton, x, y)) return 'fullscreen'
    if (containsPoint(layout.handbrake, x, y)) return 'handbrake'
    if (containsPoint(layout.throttle, x, y)) return 'throttle'
    if (containsPoint(layout.brake, x, y)) return 'brake'
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
      default:
        break
    }
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
])
