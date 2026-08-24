/**
 * UI layer: everything drawn in screen space.
 *
 * The on-screen controls live here, laid out by the same module the input
 * layer hit tests against, so what is drawn and what responds can never drift
 * apart. Everything is drawn in code except the gearbox, which is two art
 * layers positioned by that same geometry -- nothing is ever persisted.
 */
import { clamp } from '../../core/math'
import { drawDebugOverlay } from '../../debug/overlay'
import {
  columnToX,
  computeTouchLayout,
  GATE_DEAD_SLOT,
  gateGear,
  type GateGeometry,
  gateGeometry,
  GEAR_GATE_KEY,
  GEAR_KNOB_KEY,
  steeringKnobDiameter,
  type Rect,
  type TouchLayout,
} from '../../ui/touchLayout'
import type { UiState } from '../../ui/uiState'
import {
  CLUTCH_BITE_END,
  CLUTCH_BITE_START,
  gearLabel,
  NEUTRAL_GEAR,
  REVERSE_GEAR,
} from '../../vehicle/powertrain'
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
      drawVolume(context, layout)
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

  drawButtonBox(ctx, layout.muteButton, ui.pressedButtons.has('mute'))
  drawMuteGlyph(ctx, layout.muteButton, ui.muted)

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

/** A speaker, with the sound crossed out when it is off. */
function drawMuteGlyph(ctx: CanvasRenderingContext2D, rect: Rect, muted: boolean): void {
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2
  const size = rect.width * 0.3

  ctx.fillStyle = GLYPH
  ctx.beginPath()
  ctx.moveTo(cx - size * 0.9, cy - size * 0.32)
  ctx.lineTo(cx - size * 0.45, cy - size * 0.32)
  ctx.lineTo(cx + size * 0.1, cy - size * 0.85)
  ctx.lineTo(cx + size * 0.1, cy + size * 0.85)
  ctx.lineTo(cx - size * 0.45, cy + size * 0.32)
  ctx.lineTo(cx - size * 0.9, cy + size * 0.32)
  ctx.closePath()
  ctx.fill()

  ctx.strokeStyle = GLYPH
  ctx.lineWidth = Math.max(1.5, rect.width * 0.055)
  if (muted) {
    ctx.beginPath()
    ctx.moveTo(cx + size * 0.42, cy - size * 0.45)
    ctx.lineTo(cx + size * 1.05, cy + size * 0.45)
    ctx.moveTo(cx + size * 1.05, cy - size * 0.45)
    ctx.lineTo(cx + size * 0.42, cy + size * 0.45)
    ctx.stroke()
    return
  }
  for (const radius of [size * 0.55, size * 0.95]) {
    ctx.beginPath()
    ctx.arc(cx + size * 0.15, cy, radius, -Math.PI * 0.32, Math.PI * 0.32)
    ctx.stroke()
  }
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
 * A tall pedal whose travel is where the finger is, with the bite band marked
 * down its side. Seeing the friction point is how you learn to feel it.
 */
function drawClutch(context: RenderContext, layout: TouchLayout): void {
  const { ctx, powertrain } = context
  const rect = layout.clutch
  const pressed = clamp(1 - powertrain.clutch, 0, 1)
  const radius = rect.width * 0.3

  ctx.save()
  roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius)
  ctx.fillStyle = pressed > 0.02 ? PANEL_FILL_PRESSED : PANEL_FILL
  ctx.fill()
  ctx.clip()
  if (pressed > 0) {
    ctx.fillStyle = FILL_LEVEL
    const filled = rect.height * pressed
    ctx.fillRect(rect.x, rect.y + rect.height - filled, rect.width, filled)
  }
  // The bite, drawn where the pedal actually is when the plates take hold.
  // The top of the pedal is on the floor, the bottom is fully out.
  const biteTop = rect.y + CLUTCH_BITE_START * rect.height
  const biteBottom = rect.y + CLUTCH_BITE_END * rect.height
  ctx.fillStyle = 'rgba(255, 196, 120, 0.55)'
  ctx.fillRect(rect.x + rect.width * 0.74, biteTop, rect.width * 0.26, biteBottom - biteTop)
  ctx.restore()

  ctx.strokeStyle = pressed > 0.02 ? PANEL_STROKE_PRESSED : PANEL_STROKE
  ctx.lineWidth = 1.5
  roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius)
  ctx.stroke()

  drawRotatedLabel(ctx, rect, 'EMBREAGEM')
}

