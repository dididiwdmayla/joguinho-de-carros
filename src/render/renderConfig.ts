/** Purely visual constants. Nothing here feeds the simulation. */

/** Drop shadow under a car. */
export const SHADOW_ALPHA = 0.42
/** Fixed world-space offset of the shadow [m] (light comes from up-left). */
export const SHADOW_OFFSET_X = 0.16
export const SHADOW_OFFSET_Y = 0.28
/** Shadow size relative to the body footprint. */
export const SHADOW_SCALE = 0.48

/**
 * Wheels are drawn in code, under the body sprite. Their size and track come
 * from the car file; only the look lives here.
 */
export const WHEEL_COLOR = '#15171b'
/** Corner rounding as a fraction of the tyre width. */
export const WHEEL_CORNER_FRACTION = 0.34

/** Ground colour behind the tiles, only visible for a frame while loading. */
export const VOID_COLOR = '#14161a'
