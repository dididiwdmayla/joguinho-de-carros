/**
 * Sprite blitting in metres.
 *
 * The PNGs carry transparent padding, so the opaque box measured at load time
 * is the source rect. The destination is always the size declared in the
 * manifest -- pixel dimensions of the file never reach the screen.
 */
import type { LoadedSprite } from '../assets/loader'

/** Draws the sprite centred on the current origin, aligned with +X. */
export function drawSpriteMeters(ctx: CanvasRenderingContext2D, sprite: LoadedSprite): void {
  const { trim } = sprite
  ctx.drawImage(
    sprite.image,
    trim.x,
    trim.y,
    trim.width,
    trim.height,
    -sprite.lengthMeters / 2,
    -sprite.widthMeters / 2,
    sprite.lengthMeters,
    sprite.widthMeters,
  )
}
