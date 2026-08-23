/**
 * Shadows layer: a soft dark ellipse under each car.
 *
 * The offset is fixed in world space (as if the sun sat still above the lot),
 * which is what keeps a flat top-down sprite from looking like a sticker.
 */
import { TAU } from '../../core/constants'
import { inWorldSpace } from '../renderer'
import { SHADOW_ALPHA, SHADOW_OFFSET_X, SHADOW_OFFSET_Y, SHADOW_SCALE } from '../renderConfig'
import type { RenderContext } from '../scene'

export function drawShadows(context: RenderContext): void {
  const { ctx, assets, scene } = context
  if (scene.vehicles.length === 0) return

  inWorldSpace(context, () => {
    for (const vehicle of scene.vehicles) {
      const sprite = assets.sprite(vehicle.spriteKey)
      const halfLength = sprite.lengthMeters * SHADOW_SCALE
      const halfWidth = sprite.widthMeters * SHADOW_SCALE

      ctx.save()
      ctx.translate(vehicle.x + SHADOW_OFFSET_X, vehicle.y + SHADOW_OFFSET_Y)
      ctx.rotate(vehicle.yaw)
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
  })
}
