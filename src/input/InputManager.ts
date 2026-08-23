/**
 * Keyboard + touch front-end for InputState.
 *
 * Everything DOM-flavoured about controls lives here. The simulation only ever
 * sees the normalised InputState returned by `sample()`.
 */
import { clamp } from '../core/math'
import { createInputState, type InputState } from './input'

/** Fraction of a touch zone's half-width that maps to full deflection. */
const TOUCH_FULL_DEFLECTION = 0.85

/** Side of the (top-right) square that toggles the debug overlay, in CSS px. */
const DEBUG_CORNER_MAX = 96
const DEBUG_CORNER_FRACTION = 0.18

type TouchZone = 'steer' | 'pedals'

interface TrackedTouch {
  zone: TouchZone
  steer: number
  throttle: number
  brake: number
}

export interface DebugCornerRect {
  x: number
  y: number
  size: number
}

/** Top-right square that toggles the overlay on devices with no keyboard. */
export function debugCornerRect(cssWidth: number, cssHeight: number): DebugCornerRect {
  const size = Math.min(DEBUG_CORNER_MAX, Math.min(cssWidth, cssHeight) * DEBUG_CORNER_FRACTION)
  return { x: cssWidth - size, y: 0, size }
}

export class InputManager {
  private readonly canvas: HTMLCanvasElement
  private readonly state: InputState = createInputState()
  private readonly keys = new Set<string>()
  private readonly touches = new Map<number, TrackedTouch>()
  private debugTogglePending = false

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
    window.addEventListener('blur', this.onBlur)
    this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false })
    this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false })
    this.canvas.addEventListener('touchend', this.onTouchEnd, { passive: false })
    this.canvas.addEventListener('touchcancel', this.onTouchEnd, { passive: false })
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
    window.removeEventListener('blur', this.onBlur)
    this.canvas.removeEventListener('touchstart', this.onTouchStart)
    this.canvas.removeEventListener('touchmove', this.onTouchMove)
    this.canvas.removeEventListener('touchend', this.onTouchEnd)
    this.canvas.removeEventListener('touchcancel', this.onTouchEnd)
  }

  /** Merges every source into the current control state. */
  sample(): Readonly<InputState> {
    const keyThrottle = this.anyKey('KeyW', 'ArrowUp') ? 1 : 0
    const keyBrake = this.anyKey('KeyS', 'ArrowDown') ? 1 : 0
    const keySteer =
      (this.anyKey('KeyD', 'ArrowRight') ? 1 : 0) - (this.anyKey('KeyA', 'ArrowLeft') ? 1 : 0)

    let touchThrottle = 0
    let touchBrake = 0
    let touchSteer = 0
    let steering = false
    for (const touch of this.touches.values()) {
      if (touch.zone === 'steer') {
        touchSteer = touch.steer
        steering = true
      } else {
        touchThrottle = Math.max(touchThrottle, touch.throttle)
        touchBrake = Math.max(touchBrake, touch.brake)
      }
    }

    this.state.throttle = Math.max(keyThrottle, touchThrottle)
    this.state.brake = Math.max(keyBrake, touchBrake)
    this.state.steer = steering ? touchSteer : keySteer
    this.state.handbrake = this.keys.has('Space')
    return this.state
  }

  /** True once per debug-toggle request (F3, backquote or a corner tap). */
  consumeDebugToggle(): boolean {
    const pending = this.debugTogglePending
    this.debugTogglePending = false
    return pending
  }

  private anyKey(...codes: readonly string[]): boolean {
    for (const code of codes) if (this.keys.has(code)) return true
    return false
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'F3' || event.code === 'Backquote') {
      if (!event.repeat) this.debugTogglePending = true
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

  /** Losing focus must not leave a key stuck down. */
  private readonly onBlur = (): void => {
    this.keys.clear()
    this.touches.clear()
  }

  private readonly onTouchStart = (event: TouchEvent): void => {
    event.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    for (const touch of Array.from(event.changedTouches)) {
      const x = touch.clientX - rect.left
      const y = touch.clientY - rect.top

      const corner = debugCornerRect(rect.width, rect.height)
      if (x >= corner.x && x <= corner.x + corner.size && y >= corner.y && y <= corner.y + corner.size) {
        this.debugTogglePending = true
        continue
      }

      // Placeholder scheme: bottom-left steers, bottom-right is the pedals.
      // The real touch controls land in a later stage.
      if (y < rect.height / 2) continue
      const zone: TouchZone = x < rect.width / 2 ? 'steer' : 'pedals'
      const tracked: TrackedTouch = { zone, steer: 0, throttle: 0, brake: 0 }
      this.updateTouch(tracked, x, y, rect.width, rect.height)
      this.touches.set(touch.identifier, tracked)
    }
  }

  private readonly onTouchMove = (event: TouchEvent): void => {
    event.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    for (const touch of Array.from(event.changedTouches)) {
      const tracked = this.touches.get(touch.identifier)
      if (tracked === undefined) continue
      this.updateTouch(tracked, touch.clientX - rect.left, touch.clientY - rect.top, rect.width, rect.height)
    }
  }

  private readonly onTouchEnd = (event: TouchEvent): void => {
    event.preventDefault()
    for (const touch of Array.from(event.changedTouches)) this.touches.delete(touch.identifier)
  }

  private updateTouch(
    tracked: TrackedTouch,
    x: number,
    y: number,
    cssWidth: number,
    cssHeight: number,
  ): void {
    if (tracked.zone === 'steer') {
      // Horizontal finger position across the bottom-left quadrant.
      const center = cssWidth / 4
      const span = (cssWidth / 4) * TOUCH_FULL_DEFLECTION
      tracked.steer = clamp((x - center) / span, -1, 1)
      return
    }
    // Vertical finger position across the bottom-right quadrant:
    // above its middle accelerates, below it brakes.
    const center = cssHeight * 0.75
    const span = (cssHeight / 4) * TOUCH_FULL_DEFLECTION
    const axis = clamp((center - y) / span, -1, 1)
    tracked.throttle = Math.max(0, axis)
    tracked.brake = Math.max(0, -axis)
  }
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
