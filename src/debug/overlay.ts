/**
 * Debug readout. Without these numbers the physics cannot be tuned: every
 * value the tyre model depends on is printed here, per axle.
 */
import { clamp, radToDeg } from '../core/math'
import { debugCornerRect } from '../input/InputManager'
import { inScreenSpace } from '../render/renderer'
import type { RenderContext } from '../render/scene'
import type { DebugFrame } from './debugFrame'

const PANEL_MARGIN = 12
const PANEL_PADDING = 10
const LABEL_WIDTH = 9
const VALUE_WIDTH = 9

function row(label: string, value: string, unit: string): string {
  return `${label.padEnd(LABEL_WIDTH)}${value.padStart(VALUE_WIDTH)} ${unit}`
}

function buildLines(frame: DebugFrame): string[] {
  const t = frame.telemetry
  return [
    row('vel', (t.speed * 3.6).toFixed(1), 'km/h'),
    row('vx', frame.vx.toFixed(2), 'm/s'),
    row('vy', frame.vy.toFixed(2), 'm/s'),
    row('yawRate', frame.yawRate.toFixed(3), 'rad/s'),
    row('steer', radToDeg(frame.steer).toFixed(1), 'deg'),
    row('slip F', radToDeg(t.slipFront).toFixed(2), 'deg'),
    row('slip R', radToDeg(t.slipRear).toFixed(2), 'deg'),
    row('Fz F', t.loadFront.toFixed(0), 'N'),
    row('Fz R', t.loadRear.toFixed(0), 'N'),
    row('Fy F', t.lateralFront.toFixed(0), 'N'),
    row('Fy R', t.lateralRear.toFixed(0), 'N'),
    row('blend t', t.blend.toFixed(3), ''),
    row('ax', t.longitudinalAcceleration.toFixed(2), 'm/s2'),
    row('fps', frame.fps.toFixed(0), ''),
  ]
}

export function drawDebugOverlay(context: RenderContext, frame: DebugFrame): void {
  const { ctx, viewport } = context
  const lines = buildLines(frame)

  inScreenSpace(context, () => {
    const fontSize = clamp(Math.round(Math.min(viewport.cssWidth, viewport.cssHeight) * 0.032), 12, 16)
    const lineHeight = Math.round(fontSize * 1.45)
    ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
    ctx.textBaseline = 'top'

    let textWidth = 0
    for (const line of lines) textWidth = Math.max(textWidth, ctx.measureText(line).width)

    const panelWidth = textWidth + PANEL_PADDING * 2
    const panelHeight = lines.length * lineHeight + PANEL_PADDING * 2

    ctx.fillStyle = 'rgba(8, 10, 13, 0.74)'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.roundRect(PANEL_MARGIN, PANEL_MARGIN, panelWidth, panelHeight, 8)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#d7e2ea'
    let y = PANEL_MARGIN + PANEL_PADDING
    for (const line of lines) {
      ctx.fillText(line, PANEL_MARGIN + PANEL_PADDING, y)
      y += lineHeight
    }
  })
}

/** Marks the tappable corner, so the overlay is reachable without a keyboard. */
export function drawDebugCorner(context: RenderContext): void {
  const { ctx, viewport } = context
  const corner = debugCornerRect(viewport.cssWidth, viewport.cssHeight)
  const inset = corner.size * 0.28
  const box = {
    x: corner.x + inset,
    y: corner.y + inset,
    size: corner.size - inset * 2,
  }

  inScreenSpace(context, () => {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)'
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.roundRect(box.x, box.y, box.size, box.size, box.size * 0.24)
    ctx.stroke()

    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
    const barWidth = box.size * 0.52
    const barHeight = Math.max(1.5, box.size * 0.08)
    for (let i = 0; i < 3; i++) {
      const y = box.y + box.size * (0.28 + i * 0.22) - barHeight / 2
      ctx.fillRect(box.x + (box.size - barWidth) / 2, y, barWidth, barHeight)
    }
  })
}
