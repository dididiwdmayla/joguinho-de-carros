/**
 * The screens in front of the game: the level list, the pause panel, and the
 * two ways a run ends.
 *
 * Everything is drawn from the rectangles screens.ts hands out, so what is
 * drawn and what a tap lands on cannot drift apart. The look is the settings
 * menu's, on purpose: this is the same game speaking, not a second interface.
 */
import { clamp } from '../../core/math'
import {
  computeScreenLayout,
  formatTime,
  type ScreenCardLayout,
  type ScreenModel,
  type ScreenStatLayout,
} from '../../ui/screens'
import type { Rect } from '../../ui/touchLayout'
import { inScreenSpace } from '../renderer'
import type { RenderContext } from '../scene'
import { roundedRectPath } from '../shapes'
import {
  drawButtonBox,
  drawLabel,
  drawRowLabel,
  drawRowValue,
  GLYPH,
  PANEL_FILL_SOLID,
  PANEL_STROKE,
} from './uiStyle'

const SCRIM = 'rgba(8, 10, 14, 0.78)'
const TITLE_COLOR = 'rgba(158, 203, 255, 0.95)'
const MUTED = 'rgba(196, 210, 222, 0.62)'
const STAR_ON = '#f2c65c'
const STAR_OFF = 'rgba(226, 236, 245, 0.18)'
/** A criterion met, and one missed. */
const PASS = '#7fe0a0'
const FAIL = '#ff8f9e'
const DISABLED_ALPHA = 0.35

export function drawScreen(context: RenderContext, model: ScreenModel): void {
  const { ctx, viewport } = context
  const layout = computeScreenLayout(viewport, model)

  inScreenSpace(context, () => {
    ctx.fillStyle = SCRIM
    ctx.fillRect(0, 0, viewport.cssWidth, viewport.cssHeight)

    const { panel } = layout
    ctx.fillStyle = PANEL_FILL_SOLID
    ctx.strokeStyle = PANEL_STROKE
    ctx.lineWidth = 1.5
    roundedRectPath(ctx, panel.x, panel.y, panel.width, panel.height, layout.rowHeight * 0.34)
    ctx.fill()
    ctx.stroke()

    drawLabel(ctx, layout.titleRect, model.title, 0.62, TITLE_COLOR)
    if (layout.subtitleRect !== null) {
      drawLabel(ctx, layout.subtitleRect, model.subtitle, 0.62, MUTED)
    }
    if (layout.starsRect !== null && model.stars !== null) {
      drawStarRow(ctx, layout.starsRect, model.stars, layout.starsRect.height * 0.86)
    }

    for (const stat of layout.stats) drawStatRow(ctx, stat)

    for (const card of layout.cards) drawCard(ctx, card)

    for (const button of layout.buttons) {
      ctx.save()
      if (!button.enabled) ctx.globalAlpha = DISABLED_ALPHA
      drawButtonBox(ctx, button.rect, button.primary === true)
      drawLabel(ctx, button.rect, button.label, 0.38)
      ctx.restore()
    }
  })
}

/**
 * One row of numbers. A row that was judged gives up the space at its right
 * edge to a tick or a cross and is coloured by the verdict, so the criteria
 * that cost a star can be picked out without reading any of them.
 */
function drawStatRow(ctx: CanvasRenderingContext2D, stat: ScreenStatLayout): void {
  const judged = stat.passed !== undefined
  const mark = judged ? stat.rect.height : 0
  const textRect: Rect = { ...stat.rect, width: stat.rect.width - mark }

  drawRowLabel(ctx, textRect, stat.label, 0.36, MUTED)
  const color = judged ? (stat.passed === true ? PASS : FAIL) : stat.highlight === true ? STAR_ON : GLYPH
  drawRowValue(ctx, textRect, stat.value, 0.38, color)

  if (!judged) return
  drawVerdict(
    ctx,
    { x: stat.rect.x + stat.rect.width - mark, y: stat.rect.y, width: mark, height: mark },
    stat.passed === true,
  )
}

/** A tick or a cross, drawn in the square a judged row reserves for it. */
function drawVerdict(ctx: CanvasRenderingContext2D, rect: Rect, passed: boolean): void {
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const reach = rect.height * 0.22

  ctx.save()
  ctx.strokeStyle = passed ? PASS : FAIL
  ctx.lineWidth = Math.max(1.5, rect.height * 0.1)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.beginPath()
  if (passed) {
    ctx.moveTo(centerX - reach, centerY)
    ctx.lineTo(centerX - reach * 0.25, centerY + reach * 0.75)
    ctx.lineTo(centerX + reach, centerY - reach * 0.75)
  } else {
    ctx.moveTo(centerX - reach * 0.8, centerY - reach * 0.8)
    ctx.lineTo(centerX + reach * 0.8, centerY + reach * 0.8)
    ctx.moveTo(centerX + reach * 0.8, centerY - reach * 0.8)
    ctx.lineTo(centerX - reach * 0.8, centerY + reach * 0.8)
  }
  ctx.stroke()
  ctx.restore()
}

/** One level in the list: number and name, its stars, and the best time. */
function drawCard(ctx: CanvasRenderingContext2D, card: ScreenCardLayout): void {
  drawButtonBox(ctx, card.rect, false)
  const { rect } = card
  const inset = rect.height * 0.3
  const starSize = rect.height * 0.34
  const starsWidth = starSize * 3.4

  const nameRect: Rect = {
    x: rect.x,
    y: rect.y,
    width: rect.width - starsWidth - inset,
    height: rect.height * 0.62,
  }
  drawRowLabel(ctx, nameRect, `${card.index + 1}. ${card.name}`, 0.44, GLYPH, nameRect.width - inset * 2)

  const underRect: Rect = {
    x: rect.x,
    y: rect.y + rect.height * 0.44,
    width: rect.width - starsWidth - inset,
    height: rect.height * 0.5,
  }
  const best = card.time === null ? 'sem registro' : `melhor ${formatTime(card.time)}`
  drawRowLabel(ctx, underRect, `${'●'.repeat(card.difficulty)}  ${best}`, 0.36, MUTED)

  drawStarRow(
    ctx,
    { x: rect.x + rect.width - starsWidth - inset, y: rect.y, width: starsWidth, height: rect.height },
    card.stars,
    starSize,
  )
}

/** Three stars, as many of them lit as were earned. */
function drawStarRow(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  earned: number,
  size: number,
): void {
  const spacing = size * 1.15
  const centerY = rect.y + rect.height / 2
  const firstX = rect.x + rect.width / 2 - spacing
  for (let i = 0; i < 3; i++) {
    drawStar(ctx, firstX + i * spacing, centerY, size / 2, i < earned)
  }
}

function drawStar(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  radius: number,
  lit: boolean,
): void {
  const inner = radius * 0.44
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const reach = i % 2 === 0 ? radius : inner
    const angle = -Math.PI / 2 + (i * Math.PI) / 5
    const x = cx + Math.cos(angle) * reach
    const y = cy + Math.sin(angle) * reach
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = lit ? STAR_ON : STAR_OFF
  ctx.fill()
  if (!lit) return
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)'
  ctx.lineWidth = clamp(radius * 0.12, 0.5, 2)
  ctx.stroke()
}
