/**
 * What the renderer is allowed to know.
 *
 * The scene is a plain description of the frame: no simulation types leak in,
 * so a layer can be rewritten without touching anything upstream of it.
 */
import type { AssetStore } from '../assets/loader'
import type { DebugFrame } from '../debug/debugFrame'
import type { InputState } from '../input/input'
import type { UiState } from '../ui/uiState'
import type { CameraView } from './camera'
import type { Viewport } from './viewport'

export interface VehicleRenderState {
  /** Manifest key of the body art. */
  spriteKey: string
  /** Centre of gravity in world metres; the sprite is centred and rotated here. */
  x: number
  y: number
  /** Heading [rad]. */
  yaw: number
  /** Front wheel angle [rad], drawn on the front axle. */
  steer: number
  /** Front axle distance ahead of the centre of gravity [m]. */
  frontAxleOffset: number
  /** Rear axle distance behind the centre of gravity [m]. */
  rearAxleOffset: number
  /** Distance between the left and right tyre centres [m]. */
  trackWidth: number
  /** Tyre width [m]. */
  wheelWidth: number
  /** Tyre diameter [m]. */
  wheelDiameter: number
}

export interface Scene {
  /** Manifest key of the tile the ground layer repeats. */
  groundSpriteKey: string
  vehicles: VehicleRenderState[]
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
  /** Null while the overlay is hidden. */
  readonly debug: DebugFrame | null
}
