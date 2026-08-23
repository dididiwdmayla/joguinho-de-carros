/**
 * Debug readout. Without these numbers the physics cannot be tuned: every
 * value the tyre model depends on is printed here, per axle.
 */
import { clamp, radToDeg } from '../core/math'
import { inScreenSpace } from '../render/renderer'
import type { RenderContext } from '../render/scene'
import { roundedRectPath } from '../render/shapes'
import { gearLabel, transmissionModeLabel } from '../vehicle/powertrain'
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
  const p = t.powertrain
  const engine = p.running ? p.rpm.toFixed(0) : p.stalled ? 'morto' : '--'
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
    row('Fx tot', t.longitudinalForce.toFixed(0), 'N'),
    row('rpm', engine, ''),
    row('marcha', gearLabel(p.gear), ''),
    row('cambio', transmissionModeLabel(p.mode), ''),
    row('embreag', p.clutch.toFixed(2), ''),
    row('engate', p.engagement.toFixed(2), ''),
    row('dRpm', p.deltaRpm.toFixed(0), ''),
    row('T motor', p.engineTorque.toFixed(0), 'Nm'),
    row('T embr', p.clutchTorque.toFixed(0), 'Nm'),
    row('Fx roda', p.driveForce.toFixed(0), 'N'),
    row('limite', p.tractionLimit.toFixed(0), 'N'),
    row('patina', p.wheelspin ? `sim ${p.wheelSlip.toFixed(2)}` : 'nao', p.wheelspin ? 'm/s' : ''),
    row('acopl', p.locked ? 'travada' : 'patina', ''),
    row('fps', frame.fps.toFixed(0), ''),
  ]
}

export function drawDebugOverlay(context: RenderContext, frame: DebugFrame): void {
  const { ctx, viewport } = context
  const lines = buildLines(frame)

  inScreenSpace(context, () => {
    const fontSize = clamp(
      Math.round(Math.min(viewport.cssWidth, viewport.cssHeight) * 0.032),
      12,
      16,
    )
    const lineHeight = Math.round(fontSize * 1.45)
    ctx.font = `${fontSize}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
    ctx.textBaseline = 'top'

    let columnWidth = 0
    for (const line of lines) columnWidth = Math.max(columnWidth, ctx.measureText(line).width)

    // Inside the safe area: the notch must never eat the readout.
    const left = viewport.safeArea.left + PANEL_MARGIN
    const top = viewport.safeArea.top + PANEL_MARGIN
    // The readout grew past the height of a phone held sideways, so it wraps
    // into as many columns as it takes rather than running off the screen.
    // Capped well short of the bottom edge so it never buries a control.
    const available =
      (viewport.cssHeight - viewport.safeArea.bottom - top) * 0.6 - PANEL_PADDING * 2
    const perColumn = Math.max(1, Math.floor(available / lineHeight))
    const columns = Math.ceil(lines.length / perColumn)
    const rows = Math.ceil(lines.length / columns)

    const panelWidth = columns * columnWidth + (columns - 1) * PANEL_PADDING + PANEL_PADDING * 2
    const panelHeight = rows * lineHeight + PANEL_PADDING * 2

    ctx.fillStyle = 'rgba(8, 10, 13, 0.74)'
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.10)'
    ctx.lineWidth = 1
    roundedRectPath(ctx, left, top, panelWidth, panelHeight, 8)
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = '#d7e2ea'
    for (let i = 0; i < lines.length; i++) {
      const column = Math.floor(i / rows)
      const row = i % rows
      ctx.fillText(
        lines[i],
        left + PANEL_PADDING + column * (columnWidth + PANEL_PADDING),
        top + PANEL_PADDING + row * lineHeight,
      )
    }
    ctx.textBaseline = 'alphabetic'
  })
}
