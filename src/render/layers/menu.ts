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
  rowTextWidth,
} from './uiStyle'

const SCRIM = 'rgba(8, 10, 14, 0.72)'
const EDIT_SCRIM = 'rgba(8, 10, 14, 0.55)'
const TITLE_COLOR = 'rgba(127, 178, 232, 0.9)'
/** Section notes and the fuel's own line: present, but never shouting. */
const NOTE_COLOR = 'rgba(196, 210, 222, 0.6)'
/** The rule between the two halves of the menu. */
const DIVIDER = 'rgba(255, 255, 255, 0.12)'
const MENU_FONT = 'system-ui, -apple-system, Segoe UI, sans-serif'
/** A hint gets two lines before it starts being shrunk to fit. */
const MAX_HINT_LINES = 2
/** Type size inside a menu row, as a fraction of the row's height. */
const ROW_TEXT = 0.34

export function drawMenu(context: RenderContext): void {
  const { ctx, viewport } = context
  const menu = computeMenuLayout(viewport, context.ui)
  // Rows inset their own text by this much, and the section headings above
  // them line up with it rather than with the edge of the panel.
  const inset = menu.rowHeight * 0.4

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

    drawCentred(ctx, menu.titleRect, menu.title, 0.72, TITLE_COLOR)

    if (menu.divider !== null) {
      ctx.fillStyle = DIVIDER
      ctx.fillRect(menu.divider.x, menu.divider.y, menu.divider.width, menu.divider.height)
    }

    for (const section of menu.sections) {
      drawAligned(ctx, section.titleRect, section.title, 0.68, ACCENT, inset)
      drawAligned(ctx, section.noteRect, section.note, 0.68, NOTE_COLOR, inset)

      for (const row of section.rows) {
        drawButtonBox(ctx, row.rect, false)
        // The value takes what it needs, up to half the row, and the label
        // gets the rest. A fixed split would either cramp "SIMULACAO" or
        // shrink every label on the panel to make room for it.
        const edges = row.rect.height * 0.4 * 2 + row.rect.height * 0.4
        const free = row.rect.width - edges
        const value = row.value.length === 0
          ? 0
          : Math.min(rowTextWidth(ctx, row.value, row.rect, ROW_TEXT), free * 0.55)
        drawRowLabel(ctx, row.rect, row.label, ROW_TEXT, GLYPH, free - value)
        if (row.value.length > 0) {
          drawRowValue(ctx, row.rect, row.value, ROW_TEXT, ACCENT, value)
        }
      }

      if (section.hintRect !== null) {
        drawWrapped(ctx, section.hintRect, section.hint, NOTE_COLOR, inset)
      }
    }

    drawButtonBox(ctx, menu.close.rect, false)
    drawLabel(ctx, menu.close.rect, menu.close.label, ROW_TEXT)
  })
}

/** One line of type, left-aligned to the same inset the rows use. */
function drawAligned(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  text: string,
  scale: number,
  color: string,
  inset: number,
): void {
  const size = fitText(ctx, text, rect.height * scale, rect.width - inset * 2)
  ctx.fillStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, rect.x + inset, rect.y + rect.height / 2 + size * 0.05)
  ctx.textBaseline = 'alphabetic'
}

function drawCentred(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  text: string,
  scale: number,
  color: string,
): void {
  fitText(ctx, text, rect.height * scale, rect.width * 0.9)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, rect.x + rect.width / 2, rect.y + rect.height / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/**
 * The fuel's one line about itself, over two lines if that is what it takes.
 * Wrapped rather than shrunk: a sentence squeezed onto one line ends up too
 * small to read, which defeats the point of writing it.
 */
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  text: string,
  color: string,
  inset: number,
): void {
  const available = rect.width - inset * 2
  const size = fitText(ctx, text, rect.height * 0.4, available * MAX_HINT_LINES)
  const lines = wrapText(ctx, text, available, MAX_HINT_LINES)
  const lineHeight = size * 1.25
  const first = rect.y + rect.height / 2 - ((lines.length - 1) * lineHeight) / 2

  ctx.fillStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  for (let i = 0; i < lines.length; i++) {
    ctx.fillText(lines[i], rect.x + inset, first + i * lineHeight)
  }
  ctx.textBaseline = 'alphabetic'
}

/** Sets the font at `size`, shrunk until the text fits in `available`. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  available: number,
): number {
  let chosen = Math.max(8, size)
  ctx.font = `600 ${chosen.toFixed(0)}px ${MENU_FONT}`
  const natural = ctx.measureText(text).width
  if (natural > available) {
    chosen = Math.max(7, chosen * (available / natural))
    ctx.font = `600 ${chosen.toFixed(0)}px ${MENU_FONT}`
  }
  return chosen
}

/** Greedy word wrap, with the tail crammed onto the last line it is given. */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  available: number,
  maxLines: number,
): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(' ')) {
    const candidate = line.length === 0 ? word : `${line} ${word}`
    if (ctx.measureText(candidate).width <= available || line.length === 0) {
      line = candidate
      continue
    }
    if (lines.length === maxLines - 1) {
      line = candidate
      continue
    }
    lines.push(line)
    line = word
  }
  lines.push(line)
  return lines
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
