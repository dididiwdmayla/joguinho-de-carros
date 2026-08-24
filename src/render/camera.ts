/**
 * Chase camera. It never rotates with the car -- the world keeps a fixed
 * orientation on screen -- it translates, with exponential smoothing and a
 * velocity look-ahead so the player sees where they are going.
 *
 * It also frames the bay. Coming up on the target, the camera slides part of
 * the way towards it and eases back a little, so the last few metres of a
 * manoeuvre are seen whole: the car, the bay, and the gap between them. The
 * movement is small on purpose. A camera that lurches while somebody is
 * placing a car within centimetres is worse than one that does nothing.
 */
import { PIXELS_PER_METER } from '../core/constants'
import { clamp, lerp, smoothingFactor } from '../core/math'
import type { Viewport } from './viewport'

/** Reciprocal time constant of the follow [1/s]. Higher = tighter. */
const FOLLOW_RATE = 6
/** How far ahead of the car the camera looks, in seconds of travel. */
const LOOK_AHEAD_TIME = 0.5
/** Ceiling for that offset [m], so highway speeds do not lose the car. */
const LOOK_AHEAD_MAX = 5

/** Distance to the bay at which the framing starts, and where it is full [m]. */
const FRAME_START = 22
const FRAME_FULL = 7
/** Most of the way to the bay the camera is ever pulled. */
const FRAME_BIAS = 0.42
/** How much of the look-ahead survives at full framing: a slow manoeuvre. */
const FRAME_LOOK_AHEAD = 0.25

/** World scale far from the bay and standing in it [px/m]. */
const FAR_SCALE = PIXELS_PER_METER
const NEAR_SCALE = PIXELS_PER_METER * 0.8
/** How fast the scale chases its target [1/s]: slow enough to be unnoticed. */
const ZOOM_RATE = 1.6

export interface CameraState {
  x: number
  y: number
  /** World scale [px/m]; eased rather than snapped. */
  scale: number
}

/** What the renderer consumes: an interpolated camera plus the world scale. */
export interface CameraView {
  x: number
  y: number
  pixelsPerMeter: number
}

export interface FollowTarget {
  x: number
  y: number
  /** World-frame velocity [m/s]. */
  velocityX: number
  velocityY: number
  /** The bay being aimed at, or null when there is nothing to frame. */
  focusX: number | null
  focusY: number | null
}

export function createCameraState(x: number, y: number): CameraState {
  return { x, y, scale: FAR_SCALE }
}

export function copyCameraState(from: CameraState, to: CameraState): void {
  to.x = from.x
  to.y = from.y
  to.scale = from.scale
}

/** Puts the camera exactly on the car, for the first frame of a level. */
export function snapCamera(camera: CameraState, x: number, y: number): void {
  camera.x = x
  camera.y = y
  camera.scale = FAR_SCALE
}

/** Runs inside the fixed step, so the motion is identical at any frame rate. */
export function stepCamera(camera: CameraState, target: FollowTarget, dt: number): void {
  // How close the bay is, as 0 far away .. 1 standing in it.
  let framing = 0
  if (target.focusX !== null && target.focusY !== null) {
    const distance = Math.hypot(target.focusX - target.x, target.focusY - target.y)
    framing = clamp((FRAME_START - distance) / (FRAME_START - FRAME_FULL), 0, 1)
  }

  // The look-ahead is what makes the camera useful at speed and a nuisance at
  // a crawl, so the framing turns most of it off as the bay comes up.
  const reach = LOOK_AHEAD_TIME * lerp(1, FRAME_LOOK_AHEAD, framing)
  let aheadX = target.velocityX * reach
  let aheadY = target.velocityY * reach
  const aheadDistance = Math.hypot(aheadX, aheadY)
  if (aheadDistance > LOOK_AHEAD_MAX) {
    const scale = LOOK_AHEAD_MAX / aheadDistance
    aheadX *= scale
    aheadY *= scale
  }

  let aimX = target.x + aheadX
  let aimY = target.y + aheadY
  if (target.focusX !== null && target.focusY !== null && framing > 0) {
    const bias = FRAME_BIAS * framing
    aimX = lerp(aimX, target.focusX, bias)
    aimY = lerp(aimY, target.focusY, bias)
  }

  const factor = smoothingFactor(FOLLOW_RATE, dt)
  camera.x = lerp(camera.x, aimX, factor)
  camera.y = lerp(camera.y, aimY, factor)

  const wanted = lerp(FAR_SCALE, NEAR_SCALE, framing)
  camera.scale = lerp(camera.scale, wanted, smoothingFactor(ZOOM_RATE, dt))
}

export function createCameraView(): CameraView {
  return { x: 0, y: 0, pixelsPerMeter: FAR_SCALE }
}

/** World metres -> CSS pixels. */
export function worldToScreenX(camera: CameraView, viewport: Viewport, worldX: number): number {
  return (worldX - camera.x) * camera.pixelsPerMeter + viewport.cssWidth / 2
}

export function worldToScreenY(camera: CameraView, viewport: Viewport, worldY: number): number {
  return (worldY - camera.y) * camera.pixelsPerMeter + viewport.cssHeight / 2
}
