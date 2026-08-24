/**
 * Sprite blitting in metres.
 *
 * Where the picture goes was worked out once, at load time: `quad` is the
 * trimmed artwork's place in metres, positioned so the bodywork inside it is
 * exactly the size the manifest declares and centred on the origin. Anything
 * that sticks out past the bodywork -- a wing mirror, a barrier's foot --
 * hangs off the quad the same way it hangs off the car.
 *
 * Pixel dimensions of the file never reach the screen, and neither does any
 * arithmetic about them: this is a blit and nothing else.
 */
import type { DrawableSprite } from './tint'

/** Draws the sprite centred on the current origin, aligned with +X. */
export function drawSpriteMeters(
  ctx: CanvasRenderingContext2D,
  sprite: DrawableSprite,
  scale = 1,
): void {
  const { trim, quad } = sprite
  ctx.drawImage(
    sprite.image,
    trim.x,
    trim.y,
    trim.width,
    trim.height,
    quad.x * scale,
    quad.y * scale,
    quad.width * scale,
    quad.height * scale,
  )
}
