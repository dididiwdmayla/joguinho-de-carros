/** Read-only snapshot handed to the debug overlay each frame. */
import type { EngineAudioReadout } from '../audio/engineAudio'
import type { ParkingCheck } from '../level/parking'
import type { VehicleTelemetry } from '../vehicle/physics'

/** What the level being driven is doing. Null while no level is loaded. */
export interface RunDebug {
  /** Time on the clock [s]. */
  readonly time: number
  /** Accumulated impact [m/s], and how it got there. */
  readonly damage: number
  readonly impacts: number
  readonly worstImpact: number
  /** The five parking conditions, live. */
  readonly check: Readonly<ParkingCheck>
  /** How far through the hold the bay is, 0..1. */
  readonly hold: number
}

export interface DebugFrame {
  readonly telemetry: VehicleTelemetry
  /** Body-frame velocity [m/s]. */
  readonly vx: number
  readonly vy: number
  /** Heading rate [rad/s]. */
  readonly yawRate: number
  /** Current front wheel angle [rad]. */
  readonly steer: number
  /**
   * Where the car is actually being painted, in CSS pixels from the top-left
   * of the canvas, and where the camera is, in world metres. Printed to three
   * decimals: any shiver of the car against the asphalt is a wobble in these
   * numbers before it is anything you can see.
   */
  readonly screenX: number
  readonly screenY: number
  readonly cameraX: number
  readonly cameraY: number
  /** Smoothed frames per second, to check the fixed step against the display. */
  readonly fps: number
  /** Why the game is or is not making a sound. */
  readonly audio: EngineAudioReadout
  /** Name of the fuel whose numbers the engine is running on. */
  readonly fuel: string
  /** The run in progress, or null in the menu. */
  readonly run: RunDebug | null
}
