/**
 * Vehicles layer.
 *
 * Bodies come from sprites, wheels are drawn in code underneath them: the
 * bodywork covers most of each tyre and only the sliver that clears the
 * silhouette shows, which is what a real car looks like from directly above
 * and is what makes the steering angle readable without shouting.
 *
 * Nothing outside this file depends on how any of it is drawn: the layer only
 * reads the pose and the sizes it is handed.
 */
import { inWorldSpace } from '../renderer'
import { WHEEL_COLOR, WHEEL_CORNER_FRACTION } from '../renderConfig'
import type { RenderContext, VehicleRenderState } from '../scene'
import { roundedRectPath } from '../shapes'
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
      drawWheels(ctx, vehicle)
      drawSpriteMeters(ctx, sprite)
      ctx.restore()
    }
  })
}

/** All four tyres: the front pair steered, the rear pair square to the body. */
function drawWheels(ctx: CanvasRenderingContext2D, vehicle: VehicleRenderState): void {
  const halfTrack = vehicle.trackWidth / 2
  ctx.fillStyle = WHEEL_COLOR
  for (const side of [-1, 1]) {
    drawWheel(ctx, vehicle, vehicle.frontAxleOffset, side * halfTrack, vehicle.steer)
    drawWheel(ctx, vehicle, -vehicle.rearAxleOffset, side * halfTrack, 0)
  }
}

function drawWheel(
  ctx: CanvasRenderingContext2D,
  vehicle: VehicleRenderState,
  offsetX: number,
  offsetY: number,
  angle: number,
): void {
  ctx.save()
  ctx.translate(offsetX, offsetY)
  ctx.rotate(angle)
  roundedRectPath(
    ctx,
    -vehicle.wheelDiameter / 2,
    -vehicle.wheelWidth / 2,
    vehicle.wheelDiameter,
    vehicle.wheelWidth,
    vehicle.wheelWidth * WHEEL_CORNER_FRACTION,
  )
  ctx.fill()
  ctx.restore()
}
