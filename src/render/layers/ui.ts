/**
 * UI layer: everything drawn in screen space.
 *
 * The on-screen controls live here, laid out by the same module the input
 * layer hit tests against, so what is drawn and what responds can never drift
 * apart -- including once the player has dragged them somewhere else. A
 * control the player has hidden is simply not drawn, unless the editor is
 * open, where it shows as an empty box waiting to be switched back on.
 *
 * Everything is drawn in code, except the H gate: it is the one control that
 * is not painted on the canvas but placed above it as an element, because it
 * has to react to the clutch and to the lever on its own. Nothing is ever
 * persisted.
 */
import { clamp } from '../../core/math'
import { drawDebugOverlay } from '../../debug/overlay'
import { wheelMaxAngle, type ControlSlot } from '../../ui/controlLayout'
import {
  computeTouchLayout,
  gateGeometry,
  rectCenterX,
  rectCenterY,
  STEERING_WHEEL_KEY,
  steeringKnobDiameter,
  steeringWheelDiameter,
  type Rect,
  type TouchLayout,
} from '../../ui/touchLayout'
import { gateEngageable } from '../../ui/uiState'
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
import { drawEditorChrome, drawEditorScrim, drawMenu } from './menu'
import {
  drawButtonBox,
  drawLabel,
  drawLatchBadge,
  drawRotatedLabel,
  FILL_LEVEL,
  GLYPH,
  PANEL_FILL,
  PANEL_FILL_PRESSED,
  PANEL_STROKE,
  PANEL_STROKE_PRESSED,
} from './uiStyle'

/** How much of a hidden control still shows while the editor is open. */
const GHOST_ALPHA = 0.28
/**
 * And how much of a visible one. Inside the editor the controls are furniture
 * to be arranged, so they are turned down far enough for the names and
 * outlines drawn over them to be the thing that reads.
 */
const EDIT_ALPHA = 0.5

export function drawUi(context: RenderContext): void {
  const { ui } = context
  const layout = computeTouchLayout(context.viewport, ui.controls, ui.gatePattern)
  const editing = ui.menu === 'edit'

  // The gate is an element over the canvas, not paint on it, so it is placed
  // before the frame is drawn rather than inside it.
  syncGate(context, layout, editing)

  inScreenSpace(context, () => {
    // The editor dims the world first, so the controls it is about to lay out
    // read as furniture rather than as something still driving the car.
    if (editing) drawEditorScrim(context)
    // The top-right row is the way into the menu; inside the editor the bar
    // takes that corner over, so the row stands down.
    if (!editing) drawButtons(context, layout)
    if (ui.controlsVisible) drawControls(context, layout, editing)
    if (ui.rotateHintVisible && !editing) drawRotateHint(context, layout)
  })

  if (context.debug !== null) drawDebugOverlay(context, context.debug)
  if (editing) drawEditorChrome(context, layout)
  if (ui.menu === 'main') drawMenu(context)
  if (ui.instructionsVisible) drawInstructions(context)
}

/**
 * Every driving control, each one skipped when it is hidden -- or drawn faint
 * when the editor is open, which is the only place a hidden control can be
 * found and switched back on.
 */
function drawControls(context: RenderContext, layout: TouchLayout, editing: boolean): void {
  const { ctx } = context
  const show = (slot: ControlSlot, draw: () => void): void => {
    const hidden = layout.hidden[slot]
    if (hidden && !editing) return
    if (!editing) {
      draw()
      return
    }
    ctx.save()
    ctx.globalAlpha = hidden ? GHOST_ALPHA : EDIT_ALPHA
    draw()
    ctx.restore()
  }

  show('steering', () => drawSteering(context, layout))
  show('throttle', () => drawPedal(context, layout, 'throttle'))
  show('brake', () => drawPedal(context, layout, 'brake'))
  show('handbrake', () => drawHandbrake(context, layout))
  show('clutch', () => drawClutch(context, layout))
  show('gearbox', () => drawGearbox(context, layout))
  show('mode', () => drawModeButton(context, layout))
  show('ignition', () => drawIgnitionButton(context, layout))
  drawVolume(context, layout)
}

// ------------------------------------------------------------------ buttons

