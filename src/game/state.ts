/**
 * The single explicit state object. Everything mutable in the game lives in
 * here and is passed around by reference; no module keeps hidden globals.
 */
import type { AssetStore } from '../assets/loader'
import type { InputManager } from '../input/InputManager'
import {
  copyCameraState,
  createCameraState,
  createCameraView,
  type CameraState,
  type CameraView,
  type FollowTarget,
} from '../render/camera'
import type { Scene, VehicleRenderState } from '../render/scene'
import type { Viewport } from '../render/viewport'
import type { UiState } from '../ui/uiState'
import type { CarParams } from '../vehicle/carParams'
import { createTelemetry, type VehicleTelemetry } from '../vehicle/physics'
import { createVehicleState, type VehicleState } from '../vehicle/vehicleState'

export interface GameState {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly viewport: Viewport
  readonly assets: AssetStore
  readonly input: InputManager
  readonly ui: UiState

  readonly car: CarParams
  /** Authoritative simulation state, advanced at a fixed 60 Hz. */
  readonly vehicle: VehicleState
  /** State before the last physics step, used to interpolate the render. */
  readonly vehiclePrevious: VehicleState
  readonly telemetry: VehicleTelemetry

  readonly camera: CameraState
  readonly cameraPrevious: CameraState
  readonly cameraView: CameraView
  readonly followTarget: FollowTarget

  readonly scene: Scene
  readonly playerRender: VehicleRenderState

  /** Leftover simulation time, in seconds. */
  accumulator: number
  /** Timestamp of the previous frame in milliseconds, -1 before the first. */
  lastTimestamp: number
  /** Smoothed display refresh rate, shown in the overlay. */
  fps: number
}

export interface GameStateOptions {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  viewport: Viewport
  assets: AssetStore
  input: InputManager
  ui: UiState
  car: CarParams
  playerSpriteKey: string
  groundSpriteKey: string
}

export function createGameState(options: GameStateOptions): GameState {
  const vehicle = createVehicleState(0, 0, 0)
  const camera = createCameraState(vehicle.x, vehicle.y)
  const { car } = options

  const playerRender: VehicleRenderState = {
    spriteKey: options.playerSpriteKey,
    x: vehicle.x,
    y: vehicle.y,
    yaw: vehicle.yaw,
    steer: vehicle.steer,
    frontAxleOffset: car.cgToFront,
    rearAxleOffset: car.cgToRear,
    trackWidth: car.trackWidth,
    wheelWidth: car.wheelWidth,
    wheelDiameter: car.wheelDiameter,
  }

  const scene: Scene = {
    groundSpriteKey: options.groundSpriteKey,
    vehicles: [playerRender],
  }

  const cameraPrevious = createCameraState(camera.x, camera.y)
  copyCameraState(camera, cameraPrevious)

  return {
    canvas: options.canvas,
    ctx: options.ctx,
    viewport: options.viewport,
    assets: options.assets,
    input: options.input,
    ui: options.ui,
    car,
    vehicle,
    vehiclePrevious: createVehicleState(vehicle.x, vehicle.y, vehicle.yaw),
    telemetry: createTelemetry(),
    camera,
    cameraPrevious,
    cameraView: createCameraView(),
    followTarget: { x: vehicle.x, y: vehicle.y, velocityX: 0, velocityY: 0 },
    scene,
    playerRender,
    accumulator: 0,
    lastTimestamp: -1,
    fps: 60,
  }
}
