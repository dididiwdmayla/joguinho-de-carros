/**
 * The one shape the rest of the game reads. Keyboard, touch and anything that
 * comes later all funnel into this; no other module ever touches a key event.
 */
export interface InputState {
  /** 0..1 */
  throttle: number
  /** 0..1 */
  brake: number
  /** -1..1, negative steers left. */
  steer: number
  handbrake: boolean
}

export function createInputState(): InputState {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false }
}
