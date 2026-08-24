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
 *
 * Two things sit in front of the car and take the pointers for themselves:
 * the settings menu, and the control editor. Inside the editor a press on a
 * control moves it instead of working it, which is why the routing happens
 * before any hit testing against the driving controls.
 */
import { clamp, wrapAngle } from '../core/math'
import type { Viewport } from '../render/viewport'
import {
  CONTROL_SLOTS,
  DEFAULT_WHEEL_TURNS,
  emptyPlacements,
  LATCHABLE_SLOTS,
  MAX_CONTROL_SCALE,
  MIN_CONTROL_SCALE,
  nextWheelTurns,
  presetPlacements,
  PRESET_IDS,
  saveControlConfig,
  wheelMaxAngle,
  type ControlPlacement,
  type ControlSlot,
} from '../ui/controlLayout'
import {
  computeEditorLayout,
  computeMenuLayout,
  slotAtPoint,
  type EditorAction,
  type MenuAction,
} from '../ui/menuLayout'
import { moveShifter, releaseShifter } from '../ui/shifterGate'
import {
  columnAtX,
  computeTouchLayout,
  containsPoint,
  defaultSlotRects,
  gateGeometry,
  rectCenterX,
  rectCenterY,
  type Rect,
  type TouchLayout,
} from '../ui/touchLayout'
import { gateEngageable, type UiButton, type UiState } from '../ui/uiState'
import { saveVehicleSettings } from '../ui/vehicleSettings'
import { nextFuelId } from '../vehicle/fuel'
import { nextTransmissionMode, type PowertrainCommand } from '../vehicle/powertrain'
import { createInputState, type InputState } from './input'

/** Pedal reading at the shallow edge, so a light press still does something. */
const PEDAL_FLOOR = 0.1

/** How fast the clutch pedal comes back up once the finger leaves it [1/s]. */
const CLUTCH_RETURN_RATE = 2.5

/** Below this a latch would be holding nothing, so it is not taken. */
const LATCH_DEADZONE = 0.01

/** One step of the editor's size buttons. */
const SCALE_STEP = 0.1

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
  'menu',
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
  /** Accumulated wheel rotation [rad], only used by the wheel. */
  wheelAngle: number
  /** Angle of the finger about the wheel centre at the last move [rad]. */
  wheelGrabAngle: number
  /** True when lifting this finger should leave the control held down. */
  latching: boolean
}

/** A control being pushed around the screen inside the editor. */
interface EditDrag {
  readonly slot: ControlSlot
  readonly mode: 'move' | 'resize'
  readonly pointerId: number
  /** Pointer to control centre at the moment of the grab, in CSS pixels. */
  readonly grabDx: number
  readonly grabDy: number
  /** Centre the resize pivots about, and the reach and scale it started at. */
  readonly centerX: number
  readonly centerY: number
  readonly startDistance: number
  readonly startScale: number
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
  private editDrag: EditDrag | null = null

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

    // Latched controls are exactly as good as a finger that never lifts: the
    // reading below is the one the player left behind on the last press.
    const latched = this.ui.latched
    const latchedSteer = latched.get('steering')
    const latchedClutch = latched.get('clutch')

    // The key has no travel, so it means the floor; a finger means wherever it
    // is sitting; a latch means where the finger was left. With none of them,
    // the pedal climbs back at a fixed rate.
    if (this.keys.has('KeyC')) this.clutchPedal = 1
    else if (clutchHeld !== null) this.clutchPedal = clutchHeld
    else if (latchedClutch !== undefined) this.clutchPedal = latchedClutch
    else this.clutchPedal = Math.max(0, this.clutchPedal - CLUTCH_RETURN_RATE * dt)

