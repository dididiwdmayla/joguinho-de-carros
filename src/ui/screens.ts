/**
 * The screens in front of the game: the level list, the pause panel, and the
 * two ways a run ends.
 *
 * Same split as the settings menu, and for the same reason: one module works
 * out where everything is, and both the layer that draws it and the layer that
 * decides where a tap landed read the answer from here. They cannot disagree.
 *
 * A screen is described as a model -- a title, some rows of numbers, a list of
 * levels, a row of buttons -- and laid out generically. Adding a screen is
 * writing another model, not another layout.
 */
import { clamp } from '../core/math'
import type { Viewport } from '../render/viewport'
import type { Rect } from './touchLayout'

export type ScreenKind = 'fases' | 'carregando' | 'pausa' | 'concluido' | 'falhou'

/** What a press on a screen asks the game to do. */
export type ScreenAction =
  | { readonly kind: 'jogar'; readonly index: number }
  /** Not a button on any panel: the pause key and the pause button send it. */
  | { readonly kind: 'pausar' }
  | { readonly kind: 'continuar' }
  | { readonly kind: 'repetir' }
  | { readonly kind: 'avancar' }
  | { readonly kind: 'fases' }
  | { readonly kind: 'ajustes' }

export interface ScreenStat {
  readonly label: string
  readonly value: string
  /** Draws the value in the accent colour: a personal best, a lost run. */
  readonly highlight?: boolean
  /**
   * A row that was judged: drawn with a tick or a cross, and in the colour of
   * the verdict. Left out on a row that is only a number.
   */
  readonly passed?: boolean
}

export interface ScreenLevelCard {
  readonly index: number
  readonly name: string
  readonly difficulty: number
  /** 0 when the level has never been finished. */
  readonly stars: number
  /** Best time [s], or null. */
  readonly time: number | null
}

export interface ScreenButtonModel {
  readonly action: ScreenAction
  readonly label: string
  readonly enabled: boolean
  /** The one the player most likely wants. */
  readonly primary?: boolean
}

export interface ScreenModel {
  readonly kind: ScreenKind
  readonly title: string
  /** One line under the title; empty for none. */
  readonly subtitle: string
  /** 1..3 to draw a star row, null for no stars on this screen. */
  readonly stars: number | null
  readonly stats: readonly ScreenStat[]
  readonly levels: readonly ScreenLevelCard[]
  readonly buttons: readonly ScreenButtonModel[]
}

export interface ScreenButtonLayout extends ScreenButtonModel {
  readonly rect: Rect
}

export interface ScreenCardLayout extends ScreenLevelCard {
  readonly rect: Rect
}

export interface ScreenStatLayout extends ScreenStat {
  readonly rect: Rect
}

export interface ScreenLayout {
  readonly panel: Rect
  readonly titleRect: Rect
  readonly subtitleRect: Rect | null
  readonly starsRect: Rect | null
  readonly stats: readonly ScreenStatLayout[]
  readonly cards: readonly ScreenCardLayout[]
  readonly buttons: readonly ScreenButtonLayout[]
  /** Height of one row, so the type can be sized against it. */
  readonly rowHeight: number
}

/** Distance the panel keeps from the edges of the safe area. */
const MARGIN = 12
/** A row may be shrunk this far to fit a short screen, and no further. */
const MIN_ROW_HEIGHT = 18
/** Widest the panel is allowed to get on a large screen. */
const MAX_PANEL_WIDTH = 460
/** Most buttons that fit on one line before they are stacked into two. */
const MAX_BUTTONS_PER_ROW = 3

interface Metrics {
  readonly row: number
  readonly gap: number
  readonly padding: number
  readonly title: number
  readonly subtitle: number
  readonly stars: number
  readonly card: number
}

function metricsFor(row: number): Metrics {
  return {
    row,
    gap: row * 0.2,
    padding: row * 0.55,
    title: row * 1.05,
    subtitle: row * 0.7,
    stars: row * 1.5,
    card: row * 1.35,
  }
}

function buttonRows(model: ScreenModel): number {
  return Math.max(1, Math.ceil(model.buttons.length / MAX_BUTTONS_PER_ROW))
}

