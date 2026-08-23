/**
 * Canvas messages for the moments before the loop owns the screen: loading and
 * fatal errors. On a phone there is no console, so failures have to be visible.
 */
import { VOID_COLOR } from '../render/renderConfig'
import { syncViewport, type Viewport } from '../render/viewport'

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/)
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const candidate = line.length === 0 ? word : `${line} ${word}`
    if (ctx.measureText(candidate).width > maxWidth && line.length > 0) {
      lines.push(line)
      line = word
    } else {
      line = candidate
    }
  }
  if (line.length > 0) lines.push(line)
  return lines
}

export function drawBootMessage(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  message: string,
  color: string,
): void {
  syncViewport(canvas, viewport)
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)
  ctx.fillStyle = VOID_COLOR
  ctx.fillRect(0, 0, viewport.cssWidth, viewport.cssHeight)

  const fontSize = Math.round(Math.min(viewport.cssWidth, viewport.cssHeight) * 0.035) + 6
  ctx.font = `${Math.min(fontSize, 22)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const maxWidth = viewport.cssWidth * 0.86
  const lines = wrap(ctx, message, maxWidth)
  const lineHeight = Math.min(fontSize, 22) * 1.5
  let y = viewport.cssHeight / 2 - ((lines.length - 1) * lineHeight) / 2
  for (const line of lines) {
    ctx.fillText(line, viewport.cssWidth / 2, y)
    y += lineHeight
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}
