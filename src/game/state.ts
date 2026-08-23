/**
 * The single explicit state object. Everything mutable in the game lives in
 * here and is passed around by reference; no module keeps hidden globals.
 */
import type { AssetStore } from '../assets/loader'
import type { EngineAudio } from '../audio/engineAudio'
import type { InputManager } from '../input/InputManager'
import {
  copyCameraState,
  createCameraState,
  createCameraView,
  type CameraState,
  type CameraView,
  type FollowTarget,
} from '../render/camera'
import type { PowertrainReadout, Scene, VehicleRenderState } from '../render/scene'
import type { Viewport } from '../render/viewport'
import type { UiState } from '../ui/uiState'
import type { CarParams } from '../vehicle/carParams'
import { createTelemetry, type VehicleTelemetry } from '../vehicle/physics'
import {
  createPowertrainState,
  transmissionModeLabel,
  type PowertrainState,
  type TransmissionMode,
} from '../vehicle/powertrain'
import { createVehicleState, type VehicleState } from '../vehicle/vehicleState'

/**
 * How the car is handed over on the first frame. Automatic, in drive: the game
 * has to be drivable before anyone has read which key changes the gearbox.
 */
export const INITIAL_TRANSMISSION_MODE: TransmissionMode = 'automatic'

export interface GameState {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly viewport: Viewport
  readonly assets: AssetStore
  readonly input: InputManager
  readonly ui: UiState
  /** Silent until a gesture opens the device; the loop feeds it regardless. */
  readonly audio: EngineAudio

  readonly car: CarParams
  /** Authoritative simulation state, advanced at a fixed 60 Hz. */
  readonly vehicle: VehicleState
  /** State before the last physics step, used to interpolate the render. */
  readonly vehiclePrevious: VehicleState
  /**
   * Engine, clutch and gearbox. Kept beside the rigid-body state rather than
   * inside it: nothing here is interpolated for the render, and the transmission
   * mode has to stay readable from outside for the HUD that comes next.
   */
  readonly powertrain: PowertrainState
  readonly telemetry: VehicleTelemetry

  readonly camera: CameraState
  readonly cameraPrevious: CameraState
  readonly cameraView: CameraView
  readonly followTarget: FollowTarget

  readonly scene: Scene
  readonly playerRender: VehicleRenderState
  /** What the on-screen controls need from the powertrain, refreshed per frame. */
  readonly powertrainReadout: PowertrainReadout

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
  audio: EngineAudio
  playerSpriteKey: string
  groundSpriteKey: string
}

export function createGameState(options: GameStateOptions): GameState {
  const vehicle = createVehicleState(0, 0, 0)
  const camera = createCameraState(vehicle.x, vehicle.y)
  const { car } = options
  const powertrain = createPowertrainState(INITIAL_TRANSMISSION_MODE, car.powertrain.idleRpm)

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
    audio: options.audio,
    car,
    vehicle,
    vehiclePrevious: createVehicleState(vehicle.x, vehicle.y, vehicle.yaw),
    powertrain,
    telemetry: createTelemetry(powertrain),
    camera,
    cameraPrevious,
    cameraView: createCameraView(),
    followTarget: { x: vehicle.x, y: vehicle.y, velocityX: 0, velocityY: 0 },
    scene,
    playerRender,
    powertrainReadout: {
      modeLabel: transmissionModeLabel(powertrain.mode),
      clutch: powertrain.clutch,
      gear: powertrain.gear,
      stalled: powertrain.stalled,
    },
    accumulator: 0,
    lastTimestamp: -1,
    fps: 60,
  }
}
