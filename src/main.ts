/**
 * Bootstrap: load the data, wire the pieces together, start the loop.
 *
 * Both JSON files live in src/data and are fetched at runtime by URL, so the
 * numbers that define the world are never baked into the code.
 */
import manifestUrl from './data/assets.json?url'
import playerSedanUrl from './data/cars/player_sedan.json?url'

import { loadSprites } from './assets/loader'
import { loadManifest, spriteKeyForPath } from './assets/manifest'
import { drawBootMessage } from './game/bootScreen'
import { startGame } from './game/game'
import { createGameState } from './game/state'
import { InputManager } from './input/InputManager'
import { createViewport } from './render/viewport'
import { loadCarParams } from './vehicle/carParams'

/** The world this stage drives on. */
const GROUND_SPRITE_KEY = 'asphalt_tile'

async function boot(): Promise<void> {
  const canvas = document.getElementById('game')
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas #game nao encontrado')

  const ctx = canvas.getContext('2d', { alpha: false })
  if (ctx === null) throw new Error('Canvas 2D nao disponivel neste navegador')

  const viewport = createViewport()
  drawBootMessage(canvas, ctx, viewport, 'carregando...', '#8b98a5')

  const manifest = await loadManifest(manifestUrl)
  const car = await loadCarParams(playerSedanUrl, 'player_sedan.json')
  const playerSpriteKey = spriteKeyForPath(manifest, car.sprite)
  const assets = await loadSprites(manifest, [playerSpriteKey, GROUND_SPRITE_KEY])

  const input = new InputManager(canvas)
  input.attach()

  const state = createGameState({
    canvas,
    ctx,
    assets,
    input,
    car,
    playerSpriteKey,
    groundSpriteKey: GROUND_SPRITE_KEY,
  })
  startGame(state)
}

boot().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(error)
  const canvas = document.getElementById('game')
  if (canvas instanceof HTMLCanvasElement) {
    const ctx = canvas.getContext('2d', { alpha: false })
    if (ctx !== null) drawBootMessage(canvas, ctx, createViewport(), `erro: ${message}`, '#e2686d')
  }
})
