/**
 * Fullscreen and orientation, with the vendor-prefixed fallbacks still needed
 * on Safari. Everything here is best effort: an API that is missing or refuses
 * must never throw into the caller, because these are called straight from a
 * touch handler.
 */

interface PrefixedDocument extends Document {
  webkitFullscreenElement?: Element | null
  webkitExitFullscreen?: () => void
}

interface PrefixedElement extends HTMLElement {
  webkitRequestFullscreen?: () => void
}

interface LockableOrientation extends ScreenOrientation {
  lock?: (orientation: string) => Promise<void>
}

export function isFullscreen(): boolean {
  const doc = document as PrefixedDocument
  return doc.fullscreenElement !== null || (doc.webkitFullscreenElement ?? null) !== null
}

/** Enters fullscreen on `element`, or leaves it if already there. */
export function toggleFullscreen(element: HTMLElement): void {
  const doc = document as PrefixedDocument
  const target = element as PrefixedElement
  try {
    if (isFullscreen()) {
      if (typeof doc.exitFullscreen === 'function') void doc.exitFullscreen()
      else if (typeof doc.webkitExitFullscreen === 'function') doc.webkitExitFullscreen()
      return
    }
    if (typeof target.requestFullscreen === 'function') {
      // iOS Safari on the phone has no element fullscreen at all: the promise
      // rejects and we simply stay windowed.
      void target.requestFullscreen().catch(() => undefined)
    } else if (typeof target.webkitRequestFullscreen === 'function') {
      target.webkitRequestFullscreen()
    }
  } catch {
    // Nothing to do: the player stays in the window.
  }
}

/**
 * Tries to pin the screen to landscape. Resolves to false whenever the browser
 * does not support it (every desktop, and iOS), which is the cue to ask the
 * player to rotate the device instead.
 */
export async function lockLandscape(): Promise<boolean> {
  try {
    const orientation = window.screen?.orientation as LockableOrientation | undefined
    if (orientation === undefined || typeof orientation.lock !== 'function') return false
    await orientation.lock('landscape')
    return true
  } catch {
    return false
  }
}

/** Runs `listener` whenever the browser enters or leaves fullscreen. */
export function onFullscreenChange(listener: () => void): void {
  document.addEventListener('fullscreenchange', listener)
  document.addEventListener('webkitfullscreenchange', listener)
}
