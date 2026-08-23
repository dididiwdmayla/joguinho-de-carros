/** Purely visual constants. Nothing here feeds the simulation. */

/** Drop shadow under a car. */
export const SHADOW_ALPHA = 0.42
/** Fixed world-space offset of the shadow [m] (light comes from up-left). */
export const SHADOW_OFFSET_X = 0.16
export const SHADOW_OFFSET_Y = 0.28
/** Shadow size relative to the body footprint. */
export const SHADOW_SCALE = 0.48

/** Front wheels, drawn in code so the steering angle is readable. */
export const WHEEL_LENGTH = 0.62
export const WHEEL_WIDTH = 0.21
export const WHEEL_CORNER_RADIUS = 0.07
/** Wheel track as a fraction of the body width. */
export const WHEEL_TRACK_FRACTION = 0.86
export const WHEEL_COLOR = '#191c21'

/** Ground colour behind the tiles, only visible for a frame while loading. */
export const VOID_COLOR = '#14161a'
