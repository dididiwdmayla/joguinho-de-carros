/**
 * Frame loop.
 *
 * The simulation always advances in whole 60 Hz steps, no matter what the
 * display does. Whatever time is left over between steps becomes the alpha the
 * renderer uses to interpolate, so 30 fps and 144 fps produce the same physics
 * and the same motion, only sampled at different moments.
 *
 * The loop is also where the phases meet the world: it is the only place that
 * builds a level, places the car on a spawn, or asks the flow to change state.
 * Everything it does in a frame depends on one question -- is the game being
 * played right now -- and when the answer is no, nothing moves.
 */
import {
  setEngineAudioMuted,
  setEngineAudioVolume,
  updateEngineAudio,
} from '../audio/engineAudio'
import { setObbPose } from '../collision/obb'
import { resolveVehicleCollisions } from '../collision/vehicleCollision'
import { FIXED_DT, MAX_STEPS_PER_FRAME } from '../core/constants'
import { clamp, lerp, lerpAngle } from '../core/math'
import type { DebugBoxes, DebugFrame } from '../debug/debugFrame'
import type { InputState } from '../input/input'
import { buildLevel } from '../level/levelRuntime'
import type { LevelDefinition } from '../level/levelSchema'
import { checkParking, stepParking } from '../level/parking'
import {
  copyCameraState,
  snapCamera,
  stepCamera,
  worldToScreenX,
  worldToScreenY,
} from '../render/camera'
import { renderFrame } from '../render/renderer'
import type { RenderContext, VehicleRenderState } from '../render/scene'
import { syncViewport } from '../render/viewport'
import type { ScreenAction } from '../ui/screens'
import { stepVehicle } from '../vehicle/physics'
import {
  applyPowertrainCommand,
  parkAvailable,
  resetPowertrainState,
  transmissionModeLabel,
} from '../vehicle/powertrain'
import { copyVehicleState } from '../vehicle/vehicleState'
import { syncShifterToGear, updateControlOpacity } from '../ui/uiState'
import { saveVehicleSettings } from '../ui/vehicleSettings'
import { resolveFuel } from '../vehicle/fuel'
import {
  advanceRun,
  chooseLevel,
  completeRun,
  isDriving,
  leaveToMenu,
  levelReady,
  pauseRun,
  resumeRun,
} from './flow'
import { screenModelFor } from './screenModel'
import { applySelectedFuel, type GameState } from './state'

/** Weight of one frame in the smoothed fps readout. */
const FPS_SMOOTHING = 0.08

export interface GameCallbacks {
  /** Called once if a frame throws, so the failure reaches the screen. */
  onFatalError: (error: unknown) => void
}

/** Starts the loop and returns a function that stops it. */
export function startGame(state: GameState, callbacks: GameCallbacks): () => void {
  let stopped = false
  let handle = requestAnimationFrame(function frame(timestamp: number): void {
    if (stopped) return
    handle = requestAnimationFrame(frame)
    try {
      advanceFrame(state, timestamp)
    } catch (error: unknown) {
      // A throw inside requestAnimationFrame is invisible: the browser keeps
      // calling us and the canvas keeps whatever was drawn last, which reads
      // as a frozen game. Stop and hand the error over to be painted.
      stopped = true
      cancelAnimationFrame(handle)
      callbacks.onFatalError(error)
    }
  })
  return () => {
    stopped = true
    cancelAnimationFrame(handle)
  }
}

