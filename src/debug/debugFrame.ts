/** Read-only snapshot handed to the debug overlay each frame. */
import type { EngineAudioReadout } from '../audio/engineAudio'
import type { VehicleTelemetry } from '../vehicle/physics'

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
}
