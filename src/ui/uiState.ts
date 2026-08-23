/** Screen-layer state: what is on show and what is being pressed right now. */

export type UiButton = 'controls' | 'fullscreen' | 'debug'

export interface UiState {
  /** Touch control layer. Hidden by default when there is no touch screen. */
  controlsVisible: boolean
  /** First-run instructions, dismissed by the first key or touch. */
  instructionsVisible: boolean
  debugVisible: boolean
  fullscreenActive: boolean
  /** True once the orientation could actually be locked to landscape. */
  orientationLocked: boolean
  /** Asks the player to rotate when the lock is unavailable and we are upright. */
  rotateHintVisible: boolean
  /** Button currently held down, for the pressed state. */
  pressedButton: UiButton | null
  /** True while a finger owns the steering control. */
  steeringActive: boolean
}

export function createUiState(controlsVisible: boolean): UiState {
  return {
    controlsVisible,
    instructionsVisible: true,
    debugVisible: false,
    fullscreenActive: false,
    orientationLocked: false,
    rotateHintVisible: false,
    pressedButton: null,
    steeringActive: false,
  }
}

/**
 * Whether this machine is likely to be driven by fingers. Used only to pick the
 * initial visibility of the touch layer -- no code path depends on it, so a
 * wrong answer costs a button press, never a broken start.
 */
export function prefersTouchControls(): boolean {
  try {
    // The primary pointer, not merely the presence of a touch screen: a laptop
    // with a touch display is still driven with the keyboard.
    if (typeof window.matchMedia === 'function') {
      return window.matchMedia('(pointer: coarse)').matches
    }
    return typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0
  } catch {
    return false
  }
}
