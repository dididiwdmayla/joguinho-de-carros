/**
 * UI layer: everything drawn in screen space.
 *
 * The on-screen controls live here, laid out by the same module the input
 * layer hit tests against, so what is drawn and what responds can never drift
 * apart. Everything is drawn in code -- no images, nothing persisted.
 */
import { clamp } from '../../core/math'
import { drawDebugOverlay } from '../../debug/overlay'
import {
  computeTouchLayout,
  steeringKnobDiameter,
  type Rect,
  type TouchLayout,
} from '../../ui/touchLayout'
import { inScreenSpace } from '../renderer'
import type { RenderContext } from '../scene'
import { roundedRectPath } from '../shapes'

const PANEL_FILL = 'rgba(10, 13, 17, 0.42)'
const PANEL_FILL_PRESSED = 'rgba(96, 148, 208, 0.42)'
const PANEL_STROKE = 'rgba(255, 255, 255, 0.20)'
const PANEL_STROKE_PRESSED = 'rgba(160, 205, 255, 0.65)'
const GLYPH = 'rgba(226, 236, 245, 0.88)'
const FILL_LEVEL = 'rgba(120, 180, 245, 0.34)'

export function drawUi(context: RenderContext): void {
  const layout = computeTouchLayout(context.viewport)

  inScreenSpace(context, () => {
    drawButtons(context, layout)
    if (context.ui.controlsVisible) {
      drawSteering(context, layout)
      drawPedals(context, layout)
      drawHandbrake(context, layout)
    }
    if (context.ui.rotateHintVisible) drawRotateHint(context, layout)
  })

  if (context.debug !== null) drawDebugOverlay(context, context.debug)
  if (context.ui.instructionsVisible) drawInstructions(context)
}

// ------------------------------------------------------------------ buttons

function drawButtons(context: RenderContext, layout: TouchLayout): void {
  const { ctx, ui } = context
  drawButtonBox(ctx, layout.controlsButton, ui.pressedButton === 'controls')
  drawControlsGlyph(ctx, layout.controlsButton, ui.controlsVisible)

  drawButtonBox(ctx, layout.debugButton, ui.pressedButton === 'debug')
  drawDebugGlyph(ctx, layout.debugButton)

  if (ui.controlsVisible) {
    drawButtonBox(ctx, layout.fullscreenButton, ui.pressedButton === 'fullscreen')
    drawFullscreenGlyph(ctx, layout.fullscreenButton, ui.fullscreenActive)
  }
}

function drawButtonBox(ctx: CanvasRenderingContext2D, rect: Rect, pressed: boolean): void {
  ctx.fillStyle = pressed ? PANEL_FILL_PRESSED : PANEL_FILL
  ctx.strokeStyle = pressed ? PANEL_STROKE_PRESSED : PANEL_STROKE
  ctx.lineWidth = 1.5
  roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, rect.height * 0.26)
  ctx.fill()
  ctx.stroke()
}

/** Three bars: the control layer itself. Crossed through when hidden. */
function drawControlsGlyph(ctx: CanvasRenderingContext2D, rect: Rect, visible: boolean): void {
  const barWidth = rect.width * 0.5
  const barHeight = Math.max(1.5, rect.height * 0.075)
  ctx.fillStyle = GLYPH
  for (let i = 0; i < 3; i++) {
    const y = rect.y + rect.height * (0.32 + i * 0.18) - barHeight / 2
    ctx.fillRect(rect.x + (rect.width - barWidth) / 2, y, barWidth, barHeight)
  }
  if (visible) return
  ctx.strokeStyle = GLYPH
  ctx.lineWidth = Math.max(1.5, rect.height * 0.07)
  ctx.beginPath()
  ctx.moveTo(rect.x + rect.width * 0.22, rect.y + rect.height * 0.78)
  ctx.lineTo(rect.x + rect.width * 0.78, rect.y + rect.height * 0.22)
  ctx.stroke()
}

