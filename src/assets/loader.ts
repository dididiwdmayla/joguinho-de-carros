/**
 * Runtime asset loading.
 *
 * Every image is fetched by the path declared in the manifest, so the files
 * under public/assets/ keep their exact URLs in the published build.
 *
 * Sprites are also measured: the PNGs are authored with transparent padding
 * around the artwork, so the loader finds the opaque bounding box once and
 * stores it as the source rect. Drawing that rect at the declared metres is
 * what makes a 4.5 m car actually cover 4.5 m of world.
 */
import type { AssetManifest } from './manifest'

/** Source rectangle inside the image, in image pixels. */
export interface SpriteTrim {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface LoadedSprite {
  readonly key: string
  readonly image: HTMLImageElement
  /** Extent along the sprite's +X axis [m]. */
  readonly lengthMeters: number
  /** Extent along the sprite's +Y axis [m]. */
  readonly widthMeters: number
  readonly trim: SpriteTrim
}

export interface AssetStore {
  sprite(key: string): LoadedSprite
}

/** Alpha below this counts as empty padding (kills soft halos around art). */
const ALPHA_THRESHOLD = 8

function assetUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\/+/, '')}`
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error(`Falha ao carregar imagem: ${url}`))
    image.src = url
  })
}

/**
 * Opaque bounding box of an image. Scans inward from each edge so fully
 * opaque textures (the ground tiles) bail out after a single row/column.
 */
function measureTrim(image: HTMLImageElement): SpriteTrim {
  const width = image.naturalWidth
  const height = image.naturalHeight
  const full: SpriteTrim = { x: 0, y: 0, width, height }
  if (width === 0 || height === 0) return full

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (ctx === null) return full
  ctx.drawImage(image, 0, 0)

  const { data } = ctx.getImageData(0, 0, width, height)
  const alphaAt = (x: number, y: number): number => data[(y * width + x) * 4 + 3] ?? 0

  const rowHasInk = (y: number): boolean => {
    for (let x = 0; x < width; x++) if (alphaAt(x, y) > ALPHA_THRESHOLD) return true
    return false
  }
  const columnHasInk = (x: number, top: number, bottom: number): boolean => {
    for (let y = top; y <= bottom; y++) if (alphaAt(x, y) > ALPHA_THRESHOLD) return true
    return false
  }

  let top = 0
  while (top < height && !rowHasInk(top)) top++
  if (top === height) return full // fully transparent: keep the whole frame

  let bottom = height - 1
  while (bottom > top && !rowHasInk(bottom)) bottom--

  let left = 0
  while (left < width && !columnHasInk(left, top, bottom)) left++

  let right = width - 1
  while (right > left && !columnHasInk(right, top, bottom)) right--

  return { x: left, y: top, width: right - left + 1, height: bottom - top + 1 }
}

/**
 * Loads the sprites named by `keys`. Only what the current stage draws is
 * fetched; every other entry stays in the manifest waiting for its stage.
 */
export async function loadSprites(manifest: AssetManifest, keys: readonly string[]): Promise<AssetStore> {
  const loaded = new Map<string, LoadedSprite>()

  await Promise.all(
    keys.map(async (key) => {
      const entry = manifest.sprites[key]
      if (entry === undefined) throw new Error(`Sprite "${key}" nao existe no manifesto`)
      const image = await loadImage(assetUrl(entry.path))
      loaded.set(key, {
        key,
        image,
        lengthMeters: entry.lengthMeters,
        widthMeters: entry.widthMeters,
        trim: measureTrim(image),
      })
    }),
  )

  return {
    sprite(key: string): LoadedSprite {
      const sprite = loaded.get(key)
      if (sprite === undefined) throw new Error(`Sprite "${key}" nao foi carregado`)
      return sprite
    },
  }
}
