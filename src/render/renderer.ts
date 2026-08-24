/**
 * Layer orchestration.
 *
 * Every frame is drawn as a fixed stack of named layers, each isolated in its
 * own function. Layers that have nothing to draw yet still exist, so the ones
 * that come later slot in without anything else moving.
 */
import { drawCollisionBoxes } from '../debug/boxes'
import { drawDecals } from './layers/decals'
import { drawEffects } from './layers/effects'
import { drawGround } from './layers/ground'
import { drawProps } from './layers/props'
import { drawShadows } from './layers/shadows'
import { drawSkidMarks } from './layers/skidMarks'
import { drawUi } from './layers/ui'
import { drawVehicles } from './layers/vehicles'
import type { RenderContext } from './scene'

export function renderFrame(context: RenderContext): void {
  const { ctx, viewport } = context
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'

  drawGround(context)
  drawDecals(context)
  drawSkidMarks(context)
  drawShadows(context)
  // Scenery first, the player's car over it: the two never really overlap --
  // the collision sees to that -- but when a bumper is a centimetre from a
  // van, the car the player is driving is the one that should be on top.
  drawProps(context)
  drawVehicles(context)
  drawEffects(context)
  // Over the art it is checking and under the panels, which is the only place
  // an outline of a collision box is worth anything.
  if (context.debug !== null && context.debug.boxes !== null) {
    drawCollisionBoxes(context, context.debug.boxes)
  }
  drawUi(context)
}

/**
 * Runs `draw` with the canvas mapped to world space: one unit is one metre,
 * the origin is the camera, +Y is down. Sizes taken from the manifest can be
 * passed straight to drawing calls.
 */
export function inWorldSpace(context: RenderContext, draw: () => void): void {
  const { ctx, viewport, camera } = context
  ctx.save()
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)
  ctx.translate(viewport.cssWidth / 2, viewport.cssHeight / 2)
  ctx.scale(camera.pixelsPerMeter, camera.pixelsPerMeter)
  ctx.translate(-camera.x, -camera.y)
  draw()
  ctx.restore()
}

/** Runs `draw` in CSS pixel space with the origin at the top-left corner. */
export function inScreenSpace(context: RenderContext, draw: () => void): void {
  const { ctx, viewport } = context
  ctx.save()
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)
  draw()
  ctx.restore()
}