function advanceFrame(state: GameState, timestamp: number): void {
  syncViewport(state.canvas, state.viewport)

  const previous = state.lastTimestamp
  state.lastTimestamp = timestamp

  // A tab coming back from the background reports a huge gap. Capping it at
  // the step budget is what stops the accumulator from spiralling: the
  // simulation simply skips the time it could not afford to simulate.
  const elapsed =
    previous < 0
      ? FIXED_DT
      : clamp((timestamp - previous) / 1000, 0, FIXED_DT * MAX_STEPS_PER_FRAME)
  if (elapsed > 0) state.fps += (1 / elapsed - state.fps) * FPS_SMOOTHING

  // What the panels asked for, before anything else this frame: a press on
  // REPETIR has to be the first thing that happens, not something applied to
  // a run that has already advanced another step.
  for (const action of state.input.drainScreenActions()) applyScreenAction(state, action)
  if (state.flow.phase === 'carregando') loadChosenLevel(state)

  const driving = isDriving(state.flow.phase)

  // Gear changes and the like act once, before the steps that follow: pressing
  // a key must never mean two gears because the frame ran long. They are also
  // taken before the gearbox is mirrored below, so a lever let go of never
  // spends a frame drawn back in the gear the box has not left yet.
  //
  // They are applied whatever the phase, because one of them is the settings
  // menu's way of changing gearbox, and that menu opens from the level list
  // and from the pause panel as much as from the road. The rest are harmless
  // anywhere: the car is standing still, and starting a level hands it back
  // in the gear that gearbox starts in.
  for (const command of state.input.drainCommands()) {
    applyPowertrainCommand(state.powertrain, state.car.powertrain, command, state.vehicle.vx)
  }

  // The gearbox tells the controls what it is, so the input layer can lay out
  // the right shifter and refuse a gear the clutch will not allow -- without
  // reaching into the simulation itself.
  if (state.ui.mode !== state.powertrain.mode) {
    // Another gearbox means another layout: the controls under those latches
    // are about to be somewhere else, or not on the screen at all.
    state.ui.latched.clear()
    state.ui.editing = null
  }
  state.ui.mode = state.powertrain.mode
  state.ui.gear = state.powertrain.gear
  state.ui.clutchPedal = state.powertrain.clutch
  // The lever belongs to whoever is holding it; when nobody is, it goes where
  // the gearbox actually is, so the number keys move it too.
  syncShifterToGear(state.ui)

  // Input is sampled once per frame and reused by every step of that frame.
  const input = state.input.sample()

  // Chases each control's drawn opacity towards 1 while it is being touched
  // and back towards the configured level once it is not, in real seconds so
  // the fade takes the same time at any frame rate.
  updateControlOpacity(state.ui, elapsed)

  syncVehicleSettings(state)

  // Asking to rotate only makes sense while the on-screen controls are in use
  // and the browser refused to pin the orientation for us.
  state.ui.rotateHintVisible =
    state.ui.controlsVisible &&
    !state.ui.orientationLocked &&
    state.viewport.cssHeight > state.viewport.cssWidth

  if (driving) {
    state.accumulator += elapsed
    let steps = 0
    while (state.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
      stepWorld(state, input)
      state.accumulator -= FIXED_DT
      steps++
    }
  } else {
    // Nothing is moving, so nothing has to be interpolated towards: the frame
    // is drawn exactly where the last step left the world.
    state.accumulator = 0
    copyVehicleState(state.vehicle, state.vehiclePrevious)
    copyCameraState(state.camera, state.cameraPrevious)
  }

  // Sound reads the same state the renderer is about to draw, and is fed in
  // real seconds rather than simulation steps: an engine dying takes as long
  // to be heard as it takes to happen. A paused game is silent whatever the
  // sound switch says -- the engine is not running, it is on hold.
  setEngineAudioMuted(state.audio, state.ui.muted || !driving)
  setEngineAudioVolume(state.audio, state.ui.volume)
  updateEngineAudio(
    state.audio,
    state.powertrain,
    state.telemetry.powertrain.deltaRpm,
    input.throttle,
    elapsed,
  )

  refreshScreen(state)

  const alpha = clamp(state.accumulator / FIXED_DT, 0, 1)
  renderFrame(buildRenderContext(state, input, alpha))
}

/** One fixed step of the world: physics, then contact, then the level's rules. */
function stepWorld(state: GameState, input: Readonly<InputState>): void {
  copyVehicleState(state.vehicle, state.vehiclePrevious)
  copyCameraState(state.camera, state.cameraPrevious)

  stepVehicle(state.vehicle, state.car, state.powertrain, input, FIXED_DT, state.telemetry)
  resolveContacts(state)

  const runtime = state.flow.runtime
  if (runtime !== null) {
    const level = runtime.definition
    const { parking } = state.flow.run
    checkParking(
      parking.check,
      state.vehicle,
      state.car,
      state.powertrain,
      input.handbrake,
      runtime.targetBox,
      level.params,
    )
    stepParking(parking, level.params, FIXED_DT)
    state.scene.targetProgress = parking.progress
    // The bay first, the clock second. A car that came to rest in the bay on
    // the very step the clock ran out is parked, not late.
    if (parking.done) completeRun(state.flow, level)
    else advanceRun(state.flow, level, state.powertrain.stalled, FIXED_DT)
  }

  updateFollowTarget(state)
  stepCamera(state.camera, state.followTarget, FIXED_DT)
}

