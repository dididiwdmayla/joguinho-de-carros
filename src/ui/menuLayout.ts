/**
 * Geometry of the settings menu and of the control editor.
 *
 * Same rule as the controls themselves: one module owns the rectangles, so
 * the layer that draws a row and the layer that decides a tap landed on it
 * can never disagree about where it was.
 */
import { clamp } from '../core/math'
import type { Viewport } from '../render/viewport'
import {
  CONTROL_LABELS,
  LATCHABLE_SLOTS,
  PRESET_LABELS,
  type ControlSlot,
} from './controlLayout'
import type { Rect, TouchLayout } from './touchLayout'
import type { UiState } from './uiState'

export type MenuAction = 'edit' | 'steeringStyle' | 'preset' | 'reset' | 'close'

export interface MenuRow {
  readonly action: MenuAction
  readonly label: string
  /** Right-aligned current value, empty for rows that simply do something. */
  readonly value: string
  readonly rect: Rect
}

export interface MenuLayout {
  readonly panel: Rect
  readonly title: string
  readonly rows: readonly MenuRow[]
}

export function computeMenuLayout(viewport: Viewport, ui: UiState): MenuLayout {
  const unit = clamp(Math.min(viewport.cssWidth, viewport.cssHeight) * 0.13, 44, 92)
  const rowHeight = Math.max(44, unit * 0.66)
  const padding = unit * 0.24
  const definitions: readonly { action: MenuAction; label: string; value: string }[] = [
    { action: 'edit', label: 'EDITAR CONTROLES', value: '' },
    {
      action: 'steeringStyle',
      label: 'ESTERCAMENTO',
      value: ui.controls.steeringStyle === 'wheel' ? 'VOLANTE' : 'BARRA',
    },
    { action: 'preset', label: 'LAYOUT', value: PRESET_LABELS[ui.controls.preset] },
    { action: 'reset', label: 'RESTAURAR PADRAO', value: '' },
    { action: 'close', label: 'FECHAR', value: '' },
  ]

  const width = Math.min(
    viewport.cssWidth - viewport.safeArea.left - viewport.safeArea.right - unit * 0.4,
    unit * 6.4,
  )
  const height = definitions.length * rowHeight + (definitions.length - 1) * padding * 0.4 + padding * 3.2
  const x = (viewport.cssWidth - width) / 2
  const y = clamp(
    (viewport.cssHeight - height) / 2,
    viewport.safeArea.top + unit * 0.2,
    Math.max(viewport.safeArea.top + unit * 0.2, viewport.cssHeight - height - unit * 0.2),
  )

  const rows: MenuRow[] = definitions.map((definition, index) => ({
    ...definition,
    rect: {
      x: x + padding,
      y: y + padding * 2.2 + index * (rowHeight + padding * 0.4),
      width: width - padding * 2,
      height: rowHeight,
    },
  }))

  return { panel: { x, y, width, height }, title: 'CONFIGURACOES', rows }
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
