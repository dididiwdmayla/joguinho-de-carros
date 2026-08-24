/**
 * Geometry of the on-screen controls, in CSS pixels.
 *
 * One module owns it so hit testing and drawing can never disagree: the input
 * layer asks where the controls are, the ui layer draws them in exactly the
 * same place. Everything is laid out inside the device's safe area, so the
 * notch and the gesture bar never sit on top of a control.
 *
 * The built-in seat is laid out the way a car is: steering under the left
 * thumb, the clutch on the left edge just above it so both work at once, the
 * pedals under the right thumb, and the gearbox in the middle between them.
 * That is only where the controls start, though -- the player's own layout is
 * applied on top of it here, so nothing downstream has to know whether a
 * control is where the game put it or where its owner did.
 */
import { clamp } from '../core/math'
import type { Viewport } from '../render/viewport'
import {
  CONTROL_SLOTS,
  MAX_CONTROL_SCALE,
  MIN_CONTROL_SCALE,
  type ControlConfig,
  type ControlSlot,
} from './controlLayout'
import { GATE_UNITS, plateAspect, plateWidthUnits, type ShifterPattern } from './shifterPattern'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/** Rect of every movable control, before or after the player's own layout. */
export type SlotRects = Record<ControlSlot, Rect>

export interface TouchLayout {
  /** Base size the whole layout is derived from. */
  unit: number
  /** Spacing the built-in layout separates controls by. */
  gap: number

  /**
   * Every movable control, keyed by slot. The named fields below are the same
   * rects under the names the rest of the game already uses; this is the one
   * the editor walks.
   */
  readonly slots: Readonly<SlotRects>
  readonly hidden: Readonly<Record<ControlSlot, boolean>>
  readonly latch: Readonly<Record<ControlSlot, boolean>>

  /** Steering: a horizontal bar, or a wheel turned by dragging round it. */
  steering: Rect
  /** Generous grab area around the steering bar. */
  steeringGrab: Rect
  /** How far the knob travels from the centre at full lock, in CSS pixels. */
  steeringTravel: number
  /** Tall pedals: travel comes from where the finger sits inside them. */
  throttle: Rect
  brake: Rect
  clutch: Rect
  /** Handbrake, above the pedals. */
  handbrake: Rect
  /**
   * The H gate's plate, used in manual. There is no panel around it: the
   * plate is the whole control, so this is both what is drawn and what a
   * finger has to be inside to take hold of the lever.
   */
  gate: Rect
  /** Sequential selector, in the same place as the gate. */
  sequentialUp: Rect
  sequentialDown: Rect
  /** Automatic selector: an indicator with reverse and neutral beside it. */
  gearDisplay: Rect
  reverse: Rect
  neutral: Rect
  /** Transmission mode selector and starter. */
  mode: Rect
  ignition: Rect
  /** Master volume. */
  volume: Rect
  /** Top-right buttons, right to left. Fixed: they are how the menu is reached. */
  menuButton: Rect
  controlsButton: Rect
  debugButton: Rect
  muteButton: Rect
  fullscreenButton: Rect
}

export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
}

export function rectCenterX(rect: Rect): number {
  return rect.x + rect.width / 2
}

export function rectCenterY(rect: Rect): number {
  return rect.y + rect.height / 2
}

function inflate(rect: Rect, amountX: number, amountY: number): Rect {
  return {
    x: rect.x - amountX,
    y: rect.y - amountY,
    width: rect.width + amountX * 2,
    height: rect.height + amountY * 2,
  }
}

/**
 * The layout the game would use if nobody had touched it. Kept separate from
 * the finished layout because the editor needs it twice over: to size a
 * control the player has scaled, and to know where "back to default" is.
 */
export function defaultSlotRects(
  viewport: Viewport,
  config: ControlConfig,
  pattern: ShifterPattern,
): SlotRects {
  return defaultLayout(viewport, config, pattern).slots
}

