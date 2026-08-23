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
import { NEUTRAL_GEAR, REVERSE_GEAR } from '../vehicle/powertrain'

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
  /** The H gate, used in manual. */
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

export function computeTouchLayout(viewport: Viewport): TouchLayout {
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
  // Between the wheel and the pedals when there is room for it. Held upright
  // a phone has no such room, so the gate moves up a row instead of being
  // squeezed into the controls on either side of it.
  const gateHeight = unit * 2.3
  const betweenFrom = steering.x + steering.width + gap
  const betweenTo = throttle.x - gap
  const aboveFrom = clutch.x + clutch.width + gap
  const aboveTo = throttle.x - gap
  const fitsBetween = betweenTo - betweenFrom >= unit * 2.6
  const gateFrom = fitsBetween ? betweenFrom : aboveFrom
  const gateSpan = Math.max(unit * 1.6, (fitsBetween ? betweenTo : aboveTo) - gateFrom)
  const gateWidth = Math.min(unit * 4.4, gateSpan)
  const gate: Rect = {
    x: gateFrom + (gateSpan - gateWidth) / 2,
    y: (fitsBetween ? bottom : steering.y - gap) - gateHeight,
    width: gateWidth,
    height: gateHeight,
  }

  // Sequential: two big paddles in the same footprint.
  const paddleHeight = (gateHeight - gap * 0.6) / 2
  const sequentialUp: Rect = { x: gate.x, y: gate.y, width: gate.width, height: paddleHeight }
  const sequentialDown: Rect = {
    x: gate.x,
    y: gate.y + paddleHeight + gap * 0.6,
    width: gate.width,
    height: paddleHeight,
  }

  // Automatic: what gear it picked, with the two selectors it still answers to.
  const cellWidth = (gate.width - gap * 0.6) / 2
  const gearDisplay: Rect = {
    x: gate.x,
    y: gate.y,
    width: cellWidth,
    height: gateHeight,
  }
  const selectorHeight = (gateHeight - gap * 0.6) / 2
  const reverse: Rect = {
    x: gate.x + cellWidth + gap * 0.6,
    y: gate.y,
    width: cellWidth,
    height: selectorHeight,
  }
  const neutral: Rect = {
    x: reverse.x,
    y: gate.y + selectorHeight + gap * 0.6,
    width: cellWidth,
    height: selectorHeight,
  }

  // Wide, but never so short that a thumb misses them.
  const smallHeight = Math.max(40, unit * 0.72)
  const smallWidth = (gate.width - gap * 0.6) / 2
  const mode: Rect = {
    x: gate.x,
    y: gate.y - gap - smallHeight,
    width: smallWidth,
    height: smallHeight,
  }
  const ignition: Rect = {
    x: gate.x + smallWidth + gap * 0.6,
    y: mode.y,
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
    mode,
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

/**
 * The gate as coordinates.
 *
 *     1   3   5
 *     |   |   |
 *     +---+---+---+     <- the corridor: neutral, all of it
 *     |   |   |   |
 *     2   4   6   R
 *
 * Columns are counted from the left; the lane is -1 up, 0 in the corridor and
 * +1 down. Reverse is the bottom of one extra column on the right.
 */
export interface GateGeometry {
  readonly columns: number
  /** Centre of column 0. */
  readonly firstColumnX: number
  readonly columnSpacing: number
  readonly corridorY: number
  /** Distance from the corridor to a fully seated gear. */
  readonly laneReach: number
  readonly knobRadius: number
}

export function gateGeometry(layout: TouchLayout, forwardGears: number): GateGeometry {
  const columns = gateColumns(forwardGears)
  const { gate } = layout
  const columnSpacing = gate.width / columns
  return {
    columns,
    firstColumnX: gate.x + columnSpacing / 2,
    columnSpacing,
    corridorY: gate.y + gate.height / 2,
    laneReach: gate.height * 0.34,
    knobRadius: Math.min(columnSpacing, gate.height) * 0.22,
  }
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
