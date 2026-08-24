/**
 * The single explicit state object. Everything mutable in the game lives in
 * here and is passed around by reference; no module keeps hidden globals.
 */
import type { AssetStore } from '../assets/loader'
import { setEngineReference, type EngineAudio } from '../audio/engineAudio'
import { createObb, type Obb } from '../collision/obb'
import type { ColliderMotion, VehicleCollider } from '../collision/vehicleCollision'
import type { InputManager } from '../input/InputManager'
import type { LevelDefinition } from '../level/levelSchema'
import {
  copyCameraState,
  createCameraState,
  createCameraView,
  type CameraState,
  type CameraView,
  type FollowTarget,
} from '../render/camera'
import { createScene, type PowertrainReadout, type Scene, type VehicleRenderState } from '../render/scene'
import type { Viewport } from '../render/viewport'
import type { GateOverlay } from '../ui/gateOverlay'
import type { UiState } from '../ui/uiState'
import type { CarParams } from '../vehicle/carParams'
import { applyFuel, resolveFuel } from '../vehicle/fuel'
import { createTelemetry, type VehicleTelemetry } from '../vehicle/physics'
import {
  createPowertrainState,
  resetEngineWarmth,
  transmissionModeLabel,
  type PowertrainState,
} from '../vehicle/powertrain'
import { createVehicleState, type VehicleState } from '../vehicle/vehicleState'
import { createFlowState, type FlowState } from './flow'

/**
 * How much a hit bounces. Nearly nothing on purpose: the car must never be
 * thrown by the scenery, and this is here only so a kerb is not perfectly dead.
 */
const RESTITUTION = 0.02

/**
 * Friction along a contact. Low, because the interesting case is the shallow
 * one -- the car brushing a wall keeps most of its speed and slides along it,
 * which is what actually happens and what a player expects.
 */
const CONTACT_FRICTION = 0.32

export interface GameState {
  readonly canvas: HTMLCanvasElement
  readonly ctx: CanvasRenderingContext2D
  readonly viewport: Viewport
  readonly assets: AssetStore
  readonly input: InputManager
  readonly ui: UiState
  /** The H gate, drawn as an element over the canvas. */
  readonly gate: GateOverlay
  /** Silent until a gesture opens the device; the loop feeds it regardless. */
  readonly audio: EngineAudio

  /**
   * The car as it is being driven: the authored numbers with the chosen fuel
   * already poured into them. Replaced outright when the fuel changes, which
   * is the only way a fuel ever reaches the physics.
   */
  car: CarParams
  /** The car as the JSON authored it, the starting point of every fuel. */
  readonly carBase: CarParams
  /** Fuel currently resolved into `car`, so a change can be noticed. */
  fuelId: string
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

  /** The car's box, and what the response needs to know about its mass. */
  readonly collider: VehicleCollider
  /** Scratch the collision response reads and writes, once per step. */
  readonly colliderMotion: ColliderMotion
  /**
   * The same box at the pose being drawn, for the overlay that outlines it.
   *
   * A copy rather than the collider's own: that one is at the last simulation
   * step, and the frame is drawn interpolated between two of them. Outlining
   * the step's box over the interpolated car is how a debug view ends up
   * showing a mismatch it invented itself.
   */
  readonly colliderView: Obb

  readonly camera: CameraState
  readonly cameraPrevious: CameraState
  readonly cameraView: CameraView
  readonly followTarget: FollowTarget

  /** Every level there is, in the order they are offered. */
  readonly levels: readonly LevelDefinition[]
  /** Which phase the game is in, and everything one run accumulates. */
  readonly flow: FlowState
  /** Revision of the flow the screen model was last built from. */
  screenRevision: number

  /** The level's scene while one is loaded, an empty lot otherwise. */
  scene: Scene
  /** Bare scene shown behind the level list, so the renderer always has one. */
  readonly emptyScene: Scene
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
  /** The H gate, drawn as an element over the canvas. */
  gate: GateOverlay
  /** The car as authored; the fuel the player has chosen is poured in here. */
  carBase: CarParams
  audio: EngineAudio
  playerSpriteKey: string
  levels: readonly LevelDefinition[]
}

