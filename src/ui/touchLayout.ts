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
import { NEUTRAL_GEAR, REVERSE_GEAR } from '../vehicle/powertrain'
import {
  CONTROL_SLOTS,
  MAX_CONTROL_SCALE,
  MIN_CONTROL_SCALE,
  type ControlConfig,
  type ControlSlot,
} from './controlLayout'

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
  /** The H gate, used in manual. */
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
export function defaultSlotRects(viewport: Viewport, config: ControlConfig): SlotRects {
  return defaultLayout(viewport, config).slots
}

/** The built-in slots plus the fixed volume bar that sits beside the buttons. */
function defaultLayout(
  viewport: Viewport,
  config: ControlConfig,
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
  // Between the steering and the pedals when there is room for it. Held
  // upright a phone has no such room, so the gate moves up a row instead of
  // being squeezed into the controls on either side of it.
  //
  // The box is cut to the plate's own proportions and then given every pixel
  // of height that is going: the gate is the control a thumb has to hit a
  // groove on, and it is drawn as bare metal with nothing behind it, so there
  // is no panel to keep small.
  const smallHeight = Math.max(40, unit * 0.72)
  const betweenFrom = steering.x + steering.width + gap
  const betweenTo = throttle.x - gap
  const aboveFrom = clutch.x + clutch.width + gap
  const aboveTo = throttle.x - gap
  const fitsBetween = betweenTo - betweenFrom >= unit * 2.2
  const gateFrom = fitsBetween ? betweenFrom : aboveFrom
  const gateSpan = Math.max(unit * 1.2, (fitsBetween ? betweenTo : aboveTo) - gateFrom)
  const gateBottom = fitsBetween ? bottom : steering.y - gap
  const gateRoom = Math.max(unit * 1.9, gateBottom - top - smallHeight - gap * 2)
  const gateWidth = Math.min(gateSpan, Math.min(unit * 3.4, gateRoom) * GATE_BOX_ASPECT)
  const gateHeight = gateWidth / GATE_BOX_ASPECT
  const gearbox: Rect = {
    x: gateFrom + (gateSpan - gateWidth) / 2,
    y: gateBottom - gateHeight,
    width: gateWidth,
    height: gateHeight,
  }

  // Mode selector and starter. Wide enough for the word PARTIDA without the
  // type having to shrink to fit, and stacked in the gap between the gate and
  // the pedals whenever there is one: the row above the gate is where the car
  // itself sits, and buttons drawn across the bodywork are buttons nobody can
  // read. Only a screen too narrow for that gap falls back to the row.
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

export function computeTouchLayout(viewport: Viewport, config: ControlConfig): TouchLayout {
  const unit = baseUnit(viewport)
  const gap = Math.round(unit * 0.16)
  const base = defaultLayout(viewport, config)

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
  // built-in ones: a gate the player has dragged takes its channels with it.
  const paddleHeight = (gearbox.height - gap * 0.6) / 2
  // The box is cut to the H gate's proportions, which is taller than it is
  // wide. The automatic stacks inside it rather than sitting side by side:
  // the gear it picked across the top, the two selectors it still answers to
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
// The gate is drawn from a fixed piece of art (gear_gate.png): a plate
// routed with four channels, three forward pairs on the left and a fourth on
// the right whose lower half is reverse -- its upper half is unused, since
// there is no sixth pair. The fractions below were measured on that art's
// own trimmed opaque box (0..1 across its width and height) so a finger's
// drag lines up with the groove drawn under it. Columns are counted from the
// left; the lane is -1 up, 0 in the corridor and +1 down.
//
//     1   3   5   x     <- x: column 3's upper channel. Routed into the art
//     |   |   |   .        like the rest, but nothing lives there -- darkened
//     +---+---+---+        rather than left looking like a fourth pair.
//     |   |   |   |
//     2   4   6   R

/** Width/height of the trimmed gate art -- the art is never stretched off
 *  its own proportions when it is fitted into the layout. */
const GATE_ART_ASPECT = 527 / 688

/** Centre-x of each of the art's four channels, left to right. */
const GATE_COLUMN_X_FRAC: readonly number[] = [0.261, 0.4, 0.598, 0.737]
/** Centre-y of the horizontal corridor connecting the channels. */
const GATE_CORRIDOR_Y_FRAC = 0.5
/** Corridor to a fully seated gear, along the art's own height. */
const GATE_LANE_REACH_FRAC = 0.2885
/** Knob diameter, relative to the art's width -- sized for a thumb. */
const KNOB_DIAMETER_FRAC = 0.4
/** Gate-box height reserved above and below the art for the gear numbers,
 *  so a label never has to sit on top of the metal. */
const LABEL_BAND_FRAC = 0.13

/**
 * Column 3's upper channel, in the same 0..1 art fractions: routed into the
 * plate like every other channel, but reverse is the bottom of that column,
 * not the top, so nothing is ever seated here. Darkened in code instead of
 * left looking like a live position.
 */
export const GATE_DEAD_SLOT = {
  centerXFrac: 0.737,
  halfWidthFrac: 0.06,
  topFrac: 0.17,
  bottomFrac: 0.465,
}

/** Manifest keys of the gate's two layers. */
export const GEAR_GATE_KEY = 'gear_gate'
export const GEAR_KNOB_KEY = 'gear_knob'

/** Manifest key of the wheel, the alternative to the steering bar. */
export const STEERING_WHEEL_KEY = 'steering_wheel'

export interface GateGeometry {
  readonly columns: number
  /** Where the art is actually drawn, fitted to its own proportions. */
  readonly art: Rect
  /** Centre-x of each column, left to right, in layout pixels. */
  readonly columnX: readonly number[]
  readonly corridorY: number
  /** Distance from the corridor to a fully seated gear, in layout pixels. */
  readonly laneReach: number
  readonly knobDiameter: number
  /** Where gear numbers sit, above and below the art. */
  readonly labelTopY: number
  readonly labelBottomY: number
}

export function gateGeometry(layout: TouchLayout, forwardGears: number): GateGeometry {
  const columns = gateColumns(forwardGears)
  const { gate } = layout
  const band = gate.height * LABEL_BAND_FRAC
  const art = fitContain(
    { x: gate.x, y: gate.y + band, width: gate.width, height: gate.height - band * 2 },
    GATE_ART_ASPECT,
  )
  return {
    columns,
    art,
    columnX: GATE_COLUMN_X_FRAC.slice(0, columns).map((frac) => art.x + frac * art.width),
    corridorY: art.y + GATE_CORRIDOR_Y_FRAC * art.height,
    laneReach: GATE_LANE_REACH_FRAC * art.height,
    knobDiameter: art.width * KNOB_DIAMETER_FRAC,
    labelTopY: art.y - band / 2,
    labelBottomY: art.y + art.height + band / 2,
  }
}

/** The largest rect with `aspect` (width/height) centred inside `box`. */
function fitContain(box: Rect, aspect: number): Rect {
  const width = box.height * aspect <= box.width ? box.height * aspect : box.width
  const height = width / aspect
  return {
    x: box.x + (box.width - width) / 2,
    y: box.y + (box.height - height) / 2,
    width,
    height,
  }
}

/**
 * Continuous column (0..columns-1) for an x position, by inverting the same
 * piecewise scale the art's channels were measured against. The columns are
 * not evenly spaced, so this -- not a single division -- is what keeps a
 * dragging finger over the groove drawn under it.
 */
export function columnAtX(geometry: GateGeometry, x: number): number {
  const { columnX } = geometry
  if (x <= columnX[0]) return 0
  for (let i = 1; i < columnX.length; i++) {
    if (x <= columnX[i]) {
      const span = columnX[i] - columnX[i - 1]
      return i - 1 + (span > 0 ? (x - columnX[i - 1]) / span : 0)
    }
  }
  return columnX.length - 1
}

/** Inverse of `columnAtX`: the x position of a (possibly fractional) column. */
export function columnToX(geometry: GateGeometry, column: number): number {
  const { columnX } = geometry
  const i0 = clamp(Math.floor(column), 0, columnX.length - 1)
  const i1 = Math.min(i0 + 1, columnX.length - 1)
  const t = clamp(column - i0, 0, 1)
  return columnX[i0] + (columnX[i1] - columnX[i0]) * t
}

/** Forward gears in pairs, plus the column reverse lives at the bottom of. */
export function gateColumns(forwardGears: number): number {
  return Math.ceil(forwardGears / 2) + 1
}

/**
 * Which gear sits at a gate position, or null when there is nothing there --
 * the top of the reverse column, or an odd gear a five-speed does not have.
 */
export function gateGear(column: number, lane: number, forwardGears: number): number | null {
  if (lane === 0) return NEUTRAL_GEAR
  const reverseColumn = gateColumns(forwardGears) - 1
  if (column === reverseColumn) return lane > 0 ? REVERSE_GEAR : null
  const gear = column * 2 + (lane < 0 ? 1 : 2)
  return gear >= 1 && gear <= forwardGears ? gear : null
}

/** Where a gear sits in the gate, for putting the lever back where it belongs. */
export function gearGatePosition(
  gear: number,
  forwardGears: number,
): { column: number; lane: number } {
  if (gear === REVERSE_GEAR) return { column: gateColumns(forwardGears) - 1, lane: 1 }
  if (gear === NEUTRAL_GEAR) return { column: 0, lane: 0 }
  const column = Math.floor((gear - 1) / 2)
  return { column, lane: gear % 2 === 1 ? -1 : 1 }
}

/**
 * Aspect the gate box itself is cut to, so the plate fills it exactly: the
 * art's own aspect, widened by the label bands the box reserves above and
 * below it. Sizing the box this way is what stops a large gate from being
 * large mostly in empty margin.
 */
const GATE_BOX_ASPECT = GATE_ART_ASPECT * (1 - LABEL_BAND_FRAC * 2)
