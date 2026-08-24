/**
 * Decals: everything painted on or stuck to the asphalt.
 *
 * Two kinds live here. The stains, cracks and manholes are sprites placed by
 * the level file. The bay markings are not sprites at all -- they are drawn as
 * strokes, from the same rectangles the parking test measures against, so a
 * bay is painted exactly where it is rather than wherever a PNG happened to
 * land. Their wear was worked out once, when the level loaded, from the
 * level's own seed: the paint looks weathered and looks the same every time.
 *
 * The target bay is the one thing on screen that answers back. It fills as the
 * hold runs, which is the game saying "yes, this counts" without a readout.
 */
import { PAINT_WIDTH } from '../../level/levelRuntime'
import { inWorldSpace } from '../renderer'
import type { RenderContext, SlotRender } from '../scene'
import { drawSpriteMeters } from '../sprite'

/** The line paint, before its per-segment wear is applied. */
const PAINT_COLOR = '236, 238, 233'
/** The target bay, before the hold starts filling it. */
const TARGET_COLOR = '150, 205, 255'
/** How much of the target bay's fill is there from the start. */
const TARGET_BASE_ALPHA = 0.07
/** And how much it is worth once the hold is complete. */
const TARGET_FULL_ALPHA = 0.3

/** The kerb around the playable area. */
const KERB_COLOR = '#8f959c'
const KERB_EDGE = 'rgba(24, 27, 32, 0.55)'
const KERB_WIDTH = 0.36

export function drawDecals(context: RenderContext): void {
  const { ctx, scene } = context

  inWorldSpace(context, () => {
    for (const decal of scene.decals) {
      const { sprite } = decal
      ctx.save()
      ctx.globalAlpha = decal.alpha
      // Art drawn on white paper is multiplied onto the road instead of
      // pasted over it: the white leaves the asphalt untouched and only the
      // stain lands. Anything authored with transparency blits normally.
      if (sprite.blend === 'multiply') ctx.globalCompositeOperation = 'multiply'
      ctx.translate(decal.x, decal.y)
      ctx.rotate(decal.yaw)
      drawSpriteMeters(ctx, sprite, decal.scale)
      ctx.restore()
    }

    drawKerb(context)
    for (const slot of scene.slots) drawSlot(context, slot)
  })
}

/**
 * The edge of the world, drawn as a kerb. There is a wall out there whether or
 * not anything is painted, and a wall the player cannot see is a wall they
 * will blame the game for.
 */
function drawKerb(context: RenderContext): void {
  const { ctx, scene } = context
  const points = scene.boundary
  if (points.length < 2) return

  ctx.save()
  ctx.beginPath()
  ctx.moveTo(points[0][0], points[0][1])
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i][0], points[i][1])
  ctx.closePath()
  ctx.lineJoin = 'round'
  ctx.strokeStyle = KERB_COLOR
  ctx.lineWidth = KERB_WIDTH
  ctx.stroke()
  // A dark hairline on the inside edge, which is what stops the kerb reading
  // as a strip of light-grey tape.
  ctx.strokeStyle = KERB_EDGE
  ctx.lineWidth = KERB_WIDTH * 0.28
  ctx.stroke()
  ctx.restore()
}

function drawSlot(context: RenderContext, slot: SlotRender): void {
  const { ctx, scene } = context

  if (slot.target) {
    ctx.save()
    ctx.translate(slot.x, slot.y)
    ctx.rotate(slot.angle)
    const alpha =
      TARGET_BASE_ALPHA + (TARGET_FULL_ALPHA - TARGET_BASE_ALPHA) * scene.targetProgress
    ctx.fillStyle = `rgba(${TARGET_COLOR}, ${alpha.toFixed(3)})`
    ctx.fillRect(-slot.length / 2, -slot.width / 2, slot.length, slot.width)
    ctx.restore()
  }

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineWidth = PAINT_WIDTH
  const color = slot.target ? TARGET_COLOR : PAINT_COLOR
  for (const segment of slot.paint) {
    ctx.strokeStyle = `rgba(${color}, ${segment.alpha.toFixed(3)})`
    ctx.beginPath()
    ctx.moveTo(segment.x1, segment.y1)
    ctx.lineTo(segment.x2, segment.y2)
    ctx.stroke()
  }
  ctx.restore()
}
