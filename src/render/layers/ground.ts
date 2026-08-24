/**
 * Ground layer: repeats the asphalt tile over the viewport.
 *
 * The grid is anchored to the world, not to the screen, so it scrolls with the
 * camera instead of sliding under it. Only the tiles the camera can actually
 * see are drawn.
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
import type { RenderContext } from '../scene'

export function drawGround(context: RenderContext): void {
  const { ctx, viewport, camera, assets, scene } = context
  const tile = assets.sprite(scene.groundSpriteKey)
  const tileWidth = tile.lengthMeters
  const tileHeight = tile.widthMeters

  ctx.save()
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)

  // Visible world rectangle, in metres.
  const halfWidth = viewport.cssWidth / 2 / camera.pixelsPerMeter
  const halfHeight = viewport.cssHeight / 2 / camera.pixelsPerMeter
  const firstColumn = Math.floor((camera.x - halfWidth) / tileWidth)
  const lastColumn = Math.ceil((camera.x + halfWidth) / tileWidth)
  const firstRow = Math.floor((camera.y - halfHeight) / tileHeight)
  const lastRow = Math.ceil((camera.y + halfHeight) / tileHeight)

  // One device pixel, expressed in the CSS units this transform draws in.
  // Anything less can leave a boundary pixel only partly covered.
  const bleed = 1 / viewport.dpr

  // Row by row, left to right: a tile only ever bleeds towards neighbours that
  // have not been drawn yet, so every overlap ends up covered.
  const { trim } = tile
  for (let row = firstRow; row < lastRow; row++) {
    const top = worldToScreenY(camera, viewport, row * tileHeight)
    const bottom = worldToScreenY(camera, viewport, (row + 1) * tileHeight)
    for (let column = firstColumn; column < lastColumn; column++) {
      const left = worldToScreenX(camera, viewport, column * tileWidth)
      const right = worldToScreenX(camera, viewport, (column + 1) * tileWidth)
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
