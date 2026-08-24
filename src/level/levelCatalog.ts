/**
 * Every level there is, loaded once at boot.
 *
 * The five files are small -- a few kilobytes between them -- so they are all
 * fetched up front rather than one at a time. That buys two things: the level
 * list can show what each level is before anybody has chosen one, and
 * choosing one is instant, with no download between the press and the car.
 *
 * The order of this list is the order of the levels, and the difficulty curve
 * is the order. Nothing else decides it.
 */
import level01Url from '../data/levels/01-vaga-isolada.json?url'
import level02Url from '../data/levels/02-entre-dois-carros.json?url'
import level03Url from '../data/levels/03-baliza-tranquila.json?url'
import level04Url from '../data/levels/04-van-e-pickup.json?url'
import level05Url from '../data/levels/05-baliza-apertada.json?url'

import type { AssetManifest } from '../assets/manifest'
import { levelSpriteKeys, parseLevel, validateLevelSprites, type LevelDefinition } from './levelSchema'

interface CatalogEntry {
  readonly url: string
  /** File name, so a parse error says which file. */
  readonly where: string
}

const CATALOG: readonly CatalogEntry[] = [
  { url: level01Url, where: '01-vaga-isolada.json' },
  { url: level02Url, where: '02-entre-dois-carros.json' },
  { url: level03Url, where: '03-baliza-tranquila.json' },
  { url: level04Url, where: '04-van-e-pickup.json' },
  { url: level05Url, where: '05-baliza-apertada.json' },
]

/**
 * Fetches and validates every level. Throws with the file named on the first
 * one that is wrong, which is the whole point of doing this at boot: a level
 * with a typo must fail on the loading screen, not two menus later.
 */
export async function loadLevels(manifest: AssetManifest): Promise<LevelDefinition[]> {
  const levels = await Promise.all(
    CATALOG.map(async (entry) => {
      const response = await fetch(entry.url)
      if (!response.ok) {
        throw new Error(`Falha ao carregar ${entry.where} (HTTP ${response.status})`)
      }
      const level = parseLevel((await response.json()) as unknown, entry.where)
      validateLevelSprites(level, manifest)
      return level
    }),
  )

  const seen = new Set<string>()
  for (const level of levels) {
    if (seen.has(level.id)) throw new Error(`Duas fases com o mesmo id: "${level.id}"`)
    seen.add(level.id)
  }
  return levels
}

/** Every sprite every level asks for, so the boot can fetch them in one go. */
export function spriteKeysForLevels(levels: readonly LevelDefinition[]): string[] {
  const keys = new Set<string>()
  for (const level of levels) for (const key of levelSpriteKeys(level)) keys.add(key)
  return [...keys]
}
