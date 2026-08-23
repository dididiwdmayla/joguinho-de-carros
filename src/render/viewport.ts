/**
 * Canvas sizing. The backing store is kept at device-pixel resolution so
 * nothing is ever upscaled, and the drawing space stays in CSS pixels.
 */
import { clamp } from '../core/math'

/** Beyond this the extra pixels cost more than they show. */
const MAX_DEVICE_PIXEL_RATIO = 3

/**
 * Ceiling for the backing store area, in pixels.
 *
 * A large monitor at dpr 2 can ask for a canvas the browser refuses to
 * allocate, and that failure is silent: the canvas simply stops drawing.
 * Staying under a safe area, by lowering the effective dpr when needed, keeps
 * the picture correct everywhere. Raise this if a big display looks soft.
 */
const MAX_CANVAS_PIXELS = 4_000_000

/** Id of the hidden element in index.html that exposes env(safe-area-inset-*). */
const SAFE_AREA_PROBE_ID = 'safe-area-probe'

export interface SafeAreaInsets {
  top: number
  right: number
  bottom: number
  left: number
}

export interface Viewport {
  /** Drawing width in CSS pixels (exactly deviceWidth / dpr). */
  cssWidth: number
  cssHeight: number
  dpr: number
  /** Notch and gesture-bar margins, in CSS pixels. */
  safeArea: SafeAreaInsets
}

export function createViewport(): Viewport {
  const viewport: Viewport = {
    cssWidth: 1,
    cssHeight: 1,
    dpr: 1,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  }
  readSafeArea(viewport.safeArea)
  return viewport
}

/**
 * Resizes the backing store to match the element and the current device pixel
 * ratio. Returns true when the backing store actually changed size.
 *
 * The derived CSS size is written on every call, never behind the "did it
 * change" check: a freshly created Viewport still holds its 1x1 placeholder,
 * and if the canvas already happens to have the right size (because the boot
 * screen sized it) the placeholder would survive and the whole game would draw
 * into a single pixel.
 */
export function syncViewport(canvas: HTMLCanvasElement, viewport: Viewport): boolean {
  const rect = canvas.getBoundingClientRect()
  const cssWidth = Math.max(1, rect.width)
  const cssHeight = Math.max(1, rect.height)

  let dpr = clamp(window.devicePixelRatio || 1, 1, MAX_DEVICE_PIXEL_RATIO)
  const requestedArea = cssWidth * dpr * cssHeight * dpr
  if (requestedArea > MAX_CANVAS_PIXELS) {
    dpr = Math.max(0.5, dpr * Math.sqrt(MAX_CANVAS_PIXELS / requestedArea))
  }

  const deviceWidth = Math.max(1, Math.round(cssWidth * dpr))
  const deviceHeight = Math.max(1, Math.round(cssHeight * dpr))
  const resized = canvas.width !== deviceWidth || canvas.height !== deviceHeight

  if (resized) {
    canvas.width = deviceWidth
    canvas.height = deviceHeight
    if (canvas.width !== deviceWidth || canvas.height !== deviceHeight) {
      throw new Error(
        `O navegador recusou um canvas de ${deviceWidth}x${deviceHeight} pixels ` +
          `(dpr ${dpr.toFixed(2)}).`,
      )
    }
    readSafeArea(viewport.safeArea)
  }

  viewport.dpr = dpr
  viewport.cssWidth = deviceWidth / dpr
  viewport.cssHeight = deviceHeight / dpr
  return resized
}

/**
 * env(safe-area-inset-*) only exists in CSS, so a hidden element carries the
 * values as padding and we read them back here.
 */
function readSafeArea(target: SafeAreaInsets): void {
  const probe = document.getElementById(SAFE_AREA_PROBE_ID)
  if (probe === null) return
  const style = window.getComputedStyle(probe)
  target.top = parseFloat(style.paddingTop) || 0
  target.right = parseFloat(style.paddingRight) || 0
  target.bottom = parseFloat(style.paddingBottom) || 0
  target.left = parseFloat(style.paddingLeft) || 0
}
