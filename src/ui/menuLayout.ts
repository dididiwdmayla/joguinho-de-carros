/**
 * Geometry of the settings menu and of the control editor.
 *
 * Same rule as the controls themselves: one module owns the rectangles, so
 * the layer that draws a row and the layer that decides a tap landed on it
 * can never disagree about where it was.
 *
 * The menu is in two halves and the split is the point of it. Everything
 * under CONTROLE changes how the car is worked and nothing else; everything
 * under VEICULO changes how hard it is to drive. A player who wants a lighter
 * wheel should never have to wonder whether they have just made it easier.
 */
import { clamp } from '../core/math'
import type { Viewport } from '../render/viewport'
import { resolveFuel } from '../vehicle/fuel'
import { transmissionModeName } from '../vehicle/powertrain'
import {
  CONTROL_LABELS,
  LATCHABLE_SLOTS,
  PRESET_LABELS,
  wheelTurnsLabel,
  type ControlSlot,
} from './controlLayout'
import type { Rect, TouchLayout } from './touchLayout'
import type { UiState } from './uiState'

export type MenuAction =
  | 'wheelTurns'
  | 'steeringStyle'
  | 'preset'
  | 'edit'
  | 'reset'
  | 'fuel'
  | 'transmission'
  | 'close'

export interface MenuRow {
  readonly action: MenuAction
  readonly label: string
  /** Right-aligned current value, empty for rows that simply do something. */
  readonly value: string
  readonly rect: Rect
}

export interface MenuSection {
  readonly title: string
  /** One line under the title, saying what this half of the menu costs. */
  readonly note: string
  readonly rows: readonly MenuRow[]
  /** What the current choice means, empty when there is nothing to say. */
  readonly hint: string
  readonly titleRect: Rect
  readonly noteRect: Rect
  readonly hintRect: Rect | null
}

export interface MenuLayout {
  readonly panel: Rect
  readonly title: string
  readonly titleRect: Rect
  readonly sections: readonly MenuSection[]
  /** The way out, across the foot of the panel. */
  readonly close: MenuRow
  /** Every row of every section plus the close row, for hit testing. */
  readonly rows: readonly MenuRow[]
  /** Hairline between the two halves; null when there is no room for one. */
  readonly divider: Rect | null
  /** Height of one row, so the layer that draws can match its type to it. */
  readonly rowHeight: number
}

/** Distance the panel keeps from the edges of the safe area. */
const MENU_MARGIN = 12
/**
 * Below this much width the two halves are stacked instead of set apart. Set
 * where it is because a short landscape window has no height to stack in: two
 * columns are what keep the second half of the menu on the screen.
 */
const TWO_COLUMN_WIDTH = 400
/** A row may be shrunk this far to fit a short screen, and no further. */
const MIN_ROW_HEIGHT = 20
/** Widest a single column of rows is allowed to get on a large screen. */
const MAX_COLUMN_WIDTH = 340

interface RowDefinition {
  readonly action: MenuAction
  readonly label: string
  readonly value: string
}

interface SectionDefinition {
  readonly title: string
  readonly note: string
  readonly hint: string
  readonly rows: readonly RowDefinition[]
}

/**
 * What the menu says right now. Values are read straight off the state that
 * owns them, so a row can never show something the game is not doing.
 */
function menuSections(ui: UiState): readonly SectionDefinition[] {
  const fuel = resolveFuel(ui.fuels, ui.vehicle.fuel)
  return [
    {
      title: 'CONTROLE',
      note: 'nao muda a dificuldade',
      hint: '',
      rows: [
        {
          action: 'wheelTurns',
          label: 'VOLTAS DO VOLANTE',
          value: wheelTurnsLabel(ui.controls.wheelTurns),
        },
        {
          action: 'steeringStyle',
          label: 'ESTERCAMENTO',
          value: ui.controls.steeringStyle === 'wheel' ? 'VOLANTE' : 'BARRA',
        },
        { action: 'preset', label: 'LAYOUT', value: PRESET_LABELS[ui.controls.preset] },
        { action: 'edit', label: 'EDITAR CONTROLES', value: '' },
        { action: 'reset', label: 'RESTAURAR PADRAO', value: '' },
      ],
    },
    {
      title: 'VEICULO',
      note: 'muda a dificuldade',
      hint: fuel.hint,
      rows: [
        { action: 'fuel', label: 'COMBUSTIVEL', value: fuel.label.toUpperCase() },
        { action: 'transmission', label: 'TRANSMISSAO', value: transmissionModeName(ui.mode) },
      ],
    },
  ]
}

