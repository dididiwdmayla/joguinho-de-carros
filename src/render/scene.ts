/**
 * What the renderer is allowed to know.
 *
 * The scene is a plain description of the frame: no simulation types leak in,
 * so a layer can be rewritten without touching anything upstream of it. It is
 * built once when a level loads and only the handful of fields that actually
 * move -- the player's pose, the target bay's glow -- are written per frame.
 *
 * Sprites arrive here already resolved, as images with their size in metres
 * attached, rather than as manifest keys. That is what lets a parked car be a
 * repainted copy of the sedan and still be drawn by the same three lines as
 * everything else.
 */
import type { AssetStore } from '../assets/loader'
import type { DebugFrame } from '../debug/debugFrame'
import type { InputState } from '../input/input'
import type { GateOverlay } from '../ui/gateOverlay'
import type { UiState } from '../ui/uiState'
import type { CameraView } from './camera'
import type { DrawableSprite } from './tint'
import type { Viewport } from './viewport'

/** Wheels drawn in code under a body. Null on a car that is only scenery. */
export interface WheelRender {
  /** Front wheel angle [rad]. */
  steer: number
  /** Front axle distance ahead of the centre of gravity [m]. */
  readonly frontAxleOffset: number
  /** Rear axle distance behind the centre of gravity [m]. */
  readonly rearAxleOffset: number
  /** Distance between the left and right tyre centres [m]. */
  readonly trackWidth: number
  /** Tyre width [m]. */
  readonly wheelWidth: number
  /** Tyre diameter [m]. */
  readonly wheelDiameter: number
}

export interface VehicleRenderState {
  sprite: DrawableSprite
  /** Centre of the body in world metres; the sprite is centred and rotated here. */
  x: number
  y: number
  /** Heading [rad]. */
  yaw: number
  wheels: WheelRender | null
}

/** A cone, a planter, a parked car: art at a pose, and whether it casts. */
export interface PropRenderState {
  readonly sprite: DrawableSprite
  readonly x: number
  readonly y: number
  readonly yaw: number
  /** Tall enough to throw a shadow. A painted line is not. */
  readonly shadow: boolean
}

/** Something painted on the asphalt: a stain, a crack, a manhole. */
export interface DecalRenderState {
  readonly sprite: DrawableSprite
  readonly x: number
  readonly y: number
  readonly yaw: number
  /** Multiplies the sprite's declared metres. */
  readonly scale: number
  readonly alpha: number
}

/** One worn segment of painted line, in world metres. */
export interface PaintSegment {
  readonly x1: number
  readonly y1: number
  readonly x2: number
  readonly y2: number
  readonly alpha: number
}

/** A bay, as the decal layer paints it: nothing here is a PNG. */
export interface SlotRender {
  readonly x: number
  readonly y: number
  readonly angle: number
  readonly length: number
  readonly width: number
  /** True for the bay the player is being sent to. */
  readonly target: boolean
  readonly paint: readonly PaintSegment[]
}

export interface GroundRender {
  /** The tile the lot is paved with. */
  readonly sprite: DrawableSprite
  /** Paved rectangle in world metres; outside it there is no lot. */
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface Scene {
  ground: GroundRender | null
  /** Outline of the playable area, drawn as a kerb. Closed polygon. */
  boundary: readonly (readonly [number, number])[]
  decals: readonly DecalRenderState[]
  slots: readonly SlotRender[]
  props: readonly PropRenderState[]
  vehicles: VehicleRenderState[]
  /**
   * How far through its hold the target bay is, 0..1. The bay brightens with
   * it, which is the only thing on screen that says the car is being counted
   * as parked -- and it is scenery, not a readout.
   */
  targetProgress: number
}

export function createScene(): Scene {
  return {
    ground: null,
    boundary: [],
    decals: [],
    slots: [],
    props: [],
    vehicles: [],
    targetProgress: 0,
  }
}

/**
 * What the on-screen controls need to know about the powertrain to draw
 * themselves: the label on the mode button, how far the clutch pedal has
 * travelled, which gear the selector is on. Not a dashboard -- that arrives
 * with the HUD -- only the state of the buttons themselves.
 */
export interface PowertrainReadout {
  /** Short mode name shown on the selector. */
  modeLabel: string
  /** Clutch travel, 0 pressed .. 1 released. */
  clutch: number
  /** -1 reverse, 0 neutral, 1..n a forward gear. */
  gear: number
  /** Parking pawl in. Not a gear, so the selector cannot read it off one. */
  park: boolean
  /** Whether P would go in right now, so the selector can show it greyed. */
  parkReady: boolean
  /** True while the engine is dead, so the starter can ask to be pressed. */
  stalled: boolean
}

export interface RenderContext {
  readonly ctx: CanvasRenderingContext2D
  readonly viewport: Viewport
  readonly camera: CameraView
  readonly assets: AssetStore
  readonly scene: Scene
  /** Current controls, so the on-screen pedals can show what is pressed. */
  readonly input: Readonly<InputState>
  readonly ui: Readonly<UiState>
  /**
   * The H gate, which is an element above the canvas rather than paint on it.
   * The ui layer places it and tells it what the lever is doing; it is the one
   * part of the frame the 2D context does not draw.
   */
  readonly gate: GateOverlay
  /** Null while the overlay is hidden. */
  readonly debug: DebugFrame | null
  readonly powertrain: Readonly<PowertrainReadout>
}