function drawGearbox(context: RenderContext, layout: TouchLayout): void {
  const { ctx, ui, powertrain } = context

  drawButtonBox(ctx, layout.mode, ui.pressedButtons.has('mode'))
  drawLabel(ctx, layout.mode, powertrain.modeLabel, 0.4)
  drawButtonBox(ctx, layout.ignition, ui.pressedButtons.has('ignition') || powertrain.stalled)
  drawLabel(ctx, layout.ignition, 'PARTIDA', 0.34)

  switch (ui.mode) {
    case 'manual':
      drawGate(context, layout)
      break
    case 'sequential':
      drawButtonBox(ctx, layout.sequentialUp, ui.pressedButtons.has('sequentialUp'))
      drawLabel(ctx, layout.sequentialUp, `${gearLabel(powertrain.gear)}  +`, 0.42)
      drawButtonBox(ctx, layout.sequentialDown, ui.pressedButtons.has('sequentialDown'))
      drawLabel(ctx, layout.sequentialDown, '-', 0.42)
      break
    case 'automatic':
      drawButtonBox(ctx, layout.gearDisplay, false)
      drawLabel(ctx, layout.gearDisplay, gearLabel(powertrain.gear), 0.5)
      drawButtonBox(
        ctx,
        layout.reverse,
        ui.pressedButtons.has('reverse') || powertrain.gear === REVERSE_GEAR,
      )
      drawLabel(ctx, layout.reverse, 'RE', 0.42)
      drawButtonBox(
        ctx,
        layout.neutral,
        ui.pressedButtons.has('neutral') || powertrain.gear === NEUTRAL_GEAR,
      )
      drawLabel(ctx, layout.neutral, 'N', 0.42)
      break
  }
}

/**
 * The H gate: a fixed piece of art, with the lever drawn on top of it
 * wherever the drag left it. The channels are cut into the art; which of
 * them is reachable is still decided entirely by the geometry in
 * touchLayout.ts, calibrated to sit exactly over the art's own grooves.
 */
function drawGate(context: RenderContext, layout: TouchLayout): void {
  const { ctx, ui, assets } = context
  const { gate } = layout
  const geometry = gateGeometry(layout, ui.forwardGears)
  const { art } = geometry

  ctx.fillStyle = PANEL_FILL
  ctx.strokeStyle = PANEL_STROKE
  ctx.lineWidth = 1.5
  roundedRectPath(ctx, gate.x, gate.y, gate.width, gate.height, gate.height * 0.16)
  ctx.fill()
  ctx.stroke()

  const plate = assets.ui(GEAR_GATE_KEY)
  ctx.drawImage(
    plate.image,
    plate.trim.x,
    plate.trim.y,
    plate.trim.width,
    plate.trim.height,
    art.x,
    art.y,
    art.width,
    art.height,
  )

  // The fourth column's upper channel is routed like the rest, but nothing
  // ever seats there -- reverse is the bottom of that column. Darkened so it
  // never reads as a live position.
  const dead = GATE_DEAD_SLOT
  ctx.fillStyle = 'rgba(5, 7, 10, 0.6)'
  roundedRectPath(
    ctx,
    art.x + (dead.centerXFrac - dead.halfWidthFrac) * art.width,
    art.y + dead.topFrac * art.height,
    dead.halfWidthFrac * 2 * art.width,
    (dead.bottomFrac - dead.topFrac) * art.height,
    dead.halfWidthFrac * art.width * 0.7,
  )
  ctx.fill()

  drawGateLabels(ctx, geometry, ui)
  drawShifterKnob(context, geometry)
}

