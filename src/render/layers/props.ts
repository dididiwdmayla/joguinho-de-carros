/**
 * Props: the parked cars, cones, planters and barriers a level is furnished
 * with. Every one of them is a static box in the collision world, and the pose
 * drawn here is the pose that box has -- there is one number, placed once when
 * the level loaded, and both read it.
 *
 * Anything the camera cannot see is skipped. A lot with thirty cars in it is
 * mostly off screen at any moment, and the cheapest sprite is one that is
 * never blitted.
 */
import { inWorldSpace } from '../renderer'
import type { RenderContext } from '../scene'
import { drawSpriteMeters } from '../sprite'
import { visibleWorldBounds, type WorldBounds } from '../viewBounds'

const bounds: WorldBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

export function drawProps(context: RenderContext): void {
  const { ctx, scene } = context
  if (scene.props.length === 0) return
  visibleWorldBounds(context, bounds)

  inWorldSpace(context, () => {
    for (const prop of scene.props) {
      const reach = Math.max(prop.sprite.lengthMeters, prop.sprite.widthMeters) / 2
      if (
        prop.x + reach < bounds.minX ||
        prop.x - reach > bounds.maxX ||
        prop.y + reach < bounds.minY ||
        prop.y - reach > bounds.maxY
      ) {
        continue
      }
      ctx.save()
      ctx.translate(prop.x, prop.y)
      ctx.rotate(prop.yaw)
      drawSpriteMeters(ctx, prop.sprite)
      ctx.restore()
    }
  })
}
