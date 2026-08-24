/**
 * Bootstrap: load the data, wire the pieces together, start the loop.
 *
 * Every JSON file lives in src/data and is fetched at runtime by URL, so the
 * numbers that define the world are never baked into the code.
 *
 * Every stage is wrapped: nothing here may fail in silence. A rejected
 * promise, a missing file or a stage that simply never answers all end up as
 * readable text on the canvas, naming what was being loaded.
 */
import manifestUrl from './data/assets.json?url'
import engineAudioUrl from './data/audio/engine.json?url'
import playerSedanUrl from './data/cars/player_sedan.json?url'
import fuelsUrl from './data/fuels.json?url'

import { loadEngineAudioParams } from './audio/audioParams'
import { createEngineAudio, resumeEngineAudio, setEngineAudioAudible } from './audio/engineAudio'
import { loadAssets } from './assets/loader'
import { loadManifest, spriteKeyForPath } from './assets/manifest'
import { describeError, drawBootMessage } from './game/bootScreen'
import { startGame } from './game/game'
import { createGameState } from './game/state'
import { InputManager } from './input/InputManager'
import { createViewport, type Viewport } from './render/viewport'
import { isFullscreen, lockLandscape, onFullscreenChange, toggleFullscreen } from './ui/fullscreen'
import { loadControlConfig } from './ui/controlLayout'
import { GEAR_GATE_KEY, GEAR_KNOB_KEY, STEERING_WHEEL_KEY } from './ui/touchLayout'
import { createUiState, prefersTouchControls } from './ui/uiState'
import { loadVehicleSettings } from './ui/vehicleSettings'
import { loadCarParams } from './vehicle/carParams'
import { applyFuel, loadFuelCatalog, resolveFuel } from './vehicle/fuel'

/** The world this stage drives on. */
const GROUND_SPRITE_KEY = 'asphalt_tile'

/** Nothing in the boot may take longer than this before it is called failed. */
const BOOT_TIMEOUT_MS = 10_000

interface Screen {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  viewport: Viewport
}

/** Rejects with a message naming the stage instead of hanging forever. */
function withTimeout<T>(work: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(`Tempo esgotado (${BOOT_TIMEOUT_MS / 1000}s) em: ${label}`))
    }, BOOT_TIMEOUT_MS)
    work.then(
      (value) => {
        window.clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        window.clearTimeout(timer)
        reject(error instanceof Error ? error : new Error(String(error)))
      },
    )
  })
}

function openScreen(): Screen {
  const canvas = document.getElementById('game')
  if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Canvas #game nao encontrado')
  const ctx = canvas.getContext('2d', { alpha: false })
  if (ctx === null) throw new Error('Canvas 2D nao disponivel neste navegador')
  return { canvas, ctx, viewport: createViewport() }
}

function showFailure(surface: Screen | null, stage: string, error: unknown): void {
  console.error(`[joguinho] falha em ${stage}`, error)
  if (surface === null) return
  try {
    drawBootMessage(
      surface.canvas,
      surface.ctx,
      surface.viewport,
      ['falhou:', stage, ...describeError(error)],
      '#e2686d',
    )
  } catch (paintError: unknown) {
    console.error('[joguinho] nao foi possivel pintar o erro', paintError)
  }
}

