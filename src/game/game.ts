/**
 * Frame loop.
 *
 * The simulation always advances in whole 60 Hz steps, no matter what the
 * display does. Whatever time is left over between steps becomes the alpha the
 * renderer uses to interpolate, so 30 fps and 144 fps produce the same physics
 * and the same motion, only sampled at different moments.
 */
import { FIXED_DT, MAX_STEPS_PER_FRAME } from '../core/constants'
import { clamp, lerp, lerpAngle } from '../core/math'
import { copyCameraState, stepCamera } from '../render/camera'
import { renderFrame } from '../render/renderer'
import type { RenderContext } from '../render/scene'
import { syncViewport } from '../render/viewport'
import { stepVehicle } from '../vehicle/physics'
import { copyVehicleState } from '../vehicle/vehicleState'
import type { DebugFrame } from '../debug/debugFrame'
import type { GameState } from './state'

/** Weight of one frame in the smoothed fps readout. */
const FPS_SMOOTHING = 0.08

/** Starts the loop and returns a function that stops it. */
export function startGame(state: GameState): () => void {
  let handle = requestAnimationFrame(function frame(timestamp: number): void {
    handle = requestAnimationFrame(frame)
    advanceFrame(state, timestamp)
  })
  return () => cancelAnimationFrame(handle)
}

function advanceFrame(state: GameState, timestamp: number): void {
  syncViewport(state.canvas, state.viewport)
  if (state.input.consumeDebugToggle()) state.debugVisible = !state.debugVisible

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

  // Input is sampled once per frame and reused by every step of that frame.
  const input = state.input.sample()

  state.accumulator += elapsed
  let steps = 0
  while (state.accumulator >= FIXED_DT && steps < MAX_STEPS_PER_FRAME) {
    copyVehicleState(state.vehicle, state.vehiclePrevious)
    copyCameraState(state.camera, state.cameraPrevious)

    stepVehicle(state.vehicle, state.car, input, FIXED_DT, state.telemetry)
    updateFollowTarget(state)
    stepCamera(state.camera, state.followTarget, FIXED_DT)

    state.accumulator -= FIXED_DT
    steps++
  }

  renderFrame(buildRenderContext(state, clamp(state.accumulator / FIXED_DT, 0, 1)))
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

function buildRenderContext(state: GameState, alpha: number): RenderContext {
  const current = state.vehicle
  const previous = state.vehiclePrevious
  const render = state.playerRender

  render.x = lerp(previous.x, current.x, alpha)
  render.y = lerp(previous.y, current.y, alpha)
  render.yaw = lerpAngle(previous.yaw, current.yaw, alpha)
  render.steer = lerp(previous.steer, current.steer, alpha)

  state.cameraView.x = lerp(state.cameraPrevious.x, state.camera.x, alpha)
  state.cameraView.y = lerp(state.cameraPrevious.y, state.camera.y, alpha)

  const debug: DebugFrame | null = state.debugVisible
    ? {
        telemetry: state.telemetry,
        vx: current.vx,
        vy: current.vy,
        yawRate: current.yawRate,
        steer: current.steer,
        fps: state.fps,
      }
    : null

  return {
    ctx: state.ctx,
    viewport: state.viewport,
    camera: state.cameraView,
    assets: state.assets,
    scene: state.scene,
    debug,
    debugCornerVisible: true,
  }
}
