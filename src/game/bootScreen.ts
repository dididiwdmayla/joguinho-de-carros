/**
 * Canvas messages for the moments the game loop does not own the screen:
 * loading, and anything that goes wrong. On a phone there is no console, so a
 * failure that only reaches console.error is a failure nobody can read.
 */
import { VOID_COLOR } from '../render/renderConfig'
import { syncViewport, type Viewport } from '../render/viewport'

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (text.length === 0) return ['']
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

/** Paints a centred message, replacing whatever was on the canvas. */
export function drawBootMessage(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  viewport: Viewport,
  paragraphs: readonly string[],
  color: string,
): void {
  try {
    syncViewport(canvas, viewport)
  } catch {
    // Even a canvas we failed to resize can usually still be painted.
  }
  ctx.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0)
  ctx.fillStyle = VOID_COLOR
  ctx.fillRect(0, 0, viewport.cssWidth, viewport.cssHeight)

  const fontSize = Math.min(
    22,
    Math.round(Math.min(viewport.cssWidth, viewport.cssHeight) * 0.035) + 6,
  )
  ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const maxWidth = Math.max(80, viewport.cssWidth - viewport.safeArea.left - viewport.safeArea.right - 40)
  const lines: string[] = []
  for (const paragraph of paragraphs) lines.push(...wrap(ctx, paragraph, maxWidth))

  const lineHeight = fontSize * 1.5
  let y = viewport.cssHeight / 2 - ((lines.length - 1) * lineHeight) / 2
  for (const line of lines) {
    ctx.fillText(line, viewport.cssWidth / 2, y)
    y += lineHeight
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Turns any thrown value into lines a person can read on a phone. */
export function describeError(error: unknown): string[] {
  if (error instanceof Error) {
    const where = (error.stack ?? '').split('\n')[1]?.trim() ?? ''
    const lines = [`${error.name}: ${error.message}`]
    if (where.length > 0) lines.push(where)
    return lines
  }
  return [String(error)]
}
