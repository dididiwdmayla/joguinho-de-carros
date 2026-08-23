/** Read-only snapshot handed to the debug overlay each frame. */
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
  /** Smoothed frames per second, to check the fixed step against the display. */
  readonly fps: number
}
