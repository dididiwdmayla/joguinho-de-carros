/**
 * Ground layer: repeats the asphalt tile over the viewport.
 *
 * The grid is anchored to the world, not to the screen, so it scrolls with the
 * camera instead of sliding under it. Only the tiles the camera can actually
 * see are drawn.
 */
import { worldToScreenX, worldToScreenY } from '../camera'
import type { RenderContext } from '../scene'

/**
 * Snaps a CSS coordinate onto a whole device pixel. Neighbouring tiles derive
 * their shared edge from the same world coordinate, so they land on exactly
 * the same device pixel and no hairline seam can open between them.
 */
function snapToDevicePixel(value: number, dpr: number): number {
  return Math.round(value * dpr) / dpr
}

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

  const { trim } = tile
  for (let row = firstRow; row < lastRow; row++) {
    const top = snapToDevicePixel(worldToScreenY(camera, viewport, row * tileHeight), viewport.dpr)
    const bottom = snapToDevicePixel(
      worldToScreenY(camera, viewport, (row + 1) * tileHeight),
      viewport.dpr,
    )
    for (let column = firstColumn; column < lastColumn; column++) {
      const left = snapToDevicePixel(
        worldToScreenX(camera, viewport, column * tileWidth),
        viewport.dpr,
      )
      const right = snapToDevicePixel(
        worldToScreenX(camera, viewport, (column + 1) * tileWidth),
        viewport.dpr,
      )
      ctx.drawImage(
        tile.image,
        trim.x,
        trim.y,
        trim.width,
        trim.height,
        left,
        top,
        right - left,
        bottom - top,
      )
    }
  }

  ctx.restore()
}
