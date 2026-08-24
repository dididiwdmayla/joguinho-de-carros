/**
 * What the camera can see, in world metres.
 *
 * Every layer that draws a list of things longer than the screen asks for this
 * and skips what is outside it. Written into a caller-owned rectangle rather
 * than returned, so culling a hundred props costs no allocation at all.
 */
import type { RenderContext } from './scene'

export interface WorldBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export function visibleWorldBounds(context: RenderContext, out: WorldBounds): void {
  const { viewport, camera } = context
  const halfWidth = viewport.cssWidth / 2 / camera.pixelsPerMeter
  const halfHeight = viewport.cssHeight / 2 / camera.pixelsPerMeter
  out.minX = camera.x - halfWidth
  out.maxX = camera.x + halfWidth
  out.minY = camera.y - halfHeight
  out.maxY = camera.y + halfHeight
}
