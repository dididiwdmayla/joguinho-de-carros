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
import { NEUTRAL_GEAR, REVERSE_GEAR } from '../../vehicle/powertrain'
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
      drawClutch(context, layout)
      drawGearbox(context, layout)
    }
    if (context.ui.rotateHintVisible) drawRotateHint(context, layout)
  })

  if (context.debug !== null) drawDebugOverlay(context, context.debug)
  if (context.ui.instructionsVisible) drawInstructions(context)
}

// ------------------------------------------------------------------ buttons

function drawButtons(context: RenderContext, layout: TouchLayout): void {
  const { ctx, ui } = context
  drawButtonBox(ctx, layout.controlsButton, ui.pressedButtons.has('controls'))
  drawControlsGlyph(ctx, layout.controlsButton, ui.controlsVisible)

  drawButtonBox(ctx, layout.debugButton, ui.pressedButtons.has('debug'))
  drawDebugGlyph(ctx, layout.debugButton)

  if (ui.controlsVisible) {
    drawButtonBox(ctx, layout.fullscreenButton, ui.pressedButtons.has('fullscreen'))
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

  drawLabel(ctx, rect, label, 0.24)
}

function drawHandbrake(context: RenderContext, layout: TouchLayout): void {
  const { ctx, input } = context
  const rect = layout.handbrake
  drawButtonBox(ctx, rect, input.handbrake)
  drawLabel(ctx, rect, 'MAO', 0.3)
}

// ---------------------------------------------------------------- powertrain

/**
 * The clutch fills from the left as the pedal goes down, so the friction point
 * is something you can see as well as feel. Same travel as the key: held means
 * going down, released means coming back up.
 */
function drawClutch(context: RenderContext, layout: TouchLayout): void {
  const { ctx, powertrain } = context
  const rect = layout.clutch
  const pressed = clamp(1 - powertrain.clutch, 0, 1)
  const held = context.ui.pressedButtons.has('clutch') || context.input.clutchPress > 0
  const radius = rect.height * 0.24

  ctx.save()
  roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius)
  ctx.fillStyle = held ? PANEL_FILL_PRESSED : PANEL_FILL
  ctx.fill()
  if (pressed > 0) {
    ctx.clip()
    ctx.fillStyle = FILL_LEVEL
    ctx.fillRect(rect.x, rect.y, rect.width * pressed, rect.height)
  }
  ctx.restore()

  ctx.strokeStyle = held ? PANEL_STROKE_PRESSED : PANEL_STROKE
  ctx.lineWidth = 1.5
  roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius)
  ctx.stroke()

  drawLabel(ctx, rect, 'EMBREAGEM', 0.24)
}

function drawGearbox(context: RenderContext, layout: TouchLayout): void {
  const { ctx, ui, powertrain } = context
  drawButtonBox(ctx, layout.gearUp, ui.pressedButtons.has('gearUp'))
  drawLabel(ctx, layout.gearUp, 'MARCHA +', 0.26)

  drawButtonBox(ctx, layout.gearDown, ui.pressedButtons.has('gearDown'))
  drawLabel(ctx, layout.gearDown, 'MARCHA -', 0.26)

  drawButtonBox(ctx, layout.mode, ui.pressedButtons.has('mode'))
  drawLabel(ctx, layout.mode, powertrain.modeLabel, 0.34)

  // R and N stay lit while that gear is the one selected: it is a selector,
  // not just a button.
  drawButtonBox(
    ctx,
    layout.reverse,
    ui.pressedButtons.has('reverse') || powertrain.gear === REVERSE_GEAR,
  )
  drawLabel(ctx, layout.reverse, 'RE', 0.34)

  drawButtonBox(
    ctx,
    layout.neutral,
    ui.pressedButtons.has('neutral') || powertrain.gear === NEUTRAL_GEAR,
  )
  drawLabel(ctx, layout.neutral, 'N', 0.34)

  drawButtonBox(
    ctx,
    layout.ignition,
    ui.pressedButtons.has('ignition') || powertrain.stalled,
  )
  drawLabel(ctx, layout.ignition, 'PARTIDA', 0.26)
}