    this.ui.steeringActive = steering
    this.state.throttle = Math.max(keyThrottle, pointerThrottle, latched.get('throttle') ?? 0)
    this.state.brake = Math.max(keyBrake, pointerBrake, latched.get('brake') ?? 0)
    // A hand on the control always outranks a latch, and so does a key: the
    // way out of a latched lock is to steer, not to hunt for the release.
    this.state.steer = steering
      ? pointerSteer
      : keySteer !== 0
        ? keySteer
        : (latchedSteer ?? 0)
    this.state.handbrake =
      this.keys.has('Space') || pointerHandbrake || latched.has('handbrake')
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
    return computeTouchLayout(this.viewport, this.ui.controls, this.ui.gatePattern)
  }

  /**
   * Centre to full lock, as the player has it set [rad]. Read every time
   * rather than held: changing it is meant to be felt on the next touch of
   * the wheel, not on the next reload.
   */
  private wheelAngle(): number {
    return wheelMaxAngle(this.ui.controls.wheelTurns)
  }

  // ---------------------------------------------------------------- keyboard

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (!event.repeat) this.onUserGesture()
    if (this.ui.instructionsVisible && !event.repeat) {
      this.ui.instructionsVisible = false
    }
    if (event.code === 'Escape') {
      if (!event.repeat && this.ui.menu !== 'none') this.closeMenu()
      return
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
    this.releaseEverything()
  }

  // ----------------------------------------------------------------- pointer
  // One event family for touch, mouse and pen alike. A pointer that starts a
  // control is captured to the canvas, so it keeps driving that control no
  // matter where it wanders on screen until it is lifted or cancelled.

  private readonly onPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    const captured = this.beginPointer(
      event.pointerId,
      event.clientX - rect.left,
      event.clientY - rect.top,
    )
    if (captured) this.canvas.setPointerCapture(event.pointerId)
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    event.preventDefault()
    const rect = this.canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    if (this.editDrag !== null && this.editDrag.pointerId === event.pointerId) {
      this.moveEdit(x, y)
      return
    }
    this.movePointer(event.pointerId, x, y)
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    if (this.editDrag !== null && this.editDrag.pointerId === event.pointerId) {
      this.editDrag = null
      return
    }
    this.endPointer(event.pointerId)
  }

  // --------------------------------------------------------------- pointers

  /** Returns true when the pointer should be captured to the canvas. */
  private beginPointer(id: number, x: number, y: number): boolean {
    this.onUserGesture()
    // The first press anywhere only dismisses the instructions.
    if (this.ui.instructionsVisible) {
      this.ui.instructionsVisible = false
      return false
    }

    if (this.ui.menu === 'main') {
      this.pressMenu(x, y)
      return false
    }
    if (this.ui.menu === 'edit') return this.pressEditor(id, x, y)

    const layout = this.layout()
    const control = this.hitTest(layout, x, y)
    if (control === null) return false

    if (MOMENTARY.has(control)) {
      this.ui.pressedButtons.add(control as UiButton)
      this.pointers.set(id, newPointer(control))
      this.activateButton(control as UiButton)
      return true
    }

    const pointer = newPointer(control)
    const slot = latchSlotOf(control)
    if (slot !== null && layout.latch[slot]) {
      if (this.ui.latched.has(slot)) {
        // Tapping a control that is holding itself down lets it go, and does
        // nothing else: the finger that releases must not also re-apply it.
        this.ui.latched.delete(slot)
        return true
      }
      pointer.latching = true
    }

    if (control === 'shifter') this.ui.shifter.dragging = true
    if (control === 'steering' && this.ui.controls.steeringStyle === 'wheel') {
      // Turning is relative to where the wheel already is, so putting a thumb
      // on it never snaps the steering to the angle of the thumb.
      pointer.wheelAngle = clamp(this.state.steer, -1, 1) * this.wheelAngle()
      pointer.wheelGrabAngle = wheelAngleAt(layout.steering, x, y)
      pointer.steer = clamp(this.state.steer, -1, 1)
    }
    this.updatePointer(pointer, layout, x, y)
    this.pointers.set(id, pointer)
    return true
  }

  private movePointer(id: number, x: number, y: number): void {
    const pointer = this.pointers.get(id)
    if (pointer === undefined) return
    this.updatePointer(pointer, this.layout(), x, y)
  }

  private endPointer(id: number): void {
    const pointer = this.pointers.get(id)
    if (pointer === undefined) return
    if (pointer.control === 'shifter') this.releaseShifter()
    if (pointer.latching) this.latchPointer(pointer)
    this.ui.pressedButtons.delete(pointer.control as UiButton)
    this.pointers.delete(id)
  }

  /** Leaves a control holding whatever the finger was holding when it lifted. */
  private latchPointer(pointer: ActivePointer): void {
    const slot = latchSlotOf(pointer.control)
    if (slot === null) return
    const value =
      slot === 'handbrake'
        ? 1
        : slot === 'steering'
          ? pointer.steer
          : slot === 'throttle'
            ? pointer.throttle
            : slot === 'brake'
              ? pointer.brake
              : pointer.clutch
    // A control let go of at rest has nothing to hold, and latching zero would
    // only mean a second press to clear something that was never there.
    if (Math.abs(value) > LATCH_DEADZONE) this.ui.latched.set(slot, value)
  }

  private releaseEverything(): void {
    this.pointers.clear()
    this.ui.pressedButtons.clear()
    this.ui.shifter.dragging = false
    this.editDrag = null
  }

  private activateButton(button: UiButton): void {
    switch (button) {
      case 'menu':
        this.ui.menu = 'main'
        this.releaseEverything()
        break
      case 'controls':
        this.ui.controlsVisible = !this.ui.controlsVisible
        // Releasing the layer must not leave a pedal held down -- latched or
        // otherwise. A control nobody can see must not still be driving.
        this.releaseEverything()
        this.ui.latched.clear()
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

  private hitTest(layout: TouchLayout, x: number, y: number): ControlId | null {
    // Buttons that stay reachable even with the control layer hidden.
    if (containsPoint(layout.menuButton, x, y)) return 'menu'
    if (containsPoint(layout.controlsButton, x, y)) return 'controls'
    if (containsPoint(layout.debugButton, x, y)) return 'debug'
    if (containsPoint(layout.muteButton, x, y)) return 'mute'
    if (!this.ui.controlsVisible) return null

    if (containsPoint(layout.fullscreenButton, x, y)) return 'fullscreen'

    if (containsPoint(layout.volume, x, y)) return 'volume'

    const { hidden } = layout
    if (!hidden.handbrake && containsPoint(layout.handbrake, x, y)) return 'handbrake'
    if (!hidden.throttle && containsPoint(layout.throttle, x, y)) return 'throttle'
    if (!hidden.brake && containsPoint(layout.brake, x, y)) return 'brake'
    if (!hidden.mode && containsPoint(layout.mode, x, y)) return 'mode'
    if (!hidden.ignition && containsPoint(layout.ignition, x, y)) return 'ignition'

    // The gearbox belongs to whichever transmission is fitted.
    if (!hidden.gearbox) {
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
    }

    if (!hidden.clutch && containsPoint(layout.clutch, x, y)) return 'clutch'
    if (hidden.steering) return null
    // The wheel is round and already generous; only the bar needs its grab
    // area widened out beyond the art.
    const steeringArea =
      this.ui.controls.steeringStyle === 'wheel' ? layout.steering : layout.steeringGrab
    if (containsPoint(steeringArea, x, y)) return 'steering'
    return null
  }

  private updatePointer(pointer: ActivePointer, layout: TouchLayout, x: number, y: number): void {
    switch (pointer.control) {
      case 'steering':
        if (this.ui.controls.steeringStyle === 'wheel') {
          // The finger drags the wheel round rather than to a position: only
          // the change in angle counts, so a hand can be re-seated mid-turn.
          const lock = this.wheelAngle()
          const angle = wheelAngleAt(layout.steering, x, y)
          pointer.wheelAngle = clamp(
            pointer.wheelAngle + wrapAngle(angle - pointer.wheelGrabAngle),
            -lock,
            lock,
          )
          pointer.wheelGrabAngle = angle
          pointer.steer = pointer.wheelAngle / lock
          break
        }
        // Proportional to how far the finger sits from the bar's centre.
        pointer.steer = clamp(
          (x - rectCenterX(layout.steering)) / layout.steeringTravel,
          -1,
          1,
        )
        break
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
    const gate = gateGeometry(layout, this.ui.gatePattern)
    const gear = moveShifter(this.ui.shifter, {
      targetColumn: columnAtX(gate, x),
      targetLane: (y - gate.corridorY) / gate.laneReach,
      pattern: this.ui.gatePattern,
      forwardGears: this.ui.forwardGears,
      engageable: gateEngageable(this.ui),
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

  // ------------------------------------------------------------------- menu

  private closeMenu(): void {
    this.ui.menu = 'none'
    this.ui.editing = null
    this.releaseEverything()
  }

  private pressMenu(x: number, y: number): void {
    const menu = computeMenuLayout(this.viewport, this.ui)
    for (const row of menu.rows) {
      if (containsPoint(row.rect, x, y)) {
        this.runMenuAction(row.action)
        return
      }
    }
    // A press outside the panel closes it, which is what every player tries.
    if (!containsPoint(menu.panel, x, y)) this.closeMenu()
  }

  private runMenuAction(action: MenuAction): void {
    switch (action) {
      case 'wheelTurns':
        this.ui.controls.wheelTurns = nextWheelTurns(this.ui.controls.wheelTurns)
        break
      case 'fuel':
        // Only the choice is made here. Reloading the engine's numbers is the
        // loop's job, which notices the id has changed on the next frame.
        this.ui.vehicle.fuel = nextFuelId(this.ui.fuels, this.ui.vehicle.fuel)
        break
      case 'transmission':
        // Through the same queue as the mode button and the T key: there is
        // one way to change gearbox, whoever asked for it.
        this.commands.push({ kind: 'setMode', mode: nextTransmissionMode(this.ui.mode) })
        break
      case 'edit':
        // Nothing can be laid out that cannot be seen.
        this.ui.controlsVisible = true
        this.ui.menu = 'edit'
        this.ui.editing = null
        this.releaseEverything()
        break
      case 'steeringStyle':
        this.ui.controls.steeringStyle =
          this.ui.controls.steeringStyle === 'bar' ? 'wheel' : 'bar'
        // The two are not the same shape, so a latch taken on one of them
        // means nothing on the other.
        this.ui.latched.delete('steering')
        break
      case 'preset':
        this.cyclePreset()
        break
      case 'reset':
        this.resetLayout()
        break
      case 'close':
        this.closeMenu()
        break
    }
    // Written on every action rather than on the ones that changed something:
    // the menu is the only place these are edited, and a phone closed from it
    // has to open where it was left.
    saveControlConfig(this.ui.controls)
    saveVehicleSettings(this.ui.vehicle)
  }

  // ----------------------------------------------------------------- editor

  private pressEditor(id: number, x: number, y: number): boolean {
    const layout = this.layout()
    const editor = computeEditorLayout(this.viewport, layout, this.ui)

    // The bar is chrome: it swallows presses whether or not one lands on a
    // button, so a control underneath it is never grabbed by accident.
    if (containsPoint(editor.bar, x, y)) {
      for (const button of editor.buttons) {
        if (containsPoint(button.rect, x, y)) {
          this.runEditorAction(button.action)
          return false
        }
      }
      return false
    }

    const selected = this.ui.editing
    if (selected !== null && editor.handle !== null && containsPoint(editor.handle, x, y)) {
      const rect = layout.slots[selected]
      const centerX = rectCenterX(rect)
      const centerY = rectCenterY(rect)
      this.editDrag = {
        slot: selected,
        mode: 'resize',
        pointerId: id,
        grabDx: 0,
        grabDy: 0,
        centerX,
        centerY,
        startDistance: Math.max(1, Math.hypot(x - centerX, y - centerY)),
        startScale: this.placementOf(selected).scale,
      }
      return true
    }

    const slot = slotAtPoint(layout, CONTROL_SLOTS, x, y)
    if (slot === null) {
      this.ui.editing = null
      return false
    }
    this.ui.editing = slot
    const rect = layout.slots[slot]
    this.editDrag = {
      slot,
      mode: 'move',
      pointerId: id,
      grabDx: rectCenterX(rect) - x,
      grabDy: rectCenterY(rect) - y,
      centerX: rectCenterX(rect),
      centerY: rectCenterY(rect),
      startDistance: 1,
      startScale: 1,
    }
    return true
  }

  private moveEdit(x: number, y: number): void {
    const drag = this.editDrag
    if (drag === null) return
    const placement = this.placementOf(drag.slot)
    if (drag.mode === 'move') {
      placement.x = clamp((x + drag.grabDx) / this.viewport.cssWidth, 0, 1)
      placement.y = clamp((y + drag.grabDy) / this.viewport.cssHeight, 0, 1)
    } else {
      // Reach from the centre the grab started at, so the control grows and
      // shrinks under the finger instead of chasing its own moving corner.
      const distance = Math.hypot(x - drag.centerX, y - drag.centerY)
      placement.scale = clamp(
        (drag.startScale * distance) / drag.startDistance,
        MIN_CONTROL_SCALE,
        MAX_CONTROL_SCALE,
      )
    }
    saveControlConfig(this.ui.controls)
  }

  private runEditorAction(action: EditorAction): void {
    const slot = this.ui.editing
    switch (action) {
      case 'done':
        this.closeMenu()
        break
      case 'reset':
        this.resetLayout()
        break
      case 'preset':
        this.cyclePreset()
        break
      case 'hide':
        if (slot !== null) {
          const placement = this.placementOf(slot)
          placement.hidden = !placement.hidden
          if (placement.hidden) this.ui.latched.delete(slot)
        }
        break
      case 'latch':
        if (slot !== null && LATCHABLE_SLOTS.has(slot)) {
          const placement = this.placementOf(slot)
          placement.latch = !placement.latch
          if (!placement.latch) this.ui.latched.delete(slot)
        }
        break
      case 'smaller':
      case 'bigger':
        if (slot !== null) {
          const placement = this.placementOf(slot)
          placement.scale = clamp(
            placement.scale + (action === 'bigger' ? SCALE_STEP : -SCALE_STEP),
            MIN_CONTROL_SCALE,
            MAX_CONTROL_SCALE,
          )
        }
        break
    }
    saveControlConfig(this.ui.controls)
  }

  /**
   * The slot's own placement, created from wherever it currently sits if the
   * player has never moved it. Starting from the live rect rather than from
   * the built-in one is what stops the first drag from jumping.
   */
  private placementOf(slot: ControlSlot): ControlPlacement {
    const existing = this.ui.controls.placements[slot]
    if (existing !== null) return existing
    const rect = this.layout().slots[slot]
    const created: ControlPlacement = {
      x: rectCenterX(rect) / this.viewport.cssWidth,
      y: rectCenterY(rect) / this.viewport.cssHeight,
      scale: 1,
      hidden: false,
      latch: false,
    }
    this.ui.controls.placements[slot] = created
    return created
  }

  private cyclePreset(): void {
    const current = PRESET_IDS.indexOf(this.ui.controls.preset)
    const next = PRESET_IDS[(current + 1) % PRESET_IDS.length]
    // Measured against the layout the game would have used anyway, so a
    // preset lands the same way on any screen it is picked on.
    const base = defaultSlotRects(this.viewport, this.ui.controls, this.ui.gatePattern)
    const centers = {} as Record<ControlSlot, { x: number; y: number }>
    for (const slot of CONTROL_SLOTS) {
      centers[slot] = {
        x: rectCenterX(base[slot]) / this.viewport.cssWidth,
        y: rectCenterY(base[slot]) / this.viewport.cssHeight,
      }
    }
    this.ui.controls.preset = next
    this.ui.controls.placements = presetPlacements(next, centers)
    this.ui.latched.clear()
  }

  private resetLayout(): void {
    this.ui.controls.preset = 'padrao'
    this.ui.controls.steeringStyle = 'bar'
    // Controls only: it sits under CONTROLE, and must not quietly hand the
    // player back a fuel or a gearbox they did not ask to be rid of.
    this.ui.controls.wheelTurns = DEFAULT_WHEEL_TURNS
    this.ui.controls.placements = emptyPlacements()
    this.ui.latched.clear()
    this.ui.editing = null
  }
}

function newPointer(control: ControlId): ActivePointer {
  return {
    control,
    steer: 0,
    throttle: 0,
    brake: 0,
    clutch: 0,
    wheelAngle: 0,
    wheelGrabAngle: 0,
    latching: false,
  }
}

/** The slot a control belongs to, when that slot is one that can latch. */
function latchSlotOf(control: ControlId): ControlSlot | null {
  return (LATCHABLE_SLOTS as ReadonlySet<string>).has(control)
    ? (control as ControlSlot)
    : null
}

/** Angle of a point about the centre of the wheel [rad]. */
function wheelAngleAt(wheel: Rect, x: number, y: number): number {
  return Math.atan2(y - rectCenterY(wheel), x - rectCenterX(wheel))
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
