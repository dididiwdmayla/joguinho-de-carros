/**
 * Global constants.
 *
 * The whole simulation works in SI units: metres, seconds, kilograms, newtons
 * and radians. Pixels only exist inside the render layer.
 *
 * World axes: +X points right, +Y points down, and yaw 0 means the car points
 * at +X (which is how the sprites were drawn). A positive yaw rate therefore
 * turns the nose clockwise on screen, i.e. to the car's right.
 */

/** Render scale: how many screen pixels one metre of world occupies. */
export const PIXELS_PER_METER = 32

/** Physics tick length in seconds. The simulation always runs at 60 Hz. */
export const FIXED_DT = 1 / 60

/**
 * Upper bound of physics steps consumed in a single frame. Without it a tab
 * returning from the background would try to catch up on minutes of missed
 * time and spiral into an ever growing backlog.
 */
export const MAX_STEPS_PER_FRAME = 5

/** Standard gravity [m/s^2]. */
export const GRAVITY = 9.81

export const TAU = Math.PI * 2
