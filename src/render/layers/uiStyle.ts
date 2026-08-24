/**
 * The look of every panel, button and caption drawn in screen space.
 *
 * Kept apart from the layers that use it so the controls, the settings menu
 * and the control editor cannot drift into three different visual languages,
 * and so none of them has to import another just to borrow a colour.
 */
import type { Rect } from '../../ui/touchLayout'
import { roundedRectPath } from '../shapes'

export const PANEL_FILL = 'rgba(10, 13, 17, 0.42)'
export const PANEL_FILL_PRESSED = 'rgba(96, 148, 208, 0.42)'
export const PANEL_FILL_SOLID = 'rgba(14, 18, 24, 0.94)'
export const PANEL_STROKE = 'rgba(255, 255, 255, 0.20)'
export const PANEL_STROKE_PRESSED = 'rgba(160, 205, 255, 0.65)'
export const GLYPH = 'rgba(226, 236, 245, 0.88)'
export const ACCENT = '#9ecbff'
export const FILL_LEVEL = 'rgba(120, 180, 245, 0.34)'

export function drawButtonBox(ctx: CanvasRenderingContext2D, rect: Rect, pressed: boolean): void {
  ctx.fillStyle = pressed ? PANEL_FILL_PRESSED : PANEL_FILL
  ctx.strokeStyle = pressed ? PANEL_STROKE_PRESSED : PANEL_STROKE
  ctx.lineWidth = 1.5
  roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, rect.height * 0.26)
  ctx.fill()
  ctx.stroke()
}

/** Centred caption, shrunk to fit rather than spilling out of its button. */
export function drawLabel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  scale: number,
  color: string = GLYPH,
): void {
  let size = Math.max(9, rect.height * scale)
  ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  const available = rect.width * 0.86
  const natural = ctx.measureText(label).width
  if (natural > available) {
    size = Math.max(7, size * (available / natural))
    ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  }
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, rect.x + rect.width / 2, rect.y + rect.height / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/**
 * Sets the row font at `scale` of the row's height, shrunk until the text fits
 * the width it was given. A label and a value share one row, so neither may
 * spill: they would land on top of each other rather than off the panel.
 */
function setRowFont(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: Rect,
  scale: number,
  maxWidth: number,
): void {
  let size = Math.max(10, rect.height * scale)
  ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  const natural = ctx.measureText(text).width
  if (natural > maxWidth) {
    size = Math.max(8, size * (maxWidth / natural))
    ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  }
}

/**
 * How wide a row's text wants to be at its natural size. A row shares its
 * width between a label and a value, and only the layer drawing it knows how
 * much each of them deserves -- so it has to be able to ask.
 */
export function rowTextWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: Rect,
  scale: number,
): number {
  const size = Math.max(10, rect.height * scale)
  ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  return ctx.measureText(text).width
}

/** Left-aligned caption inside a row, for menu entries. */
export function drawRowLabel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  scale: number,
  color: string = GLYPH,
  maxWidth: number = rect.width - rect.height * 0.8,
): void {
  setRowFont(ctx, label, rect, scale, maxWidth)
  ctx.fillStyle = color
  ctx.textAlign = 'left'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, rect.x + rect.height * 0.4, rect.y + rect.height / 2)
  ctx.textBaseline = 'alphabetic'
}

/** Right-aligned value against a menu row. */
export function drawRowValue(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  value: string,
  scale: number,
  color: string = ACCENT,
  maxWidth: number = rect.width - rect.height * 0.8,
): void {
  setRowFont(ctx, value, rect, scale, maxWidth)
  ctx.fillStyle = color
  ctx.textAlign = 'right'
  ctx.textBaseline = 'middle'
  ctx.fillText(value, rect.x + rect.width - rect.height * 0.4, rect.y + rect.height / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Vertical caption for a tall, narrow pedal. */
export function drawRotatedLabel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
): void {
  ctx.save()
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
  ctx.rotate(-Math.PI / 2)
  drawLabel(
    ctx,
    { x: -rect.height / 2, y: -rect.width / 2, width: rect.height, height: rect.width },
    label,
    0.34,
  )
  ctx.restore()
}

/**
 * A padlock on a control that has been told to latch: outlined while the
 * control is free, filled while it is holding itself down. Without it a
 * latched pedal and a pressed one look exactly alike.
 */
export function drawLatchBadge(ctx: CanvasRenderingContext2D, rect: Rect, held: boolean): void {
  const size = Math.max(9, Math.min(Math.min(rect.width, rect.height) * 0.24, 18))
  const x = rect.x + rect.width - size * 1.3
  const y = rect.y + size * 0.4
  const bodyTop = y + size * 0.42
  const color = held ? ACCENT : 'rgba(226, 236, 245, 0.42)'

  ctx.strokeStyle = color
  ctx.lineWidth = Math.max(1.2, size * 0.13)
  ctx.beginPath()
  ctx.arc(x + size / 2, bodyTop, size * 0.24, Math.PI, 0)
  ctx.stroke()

  ctx.fillStyle = color
  roundedRectPath(ctx, x + size * 0.14, bodyTop, size * 0.72, size * 0.56, size * 0.14)
  ctx.fill()
}
