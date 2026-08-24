/**
 * Ground layer: the paved area of the lot, and the void beyond it.
 *
 * The grid is anchored to the world, not to the screen, so it scrolls with the
 * camera instead of sliding under it. Only the tiles the camera can actually
 * see are drawn, and only inside the rectangle the level says is paved -- a
 * car park has an edge, and asphalt that carried on forever would leave the
 * kerb looking like a line painted in the middle of nowhere.
 *
 * Every edge is placed at its exact fractional position and never rounded. The
 * ground has to advance by the same continuous amount the car does: rounding
 * only one of the two makes the asphalt step from whole pixel to whole pixel
 * while the car slides between them, and at a walking pace that difference --
 * up to half a pixel, changing sign every few frames -- is exactly the shiver
 * you see under a slow-moving car.
 *
 * The seam that rounding used to close is closed another way: each tile is
 * drawn one device pixel wider and taller than its cell, so it bleeds under
 * its right and bottom neighbours, which are drawn after it and cover the
 * overlap. The pixel straddling a boundary is then a blend of two neighbouring
 * asphalt texels instead of a gap with the void colour showing through.
 */
import { worldToScreenX, worldToScreenY } from '../camera'
import { VOID_COLOR } from '../renderConfig'
import type { RenderContext } from '../scene'

export function drawGround(context: RenderContext): void {
  const { ctx, viewport, camera, scene } = context

  ctx.save()
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)
  ctx.fillStyle = VOID_COLOR
  ctx.fillRect(0, 0, viewport.cssWidth, viewport.cssHeight)

  const ground = scene.ground
  if (ground === null) {
    ctx.restore()
    return
  }

  const tile = ground.sprite
  const tileWidth = tile.lengthMeters
  const tileHeight = tile.widthMeters

  // Visible world rectangle, in metres, clipped to what is actually paved.
  const halfWidth = viewport.cssWidth / 2 / camera.pixelsPerMeter
  const halfHeight = viewport.cssHeight / 2 / camera.pixelsPerMeter
  const leftMeters = Math.max(camera.x - halfWidth, ground.x)
  const rightMeters = Math.min(camera.x + halfWidth, ground.x + ground.width)
  const topMeters = Math.max(camera.y - halfHeight, ground.y)
  const bottomMeters = Math.min(camera.y + halfHeight, ground.y + ground.height)
  if (rightMeters <= leftMeters || bottomMeters <= topMeters) {
    ctx.restore()
    return
  }

  // Clipped to the paved rectangle so the tiles at the edge are cut where the
  // lot ends rather than a tile later.
  const clipLeft = worldToScreenX(camera, viewport, ground.x)
  const clipTop = worldToScreenY(camera, viewport, ground.y)
  const clipRight = worldToScreenX(camera, viewport, ground.x + ground.width)
  const clipBottom = worldToScreenY(camera, viewport, ground.y + ground.height)
  ctx.beginPath()
  ctx.rect(clipLeft, clipTop, clipRight - clipLeft, clipBottom - clipTop)
  ctx.clip()

  // Tiles are laid out from the lot's own corner, so the pattern lines up with
  // the paving rather than with the world origin.
  const firstColumn = Math.floor((leftMeters - ground.x) / tileWidth)
  const lastColumn = Math.ceil((rightMeters - ground.x) / tileWidth)
  const firstRow = Math.floor((topMeters - ground.y) / tileHeight)
  const lastRow = Math.ceil((bottomMeters - ground.y) / tileHeight)

  // One device pixel, expressed in the CSS units this transform draws in.
  // Anything less can leave a boundary pixel only partly covered.
  const bleed = 1 / viewport.dpr

  // Row by row, left to right: a tile only ever bleeds towards neighbours that
  // have not been drawn yet, so every overlap ends up covered.
  const { trim } = tile
  for (let row = firstRow; row < lastRow; row++) {
    const top = worldToScreenY(camera, viewport, ground.y + row * tileHeight)
    const bottom = worldToScreenY(camera, viewport, ground.y + (row + 1) * tileHeight)
    for (let column = firstColumn; column < lastColumn; column++) {
      const left = worldToScreenX(camera, viewport, ground.x + column * tileWidth)
      const right = worldToScreenX(camera, viewport, ground.x + (column + 1) * tileWidth)
      ctx.drawImage(
        tile.image,
        trim.x,
        trim.y,
        trim.width,
        trim.height,
        left,
        top,
        right - left + bleed,
        bottom - top + bleed,
      )
    }
  }

  ctx.restore()
}