/** Centred caption, shrunk to fit rather than spilling out of its button. */
function drawLabel(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  label: string,
  scale: number,
): void {
  let size = Math.max(9, rect.height * scale)
  ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  const available = rect.width * 0.86
  const natural = ctx.measureText(label).width
  if (natural > available) {
    size = Math.max(7, size * (available / natural))
    ctx.font = `600 ${size.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  }
  ctx.fillStyle = GLYPH
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(label, rect.x + rect.width / 2, rect.y + rect.height / 2)
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

/**
 * Two columns: the keyboard on the left, the touch layer on the right. One
 * column of twenty-odd lines no longer fits on a phone held sideways.
 */
const KEYBOARD_LINES: readonly string[] = [
  'W / seta cima      acelerar',
  'S / seta baixo     frear',
  'A D / setas        estercar',
  'espaco             freio de mao',
  'C                  embreagem (segure)',
  'E / Q              subir / descer marcha',
  '1 a 6              marcha (so no manual)',
  'N ou 0             ponto morto',
  'X                  re',
  'R                  dar partida',
  'T                  cambio: auto, seq, manual',
  'F3 ou `            debug',
]

const TOUCH_LINES: readonly string[] = [
  'barra a esquerda   estercar',
  'pedais a direita   acelerar / frear',
  'EMBREAGEM          embreagem (segure)',
  'MAO                freio de mao',
  'MARCHA + / -       trocar marcha',
  'RE / N             re e ponto morto',
  'AUT SEQ MAN        modo do cambio',
  'PARTIDA            religar o motor',
  'botoes no topo     controles, tela cheia',
]

const INSTRUCTION_FOOTER = 'toque na tela ou pressione uma tecla'

function drawInstructions(context: RenderContext): void {
  const { ctx, viewport } = context

  inScreenSpace(context, () => {
    ctx.fillStyle = 'rgba(8, 10, 14, 0.72)'
    ctx.fillRect(0, 0, viewport.cssWidth, viewport.cssHeight)

    const usableWidth = viewport.cssWidth - viewport.safeArea.left - viewport.safeArea.right
    const usableHeight = viewport.cssHeight - viewport.safeArea.top - viewport.safeArea.bottom
    const rows = Math.max(KEYBOARD_LINES.length, TOUCH_LINES.length) + 1 // + heading

    // Height first, then shrink again if the two columns are too wide for the
    // screen. Everything scales with the font, so one correction is exact.
    let size = clamp(usableHeight * 0.05, 8, 17)
    let columnWidth = 0
    const measure = (): number => {
      ctx.font = `${size.toFixed(1)}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`
      columnWidth = 0
      for (const line of [...KEYBOARD_LINES, ...TOUCH_LINES]) {
        columnWidth = Math.max(columnWidth, ctx.measureText(line).width)
      }
      return columnWidth * 2 + size * 2 + size * 3 // columns + gutter + padding
    }
    const needed = measure()
    if (needed > usableWidth) {
      size = Math.max(7, size * (usableWidth / needed))
      measure()
    }

    const lineHeight = size * 1.5
    const padding = size * 1.5
    const gutter = size * 2
    const panelWidth = Math.max(columnWidth * 2 + gutter, ctx.measureText(INSTRUCTION_FOOTER).width) + padding * 2
    const panelHeight = (rows + 2) * lineHeight + padding
    const x = (viewport.cssWidth - panelWidth) / 2
    const y = viewport.safeArea.top + Math.max(0, (usableHeight - panelHeight) / 2)

    ctx.fillStyle = 'rgba(14, 18, 24, 0.94)'
    ctx.strokeStyle = PANEL_STROKE
    ctx.lineWidth = 1.5
    roundedRectPath(ctx, x, y, panelWidth, panelHeight, size)
    ctx.fill()
    ctx.stroke()

    ctx.textBaseline = 'top'
    const top = y + padding * 0.7
    const columnX = [x + padding, x + padding + columnWidth + gutter]
    const headings = ['TECLADO', 'TOQUE']
    const columns = [KEYBOARD_LINES, TOUCH_LINES]
    for (let column = 0; column < columns.length; column++) {
      ctx.fillStyle = '#7fb2e8'
      ctx.fillText(headings[column], columnX[column], top)
      ctx.fillStyle = '#d7e2ea'
      let cursor = top + lineHeight * 1.4
      for (const line of columns[column]) {
        ctx.fillText(line, columnX[column], cursor)
        cursor += lineHeight
      }
    }

    ctx.fillStyle = 'rgba(215, 226, 234, 0.62)'
    ctx.textAlign = 'center'
    ctx.fillText(INSTRUCTION_FOOTER, viewport.cssWidth / 2, top + (rows + 0.8) * lineHeight)
    ctx.textAlign = 'left'
    ctx.textBaseline = 'alphabetic'
  })
}