export function createGameState(options: GameStateOptions): GameState {
  const vehicle = createVehicleState(0, 0, 0)
  const camera = createCameraState(vehicle.x, vehicle.y)
  const fuel = resolveFuel(options.ui.fuels, options.ui.vehicle.fuel)
  const car = applyFuel(options.carBase, fuel)
  const powertrain = createPowertrainState(
    options.ui.vehicle.transmission,
    car.powertrain.idleRpm,
  )

  const playerSprite = options.assets.sprite(options.playerSpriteKey)
  const playerRender: VehicleRenderState = {
    sprite: playerSprite,
    x: vehicle.x,
    y: vehicle.y,
    yaw: vehicle.yaw,
    wheels: {
      steer: vehicle.steer,
      frontAxleOffset: car.cgToFront,
      rearAxleOffset: car.cgToRear,
      trackWidth: car.trackWidth,
      wheelWidth: car.wheelWidth,
      wheelDiameter: car.wheelDiameter,
    },
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
    gate: options.gate,
    audio: options.audio,
    car,
    carBase: options.carBase,
    fuelId: fuel.id,
    vehicle,
    vehiclePrevious: createVehicleState(vehicle.x, vehicle.y, vehicle.yaw),
    powertrain,
    telemetry: createTelemetry(powertrain),
    // The box is the bodywork, to the centimetre: the same metres the loader
    // sized the artwork by, with nothing added for luck and nothing shaved off
    // for forgiveness. A box a hand's width bigger than the car is a car that
    // stops short of everything it approaches, and a box smaller than the car
    // is one that parks itself through a van. There is one number, and the
    // drawing and the physics both read it.
    collider: {
      box: createObb(
        vehicle.x,
        vehicle.y,
        playerSprite.lengthMeters,
        playerSprite.widthMeters,
        vehicle.yaw,
      ),
      mass: car.mass,
      inertia: car.yawInertia,
      restitution: RESTITUTION,
      friction: CONTACT_FRICTION,
    },
    colliderMotion: { x: 0, y: 0, vx: 0, vy: 0, yaw: 0, yawRate: 0 },
    colliderView: createObb(
      vehicle.x,
      vehicle.y,
      playerSprite.lengthMeters,
      playerSprite.widthMeters,
      vehicle.yaw,
    ),
    camera,
    cameraPrevious,
    cameraView: createCameraView(),
    followTarget: { x: vehicle.x, y: vehicle.y, velocityX: 0, velocityY: 0, focusX: null, focusY: null },
    levels: options.levels,
    flow: createFlowState(),
    screenRevision: -1,
    scene: createScene(),
    emptyScene: createScene(),
    playerRender,
    powertrainReadout: {
      modeLabel: transmissionModeLabel(powertrain.mode),
      clutch: powertrain.clutch,
      gear: powertrain.gear,
      park: powertrain.park,
      parkReady: true,
      stalled: powertrain.stalled,
    },
    accumulator: 0,
    lastTimestamp: -1,
    fps: 60,
  }
}

/**
 * Pours the chosen fuel into the car and hands the result to everything that
 * reads it. Called whenever the choice changes, and it is the whole of what
 * changing fuel means: fresh numbers, and an engine that is cold again.
 *
 * The engine is never told which fuel this was. It is given a set of numbers
 * and has no way of asking where they came from.
 */
export function applySelectedFuel(state: GameState): void {
  const fuel = resolveFuel(state.ui.fuels, state.ui.vehicle.fuel)
  state.ui.vehicle.fuel = fuel.id
  state.car = applyFuel(state.carBase, fuel)
  state.fuelId = fuel.id
  // The synthesiser voices rpm against idle and the limiter, both of which a
  // fuel is allowed to move.
  setEngineReference(state.audio, {
    idleRpm: state.car.powertrain.idleRpm,
    maxRpm: state.car.powertrain.maxRpm,
  })
  resetEngineWarmth(state.powertrain)
}
