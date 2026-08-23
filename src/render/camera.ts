/**
 * Chase camera. It never rotates with the car -- the world keeps a fixed
 * orientation on screen -- it only translates, with exponential smoothing and
 * a velocity look-ahead so the player sees where they are going.
 */
import { PIXELS_PER_METER } from '../core/constants'
import { lerp, smoothingFactor } from '../core/math'
import type { Viewport } from './viewport'

/** Reciprocal time constant of the follow [1/s]. Higher = tighter. */
const FOLLOW_RATE = 6
/** How far ahead of the car the camera looks, in seconds of travel. */
const LOOK_AHEAD_TIME = 0.5
/** Ceiling for that offset [m], so highway speeds do not lose the car. */
const LOOK_AHEAD_MAX = 5

export interface CameraState {
  x: number
  y: number
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
}

export function createCameraState(x: number, y: number): CameraState {
  return { x, y }
}

export function copyCameraState(from: CameraState, to: CameraState): void {
  to.x = from.x
  to.y = from.y
}

/** Runs inside the fixed step, so the motion is identical at any frame rate. */
export function stepCamera(camera: CameraState, target: FollowTarget, dt: number): void {
  let aheadX = target.velocityX * LOOK_AHEAD_TIME
  let aheadY = target.velocityY * LOOK_AHEAD_TIME
  const aheadDistance = Math.hypot(aheadX, aheadY)
  if (aheadDistance > LOOK_AHEAD_MAX) {
    const scale = LOOK_AHEAD_MAX / aheadDistance
    aheadX *= scale
    aheadY *= scale
  }

  const factor = smoothingFactor(FOLLOW_RATE, dt)
  camera.x = lerp(camera.x, target.x + aheadX, factor)
  camera.y = lerp(camera.y, target.y + aheadY, factor)
}

export function createCameraView(): CameraView {
  return { x: 0, y: 0, pixelsPerMeter: PIXELS_PER_METER }
}

/** World metres -> CSS pixels. */
export function worldToScreenX(camera: CameraView, viewport: Viewport, worldX: number): number {
  return (worldX - camera.x) * camera.pixelsPerMeter + viewport.cssWidth / 2
}

export function worldToScreenY(camera: CameraView, viewport: Viewport, worldY: number): number {
  return (worldY - camera.y) * camera.pixelsPerMeter + viewport.cssHeight / 2
}