function drawDebugGlyph(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const size = rect.height * 0.42
  ctx.font = `${size.toFixed(0)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
  ctx.fillStyle = GLYPH
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('0.0', rect.x + rect.width / 2, rect.y + rect.height / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/** Four corner brackets, pointing out to enter and in to leave. */
function drawFullscreenGlyph(ctx: CanvasRenderingContext2D, rect: Rect, active: boolean): void {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const outer = rect.width * 0.28
  const inner = rect.width * 0.12
  ctx.strokeStyle = GLYPH
  ctx.lineWidth = Math.max(1.5, rect.width * 0.07)
  ctx.beginPath()
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const near = active ? outer : inner
      const far = active ? inner : outer
      ctx.moveTo(cx + sx * far, cy + sy * near)
      ctx.lineTo(cx + sx * far, cy + sy * far)
      ctx.lineTo(cx + sx * near, cy + sy * far)
    }
  }
  ctx.stroke()
}

// ----------------------------------------------------------------- steering

function drawSteering(context: RenderContext, layout: TouchLayout): void {
  const { ctx, input, ui } = context
  const rect = layout.steering
  const radius = rect.height / 2

  ctx.fillStyle = PANEL_FILL
  ctx.strokeStyle = ui.steeringActive ? PANEL_STROKE_PRESSED : PANEL_STROKE
  ctx.lineWidth = 1.5
  roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius)
  ctx.fill()
  ctx.stroke()

  // Centre notch, so the straight-ahead position is visible at a glance.
  const centre = rect.x + rect.width / 2
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.22)'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(centre, rect.y + rect.height * 0.22)
  ctx.lineTo(centre, rect.y + rect.height * 0.78)
  ctx.stroke()

  const knob = steeringKnobDiameter(layout)
  const knobX = centre + clamp(input.steer, -1, 1) * layout.steeringTravel
  ctx.fillStyle = ui.steeringActive ? 'rgba(150, 200, 255, 0.62)' : 'rgba(220, 232, 244, 0.42)'
  ctx.strokeStyle = PANEL_STROKE
  ctx.beginPath()
  ctx.arc(knobX, rect.y + rect.height / 2, knob / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

// ------------------------------------------------------------------- pedals

function drawPedals(context: RenderContext, layout: TouchLayout): void {
  const { ctx, input } = context
  drawPedal(ctx, layout.throttle, input.throttle, 'up', 'GAS')
  drawPedal(ctx, layout.brake, input.brake, 'down', 'FREIO')
}

/**
 * A pedal fills from the edge the finger travels towards, so the amount being
 * applied is visible while it is held.
 */
function drawPedal(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  amount: number,
  direction: 'up' | 'down',
  label: string,
): void {
  const pressed = amount > 0
  const radius = rect.height * 0.24

  ctx.save()
  roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius)
  ctx.fillStyle = pressed ? PANEL_FILL_PRESSED : PANEL_FILL
  ctx.fill()

  if (pressed) {
    const filled = rect.height * clamp(amount, 0, 1)
    ctx.clip()
    ctx.fillStyle = FILL_LEVEL
    const y = direction === 'up' ? rect.y + rect.height - filled : rect.y
    ctx.fillRect(rect.x, y, rect.width, filled)
  }
  ctx.restore()

  ctx.strokeStyle = pressed ? PANEL_STROKE_PRESSED : PANEL_STROKE
  ctx.lineWidth = 1.5
  roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius)
  ctx.stroke()

  const size = Math.max(10, rect.height * 0.24)
  ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.fillStyle = GLYPH
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, rect.x + rect.width / 2, rect.y + rect.height / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

function drawHandbrake(context: RenderContext, layout: TouchLayout): void {
  const { ctx, input } = context
  const rect = layout.handbrake
  drawButtonBox(ctx, rect, input.handbrake)
  const size = Math.max(10, rect.height * 0.3)
  ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.fillStyle = GLYPH
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('MAO', rect.x + rect.width / 2, rect.y + rect.height / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

// -------------------------------------------------------------------- hints

function drawRotateHint(context: RenderContext, layout: TouchLayout): void {
  const { ctx, viewport } = context
  const text = 'gire o aparelho para paisagem'
  // Sits under the button row, and shrinks to fit rather than running off the
  // edge on a narrow phone held upright.
  const available =
    viewport.cssWidth - viewport.safeArea.left - viewport.safeArea.right - layout.unit * 0.4
  let size = clamp(viewport.cssWidth * 0.038, 11, 20)
  ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  const natural = ctx.measureText(text).width + size * 2
  if (natural > available) {
    size = Math.max(9, size * (available / natural))
    ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  }
  const width = Math.min(available, ctx.measureText(text).width + size * 2)
  const height = size * 2.4
  const x = (viewport.cssWidth - width) / 2
  const y = layout.controlsButton.y + layout.controlsButton.height + layout.unit * 0.2

  ctx.fillStyle = 'rgba(10, 13, 17, 0.78)'
  ctx.strokeStyle = PANEL_STROKE
  ctx.lineWidth = 1.5
  roundedRectPath(ctx, x, y, width, height, height / 2)
  ctx.fill()
  ctx.stroke()

  ctx.fillStyle = GLYPH
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, viewport.cssWidth / 2, y + height / 2)
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

interface InstructionLine {
  text: string
  heading?: boolean
}

const INSTRUCTION_LINES: readonly InstructionLine[] = [
  { text: 'TECLADO', heading: true },
  { text: 'W / seta cima      acelerar' },
  { text: 'S / seta baixo     frear' },
  { text: 'A D / setas        estercar' },
  { text: 'espaco             freio de mao' },
  { text: 'F3 ou `            debug' },
  { text: '' },
  { text: 'TOQUE', heading: true },
  { text: 'barra a esquerda   estercar' },
  { text: 'pedais a direita   acelerar / frear' },
  { text: 'MAO                freio de mao' },
  { text: 'botoes no topo     controles, tela cheia, debug' },
]