/**
 * Every vertical measurement of the panel, all of them multiples of the row
 * height. That is what lets the whole thing be fitted to a short screen by
 * measuring it once and dividing: nothing is a fixed number of pixels.
 */
interface MenuMetrics {
  readonly rowHeight: number
  readonly gap: number
  readonly padding: number
  readonly titleHeight: number
  readonly sectionTitleHeight: number
  readonly noteHeight: number
  readonly hintHeight: number
}

function metricsFor(rowHeight: number): MenuMetrics {
  return {
    rowHeight,
    gap: rowHeight * 0.16,
    padding: rowHeight * 0.44,
    titleHeight: rowHeight * 0.9,
    sectionTitleHeight: rowHeight * 0.78,
    noteHeight: rowHeight * 0.6,
    hintHeight: rowHeight * 0.95,
  }
}

function sectionHeight(section: SectionDefinition, m: MenuMetrics): number {
  const rows = section.rows.length
  let height =
    m.sectionTitleHeight + m.noteHeight + m.gap + rows * m.rowHeight + (rows - 1) * m.gap
  if (section.hint.length > 0) height += m.gap + m.hintHeight
  return height
}

function bodyHeight(
  sections: readonly SectionDefinition[],
  m: MenuMetrics,
  columns: number,
): number {
  let tallest = 0
  let stacked = 0
  for (const section of sections) {
    const height = sectionHeight(section, m)
    tallest = Math.max(tallest, height)
    stacked += height
  }
  if (columns === 2) return tallest
  return stacked + (sections.length - 1) * m.gap * 2
}

function panelHeightFor(
  sections: readonly SectionDefinition[],
  m: MenuMetrics,
  columns: number,
): number {
  return (
    m.padding * 2 + m.titleHeight + m.gap * 1.5 + bodyHeight(sections, m, columns) + m.gap * 1.5 + m.rowHeight
  )
}

