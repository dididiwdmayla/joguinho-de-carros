/**
 * UI layer: screen-space overlays. In this stage that is only the debug
 * readout and the corner that toggles it without a keyboard.
 */
import { drawDebugCorner, drawDebugOverlay } from '../../debug/overlay'
import type { RenderContext } from '../scene'

export function drawUi(context: RenderContext): void {
  if (context.debugCornerVisible) drawDebugCorner(context)
  if (context.debug !== null) drawDebugOverlay(context, context.debug)
}
