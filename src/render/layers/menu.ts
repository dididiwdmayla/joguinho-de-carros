/**
 * The settings menu and the control editor.
 *
 * Both sit in front of the game, both are drawn from the rectangles
 * menuLayout.ts hands out, and neither knows anything about the car. The
 * editor is the more interesting of the two: it draws every control where it
 * currently sits, including the ones the player has hidden, because a hidden
 * control that cannot be seen is a control that can never be brought back.
 */
import { clamp } from '../../core/math'
import { CONTROL_LABELS, CONTROL_SLOTS } from '../../ui/controlLayout'
import {
  computeEditorLayout,
  computeMenuLayout,
  type EditorLayout,
} from '../../ui/menuLayout'
import type { Rect, TouchLayout } from '../../ui/touchLayout'
import { inScreenSpace } from '../renderer'
import type { RenderContext } from '../scene'
import { roundedRectPath } from '../shapes'
import {
  ACCENT,
  drawButtonBox,
  drawLabel,
  drawRowLabel,
  drawRowValue,
  GLYPH,
  PANEL_FILL_SOLID,
  PANEL_STROKE,
} from './uiStyle'

const SCRIM = 'rgba(8, 10, 14, 0.72)'
const EDIT_SCRIM = 'rgba(8, 10, 14, 0.55)'

