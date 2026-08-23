/**
 * Asset manifest: the single source of truth that maps every art file to its
 * physical size in metres. Nothing in the game references an image path or a
 * pixel size directly -- the pixel size of a PNG is irrelevant, sprites are
 * always drawn from the metres declared here.
 */

/** A world sprite: drawn with its +X axis along `lengthMeters`. */
export interface SpriteManifestEntry {
  readonly path: string
  /** Extent along the sprite's own +X axis (the car's nose direction) [m]. */
  readonly lengthMeters: number
  /** Extent along the sprite's own +Y axis [m]. */
  readonly widthMeters: number
}

/** A screen-space image (no physical size). */
export interface UiManifestEntry {
  readonly path: string
}

export interface AssetManifest {
  readonly sprites: Readonly<Record<string, SpriteManifestEntry>>
  readonly ui: Readonly<Record<string, UiManifestEntry>>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where}: campo "${field}" deve ser uma string nao vazia`)
  }
  return value
}

function readNumber(source: Record<string, unknown>, field: string, where: string): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${where}: campo "${field}" deve ser um numero positivo`)
  }
  return value
}

function parseManifest(raw: unknown): AssetManifest {
  if (!isRecord(raw)) throw new Error('assets.json: raiz deve ser um objeto')
  const rawSprites = raw['sprites']
  const rawUi = raw['ui']
  if (!isRecord(rawSprites)) throw new Error('assets.json: "sprites" ausente')
  if (!isRecord(rawUi)) throw new Error('assets.json: "ui" ausente')

  const sprites: Record<string, SpriteManifestEntry> = {}
  for (const [key, value] of Object.entries(rawSprites)) {
    const where = `assets.json sprites.${key}`
    if (!isRecord(value)) throw new Error(`${where}: deve ser um objeto`)
    sprites[key] = {
      path: readString(value, 'path', where),
      lengthMeters: readNumber(value, 'lengthMeters', where),
      widthMeters: readNumber(value, 'widthMeters', where),
    }
  }

  const ui: Record<string, UiManifestEntry> = {}
  for (const [key, value] of Object.entries(rawUi)) {
    const where = `assets.json ui.${key}`
    if (!isRecord(value)) throw new Error(`${where}: deve ser um objeto`)
    ui[key] = { path: readString(value, 'path', where) }
  }

  return { sprites, ui }
}

export async function loadManifest(url: string): Promise<AssetManifest> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Falha ao carregar assets.json (HTTP ${response.status})`)
  return parseManifest((await response.json()) as unknown)
}

/**
 * Reverse lookup used by car definitions, which name their art by file path
 * ("cars/player_sedan.png") rather than by manifest key.
 */
export function spriteKeyForPath(manifest: AssetManifest, relativePath: string): string {
  const needle = relativePath.replace(/^\/+/, '')
  for (const [key, entry] of Object.entries(manifest.sprites)) {
    if (entry.path === needle || entry.path.endsWith(`/${needle}`)) return key
  }
  throw new Error(`Nenhum sprite no manifesto para o caminho "${relativePath}"`)
}
