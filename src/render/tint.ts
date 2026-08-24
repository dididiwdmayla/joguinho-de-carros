/**
 * Recolouring a car sprite, so a row of parked cars is not a row of clones.
 *
 * There is one sedan PNG, one van PNG and so on, and there will only ever be
 * one of each: colour is not worth an asset. What happens instead is that the
 * artwork is repainted once, when the level loads, into an offscreen canvas
 * the renderer then draws like any other sprite.
 *
 * A plain hue rotation would do nothing here -- the parked cars are painted
 * silver, and rotating the hue of grey gives grey. So the pixels are given a
 * hue and a saturation outright, at the lightness they already had. Panels
 * take the new colour, shading and highlights survive because they are the
 * lightness, and glass, tyres and the darkest shadows are left alone: the
 * weight below fades out at both ends of the range so the very dark and the
 * very bright parts of the art are never touched.
 */
import type { LoadedSprite, SpriteTrim } from '../assets/loader'
import type { SpriteBlend } from '../assets/manifest'

/** Anything the world layers can blit: a loaded PNG, or a canvas we painted. */
export interface DrawableSprite {
  readonly image: CanvasImageSource
  /** Extent along the sprite's +X axis [m]. */
  readonly lengthMeters: number
  /** Extent along the sprite's +Y axis [m]. */
  readonly widthMeters: number
  readonly trim: SpriteTrim
  readonly blend: SpriteBlend
}

/** One car's paint: where on the wheel, how strong, how much of it. */
export interface Tint {
  /** 0..1 around the colour wheel. */
  readonly hue: number
  /** 0..1; how colourful the panels become. */
  readonly saturation: number
  /** 0..1; how much of the original colour is replaced. */
  readonly strength: number
}

/** Below this lightness the pixel is glass, tyre or shadow: left as it is. */
const DARK_FLOOR = 0.05
const DARK_CEILING = 0.20
/** And above this it is a highlight, which carries the shape of the bodywork. */
const BRIGHT_FLOOR = 0.86
const BRIGHT_CEILING = 1.0

/** Alpha under which a pixel is padding and not worth touching. */
const ALPHA_FLOOR = 4

function smoothstep(edge0: number, edge1: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)))
  return t * t * (3 - 2 * t)
}

/** Rec. 709 luma, which is what "how light is this pixel" means here. */
function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function hueChannel(p: number, q: number, t: number): number {
  let shifted = t
  if (shifted < 0) shifted += 1
  if (shifted > 1) shifted -= 1
  if (shifted < 1 / 6) return p + (q - p) * 6 * shifted
  if (shifted < 1 / 2) return q
  if (shifted < 2 / 3) return p + (q - p) * (2 / 3 - shifted) * 6
  return p
}

/** HSL -> RGB, every channel 0..1. */
function hslToRgb(hue: number, saturation: number, lightness: number, out: number[]): void {
  if (saturation <= 0) {
    out[0] = lightness
    out[1] = lightness
    out[2] = lightness
    return
  }
  const q =
    lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q
  out[0] = hueChannel(p, q, hue + 1 / 3)
  out[1] = hueChannel(p, q, hue)
  out[2] = hueChannel(p, q, hue - 1 / 3)
}

/**
 * Paints one copy of the sprite in a new colour.
 *
 * Only the trimmed rectangle is copied, so the transparent margin the artwork
 * was authored with is not carried into memory thirty times over. If the
 * browser will not hand the pixels back -- no 2D context, a canvas it
 * considers tainted -- the original sprite is returned untouched: a level full
 * of silver cars is a small loss, a level that fails to load is not.
 */
export function tintSprite(sprite: LoadedSprite, tint: Tint): DrawableSprite {
  const { trim } = sprite
  if (trim.width <= 0 || trim.height <= 0 || tint.strength <= 0) return sprite
  // The level tests build a whole level with no browser around them, and a
  // level of silver cars is exactly as testable as a level of red ones.
  if (typeof document === 'undefined') return sprite

  const canvas = document.createElement('canvas')
  canvas.width = trim.width
  canvas.height = trim.height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx === null) return sprite
  ctx.drawImage(sprite.image, trim.x, trim.y, trim.width, trim.height, 0, 0, trim.width, trim.height)

  let pixels: ImageData
  try {
    pixels = ctx.getImageData(0, 0, trim.width, trim.height)
  } catch (error: unknown) {
    console.warn('[joguinho] nao foi possivel recolorir um sprite', error)
    return sprite
  }

  const data = pixels.data
  const target = [0, 0, 0]
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= ALPHA_FLOOR) continue
    const r = data[i] / 255
    const g = data[i + 1] / 255
    const b = data[i + 2] / 255
    const lightness = luma(r, g, b)

    const weight =
      smoothstep(DARK_FLOOR, DARK_CEILING, lightness) *
      (1 - smoothstep(BRIGHT_FLOOR, BRIGHT_CEILING, lightness))
    if (weight <= 0) continue

    hslToRgb(tint.hue, tint.saturation, lightness, target)
    // HSL lightness is not luma, so the colour that comes back is rescaled
    // until it carries the same light as the pixel it replaces. Without this
    // a blue car comes out darker than the silver one it was painted over.
    const targetLuma = luma(target[0], target[1], target[2])
    const correction = targetLuma > 0.001 ? lightness / targetLuma : 1

    const mix = tint.strength * weight
    data[i] = clampByte((r + (Math.min(1, target[0] * correction) - r) * mix) * 255)
    data[i + 1] = clampByte((g + (Math.min(1, target[1] * correction) - g) * mix) * 255)
    data[i + 2] = clampByte((b + (Math.min(1, target[2] * correction) - b) * mix) * 255)
  }
  ctx.putImageData(pixels, 0, 0)

  return {
    image: canvas,
    lengthMeters: sprite.lengthMeters,
    widthMeters: sprite.widthMeters,
    // The copy is the artwork and nothing else, so its own trim is the whole
    // canvas -- the padding was left behind in the blit above.
    trim: { x: 0, y: 0, width: trim.width, height: trim.height },
    blend: sprite.blend,
  }
}

function clampByte(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : Math.round(value)
}

/**
 * Repaints on demand and remembers the results, so twelve cars sharing four
 * colours cost four canvases. Lives as long as the level does.
 */
export interface TintCache {
  get(sprite: LoadedSprite, tint: Tint): DrawableSprite
}

export function createTintCache(): TintCache {
  const cache = new Map<string, DrawableSprite>()
  return {
    get(sprite: LoadedSprite, tint: Tint): DrawableSprite {
      // Quantised: two hues a degree apart are the same car to anyone looking,
      // and rounding here is what keeps the cache small.
      const key = `${sprite.key}|${Math.round(tint.hue * 360)}|${Math.round(tint.saturation * 100)}|${Math.round(tint.strength * 100)}`
      const existing = cache.get(key)
      if (existing !== undefined) return existing
      const painted = tintSprite(sprite, tint)
      cache.set(key, painted)
      return painted
    },
  }
}
