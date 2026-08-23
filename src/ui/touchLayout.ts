/**
 * Geometry of the on-screen controls, in CSS pixels.
 *
 * One module owns it so hit testing and drawing can never disagree: the input
 * layer asks where the controls are, the ui layer draws them in exactly the
 * same place. Everything is laid out inside the device's safe area, so the
 * notch and the gesture bar never sit on top of a control.
 */
import { clamp } from '../core/math'
import type { Viewport } from '../render/viewport'

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
  /** Stacked pedals, bottom right. */
  throttle: Rect
  brake: Rect
  /** Handbrake, above the pedals. */
  handbrake: Rect
  /** Top-right buttons, right to left. */
  controlsButton: Rect
  debugButton: Rect
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

  // --- pedals, bottom right ----------------------------------------------
  const pedalWidth = unit * 1.6
  const pedalHeight = unit * 1.15
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

  // --- top right buttons, laid out right to left --------------------------
  // Never below the 44 px a fingertip needs, however small the screen is.
  const buttonSize = Math.max(44, unit * 0.72)
  const button = (index: number): Rect => ({
    x: right - buttonSize - index * (buttonSize + gap * 0.5),
    y: top,
    width: buttonSize,
    height: buttonSize,
  })

  return {
    unit,
    steering,
    steeringGrab: inflate(steering, unit * 0.3, unit * 0.55),
    steeringTravel: (steeringWidth - knobDiameter) / 2,
    throttle,
    brake,
    handbrake,
    controlsButton: button(0),
    debugButton: button(1),
    fullscreenButton: button(2),
  }
}

/** Knob diameter derived from the bar, shared by drawing and hit testing. */
export function steeringKnobDiameter(layout: TouchLayout): number {
  return layout.steering.height * 0.82
}