/**
 * Hands the car to the collision code and takes it back.
 *
 * The physics works in the car's own frame, where the velocity is "forward"
 * and "sideways"; contact works in the world's, where a wall has a direction
 * of its own. The two conversions here are the whole of the boundary between
 * them, and they are exact: the same vector, written twice.
 */
function resolveContacts(state: GameState): void {
  const runtime = state.flow.runtime
  if (runtime === null) return

  const vehicle = state.vehicle
  const motion = state.colliderMotion
  const cos = Math.cos(vehicle.yaw)
  const sin = Math.sin(vehicle.yaw)

  motion.x = vehicle.x
  motion.y = vehicle.y
  motion.yaw = vehicle.yaw
  motion.yawRate = vehicle.yawRate
  motion.vx = vehicle.vx * cos - vehicle.vy * sin
  motion.vy = vehicle.vx * sin + vehicle.vy * cos

  resolveVehicleCollisions(runtime.world, state.collider, motion, state.flow.run.damage)

  vehicle.x = motion.x
  vehicle.y = motion.y
  vehicle.yawRate = motion.yawRate
  vehicle.vx = motion.vx * cos + motion.vy * sin
  vehicle.vy = -motion.vx * sin + motion.vy * cos
}

/** Applies one press from a panel. The only place a phase ever changes. */
function applyScreenAction(state: GameState, action: ScreenAction): void {
  const { flow } = state
  switch (action.kind) {
    case 'pausar':
      // One control for both directions: the same key and the same button
      // that stopped the game start it again.
      if (flow.phase === 'jogando') pauseRun(flow)
      else if (flow.phase === 'pausado') resumeRun(flow)
      break
    case 'continuar':
      resumeRun(flow)
      break
    case 'jogar':
      if (action.index >= 0 && action.index < state.levels.length) {
        chooseLevel(flow, action.index)
      }
      break
    case 'repetir':
      chooseLevel(flow, flow.levelIndex)
      break
    case 'avancar':
      chooseLevel(flow, Math.min(flow.levelIndex + 1, state.levels.length - 1))
      break
    case 'fases':
      leaveToMenu(flow)
      state.scene = state.emptyScene
      break
    case 'ajustes':
      state.ui.menu = 'main'
      break
  }
}

/**
 * Builds the level the flow is waiting on and puts the car on its spawn. It
 * happens inside one frame -- everything the level needs was fetched at boot
 * -- but it is still a state of its own, because a level that ever does take
 * time must have somewhere to say so.
 */
function loadChosenLevel(state: GameState): void {
  const level = state.levels[state.flow.levelIndex]
  if (level === undefined) {
    leaveToMenu(state.flow)
    state.scene = state.emptyScene
    return
  }

  const runtime = buildLevel(level, state.assets)
  runtime.scene.vehicles.push(state.playerRender)
  state.scene = runtime.scene
  placeCarOnSpawn(state, level)
  levelReady(state.flow, runtime)
}

/** The car as it is handed over at the start of a run: still, cold, in gear. */
function placeCarOnSpawn(state: GameState, level: LevelDefinition): void {
  const vehicle = state.vehicle
  vehicle.x = level.spawn.x
  vehicle.y = level.spawn.y
  vehicle.yaw = level.spawn.angle
  vehicle.vx = 0
  vehicle.vy = 0
  vehicle.yawRate = 0
  vehicle.steer = 0
  vehicle.ax = 0
  copyVehicleState(vehicle, state.vehiclePrevious)

  resetPowertrainState(state.powertrain, state.powertrain.mode, state.car.powertrain.idleRpm)
  state.ui.latched.clear()
  state.accumulator = 0

  snapCamera(state.camera, vehicle.x, vehicle.y)
  copyCameraState(state.camera, state.cameraPrevious)
  state.playerRender.x = vehicle.x
  state.playerRender.y = vehicle.y
  state.playerRender.yaw = vehicle.yaw
  state.scene.targetProgress = 0
}

/** Rebuilds the panel, but only when the flow has actually changed. */
function refreshScreen(state: GameState): void {
  if (state.screenRevision === state.flow.revision) return
  state.screenRevision = state.flow.revision
  state.ui.screen = screenModelFor(state.flow, state.levels)
}

/**
 * Keeps the car and the settings that describe it in step, in both directions.
 *
 * The fuel is chosen in the menu and resolved here, once, into the numbers the
 * physics runs on. The gearbox is the other way round: it can be changed from
 * the menu, a button or a key, so whatever the powertrain ended up with is
 * what gets remembered.
 */