function drawInstructions(context: RenderContext): void {
  const { ctx, viewport } = context

  inScreenSpace(context, () => {
    ctx.fillStyle = 'rgba(8, 10, 14, 0.72)'
    ctx.fillRect(0, 0, viewport.cssWidth, viewport.cssHeight)

    const usableHeight = viewport.cssHeight - viewport.safeArea.top - viewport.safeArea.bottom
    const size = clamp(Math.min(viewport.cssWidth * 0.028, usableHeight * 0.042), 11, 18)
    const lineHeight = size * 1.55
    ctx.font = `${size.toFixed(0)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`

    let textWidth = 0
    for (const line of INSTRUCTION_LINES) {
      textWidth = Math.max(textWidth, ctx.measureText(line.text).width)
    }

    const footer = 'toque na tela ou pressione uma tecla'
    const padding = size * 1.6
    const panelWidth = Math.max(textWidth, ctx.measureText(footer).width) + padding * 2
    const panelHeight = (INSTRUCTION_LINES.length + 2.6) * lineHeight + padding
    const x = (viewport.cssWidth - panelWidth) / 2
    const y =
      viewport.safeArea.top + Math.max(0, (usableHeight - panelHeight) / 2)

    ctx.fillStyle = 'rgba(14, 18, 24, 0.94)'
    ctx.strokeStyle = PANEL_STROKE
    ctx.lineWidth = 1.5
    roundedRectPath(ctx, x, y, panelWidth, panelHeight, size)
    ctx.fill()
    ctx.stroke()

    let cursor = y + padding * 0.7
    ctx.textBaseline = 'top'
    for (const line of INSTRUCTION_LINES) {
      ctx.fillStyle = line.heading === true ? '#7fb2e8' : '#d7e2ea'
      ctx.fillText(line.text, x + padding, cursor)
      cursor += lineHeight
    }

    ctx.fillStyle = 'rgba(215, 226, 234, 0.62)'
    ctx.textAlign = 'center'
    ctx.fillText(footer, viewport.cssWidth / 2, cursor + lineHeight * 0.4)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  })
}
