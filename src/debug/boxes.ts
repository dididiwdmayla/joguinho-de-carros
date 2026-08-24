/**
 * The collision boxes, drawn over the art.
 *
 * There is no other way to settle the question this answers. A car that stops
 * a hand's width short of a van looks exactly like a car that stopped where it
 * should if you are looking at the van; the only way to know is to see the two
 * rectangles the physics is actually testing, on top of the two pictures the
 * player is actually looking at, and check that they are the same shape in the
 * same place.
 *
 * Everything here is stroked, never filled, and the line width is in metres so
 * it thins out as the camera pulls back: an outline that stays a fixed number
 * of pixels wide starts covering up the very edge it was drawn to show.
 */
import { obbCorners, type Obb } from '../collision/obb'
import type { BodyKind } from '../collision/world'
import { inWorldSpace } from '../render/renderer'
import type { RenderContext } from '../render/scene'
import type { DebugBoxes } from './debugFrame'

/** A colour per kind, so a wall is never mistaken for a parked car. */
const COLORS: Record<BodyKind, string> = {
  carro: 'rgba(120, 220, 255, 0.95)',
  obstaculo: 'rgba(255, 196, 92, 0.95)',
  muro: 'rgba(255, 110, 140, 0.85)',
}

/** The car the player is driving, which is the one being checked against. */
const PLAYER_COLOR = 'rgba(140, 255, 170, 0.95)'

/** Outline width [m]. About a painted line, which reads at any zoom. */
const STROKE_WIDTH = 0.06

/** Reused every frame: eight numbers, four corners, no allocation. */
const corners = [0, 0, 0, 0, 0, 0, 0, 0]

export function drawCollisionBoxes(context: RenderContext, boxes: DebugBoxes): void {
  const { ctx } = context

  inWorldSpace(context, () => {
    ctx.save()
    ctx.lineWidth = STROKE_WIDTH
    ctx.lineJoin = 'round'

    for (const body of boxes.bodies) {
      ctx.strokeStyle = COLORS[body.kind]
      strokeBox(ctx, body.box)
    }

    // The player's box last and with its axis drawn: on top of everything, and
    // told apart from the scenery at a glance.
    ctx.strokeStyle = PLAYER_COLOR
    strokeBox(ctx, boxes.player)
    strokeNose(ctx, boxes.player)

    ctx.restore()
  })
}

function strokeBox(ctx: CanvasRenderingContext2D, box: Obb): void {
  obbCorners(box, corners)
  ctx.beginPath()
  ctx.moveTo(corners[0], corners[1])
  ctx.lineTo(corners[2], corners[3])
  ctx.lineTo(corners[4], corners[5])
  ctx.lineTo(corners[6], corners[7])
  ctx.closePath()
  ctx.stroke()
}

/** A line from the centre to the middle of the front face: which way is forward. */
function strokeNose(ctx: CanvasRenderingContext2D, box: Obb): void {
  ctx.beginPath()
  ctx.moveTo(box.x, box.y)
  ctx.lineTo(box.x + box.cos * box.halfLength, box.y + box.sin * box.halfLength)
  ctx.stroke()
}
