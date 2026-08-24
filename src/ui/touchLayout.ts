/**
 * Geometry of the on-screen controls, in CSS pixels.
 *
 * One module owns it so hit testing and drawing can never disagree: the input
 * layer asks where the controls are, the ui layer draws them in exactly the
 * same place. Everything is laid out inside the device's safe area, so the
 * notch and the gesture bar never sit on top of a control.
 *
 * The seat is laid out the way a car is: steering under the left thumb, the
 * clutch on the left edge just above it so both work at once, the pedals under
 * the right thumb, and the gearbox in the middle between them.
 */
import { clamp } from '../core/math'
import type { Viewport } from '../render/viewport'
import type { TransmissionMode } from '../vehicle/powertrain'
import {
  GATE_UNITS,
  plateAspect,
  plateWidthUnits,
  type ShifterPattern,
} from './shifterPattern'

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface TouchLayout {
  /** Base size the whole layout is derived from. */
  unit: number
  /** Horizontal steering bar, bottom left. */
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
  /** Transmission mode selector and starter, above the gearbox. */
  mode: Rect
  ignition: Rect
  /** Master volume, left of the top-right buttons. */
  volume: Rect
  /** Top-right buttons, right to left. */
  controlsButton: Rect
  debugButton: Rect
  muteButton: Rect
  fullscreenButton: Rect
}

export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height
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
 * Where every control sits, for the gearbox that is currently fitted.
 *
 * `mode` only moves the row above the gearbox: the manual plate fills the
 * whole gearbox region, while the other two are short buttons on its floor,
 * and the row has to come down to meet them rather than float above nothing.
 */
export function computeTouchLayout(
  viewport: Viewport,
  pattern: ShifterPattern,
  mode: TransmissionMode,
): TouchLayout {
  const { cssWidth: width, cssHeight: height, safeArea } = viewport

  // Never smaller than a 44 px finger target, never silly on a big screen.
  const unit = clamp(Math.min(width, height) * 0.13, 44, 92)
  const gap = Math.round(unit * 0.16)
  const left = safeArea.left + gap
  const right = width - safeArea.right - gap
  const top = safeArea.top + gap
  const bottom = height - safeArea.bottom - gap

  // --- steering bar, bottom left -----------------------------------------
  const steeringWidth = clamp(width * 0.34, unit * 3, unit * 7)
  const steeringHeight = unit * 0.86
  const steering: Rect = {
    x: left,
    y: bottom - steeringHeight,
    width: steeringWidth,
    height: steeringHeight,
  }
  const knobDiameter = steeringHeight * 0.82

  // --- clutch, left edge above the bar ------------------------------------
  // Tall and narrow, because its whole point is the travel: the finger's
  // height inside it is the pedal position. Kept off to the side of the
  // steering bar so one thumb can steer while another feathers the clutch.
  const clutchWidth = unit * 0.92
  const clutchHeight = Math.min(unit * 2.5, steering.y - top - gap * 2)
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
  // the pattern itself works out to. Two places are tried -- between the wheel
  // and the pedals, and above the wheel, where a phone held upright has more
  // room -- and whichever yields the wider plate wins.
  const smallHeight = Math.max(40, unit * 0.72)
  // Kept clear above the plate for the mode and starter row that sits there.
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
  const gate = between.width >= above.width ? between : above

  // The other two gearboxes are ordinary buttons and would look absurd blown
  // up to the plate's size, so they keep their own footprint at the bottom of
  // the plate's box.
  const boxWidth = Math.min(gate.width, unit * 4.4)
  const boxHeight = Math.min(gate.height, unit * 2.3)
  const boxX = gate.x + (gate.width - boxWidth) / 2
  const boxY = gate.y + gate.height - boxHeight

  // Sequential: two big paddles in the same footprint.
  const paddleHeight = (boxHeight - gap * 0.6) / 2
  const sequentialUp: Rect = { x: boxX, y: boxY, width: boxWidth, height: paddleHeight }
  const sequentialDown: Rect = {
    x: boxX,
    y: boxY + paddleHeight + gap * 0.6,
    width: boxWidth,
    height: paddleHeight,
  }

  // Automatic: what gear it picked, with the two selectors it still answers to.
  const cellWidth = (boxWidth - gap * 0.6) / 2
  const gearDisplay: Rect = {
    x: boxX,
    y: boxY,
    width: cellWidth,
    height: boxHeight,
  }
  const selectorHeight = (boxHeight - gap * 0.6) / 2
  const reverse: Rect = {
    x: boxX + cellWidth + gap * 0.6,
    y: boxY,
    width: cellWidth,
    height: selectorHeight,
  }
  const neutral: Rect = {
    x: reverse.x,
    y: boxY + selectorHeight + gap * 0.6,
    width: cellWidth,
    height: selectorHeight,
  }

  // Wide, but never so short that a thumb misses them. They sit right on top
  // of whichever gearbox is fitted, which is the plate in manual and the short
  // button box in the other two.
  const smallWidth = (boxWidth - gap * 0.6) / 2
  const headerY = (mode === 'manual' ? gate.y : boxY) - gap - smallHeight
  const modeButton: Rect = {
    x: boxX,
    y: headerY,
    width: smallWidth,
    height: smallHeight,
  }
  const ignition: Rect = {
    x: boxX + smallWidth + gap * 0.6,
    y: headerY,
    width: smallWidth,
    height: smallHeight,
  }

  // --- top right buttons, laid out right to left --------------------------
  // Never below the 44 px a fingertip needs, however small the screen is.
  const buttonSize = Math.max(44, unit * 0.72)
  const button = (index: number): Rect => ({
    x: right - buttonSize - index * (buttonSize + gap * 0.5),
    y: top,
    width: buttonSize,
    height: buttonSize,
  })
  const buttonsLeft = button(3).x
  const volumeWidth = clamp(unit * 2.6, 60, Math.max(60, buttonsLeft - left - gap))
  const volume: Rect = {
    x: buttonsLeft - gap * 0.5 - volumeWidth,
    y: top,
    width: volumeWidth,
    height: buttonSize,
  }

  return {
    unit,
    steering,
    steeringGrab: inflate(steering, unit * 0.3, unit * 0.55),
    steeringTravel: (steeringWidth - knobDiameter) / 2,
    throttle,
    brake,
    clutch,
    handbrake,
    gate,
    sequentialUp,
    sequentialDown,
    gearDisplay,
    reverse,
    neutral,
    mode: modeButton,
    ignition,
    volume,
    controlsButton: button(0),
    debugButton: button(1),
    muteButton: button(2),
    fullscreenButton: button(3),
  }
}

/** Knob diameter derived from the bar, shared by drawing and hit testing. */
export function steeringKnobDiameter(layout: TouchLayout): number {
  return layout.steering.height * 0.82
}

// ------------------------------------------------------------------ H gate
//
// Nothing about the gate's shape is written down here: the pattern owns the
// proportions, and this only scales them into the room the layout found. The
// plate is the control, so `layout.gate` is both the drawn rectangle and the
// area a finger has to be inside to take hold of the lever.
//
//     1   3   5           <- column 3 has no position on the upper side, so
//     |   |   |              nothing is drawn there and the corner stays solid
//     +---+---+---+
//     |   |   |   |
//     2   4   6   R

/** Plate width ceiling, in layout units, so a big screen stays sensible. */
const MAX_PLATE_WIDTH_UNITS = 7

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
