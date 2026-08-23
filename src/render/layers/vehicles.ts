/**
 * Vehicles layer.
 *
 * Bodies come from sprites, front wheels are drawn in code so the steering
 * angle is visible. Nothing outside this file depends on how any of it is
 * drawn: the layer only reads the pose and the sizes it is handed.
 */
import { inWorldSpace } from '../renderer'
import {
  WHEEL_COLOR,
  WHEEL_CORNER_RADIUS,
  WHEEL_LENGTH,
  WHEEL_TRACK_FRACTION,
  WHEEL_WIDTH,
} from '../renderConfig'
import type { RenderContext, VehicleRenderState } from '../scene'
import { drawSpriteMeters } from '../sprite'

export function drawVehicles(context: RenderContext): void {
  const { ctx, assets, scene } = context
  if (scene.vehicles.length === 0) return

  inWorldSpace(context, () => {
    for (const vehicle of scene.vehicles) {
      const sprite = assets.sprite(vehicle.spriteKey)
      ctx.save()
      // Rotate about the centre of gravity, which is where the physics puts
      // the body's origin.
      ctx.translate(vehicle.x, vehicle.y)
      ctx.rotate(vehicle.yaw)
      drawSpriteMeters(ctx, sprite)
      drawFrontWheels(ctx, vehicle)
      ctx.restore()
    }
  })
}

/** Two steered rectangles on the front axle. Rear wheels stay hidden. */
function drawFrontWheels(ctx: CanvasRenderingContext2D, vehicle: VehicleRenderState): void {
  const halfTrack = (vehicle.bodyWidth * WHEEL_TRACK_FRACTION) / 2
  ctx.fillStyle = WHEEL_COLOR
  for (const side of [-1, 1]) {
    ctx.save()
    ctx.translate(vehicle.frontAxleOffset, side * halfTrack)
    ctx.rotate(vehicle.steer)
    ctx.beginPath()
    ctx.roundRect(
      -WHEEL_LENGTH / 2,
      -WHEEL_WIDTH / 2,
      WHEEL_LENGTH,
      WHEEL_WIDTH,
      WHEEL_CORNER_RADIUS,
    )
    ctx.fill()
    ctx.restore()
  }
}