export function computeMenuLayout(viewport: Viewport, ui: UiState): MenuLayout {
  const { safeArea } = viewport
  const sections = menuSections(ui)
  const availableWidth = Math.max(
    120,
    viewport.cssWidth - safeArea.left - safeArea.right - MENU_MARGIN * 2,
  )
  const availableHeight = Math.max(
    120,
    viewport.cssHeight - safeArea.top - safeArea.bottom - MENU_MARGIN * 2,
  )
  const columns = availableWidth >= TWO_COLUMN_WIDTH ? 2 : 1

  // A comfortable row first, then however much smaller it has to be. Because
  // every height is a multiple of the row, one measurement says exactly what
  // the ratio is -- there is no second guess and no overflow.
  const comfortable = clamp(Math.min(viewport.cssWidth, viewport.cssHeight) * 0.13, 44, 92) * 0.68
  const natural = panelHeightFor(sections, metricsFor(comfortable), columns)
  const rowHeight = Math.max(
    MIN_ROW_HEIGHT,
    comfortable * Math.min(1, availableHeight / natural),
  )
  const m = metricsFor(rowHeight)

  const columnWidth = Math.min(
    MAX_COLUMN_WIDTH,
    (availableWidth - m.padding * (columns + 1)) / columns,
    rowHeight * 7.4,
  )
  const width = columnWidth * columns + m.padding * (columns + 1)
  const height = panelHeightFor(sections, m, columns)
  const left = safeArea.left + MENU_MARGIN
  const x = clamp(
    (viewport.cssWidth - width) / 2,
    left,
    Math.max(left, viewport.cssWidth - safeArea.right - MENU_MARGIN - width),
  )
  const top = safeArea.top + MENU_MARGIN
  const y = clamp(
    (viewport.cssHeight - height) / 2,
    top,
    Math.max(top, viewport.cssHeight - safeArea.bottom - MENU_MARGIN - height),
  )

  const titleRect: Rect = { x, y: y + m.padding, width, height: m.titleHeight }
  const bodyTop = titleRect.y + titleRect.height + m.gap * 1.5

  const rows: MenuRow[] = []
  const laid: MenuSection[] = []
  let stackedY = bodyTop
  sections.forEach((section, index) => {
    const columnX = x + m.padding + (columns === 2 ? index * (columnWidth + m.padding) : 0)
    const columnY = columns === 2 ? bodyTop : stackedY

    const sectionTitle: Rect = {
      x: columnX,
      y: columnY,
      width: columnWidth,
      height: m.sectionTitleHeight,
    }
    const note: Rect = {
      x: columnX,
      y: sectionTitle.y + sectionTitle.height,
      width: columnWidth,
      height: m.noteHeight,
    }

    let rowY = note.y + note.height + m.gap
    const sectionRows: MenuRow[] = section.rows.map((definition) => {
      const rect: Rect = { x: columnX, y: rowY, width: columnWidth, height: m.rowHeight }
      rowY += m.rowHeight + m.gap
      return { ...definition, rect }
    })
    rows.push(...sectionRows)

    const hintRect: Rect | null =
      section.hint.length > 0
        ? {
            // `rowY` has already stepped past the last row and its gap, which
            // is exactly where sectionHeight expects the hint to start.
            x: columnX,
            y: rowY,
            width: columnWidth,
            height: m.hintHeight,
          }
        : null

    laid.push({
      title: section.title,
      note: section.note,
      hint: section.hint,
      rows: sectionRows,
      titleRect: sectionTitle,
      noteRect: note,
      hintRect,
    })
    stackedY = columnY + sectionHeight(section, m) + m.gap * 2
  })

  const close: MenuRow = {
    action: 'close',
    label: 'FECHAR',
    value: '',
    rect: {
      x: x + m.padding,
      y: y + height - m.padding - m.rowHeight,
      width: width - m.padding * 2,
      height: m.rowHeight,
    },
  }
  rows.push(close)

  // The line between the halves. It is the whole reason the menu is laid out
  // this way, so it is drawn even when the two are stacked.
  const dividerThickness = Math.max(1, rowHeight * 0.02)
  const divider: Rect | null =
    laid.length < 2
      ? null
      : columns === 2
        ? {
            x: x + width / 2 - dividerThickness / 2,
            y: bodyTop,
            width: dividerThickness,
            height: bodyHeight(sections, m, columns),
          }
        : {
            x: x + m.padding,
            y: laid[1].titleRect.y - m.gap,
            width: width - m.padding * 2,
            height: dividerThickness,
          }

  return {
    panel: { x, y, width, height },
    title: 'CONFIGURACOES',
    titleRect,
    sections: laid,
    close,
    rows,
    divider,
    rowHeight,
  }
}

// ------------------------------------------------------------------- editor

export type EditorAction =
  | 'done'
  | 'reset'
  | 'preset'
  | 'hide'
  | 'latch'
  | 'smaller'
  | 'bigger'

export interface EditorButton {
  readonly action: EditorAction
  readonly label: string
  readonly rect: Rect
}

export interface EditorLayout {
  readonly bar: Rect
  readonly buttons: readonly EditorButton[]
  /** Name of the selected control, drawn at the head of the second row. */
  readonly selectionLabel: string | null
  readonly selectionLabelRect: Rect | null
  /** Corner grip of the selected control; drag it to resize. */
  readonly handle: Rect | null
  readonly hint: string
}

/** Splits a row into `count` cells, the first `flexWidth` pixels taken out. */
function cells(row: Rect, count: number, flexWidth: number, gap: number): Rect[] {
  const available = row.width - flexWidth - (count > 0 ? gap * count : 0)
  const cellWidth = count > 0 ? available / count : 0
  const rects: Rect[] = []
  for (let i = 0; i < count; i++) {
    rects.push({
      x: row.x + flexWidth + gap * (i + 1) + cellWidth * i,
      y: row.y,
      width: cellWidth,
      height: row.height,
    })
  }
  return rects
}