/** The built-in slots plus the fixed volume bar that sits beside the buttons. */
function defaultLayout(
  viewport: Viewport,
  config: ControlConfig,
  pattern: ShifterPattern,
): { slots: SlotRects; volume: Rect } {
  const { cssWidth: width, cssHeight: height, safeArea } = viewport
  const unit = baseUnit(viewport)
  const gap = Math.round(unit * 0.16)
  const left = safeArea.left + gap
  const right = width - safeArea.right - gap
  const top = safeArea.top + gap
  const bottom = height - safeArea.bottom - gap

  // --- steering, bottom left ----------------------------------------------
  // The bar is wide and shallow, the wheel is square. Each gets the size that
  // suits it, so switching between them never leaves one squashed.
  const steering: Rect =
    config.steeringStyle === 'wheel'
      ? (() => {
          const side = Math.min(unit * 2.8, bottom - top)
          return { x: left, y: bottom - side, width: side, height: side }
        })()
      : (() => {
          const barWidth = clamp(width * 0.34, unit * 3, unit * 7)
          const barHeight = unit * 0.86
          return { x: left, y: bottom - barHeight, width: barWidth, height: barHeight }
        })()

  // --- clutch, left edge above the steering --------------------------------
  // Tall and narrow, because its whole point is the travel: the finger's
  // height inside it is the pedal position. Kept off to the side of the
  // steering so one thumb can steer while another feathers the clutch.
  const clutchWidth = unit * 0.92
  const clutchHeight = Math.max(unit, Math.min(unit * 2.5, steering.y - top - gap * 2))
  const clutch: Rect = {
    x: left,
    y: steering.y - gap - clutchHeight,
    width: clutchWidth,
    height: clutchHeight,
  }

  // --- pedals, bottom right -----------------------------------------------
  const pedalWidth = unit * 1.05
  const pedalHeight = unit * 1.7
  const brake: Rect = {
    x: right - pedalWidth,
    y: bottom - pedalHeight,
    width: pedalWidth,
    height: pedalHeight,
  }
  const throttle: Rect = {
    x: brake.x,
    y: brake.y - pedalHeight - gap * 0.6,
    width: pedalWidth,
    height: pedalHeight,
  }
  const handbrakeHeight = unit * 0.8
  const handbrake: Rect = {
    x: brake.x,
    y: throttle.y - handbrakeHeight - gap * 0.6,
    width: pedalWidth,
    height: handbrakeHeight,
  }

  // --- gearbox, in the middle where a gear lever lives --------------------
  // The gate is the most involved control on the screen, so it gets the most
  // room: the plate is fitted as large as the seat allows, at the proportions
  // the pattern itself works out to. Two places are tried -- between the
  // steering and the pedals, and above the steering, where a phone held
  // upright has more room -- and whichever yields the wider plate wins. This
  // is also the box the other two transmissions draw into, at whatever size
  // the pattern happened to earn -- a shifted gear pulls them along with it.
  const smallHeight = Math.max(40, unit * 0.72)
  // Kept clear above the plate for the mode and starter row, on the screens
  // too narrow to stand it beside the gearbox instead.
  const gateCeiling = top + smallHeight + gap * 1.6
  const aspect = plateAspect(pattern)
  const maxPlateWidth = unit * MAX_PLATE_WIDTH_UNITS
  const between = fitPlate(
    steering.x + steering.width + gap,
    throttle.x - gap,
    gateCeiling,
    bottom,
    aspect,
    maxPlateWidth,
  )
  const above = fitPlate(
    clutch.x + clutch.width + gap,
    throttle.x - gap,
    gateCeiling,
    steering.y - gap,
    aspect,
    maxPlateWidth,
  )
  const gearbox: Rect = between.width >= above.width ? between : above

  // Mode selector and starter. Wide enough for the word PARTIDA without the
  // type having to shrink to fit, and stacked beside the gearbox whenever
  // there is room: the row above the gate is where the car itself sits, and
  // buttons drawn across the bodywork are buttons nobody can read. Only a
  // screen too narrow for that gap falls back to the row.
  const smallWidth = unit * 1.4
  const besideGate = gearbox.x + gearbox.width + gap
  const stacked = throttle.x - gap - besideGate >= smallWidth
  const mode: Rect = stacked
    ? { x: besideGate, y: gearbox.y, width: smallWidth, height: smallHeight }
    : (() => {
        const pairWidth = smallWidth * 2 + gap * 0.6
        return {
          x: clamp(rectCenterX(gearbox) - pairWidth / 2, left, Math.max(left, right - pairWidth)),
          y: Math.max(top, gearbox.y - gap - smallHeight),
          width: smallWidth,
          height: smallHeight,
        }
      })()
  const ignition: Rect = stacked
    ? {
        x: mode.x,
        y: mode.y + smallHeight + gap * 0.6,
        width: smallWidth,
        height: smallHeight,
      }
    : { x: mode.x + smallWidth + gap * 0.6, y: mode.y, width: smallWidth, height: smallHeight }

  // --- volume, left of the top-right buttons ------------------------------
  const buttonSize = topButtonSize(unit)
  const buttonsLeft = topButton(viewport, 4).x
  const volumeWidth = clamp(unit * 2.6, 60, Math.max(60, buttonsLeft - left - gap))
  const volume: Rect = {
    x: buttonsLeft - gap * 0.5 - volumeWidth,
    y: top,
    width: volumeWidth,
    height: buttonSize,
  }

  return {
    slots: { steering, throttle, brake, clutch, handbrake, gearbox, mode, ignition },
    volume,
  }
}

