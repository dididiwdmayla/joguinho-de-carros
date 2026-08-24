/**
 * Shadows layer: a soft dark ellipse under everything tall enough to have one.
 *
 * The offset is fixed in world space (as if the sun sat still above the lot),
 * which is what keeps a flat top-down sprite from looking like a sticker. A
 * painted line has no shadow; a cone has a small one; a van has a van's.
 */
import { TAU } from '../../core/constants'
import { inWorldSpace } from '../renderer'
import { SHADOW_ALPHA, SHADOW_OFFSET_X, SHADOW_OFFSET_Y, SHADOW_SCALE } from '../renderConfig'
import type { DrawableSprite } from '../tint'
import type { RenderContext } from '../scene'
import { visibleWorldBounds, type WorldBounds } from '../viewBounds'

const bounds: WorldBounds = { minX: 0, minY: 0, maxX: 0, maxY: 0 }

export function drawShadows(context: RenderContext): void {
  const { ctx, scene } = context
  if (scene.vehicles.length === 0 && scene.props.length === 0) return
  visibleWorldBounds(context, bounds)

  inWorldSpace(context, () => {
    for (const prop of scene.props) {
      if (!prop.shadow) continue
      drawShadow(ctx, prop.sprite, prop.x, prop.y, prop.yaw)
    }
    for (const vehicle of scene.vehicles) {
      drawShadow(ctx, vehicle.sprite, vehicle.x, vehicle.y, vehicle.yaw)
    }
  })
}

function drawShadow(
  ctx: CanvasRenderingContext2D,
  sprite: DrawableSprite,
  x: number,
  y: number,
  yaw: number,
): void {
  const reach = Math.max(sprite.lengthMeters, sprite.widthMeters)
  if (x + reach < bounds.minX || x - reach > bounds.maxX) return
  if (y + reach < bounds.minY || y - reach > bounds.maxY) return

  const halfLength = sprite.lengthMeters * SHADOW_SCALE
  const halfWidth = sprite.widthMeters * SHADOW_SCALE

  ctx.save()
  ctx.translate(x + SHADOW_OFFSET_X, y + SHADOW_OFFSET_Y)
  ctx.rotate(yaw)
  ctx.scale(halfLength, halfWidth)

  // Radial falloff built in the unit circle, stretched into the footprint
  // by the scale above, so the edge fades instead of cutting.
  const gradient = ctx.createRadialGradient(0, 0, 0.45, 0, 0, 1)
  gradient.addColorStop(0, `rgba(0, 0, 0, ${SHADOW_ALPHA})`)
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0)')
  ctx.fillStyle = gradient
  ctx.beginPath()
  ctx.arc(0, 0, 1, 0, TAU)
  ctx.fill()
  ctx.restore()
}
