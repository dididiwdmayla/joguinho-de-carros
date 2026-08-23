/**
 * Canvas sizing. The backing store is kept at device-pixel resolution so
 * nothing is ever upscaled, and the drawing space stays in CSS pixels.
 */
import { clamp } from '../core/math'

/** Beyond this the extra pixels cost more than they show. */
const MAX_DEVICE_PIXEL_RATIO = 3

export interface Viewport {
  /** Drawing width in CSS pixels (exactly deviceWidth / dpr). */
  cssWidth: number
  cssHeight: number
  dpr: number
}

export function createViewport(): Viewport {
  return { cssWidth: 1, cssHeight: 1, dpr: 1 }
}

/**
 * Resizes the backing store to match the element and the current device pixel
 * ratio. Returns true when anything changed. The CSS size reported back is
 * derived from the rounded device size, so one drawing unit is always exactly
 * `dpr` device pixels and the picture can never end up stretched.
 */
export function syncViewport(canvas: HTMLCanvasElement, viewport: Viewport): boolean {
  const dpr = clamp(window.devicePixelRatio || 1, 1, MAX_DEVICE_PIXEL_RATIO)
  const rect = canvas.getBoundingClientRect()
  const deviceWidth = Math.max(1, Math.round(rect.width * dpr))
  const deviceHeight = Math.max(1, Math.round(rect.height * dpr))

  if (canvas.width === deviceWidth && canvas.height === deviceHeight && viewport.dpr === dpr) {
    return false
  }

  canvas.width = deviceWidth
  canvas.height = deviceHeight
  viewport.dpr = dpr
  viewport.cssWidth = deviceWidth / dpr
  viewport.cssHeight = deviceHeight / dpr
  return true
}