export function drawMenu(context: RenderContext): void {
  const { ctx, viewport } = context
  const menu = computeMenuLayout(viewport, context.ui)

  inScreenSpace(context, () => {
    ctx.fillStyle = SCRIM
    ctx.fillRect(0, 0, viewport.cssWidth, viewport.cssHeight)

    const { panel } = menu
    ctx.fillStyle = PANEL_FILL_SOLID
    ctx.strokeStyle = PANEL_STROKE
    ctx.lineWidth = 1.5
    roundedRectPath(ctx, panel.x, panel.y, panel.width, panel.height, panel.height * 0.06)
    ctx.fill()
    ctx.stroke()

    const titleSize = Math.max(11, panel.width * 0.045)
    ctx.font = `600 ${titleSize.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
    ctx.fillStyle = 'rgba(127, 178, 232, 0.9)'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(menu.title, panel.x + panel.width / 2, panel.y + titleSize * 1.5)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'

    for (const row of menu.rows) {
      drawButtonBox(ctx, row.rect, false)
      drawRowLabel(ctx, row.rect, row.label, 0.34)
      if (row.value.length > 0) drawRowValue(ctx, row.rect, row.value, 0.34)
    }
  })
}

// ------------------------------------------------------------------- editor

/** Painted before the controls, so they stay readable on top of it. */
export function drawEditorScrim(context: RenderContext): void {
  const { ctx, viewport } = context
  ctx.fillStyle = EDIT_SCRIM
  ctx.fillRect(0, 0, viewport.cssWidth, viewport.cssHeight)
}

/** Painted after them: outlines, names, the bar and the resize grip. */
export function drawEditorChrome(context: RenderContext, layout: TouchLayout): void {
  const { ctx, viewport, ui } = context
  const editor = computeEditorLayout(viewport, layout, ui)

  inScreenSpace(context, () => {
    for (const slot of CONTROL_SLOTS) {
      const rect = layout.slots[slot]
      const selected = ui.editing === slot
      drawOutline(ctx, rect, selected, layout.hidden[slot])
      drawSlotName(ctx, rect, CONTROL_LABELS[slot], layout.hidden[slot])
    }

    if (editor.handle !== null) drawHandle(ctx, editor.handle)
    drawBar(ctx, editor)
    drawHint(context, editor)
  })
}

function drawOutline(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  selected: boolean,
  hidden: boolean,
): void {
  ctx.save()
  ctx.strokeStyle = selected ? ACCENT : 'rgba(226, 236, 245, 0.35)'
  ctx.lineWidth = selected ? 2.5 : 1.5
  // Hidden controls are drawn as an empty dashed box: still there to be
  // picked up and switched back on, never mistaken for a live control.
  if (hidden) ctx.setLineDash([6, 5])
  roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, Math.min(10, rect.height * 0.2))
  ctx.stroke()
  ctx.restore()
}

/**
 * The control's name on a solid chip in the middle of it. A chip rather than
 * bare type because these names land on top of the controls' own captions,
 * and two words in the same place are worse than none.
 */
function drawSlotName(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  name: string,
  hidden: boolean,
): void {
  const size = clamp(Math.min(rect.width, rect.height) * 0.2, 9, 14)
  ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  const width = Math.min(rect.width * 0.94, ctx.measureText(name).width + size * 1.1)
  const height = size * 1.9
  const chip: Rect = {
    x: rect.x + (rect.width - width) / 2,
    y: rect.y + (rect.height - height) / 2,
    width,
    height,
  }

  ctx.fillStyle = 'rgba(10, 13, 18, 0.9)'
  roundedRectPath(ctx, chip.x, chip.y, chip.width, chip.height, height / 2)
  ctx.fill()
  drawLabel(ctx, chip, name, 0.56, hidden ? 'rgba(226, 236, 245, 0.55)' : GLYPH)
}

/** The grip that resizes the selected control: drag it away to grow. */
function drawHandle(ctx: CanvasRenderingContext2D, handle: Rect): void {
  const cx = handle.x + handle.width / 2
  const cy = handle.y + handle.height / 2
  const radius = handle.width / 2

  ctx.beginPath()
  ctx.arc(cx, cy, radius, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(14, 18, 24, 0.9)'
  ctx.fill()
  ctx.strokeStyle = ACCENT
  ctx.lineWidth = 2
  ctx.stroke()

  // A diagonal arrow, which is what a corner grip means everywhere else.
  const reach = radius * 0.44
  ctx.beginPath()
  ctx.moveTo(cx - reach, cy - reach)
  ctx.lineTo(cx + reach, cy + reach)
  ctx.moveTo(cx + reach, cy + reach * 0.1)
  ctx.lineTo(cx + reach, cy + reach)
  ctx.lineTo(cx + reach * 0.1, cy + reach)
  ctx.moveTo(cx - reach, cy - reach * 0.1)
  ctx.lineTo(cx - reach, cy - reach)
  ctx.lineTo(cx - reach * 0.1, cy - reach)
  ctx.stroke()
}

function drawBar(ctx: CanvasRenderingContext2D, editor: EditorLayout): void {
  const { bar } = editor
  ctx.fillStyle = PANEL_FILL_SOLID
  ctx.strokeStyle = PANEL_STROKE
  ctx.lineWidth = 1.5
  roundedRectPath(ctx, bar.x, bar.y, bar.width, bar.height, Math.min(14, bar.height * 0.2))
  ctx.fill()
  ctx.stroke()

  for (const button of editor.buttons) {
    drawButtonBox(ctx, button.rect, false)
    drawLabel(ctx, button.rect, button.label, 0.36)
  }

  if (editor.selectionLabel !== null && editor.selectionLabelRect !== null) {
    drawLabel(ctx, editor.selectionLabelRect, editor.selectionLabel, 0.36, ACCENT)
  }
}

function drawHint(context: RenderContext, editor: EditorLayout): void {
  const { ctx, viewport } = context
  const available = viewport.cssWidth - viewport.safeArea.left - viewport.safeArea.right
  let size = clamp(viewport.cssWidth * 0.03, 10, 16)
  ctx.font = `${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  const natural = ctx.measureText(editor.hint).width
  if (natural > available * 0.94) {
    size = Math.max(8, size * ((available * 0.94) / natural))
    ctx.font = `${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  }
  ctx.fillStyle = 'rgba(215, 226, 234, 0.72)'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText(editor.hint, viewport.cssWidth / 2, editor.bar.y + editor.bar.height + size * 0.6)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}