function panelHeightFor(model: ScreenModel, m: Metrics): number {
  let height = m.padding * 2 + m.title
  if (model.subtitle.length > 0) height += m.gap * 0.5 + m.subtitle
  if (model.stars !== null) height += m.gap + m.stars
  if (model.stats.length > 0) {
    height += m.gap + model.stats.length * m.row + (model.stats.length - 1) * m.gap * 0.5
  }
  if (model.levels.length > 0) {
    height += m.gap + model.levels.length * m.card + (model.levels.length - 1) * m.gap * 0.6
  }
  if (model.buttons.length > 0) {
    const rows = buttonRows(model)
    height += m.gap * 1.4 + rows * m.row + (rows - 1) * m.gap * 0.6
  }
  return height
}

export function computeScreenLayout(viewport: Viewport, model: ScreenModel): ScreenLayout {
  const { safeArea } = viewport
  const availableWidth = Math.max(
    140,
    viewport.cssWidth - safeArea.left - safeArea.right - MARGIN * 2,
  )
  const availableHeight = Math.max(
    140,
    viewport.cssHeight - safeArea.top - safeArea.bottom - MARGIN * 2,
  )

  // A comfortable row first, then however much smaller it has to be for the
  // whole panel to fit. Every height is a multiple of the row, so one
  // measurement gives the exact ratio and nothing can overflow.
  const comfortable = clamp(Math.min(viewport.cssWidth, viewport.cssHeight) * 0.09, 26, 46)
  const natural = panelHeightFor(model, metricsFor(comfortable))
  const row = Math.max(MIN_ROW_HEIGHT, comfortable * Math.min(1, availableHeight / natural))
  const m = metricsFor(row)

  const width = Math.min(MAX_PANEL_WIDTH, availableWidth, row * 13)
  const height = Math.min(availableHeight, panelHeightFor(model, m))
  const x = safeArea.left + MARGIN + Math.max(0, (availableWidth - width) / 2)
  const y = safeArea.top + MARGIN + Math.max(0, (availableHeight - height) / 2)
  const contentX = x + m.padding
  const contentWidth = width - m.padding * 2

  let cursor = y + m.padding
  const titleRect: Rect = { x: contentX, y: cursor, width: contentWidth, height: m.title }
  cursor += m.title

  let subtitleRect: Rect | null = null
  if (model.subtitle.length > 0) {
    cursor += m.gap * 0.5
    subtitleRect = { x: contentX, y: cursor, width: contentWidth, height: m.subtitle }
    cursor += m.subtitle
  }

  let starsRect: Rect | null = null
  if (model.stars !== null) {
    cursor += m.gap
    starsRect = { x: contentX, y: cursor, width: contentWidth, height: m.stars }
    cursor += m.stars
  }

  const stats: ScreenStatLayout[] = []
  if (model.stats.length > 0) {
    cursor += m.gap
    for (const stat of model.stats) {
      stats.push({ ...stat, rect: { x: contentX, y: cursor, width: contentWidth, height: m.row } })
      cursor += m.row + m.gap * 0.5
    }
    cursor -= m.gap * 0.5
  }

  const cards: ScreenCardLayout[] = []
  if (model.levels.length > 0) {
    cursor += m.gap
    for (const level of model.levels) {
      cards.push({
        ...level,
        rect: { x: contentX, y: cursor, width: contentWidth, height: m.card },
      })
      cursor += m.card + m.gap * 0.6
    }
    cursor -= m.gap * 0.6
  }

  const buttons: ScreenButtonLayout[] = []
  if (model.buttons.length > 0) {
    cursor += m.gap * 1.4
    const rows = buttonRows(model)
    const perRow = Math.ceil(model.buttons.length / rows)
    for (let rowIndex = 0; rowIndex < rows; rowIndex++) {
      const slice = model.buttons.slice(rowIndex * perRow, (rowIndex + 1) * perRow)
      const cellWidth = (contentWidth - m.gap * 0.6 * (slice.length - 1)) / slice.length
      slice.forEach((button, index) => {
        buttons.push({
          ...button,
          rect: {
            x: contentX + index * (cellWidth + m.gap * 0.6),
            y: cursor,
            width: cellWidth,
            height: m.row,
          },
        })
      })
      cursor += m.row + m.gap * 0.6
    }
  }

  return {
    panel: { x, y, width, height },
    titleRect,
    subtitleRect,
    starsRect,
    stats,
    cards,
    buttons,
    rowHeight: row,
  }
}

/** m:ss, which is how long every one of these levels takes. */
export function formatTime(seconds: number): string {
  const whole = Math.max(0, seconds)
  const minutes = Math.floor(whole / 60)
  const rest = whole - minutes * 60
  return `${minutes}:${rest < 10 ? '0' : ''}${rest.toFixed(1)}`
}
