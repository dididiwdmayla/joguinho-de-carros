/**
 * The one shape the rest of the game reads. Keyboard, touch and anything that
 * comes later all funnel into this; no other module ever touches a key event.
 *
 * Only continuous controls live here. Discrete ones -- picking a gear, cycling
 * the transmission mode, turning the key -- are commands instead, because a
 * frame may run several physics steps and a press must be consumed once.
 */
export interface InputState {
  /** 0..1 */
  throttle: number
  /** 0..1 */
  brake: number
  /** -1..1, negative steers left. */
  steer: number
  handbrake: boolean
  /** 0..1, how hard the clutch pedal is being pushed down. */
  clutchPress: number
}

export function createInputState(): InputState {
  return { throttle: 0, brake: 0, steer: 0, handbrake: false, clutchPress: 0 }
}