async function boot(surface: Screen): Promise<void> {
  drawBootMessage(surface.canvas, surface.ctx, surface.viewport, ['carregando...'], '#8b98a5')

  const manifest = await withTimeout(loadManifest(manifestUrl), 'manifesto de assets (assets.json)')
  const carBase = await withTimeout(
    loadCarParams(playerSedanUrl, 'player_sedan.json'),
    'parametros do carro (player_sedan.json)',
  )
  const fuels = await withTimeout(
    loadFuelCatalog(fuelsUrl, 'fuels.json'),
    'tipos de combustivel (fuels.json)',
  )
  const playerSpriteKey = spriteKeyForPath(manifest, carBase.sprite)
  const assets = await withTimeout(
    loadAssets(
      manifest,
      [playerSpriteKey, GROUND_SPRITE_KEY],
      // The wheel is fetched whether or not it is the steering in use: it can
      // be switched on mid-game, and a control that has to wait for a download
      // before it answers is a control that feels broken.
      [GEAR_GATE_KEY, GEAR_KNOB_KEY, STEERING_WHEEL_KEY],
    ),
    `imagens (${manifest.sprites[playerSpriteKey]?.path ?? playerSpriteKey}, ` +
      `${manifest.sprites[GROUND_SPRITE_KEY]?.path ?? GROUND_SPRITE_KEY})`,
  )
  const audioParams = await withTimeout(
    loadEngineAudioParams(engineAudioUrl, 'engine.json'),
    'parametros de audio (engine.json)',
  )

  // Whatever the player last chose, checked against the catalog that was
  // actually loaded. Pouring the fuel in is all that ever happens to it: what
  // comes back is a car, and nothing downstream can tell it apart from one
  // somebody authored. The game state resolves its own copy the same way.
  const vehicle = loadVehicleSettings(fuels)
  const car = applyFuel(carBase, resolveFuel(fuels, vehicle.fuel))

  // Built now, opened later: no browser lets a page make a sound before the
  // player has touched it, so until then the game simply runs in silence.
  const audio = createEngineAudio(audioParams, {
    idleRpm: car.powertrain.idleRpm,
    maxRpm: car.powertrain.maxRpm,
  })

  // Whatever layout the player left behind last time, or the built-in one.
  const ui = createUiState({
    controlsVisible: prefersTouchControls(),
    forwardGears: car.powertrain.gearRatios.length,
    controls: loadControlConfig(),
    vehicle,
    fuels,
  })
  const input = new InputManager({
    canvas: surface.canvas,
    viewport: surface.viewport,
    ui,
    // Runs inside the event handler, which is the only place a device opens
    // -- and the only place a suspended one can be told to run. Called on
    // every gesture, not just the first: one resume can be refused.
    onUserGesture: () => {
      resumeEngineAudio(audio)
    },
    onFullscreenRequest: () => {
      // Must run inside the gesture handler, so it is called straight through.
      toggleFullscreen(document.documentElement)
      void lockLandscape().then((locked) => {
        ui.orientationLocked = locked
      })
    },
  })
  input.attach()
  onFullscreenChange(() => {
    ui.fullscreenActive = isFullscreen()
    if (!ui.fullscreenActive) ui.orientationLocked = false
  })
  // A hidden tab stops getting frames, so whatever note the engine was on
  // would hang there until the player came back. Fade it out instead.
  document.addEventListener('visibilitychange', () => {
    setEngineAudioAudible(audio, !document.hidden)
  })

  const state = createGameState({
    canvas: surface.canvas,
    ctx: surface.ctx,
    viewport: surface.viewport,
    assets,
    input,
    ui,
    carBase,
    audio,
    playerSpriteKey,
    groundSpriteKey: GROUND_SPRITE_KEY,
  })

  startGame(state, {
    onFatalError: (error: unknown) => {
      input.detach()
      showFailure(surface, 'quadro do jogo', error)
    },
  })
}

/** Bootstrap entry point. No module-level mutable state escapes this call. */
function main(): void {
  let surface: Screen
  try {
    surface = openScreen()
  } catch (error: unknown) {
    showFailure(null, 'abertura do canvas', error)
    return
  }

  // Last line of defence: if the boot neither finishes nor rejects, say so
  // instead of leaving "carregando..." on the screen forever.
  let finished = false
  const watchdog = window.setTimeout(() => {
    if (finished) return
    showFailure(surface, 'carregamento inicial', new Error('O carregamento travou antes de comecar.'))
  }, BOOT_TIMEOUT_MS + 1000)

  boot(surface)
    .then(() => {
      finished = true
      window.clearTimeout(watchdog)
    })
    .catch((error: unknown) => {
      finished = true
      window.clearTimeout(watchdog)
      showFailure(surface, 'carregamento inicial', error)
    })
}

main()