function baseUnit(viewport: Viewport): number {
  // Never smaller than a 44 px finger target, never silly on a big screen.
  return clamp(Math.min(viewport.cssWidth, viewport.cssHeight) * 0.13, 44, 92)
}

function topButtonSize(unit: number): number {
  // Never below the 44 px a fingertip needs, however small the screen is.
  return Math.max(44, unit * 0.72)
}

/** Top-right buttons, counted right to left. Never movable: they are the way in. */
function topButton(viewport: Viewport, index: number): Rect {
  const unit = baseUnit(viewport)
  const gap = Math.round(unit * 0.16)
  const size = topButtonSize(unit)
  return {
    x: viewport.cssWidth - viewport.safeArea.right - gap - size - index * (size + gap * 0.5),
    y: viewport.safeArea.top + gap,
    width: size,
    height: size,
  }
}

/**
 * A control's own rect: the built-in one, or the player's centre and size if
 * they have moved it. Kept on screen whatever the saved numbers say, so a
 * layout carried over from another screen can never strand a control.
 */
function placeSlot(base: Rect, config: ControlConfig, slot: ControlSlot, viewport: Viewport): Rect {
  const placement = config.placements[slot]
  if (placement === null) return base
  const scale = clamp(placement.scale, MIN_CONTROL_SCALE, MAX_CONTROL_SCALE)
  const width = base.width * scale
  const height = base.height * scale
  const x = placement.x * viewport.cssWidth - width / 2
  const y = placement.y * viewport.cssHeight - height / 2
  return {
    x: clamp(x, 0, Math.max(0, viewport.cssWidth - width)),
    y: clamp(y, 0, Math.max(0, viewport.cssHeight - height)),
    width,
    height,
  }
}

export function computeTouchLayout(
  viewport: Viewport,
  config: ControlConfig,
  pattern: ShifterPattern,
): TouchLayout {
  const unit = baseUnit(viewport)
  const gap = Math.round(unit * 0.16)
  const base = defaultLayout(viewport, config, pattern)

  const slots = {} as SlotRects
  const hidden = {} as Record<ControlSlot, boolean>
  const latch = {} as Record<ControlSlot, boolean>
  for (const slot of CONTROL_SLOTS) {
    slots[slot] = placeSlot(base.slots[slot], config, slot, viewport)
    const placement = config.placements[slot]
    hidden[slot] = placement !== null && placement.hidden
    latch[slot] = placement !== null && placement.latch
  }

  const { steering, gearbox } = slots
  const knobDiameter = steering.height * 0.82

  // Everything below is derived from the finished slots, never from the
  // built-in ones: a gate the player has dragged or resized takes its
  // channels, its paddles and its selectors with it.
  const paddleHeight = (gearbox.height - gap * 0.6) / 2
  // The automatic stacks inside the box rather than sitting side by side: the
  // gear it picked across the top, the two selectors it still answers to
  // underneath. Side by side in a tall box gives two slivers.
  const displayHeight = gearbox.height * 0.5
  const selectorTop = gearbox.y + displayHeight + gap * 0.6
  const selectorHeight = Math.max(1, gearbox.height - displayHeight - gap * 0.6)
  const cellWidth = (gearbox.width - gap * 0.6) / 2

  return {
    unit,
    gap,
    slots,
    hidden,
    latch,
    steering,
    steeringGrab: inflate(steering, unit * 0.3, unit * 0.55),
    steeringTravel: Math.max(1, (steering.width - knobDiameter) / 2),
    throttle: slots.throttle,
    brake: slots.brake,
    clutch: slots.clutch,
    handbrake: slots.handbrake,
    gate: gearbox,
    sequentialUp: { x: gearbox.x, y: gearbox.y, width: gearbox.width, height: paddleHeight },
    sequentialDown: {
      x: gearbox.x,
      y: gearbox.y + paddleHeight + gap * 0.6,
      width: gearbox.width,
      height: paddleHeight,
    },
    gearDisplay: { x: gearbox.x, y: gearbox.y, width: gearbox.width, height: displayHeight },
    reverse: { x: gearbox.x, y: selectorTop, width: cellWidth, height: selectorHeight },
    neutral: {
      x: gearbox.x + cellWidth + gap * 0.6,
      y: selectorTop,
      width: cellWidth,
      height: selectorHeight,
    },
    mode: slots.mode,
    ignition: slots.ignition,
    volume: base.volume,
    menuButton: topButton(viewport, 0),
    controlsButton: topButton(viewport, 1),
    debugButton: topButton(viewport, 2),
    muteButton: topButton(viewport, 3),
    fullscreenButton: topButton(viewport, 4),
  }
}

