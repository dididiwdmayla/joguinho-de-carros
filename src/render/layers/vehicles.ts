/**
 * Vehicles layer: the car the player is driving.
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
import type { RenderContext, WheelRender } from '../scene'
import { roundedRectPath } from '../shapes'
import { drawSpriteMeters } from '../sprite'

export function drawVehicles(context: RenderContext): void {
  const { ctx, scene } = context
  if (scene.vehicles.length === 0) return

  inWorldSpace(context, () => {
    for (const vehicle of scene.vehicles) {
      ctx.save()
      // Rotate about the centre of gravity, which is where the physics puts
      // the body's origin.
      ctx.translate(vehicle.x, vehicle.y)
      ctx.rotate(vehicle.yaw)
      if (vehicle.wheels !== null) drawWheels(ctx, vehicle.wheels)
      drawSpriteMeters(ctx, vehicle.sprite)
      ctx.restore()
    }
  })
}

/** All four tyres: the front pair steered, the rear pair square to the body. */
function drawWheels(ctx: CanvasRenderingContext2D, wheels: WheelRender): void {
  const halfTrack = wheels.trackWidth / 2
  ctx.fillStyle = WHEEL_COLOR
  for (const side of [-1, 1]) {
    drawWheel(ctx, wheels, wheels.frontAxleOffset, side * halfTrack, wheels.steer)
    drawWheel(ctx, wheels, -wheels.rearAxleOffset, side * halfTrack, 0)
  }
}

function drawWheel(
  ctx: CanvasRenderingContext2D,
  wheels: WheelRender,
  offsetX: number,
  offsetY: number,
  angle: number,
): void {
  ctx.save()
  ctx.translate(offsetX, offsetY)
  ctx.rotate(angle)
  roundedRectPath(
    ctx,
    -wheels.wheelDiameter / 2,
    -wheels.wheelWidth / 2,
    wheels.wheelDiameter,
    wheels.wheelWidth,
    wheels.wheelWidth * WHEEL_CORNER_FRACTION,
  )
  ctx.fill()
  ctx.restore()
}