/** Size of the grip drawn on the selected control's bottom-right corner. */
function editorHandleSize(layout: TouchLayout): number {
  return Math.max(36, layout.unit * 0.46)
}

export function computeEditorLayout(
  viewport: Viewport,
  layout: TouchLayout,
  ui: UiState,
): EditorLayout {
  const unit = layout.unit
  const gap = unit * 0.12
  const rowHeight = Math.max(40, unit * 0.6)
  const selected = ui.editing
  const rows = selected === null ? 1 : 2

  const bar: Rect = {
    x: viewport.safeArea.left + gap,
    y: viewport.safeArea.top + gap,
    width: Math.max(unit * 3, viewport.cssWidth - viewport.safeArea.left - viewport.safeArea.right - gap * 2),
    height: rowHeight * rows + gap * (rows + 1),
  }

  const buttons: EditorButton[] = []
  const firstRow: Rect = { x: bar.x, y: bar.y + gap, width: bar.width, height: rowHeight }
  const top = cells(firstRow, 3, 0, gap)
  buttons.push({ action: 'done', label: 'PRONTO', rect: top[0] })
  buttons.push({ action: 'reset', label: 'RESTAURAR', rect: top[1] })
  buttons.push({
    action: 'preset',
    label: PRESET_LABELS[ui.controls.preset],
    rect: top[2],
  })

  let selectionLabel: string | null = null
  let selectionLabelRect: Rect | null = null
  let handle: Rect | null = null

  if (selected !== null) {
    selectionLabel = CONTROL_LABELS[selected]
    const secondRow: Rect = {
      x: bar.x,
      y: bar.y + gap * 2 + rowHeight,
      width: bar.width,
      height: rowHeight,
    }
    const latchable = LATCHABLE_SLOTS.has(selected)
    const count = latchable ? 4 : 3
    // The name gets whatever is left once the buttons have what they need.
    const labelWidth = clamp(bar.width * 0.26, unit * 1.2, unit * 2.6)
    const rects = cells(secondRow, count, labelWidth, gap)
    selectionLabelRect = { x: secondRow.x, y: secondRow.y, width: labelWidth, height: rowHeight }

    let index = 0
    buttons.push({
      action: 'hide',
      label: layout.hidden[selected] ? 'MOSTRAR' : 'ESCONDER',
      rect: rects[index++],
    })
    if (latchable) {
      buttons.push({
        action: 'latch',
        label: layout.latch[selected] ? 'TRAVA: SIM' : 'TRAVA: NAO',
        rect: rects[index++],
      })
    }
    buttons.push({ action: 'smaller', label: '-', rect: rects[index++] })
    buttons.push({ action: 'bigger', label: '+', rect: rects[index++] })

    if (!layout.hidden[selected]) {
      const slot = layout.slots[selected]
      const size = editorHandleSize(layout)
      // Kept whole and on screen: a control pushed against an edge would
      // otherwise leave half its grip past the glass, where no thumb can
      // reach it and the control can no longer be resized.
      handle = {
        x: clamp(slot.x + slot.width - size / 2, 0, Math.max(0, viewport.cssWidth - size)),
        y: clamp(slot.y + slot.height - size / 2, 0, Math.max(0, viewport.cssHeight - size)),
        width: size,
        height: size,
      }
    }
  }

  return {
    bar,
    buttons,
    selectionLabel,
    selectionLabelRect,
    handle,
    hint:
      selected === null
        ? 'toque num controle para escolher, arraste para mover'
        : 'arraste para mover, use o canto para redimensionar',
  }
}

/** Slot under a point in the editor, topmost first. Hidden ones still count. */
export function slotAtPoint(
  layout: TouchLayout,
  slots: readonly ControlSlot[],
  x: number,
  y: number,
): ControlSlot | null {
  // Backwards, so the control drawn last is the one picked up first.
  for (let i = slots.length - 1; i >= 0; i--) {
    const slot = slots[i]
    const rect = layout.slots[slot]
    if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
      return slot
    }
  }
  return null
}