/** Knob diameter derived from the bar, shared by drawing and hit testing. */
export function steeringKnobDiameter(layout: TouchLayout): number {
  return layout.steering.height * 0.82
}

/** The largest circle the wheel art can be drawn as inside its slot. */
export function steeringWheelDiameter(layout: TouchLayout): number {
  return Math.min(layout.steering.width, layout.steering.height)
}

// ------------------------------------------------------------------ H gate
//
// Nothing about the gate's shape is written down here: the pattern owns the
// proportions, and this only scales them into the room the "gearbox" slot
// found. The plate is the control, so `layout.gate` is both the drawn
// rectangle and the area a finger has to be inside to take hold of the lever.
//
//     1   3   5           <- column 3 has no position on the upper side, so
//     |   |   |              nothing is drawn there and the corner stays solid
//     +---+---+---+
//     |   |   |   |
//     2   4   6   R

/** Manifest key of the wheel, the alternative to the steering bar. */
export const STEERING_WHEEL_KEY = 'steering_wheel'

/** Plate width ceiling, in layout units, so a big screen stays sensible. */
const MAX_PLATE_WIDTH_UNITS = 5

/**
 * The largest plate of `aspect` that fits the horizontal span `from`..`to`
 * and the vertical room `ceiling`..`floor`, sitting on the floor.
 */
function fitPlate(
  from: number,
  to: number,
  ceiling: number,
  floor: number,
  aspect: number,
  maxWidth: number,
): Rect {
  const span = Math.max(0, to - from)
  const room = Math.max(0, floor - ceiling)
  let width = Math.min(span, maxWidth)
  let height = width / aspect
  if (height > room) {
    height = room
    width = height * aspect
  }
  // A viewport too cramped for any of this must still hand back a rectangle
  // that can be divided by, rather than a zero that spreads NaN downstream.
  width = Math.max(1, width)
  height = Math.max(1, height)
  return { x: from + (span - width) / 2, y: floor - height, width, height }
}

export interface GateGeometry {
  readonly columns: number
  /** The plate, which is the whole gate. */
  readonly plate: Rect
  /** Layout pixels per drawing unit -- the SVG is scaled by exactly this. */
  readonly scale: number
  /** Centre-x of column 0, in layout pixels. */
  readonly firstColumnX: number
  /** Distance between neighbouring columns, in layout pixels. */
  readonly columnSpacing: number
  readonly corridorY: number
  /** Corridor to a fully seated gear, in layout pixels. */
  readonly laneReach: number
}

export function gateGeometry(layout: TouchLayout, pattern: ShifterPattern): GateGeometry {
  const plate = layout.gate
  const scale = plate.width / plateWidthUnits(pattern)
  return {
    columns: pattern.columns,
    plate,
    scale,
    firstColumnX: plate.x + GATE_UNITS.marginX * scale,
    columnSpacing: GATE_UNITS.columnSpacing * scale,
    corridorY: plate.y + plate.height / 2,
    laneReach: GATE_UNITS.laneReach * scale,
  }
}

/**
 * Continuous column (0 .. columns - 1) for an x position. The spacing is
 * uniform, so this is one division -- which is the point of deriving the
 * drawing from the pattern instead of measuring it off a picture.
 */
export function columnAtX(geometry: GateGeometry, x: number): number {
  const raw = (x - geometry.firstColumnX) / geometry.columnSpacing
  return Number.isFinite(raw) ? clamp(raw, 0, geometry.columns - 1) : 0
}
