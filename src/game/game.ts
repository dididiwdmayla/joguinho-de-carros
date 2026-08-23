/**
 * Frame loop.
 *
 * The simulation always advances in whole 60 Hz steps, no matter what the
 * display does. Whatever time is left over between steps becomes the alpha the
 * renderer uses to interpolate, so 30 fps and 144 fps produce the same physics
 * and the same motion, only sampled at different moments.
 */
import {
  setEngineAudioMuted,
  setEngineAudioVolume,
  updateEngineAudio,
} from '../audio/engineAudio'
import { FIXED_DT, MAX_STEPS_PER_FRAME } from '../core/constants'
import { clamp, lerp, lerpAngle } from '../core/math'
import type { DebugFrame } from '../debug/debugFrame'
import { copyCameraState, stepCamera } from '../render/camera'
import { renderFrame } from '../render/renderer'
import type { RenderContext } from '../render/scene'
import { syncViewport } from '../render/viewport'
import { stepVehicle } from '../vehicle/physics'
import { applyPowertrainCommand, transmissionModeLabel } from '../vehicle/powertrain'
import { copyVehicleState } from '../vehicle/vehicleState'
import { syncShifterToGear } from '../ui/uiState'
import type { GameState } from './state'

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

  // The gearbox tells the controls what it is, so the input layer can lay out
  // the right shifter and refuse a gear the clutch will not allow -- without
  // reaching into the simulation itself.
  state.ui.mode = state.powertrain.mode
  state.ui.gear = state.powertrain.gear
  state.ui.clutchPedal = state.powertrain.clutch
  // The lever belongs to whoever is holding it; when nobody is, it goes where
  // the gearbox actually is, so the number keys move it too.
  syncShifterToGear(state.ui)

  // Input is sampled once per frame and reused by every step of that frame.
  const input = state.input.sample(elapsed)

  // Gear changes and the like act once, before the steps that follow: pressing
  // a key must never mean two gears because the frame ran long.
  for (const command of state.input.drainCommands()) {
    applyPowertrainCommand(state.powertrain, state.car.powertrain, command, state.vehicle.vx)
  }

  // Asking to rotate only makes sense while the on-screen controls are in use
  // and the browser refused to pin the orientation for us.
  state.ui.rotateHintVisible =
    state.ui.controlsVisible &&
    !state.ui.orientationLocked &&
    state.viewport.cssHeight > state.viewport.cssWidth

  state.accumulator += elapsed
  let steps = 0
  while (state.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    copyVehicleState(state.vehicle, state.vehiclePrevious)
    copyCameraState(state.camera, state.cameraPrevious)

    stepVehicle(state.vehicle, state.car, state.powertrain, input, FIXED_DT, state.telemetry)
    updateFollowTarget(state)
    stepCamera(state.camera, state.followTarget, FIXED_DT)

    state.accumulator -= FIXED_DT
    steps++
  }

  // Sound reads the same state the renderer is about to draw, and is fed in
  // real seconds rather than simulation steps: an engine dying takes as long
  // to be heard as it takes to happen.
  setEngineAudioMuted(state.audio, state.ui.muted)
  setEngineAudioVolume(state.audio, state.ui.volume)
  updateEngineAudio(
    state.audio,
    state.powertrain,
    state.telemetry.powertrain.deltaRpm,
    input.throttle,
    elapsed,
  )

  const alpha = clamp(state.accumulator / FIXED_DT, 0, 1)
  renderFrame(buildRenderContext(state, input, alpha))
}

/** Feeds the camera the car's position and its velocity in world axes. */
function updateFollowTarget(state: GameState): void {
  const { vehicle, followTarget } = state
  const cosYaw = Math.cos(vehicle.yaw)
  const sinYaw = Math.sin(vehicle.yaw)
  followTarget.x = vehicle.x
  followTarget.y = vehicle.y
  followTarget.velocityX = vehicle.vx * cosYaw - vehicle.vy * sinYaw
  followTarget.velocityY = vehicle.vx * sinYaw + vehicle.vy * cosYaw
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
  render.steer = lerp(previous.steer, current.steer, alpha)

  state.cameraView.x = lerp(state.cameraPrevious.x, state.camera.x, alpha)
  state.cameraView.y = lerp(state.cameraPrevious.y, state.camera.y, alpha)

  const readout = state.powertrainReadout
  readout.modeLabel = transmissionModeLabel(state.powertrain.mode)
  readout.clutch = state.powertrain.clutch
  readout.gear = state.powertrain.gear
  readout.stalled = state.powertrain.stalled

  const debug: DebugFrame | null = state.ui.debugVisible
    ? {
        telemetry: state.telemetry,
        vx: current.vx,
        vy: current.vy,
        yawRate: current.yawRate,
        steer: current.steer,
        fps: state.fps,
        audio: state.audio.readout,
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
    debug,
    powertrain: readout,
  }
}
