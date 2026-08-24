/**
 * Runtime asset loading.
 *
 * Every image is fetched by the path declared in the manifest, so the files
 * under public/assets/ keep their exact URLs in the published build.
 *
 * Sprites are also measured, and the measurement is the reason this file
 * exists. The PNGs are authored with transparent padding, and the artwork
 * inside that padding has bits that stick out past the object itself -- wing
 * mirrors, a barrier's feet. The metres in the manifest describe the object:
 * a sedan is 4.5 m long and 1.8 m wide across the bodywork.
 *
 * So the loader finds two rectangles (see spriteBounds.ts) and works out, once,
 * where the whole picture has to land for the bodywork inside it to come out at
 * exactly those metres. That rectangle is `quad`, in metres about the sprite's
 * centre, and drawing it is all any layer has to do. What follows is that the
 * collision box built from the same manifest metres lands exactly on the
 * bodywork the player can see.
 */
import type { AssetManifest, SpriteBlend } from './manifest'
import { measureSpriteBounds, type PixelBox, type SpriteBounds } from './spriteBounds'

/** Source rectangle inside the image, in image pixels. */
export type SpriteTrim = PixelBox

/**
 * Where a sprite's source rectangle lands, in metres, relative to the centre
 * it is drawn about. Not centred on the origin in general: it is the bodywork
 * that is centred, and the mirrors hang off whichever side they are on.
 */
export interface SpriteQuad {
  /** Left edge, relative to the sprite's centre [m]. */
  readonly x: number
  /** Top edge, relative to the sprite's centre [m]. */
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface LoadedSprite {
  readonly key: string
  readonly image: HTMLImageElement
  /** Extent of the bodywork along the sprite's +X axis [m]. */
  readonly lengthMeters: number
  /** Extent of the bodywork along the sprite's +Y axis [m]. */
  readonly widthMeters: number
  /** Everything that is not padding: what gets blitted. */
  readonly trim: SpriteTrim
  /** Where `trim` lands, in metres about the centre of the bodywork. */
  readonly quad: SpriteQuad
  /** How it is laid onto the canvas; see the manifest. */
  readonly blend: SpriteBlend
}

/** A loaded screen-space image: the same trimming as a sprite, no physical size. */
export interface LoadedUiImage {
  readonly key: string
  readonly image: HTMLImageElement
  readonly trim: SpriteTrim
}

export interface AssetStore {
  sprite(key: string): LoadedSprite
  ui(key: string): LoadedUiImage
}

/** An image that never fires load or error would hang the boot forever. */
const IMAGE_TIMEOUT_MS = 10_000

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    // Every ending is handled: loaded, failed, or simply never answered. A
    // missing error handler is how a single broken file hangs a Promise.all
    // for good.
    const timer = window.setTimeout(() => {
      settle(() => reject(new Error(`Tempo esgotado (10s) carregando ${url}`)))
    }, IMAGE_TIMEOUT_MS)

    const settle = (finish: () => void): void => {
      window.clearTimeout(timer)
      image.onload = null
      image.onerror = null
      finish()
    }

    image.decoding = 'async'
    image.onload = () => {
      settle(() => {
        if (image.naturalWidth === 0 || image.naturalHeight === 0) {
          reject(new Error(`Imagem vazia ou corrompida: ${url}`))
          return
        }
        resolve(image)
      })
    }
    image.onerror = () => {
      settle(() => reject(new Error(`Falha ao carregar imagem: ${url}`)))
    }
    image.src = url
  })
}

/**
 * Pulls the pixels out of an image and measures them. Losing the measurement
 * only makes the sprite sit inside its own padding; it must never take the
 * whole boot down with it.
 */
function measureImage(image: HTMLImageElement): SpriteBounds {
  const width = image.naturalWidth
  const height = image.naturalHeight
  const whole: PixelBox = { x: 0, y: 0, width, height }
  if (width === 0 || height === 0) return { trim: whole, body: whole }

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx === null) return { trim: whole, body: whole }
  ctx.drawImage(image, 0, 0)

  try {
    return measureSpriteBounds(ctx.getImageData(0, 0, width, height).data, width, height)
  } catch (error: unknown) {
    console.warn(`Nao foi possivel medir o recorte de ${image.src}`, error)
    return { trim: whole, body: whole }
  }
}

/**
 * Where the trimmed picture lands so that the bodywork inside it comes out at
 * the declared metres, centred on the origin.
 *
 * The two axes get their own scale. That is deliberate: the manifest is the
 * authority on how big a car is, and art whose proportions disagree with it by
 * a few per cent is stretched to obey rather than allowed to quietly hand the
 * physics a different car from the one on screen.
 */
export function spriteQuad(
  bounds: SpriteBounds,
  lengthMeters: number,
  widthMeters: number,
): SpriteQuad {
  const { trim, body } = bounds
  const metersPerPixelX = body.width > 0 ? lengthMeters / body.width : 0
  const metersPerPixelY = body.height > 0 ? widthMeters / body.height : 0
  const centerX = body.x + body.width / 2
  const centerY = body.y + body.height / 2
  return {
    x: (trim.x - centerX) * metersPerPixelX,
    y: (trim.y - centerY) * metersPerPixelY,
    width: trim.width * metersPerPixelX,
    height: trim.height * metersPerPixelY,
  }
}

/**
 * Loads the sprites and UI images named by `spriteKeys`/`uiKeys`. Only what
 * the current stage draws is fetched; every other entry stays in the
 * manifest waiting for its stage.
 */
export async function loadAssets(
  manifest: AssetManifest,
  spriteKeys: readonly string[],
  uiKeys: readonly string[],
): Promise<AssetStore> {
  const sprites = new Map<string, LoadedSprite>()
  const ui = new Map<string, LoadedUiImage>()

  await Promise.all([
    ...spriteKeys.map(async (key) => {
      const entry = manifest.sprites[key]
      if (entry === undefined) throw new Error(`Sprite "${key}" nao existe no manifesto`)
      const image = await loadImage(assetUrl(entry.path))
      const bounds = measureImage(image)
      sprites.set(key, {
        key,
        image,
        lengthMeters: entry.lengthMeters,
        widthMeters: entry.widthMeters,
        trim: bounds.trim,
        quad: spriteQuad(bounds, entry.lengthMeters, entry.widthMeters),
        blend: entry.blend,
      })
    }),
    ...uiKeys.map(async (key) => {
      const entry = manifest.ui[key]
      if (entry === undefined) throw new Error(`Imagem de UI "${key}" nao existe no manifesto`)
      const image = await loadImage(assetUrl(entry.path))
      ui.set(key, { key, image, trim: measureImage(image).trim })
    }),
  ])

  return {
    sprite(key: string): LoadedSprite {
      const sprite = sprites.get(key)
      if (sprite === undefined) throw new Error(`Sprite "${key}" nao foi carregado`)
      return sprite
    },
    ui(key: string): LoadedUiImage {
      const image = ui.get(key)
      if (image === undefined) throw new Error(`Imagem de UI "${key}" nao foi carregada`)
      return image
    },
  }
}