function drawButtons(context: RenderContext, layout: TouchLayout): void {
  const { ctx, ui } = context
  drawButtonBox(ctx, layout.menuButton, ui.pressedButtons.has('menu'))
  drawMenuGlyph(ctx, layout.menuButton)

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

/** Three sliders: settings. Deliberately unlike the control layer's three bars. */
function drawMenuGlyph(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const trackWidth = rect.width * 0.52
  const left = rect.x + (rect.width - trackWidth) / 2
  const thickness = Math.max(1.5, rect.height * 0.055)
  const knob = Math.max(2.5, rect.height * 0.075)
  const knobAt = [0.68, 0.34, 0.58]
  ctx.strokeStyle = GLYPH
  ctx.fillStyle = GLYPH
  ctx.lineWidth = thickness
  for (let i = 0; i < 3; i++) {
    const y = rect.y + rect.height * (0.32 + i * 0.18)
    ctx.beginPath()
    ctx.moveTo(left, y)
    ctx.lineTo(left + trackWidth, y)
    ctx.stroke()
    ctx.beginPath()
    ctx.arc(left + trackWidth * knobAt[i], y, knob, 0, Math.PI * 2)
    ctx.fill()
  }
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
  if (context.ui.controls.steeringStyle === 'wheel') drawSteeringWheel(context, layout)
  else drawSteeringBar(context, layout)
  if (layout.latch.steering) {
    drawLatchBadge(context.ctx, layout.steering, context.ui.latched.has('steering'))
  }
}

function drawSteeringBar(context: RenderContext, layout: TouchLayout): void {
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
  const centre = rectCenterX(rect)
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
  ctx.arc(knobX, rectCenterY(rect), knob / 2, 0, Math.PI * 2)
  ctx.fill()
  ctx.stroke()
}

/**
 * The wheel: the art itself, turned by exactly the angle the finger has wound
 * into it. How much of a turn full lock takes is the player's own setting, and
 * it is the same number the input layer maps a circular drag onto -- so what
 * is under the thumb and what the front wheels are doing are always the same
 * picture, at any rack.
 */
function drawSteeringWheel(context: RenderContext, layout: TouchLayout): void {
  const { ctx, input, ui, assets } = context
  const art = assets.ui(STEERING_WHEEL_KEY)
  const diameter = steeringWheelDiameter(layout)
  const radius = diameter / 2
  const cx = rectCenterX(layout.steering)
  const cy = rectCenterY(layout.steering)

  // A disc behind it: the art is mostly rim and spokes, and against asphalt
  // that alone does not read as something to put a thumb on.
  ctx.beginPath()
  ctx.arc(cx, cy, radius * 0.99, 0, Math.PI * 2)
  ctx.fillStyle = PANEL_FILL
  ctx.fill()
  ctx.strokeStyle = ui.steeringActive ? PANEL_STROKE_PRESSED : PANEL_STROKE
  ctx.lineWidth = 1.5
  ctx.stroke()

  // Fixed mark at twelve o'clock: without it a wheel a quarter turn out looks
  // exactly like a wheel that is straight.
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(cx, cy - radius * 1.02)
  ctx.lineTo(cx, cy - radius * 0.84)
  ctx.stroke()

  ctx.save()
  ctx.translate(cx, cy)
  ctx.rotate(clamp(input.steer, -1, 1) * wheelMaxAngle(ui.controls.wheelTurns))
  ctx.drawImage(
    art.image,
    art.trim.x,
    art.trim.y,
    art.trim.width,
    art.trim.height,
    -radius,
    -radius,
    diameter,
    diameter,
  )
  ctx.restore()
}

// ------------------------------------------------------------------- pedals

/**
 * A pedal fills from the edge the finger travels towards, so the amount being
 * applied is visible while it is held.
 */
function drawPedal(context: RenderContext, layout: TouchLayout, slot: 'throttle' | 'brake'): void {
  const { ctx, input, ui } = context
  const rect = layout[slot]
  const amount = slot === 'throttle' ? input.throttle : input.brake
  const direction = slot === 'throttle' ? 'up' : 'down'
  const label = slot === 'throttle' ? 'GAS' : 'FREIO'
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
  if (layout.latch[slot]) drawLatchBadge(ctx, rect, ui.latched.has(slot))
}

function drawHandbrake(context: RenderContext, layout: TouchLayout): void {
  const { ctx, input, ui } = context
  const rect = layout.handbrake
  drawButtonBox(ctx, rect, input.handbrake)
  drawLabel(ctx, rect, 'MAO', 0.3)
  if (layout.latch.handbrake) drawLatchBadge(ctx, rect, ui.latched.has('handbrake'))
}

// ---------------------------------------------------------------- powertrain

/**
 * A tall pedal whose travel is where the finger is, with the bite band marked
 * down its side. Seeing the friction point is how you learn to feel it.
 */
function drawClutch(context: RenderContext, layout: TouchLayout): void {
  const { ctx, ui, powertrain } = context
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
  if (layout.latch.clutch) drawLatchBadge(ctx, rect, ui.latched.has('clutch'))
}

function drawModeButton(context: RenderContext, layout: TouchLayout): void {
  const { ctx, ui, powertrain } = context
  drawButtonBox(ctx, layout.mode, ui.pressedButtons.has('mode'))
  drawLabel(ctx, layout.mode, powertrain.modeLabel, 0.4)
}

function drawIgnitionButton(context: RenderContext, layout: TouchLayout): void {
  const { ctx, ui, powertrain } = context
  drawButtonBox(ctx, layout.ignition, ui.pressedButtons.has('ignition') || powertrain.stalled)
  drawLabel(ctx, layout.ignition, 'PARTIDA', 0.34)
}

function drawGearbox(context: RenderContext, layout: TouchLayout): void {
  const { ctx, ui, powertrain } = context
  switch (ui.mode) {
    case 'manual':
      // Drawn by the gate element, placed in syncGate before the frame.
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
 * Hands the gate over to the element that draws it.
 *
 * Nothing about it is painted here: it is an SVG built once from the gear
 * pattern, so a frame only tells it where the plate goes and what the lever
 * is doing. It is taken off the screen whenever another gearbox is fitted,
 * the control layer is hidden or the slot is hidden outright, the instructions
 * are covering everything, or the settings menu is open -- the canvas has no
 * say over an element drawn above it, so anything the canvas would otherwise
 * cover has to take the gate down first.
 *
 * The editor is the one screen that keeps it up: a hidden or visible gearbox
 * is still furniture to be found and moved there, so it only dims, matching
 * every other control `show()` ghosts. Ghosting an element outside the canvas
 * needs its own trick -- see the z-index note below.
 */
function syncGate(context: RenderContext, layout: TouchLayout, editing: boolean): void {
  const { ui } = context
  const { hidden } = layout
  if (
    !ui.controlsVisible ||
    ui.mode !== 'manual' ||
    ui.instructionsVisible ||
    ui.menu === 'main' ||
    (hidden.gearbox && !editing)
  ) {
    context.gate.hide()
    return
  }

  const { shifter } = ui
  context.gate.sync(gateGeometry(layout, ui.gatePattern).plate, {
    column: shifter.column,
    lane: shifter.lane,
    gear: ui.gear,
    locked: !gateEngageable(ui),
    dragging: shifter.dragging,
    blocked: shifter.blocked,
    lockedColumn: shifter.lockedColumn,
    forwardGears: ui.forwardGears,
    // Ghosted like any other control while the editor is arranging it, and
    // dropped behind the canvas so the editor's own outline, name chip and
    // resize handle -- all painted after it -- are never hidden underneath a
    // plate that a DOM element would otherwise always sit above.
    opacity: editing ? (hidden.gearbox ? GHOST_ALPHA : EDIT_ALPHA) : 1,
    behindCanvas: editing,
  })
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
  ctx.arc(knobX, rectCenterY(bar), barHeight * 0.78, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(220, 232, 244, 0.72)'
  ctx.fill()
  ctx.stroke()
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
  'Esc                fechar o menu',
]

const TOUCH_LINES: readonly string[] = [
  'barra a esquerda   estercar (ou volante,',
  '                   girado com o dedo)',
  'pedais a direita   acelerar / frear',
  'EMBREAGEM          pedal alto a esquerda:',
  '                   o dedo e o curso',
  'faixa clara        ponto de friccao',
  'MAO                freio de mao',
  'cambio no meio     arraste o manete pelo H',
  '                   (corredor no centro = N)',
  'AUT SEQ MAN        modo do cambio',
  'PARTIDA            religar o motor',
  'botao de ajustes   mover, redimensionar,',
  '                   esconder e travar',
  'cadeado            fica ativo sem o dedo',
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