function syncVehicleSettings(state: GameState): void {
  if (state.ui.vehicle.fuel !== state.fuelId) applySelectedFuel(state)

  if (state.ui.vehicle.transmission !== state.powertrain.mode) {
    state.ui.vehicle.transmission = state.powertrain.mode
    saveVehicleSettings(state.ui.vehicle)
  }
}

/**
 * Every box in the level plus the car's own, posed where the frame is being
 * drawn. Only built while the box overlay is on; the boxes themselves are
 * handed over by reference, so nothing here can drift from what the physics is
 * testing against.
 */
function collisionBoxes(state: GameState, render: VehicleRenderState): DebugBoxes | null {
  const runtime = state.flow.runtime
  if (runtime === null) return null
  setObbPose(state.colliderView, render.x, render.y, render.yaw)
  return { bodies: runtime.world.bodies, player: state.colliderView }
}

/** Feeds the camera the car's position, its velocity, and the bay to frame. */
function updateFollowTarget(state: GameState): void {
  const { vehicle, followTarget } = state
  const cosYaw = Math.cos(vehicle.yaw)
  const sinYaw = Math.sin(vehicle.yaw)
  followTarget.x = vehicle.x
  followTarget.y = vehicle.y
  followTarget.velocityX = vehicle.vx * cosYaw - vehicle.vy * sinYaw
  followTarget.velocityY = vehicle.vx * sinYaw + vehicle.vy * cosYaw

  const runtime = state.flow.runtime
  followTarget.focusX = runtime === null ? null : runtime.targetBox.x
  followTarget.focusY = runtime === null ? null : runtime.targetBox.y
}

function buildRenderContext(
  state: GameState,
  input: RenderContext['input'],
  alpha: number,
): RenderContext {
  const current = state.vehicle
  const previous = state.vehiclePrevious
  const render = state.playerRender

  render.x = lerp(previous.x, current.x, alpha)
  render.y = lerp(previous.y, current.y, alpha)
  render.yaw = lerpAngle(previous.yaw, current.yaw, alpha)
  if (render.wheels !== null) render.wheels.steer = lerp(previous.steer, current.steer, alpha)

  state.cameraView.x = lerp(state.cameraPrevious.x, state.camera.x, alpha)
  state.cameraView.y = lerp(state.cameraPrevious.y, state.camera.y, alpha)
  state.cameraView.pixelsPerMeter = lerp(state.cameraPrevious.scale, state.camera.scale, alpha)

  const readout = state.powertrainReadout
  readout.modeLabel = transmissionModeLabel(state.powertrain.mode)
  readout.clutch = state.powertrain.clutch
  readout.gear = state.powertrain.gear
  readout.park = state.powertrain.park
  // Read from the car itself rather than from a press: the selector greys P
  // out while the pawl would not drop, before anybody has tried it.
  readout.parkReady = parkAvailable(current.vx)
  readout.stalled = state.powertrain.stalled

  const runtime = state.flow.runtime
  const boxes = state.ui.debug === 'caixas' ? collisionBoxes(state, render) : null

  const debug: DebugFrame | null = state.ui.debug !== 'off'
    ? {
        telemetry: state.telemetry,
        vx: current.vx,
        vy: current.vy,
        yawRate: current.yawRate,
        steer: current.steer,
        // Taken from exactly what the renderer is about to use: the same
        // interpolated pose, the same interpolated camera, the same transform
        // the ground is placed with.
        screenX: worldToScreenX(state.cameraView, state.viewport, render.x),
        screenY: worldToScreenY(state.cameraView, state.viewport, render.y),
        cameraX: state.cameraView.x,
        cameraY: state.cameraView.y,
        fps: state.fps,
        audio: state.audio.readout,
        fuel: resolveFuel(state.ui.fuels, state.fuelId).label,
        run:
          runtime === null
            ? null
            : {
                time: state.flow.run.time,
                damage: state.flow.run.damage.total,
                impacts: state.flow.run.damage.count,
                worstImpact: state.flow.run.damage.worst,
                check: state.flow.run.parking.check,
                hold: state.flow.run.parking.progress,
              },
        boxes,
      }
    : null

  return {
    ctx: state.ctx,
    viewport: state.viewport,
    camera: state.cameraView,
    assets: state.assets,
    scene: state.scene,
    input,
    ui: state.ui,
    gate: state.gate,
    debug,
    powertrain: readout,
  }
}