/** Gear numbers above and below the art, aligned to the channel each seats. */
function drawGateLabels(ctx: CanvasRenderingContext2D, geometry: GateGeometry, ui: UiState): void {
  const labelSize = Math.max(10, geometry.art.width * 0.1)
  ctx.font = `600 ${labelSize.toFixed(0)}px system-ui, -apple-system, Segoe UI, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (let column = 0; column < geometry.columns; column++) {
    const x = geometry.columnX[column]
    for (const side of [-1, 1] as const) {
      const gear = gateGear(column, side, ui.forwardGears)
      if (gear === null) continue
      ctx.fillStyle = gear === ui.gear ? '#9ecbff' : GLYPH
      ctx.fillText(gearLabel(gear), x, side < 0 ? geometry.labelTopY : geometry.labelBottomY)
    }
  }
  ctx.textAlign = 'left'
  ctx.textBaseline = 'alphabetic'
}

/**
 * The lever itself: a knob image following the finger, seated wherever the
 * drag left it. A ring behind it stands in for the old fill colour -- red
 * when the gate is refusing the gear and the knob has stopped at the
 * entrance, blue while it is simply being dragged.
 */
function drawShifterKnob(context: RenderContext, geometry: GateGeometry): void {
  const { ctx, ui, assets } = context
  const knob = assets.ui(GEAR_KNOB_KEY)
  const x = columnToX(geometry, ui.shifter.column)
  const y = geometry.corridorY + ui.shifter.lane * geometry.laneReach
  const diameter = geometry.knobDiameter
  const radius = diameter / 2

  if (ui.shifter.blocked || ui.shifter.dragging) {
    ctx.beginPath()
    ctx.arc(x, y, radius * 1.12, 0, Math.PI * 2)
    ctx.strokeStyle = ui.shifter.blocked ? 'rgba(226, 100, 90, 0.9)' : 'rgba(150, 200, 255, 0.55)'
    ctx.lineWidth = Math.max(2, diameter * 0.05)
    ctx.stroke()
  }

  ctx.drawImage(
    knob.image,
    knob.trim.x,
    knob.trim.y,
    knob.trim.width,
    knob.trim.height,
    x - radius,
    y - radius,
    diameter,
    diameter,
  )
}

/** Master volume: a bar that fills to wherever the finger last left it. */
function drawVolume(context: RenderContext, layout: TouchLayout): void {
  const { ctx, ui } = context
  const rect = layout.volume
  const barHeight = rect.height * 0.34
  const bar: Rect = {
    x: rect.x,
    y: rect.y + (rect.height - barHeight) / 2,
    width: rect.width,
    height: barHeight,
  }
  const radius = barHeight / 2

  ctx.save()
  roundedRectPath(ctx, bar.x, bar.y, bar.width, bar.height, radius)
  ctx.fillStyle = PANEL_FILL
  ctx.fill()
  ctx.clip()
  ctx.fillStyle = ui.muted ? 'rgba(226, 120, 110, 0.4)' : FILL_LEVEL
  ctx.fillRect(bar.x, bar.y, bar.width * clamp(ui.volume, 0, 1), bar.height)
  ctx.restore()

  ctx.strokeStyle = PANEL_STROKE
  ctx.lineWidth = 1.5
  roundedRectPath(ctx, bar.x, bar.y, bar.width, bar.height, radius)
  ctx.stroke()

  const knobX = bar.x + bar.width * clamp(ui.volume, 0, 1)
  ctx.beginPath()
  ctx.arc(knobX, bar.y + bar.height / 2, barHeight * 0.78, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(220, 232, 244, 0.72)'
  ctx.fill()
  ctx.stroke()
}

/** Vertical caption for a tall, narrow pedal. */
function drawRotatedLabel(ctx: CanvasRenderingContext2D, rect: Rect, label: string): void {
  ctx.save()
  ctx.translate(rect.x + rect.width / 2, rect.y + rect.height / 2)
  ctx.rotate(-Math.PI / 2)
  drawLabel(ctx, { x: -rect.height / 2, y: -rect.width / 2, width: rect.height, height: rect.width }, label, 0.34)
  ctx.restore()
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
  'M                  mudo',
  'F3 ou `            debug',
]

const TOUCH_LINES: readonly string[] = [
  'barra a esquerda   estercar',
  'pedais a direita   acelerar / frear',
  'EMBREAGEM          pedal alto a esquerda:',
  '                   o dedo e o curso',
  'faixa clara        ponto de friccao',
  'MAO                freio de mao',
  'cambio no meio     arraste o manete pelo H',
  '                   (corredor no centro = N)',
  'AUT SEQ MAN        modo do cambio',
  'PARTIDA            religar o motor',
  'barra no topo      volume',
  'botoes no topo     controles, mudo, tela cheia',
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
    let size = clamp(usableHeight / (1.5 * (rows + 3)), 8, 17)
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
