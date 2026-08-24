/**
 * Uniform grid over the static bodies of a level: the broad phase.
 *
 * A level with thirty parked cars, a fence of cones and four walls is around
 * forty boxes. Testing the player against every one of them, every frame, is
 * two thousand separating axis tests a second spent proving that the car is
 * nowhere near the far end of the lot. The grid answers the only question the
 * narrow phase actually needs -- which boxes are close -- by looking at the
 * handful of cells the car is standing on.
 *
 * The layout is a compressed row: `starts` says where each cell's slice of
 * `items` begins, and `items` holds the body indices back to back. It is built
 * once when the level loads and never written to again, so a query allocates
 * nothing and touches only the cells it asks for.
 */

export interface SpatialGrid {
  /** Cell side in metres. */
  readonly cellSize: number
  /** World coordinate of the first column/row. */
  readonly minX: number
  readonly minY: number
  readonly columns: number
  readonly rows: number
  /** Index into `items` where each cell starts; length columns*rows + 1. */
  readonly starts: Int32Array
  readonly items: Int32Array
  /**
   * Which query last reported each body, so one that straddles four cells is
   * still handed back once. Written by `queryGrid`, meaningless outside it.
   */
  readonly stamps: Int32Array
}

/** One body's axis-aligned extent, which is all the grid needs to file it. */
export interface GridBounds {
  readonly minX: number
  readonly minY: number
  readonly maxX: number
  readonly maxY: number
}

/**
 * Files every body into the cells its bounds touch.
 *
 * Two passes: count how many entries each cell wants, then fill. That is what
 * lets the whole thing live in two flat arrays instead of an array of arrays,
 * with no per-cell allocation at all.
 */
export function buildGrid(bounds: readonly GridBounds[], cellSize: number): SpatialGrid {
  const size = Math.max(0.5, cellSize)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const bound of bounds) {
    if (bound.minX < minX) minX = bound.minX
    if (bound.minY < minY) minY = bound.minY
    if (bound.maxX > maxX) maxX = bound.maxX
    if (bound.maxY > maxY) maxY = bound.maxY
  }
  // An empty level still needs a grid: one cell that never matches anything.
  if (bounds.length === 0) {
    minX = 0
    minY = 0
    maxX = 0
    maxY = 0
  }

  const columns = Math.max(1, Math.ceil((maxX - minX) / size) + 1)
  const rows = Math.max(1, Math.ceil((maxY - minY) / size) + 1)
  const cellCount = columns * rows

  const counts = new Int32Array(cellCount)
  for (const bound of bounds) {
    forEachCell(bound, minX, minY, size, columns, rows, (cell) => {
      counts[cell]++
    })
  }

  const starts = new Int32Array(cellCount + 1)
  let total = 0
  for (let i = 0; i < cellCount; i++) {
    starts[i] = total
    total += counts[i]
  }
  starts[cellCount] = total

  const cursor = starts.slice(0, cellCount)
  const items = new Int32Array(total)
  for (let index = 0; index < bounds.length; index++) {
    forEachCell(bounds[index], minX, minY, size, columns, rows, (cell) => {
      items[cursor[cell]++] = index
    })
  }

  return {
    cellSize: size,
    minX,
    minY,
    columns,
    rows,
    starts,
    items,
    stamps: new Int32Array(bounds.length).fill(-1),
  }
}

function forEachCell(
  bound: GridBounds,
  minX: number,
  minY: number,
  size: number,
  columns: number,
  rows: number,
  visit: (cell: number) => void,
): void {
  const firstColumn = clampIndex(Math.floor((bound.minX - minX) / size), columns)
  const lastColumn = clampIndex(Math.floor((bound.maxX - minX) / size), columns)
  const firstRow = clampIndex(Math.floor((bound.minY - minY) / size), rows)
  const lastRow = clampIndex(Math.floor((bound.maxY - minY) / size), rows)
  for (let row = firstRow; row <= lastRow; row++) {
    for (let column = firstColumn; column <= lastColumn; column++) {
      visit(row * columns + column)
    }
  }
}

function clampIndex(value: number, count: number): number {
  return value < 0 ? 0 : value >= count ? count - 1 : value
}

/** Ticks up on every query, so the stamp array never has to be cleared. */
let queryStamp = 0

/**
 * Appends the bodies whose cells overlap the given box to `out`, each one at
 * most once, and returns how many were written. `out` is reused by the caller:
 * nothing here allocates.
 */
export function queryGrid(
  grid: SpatialGrid,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
  out: number[],
): number {
  queryStamp++
  let count = 0
  const firstColumn = clampIndex(Math.floor((minX - grid.minX) / grid.cellSize), grid.columns)
  const lastColumn = clampIndex(Math.floor((maxX - grid.minX) / grid.cellSize), grid.columns)
  const firstRow = clampIndex(Math.floor((minY - grid.minY) / grid.cellSize), grid.rows)
  const lastRow = clampIndex(Math.floor((maxY - grid.minY) / grid.cellSize), grid.rows)

  for (let row = firstRow; row <= lastRow; row++) {
    const rowStart = row * grid.columns
    for (let column = firstColumn; column <= lastColumn; column++) {
      const cell = rowStart + column
      const end = grid.starts[cell + 1]
      for (let i = grid.starts[cell]; i < end; i++) {
        const body = grid.items[i]
        if (grid.stamps[body] === queryStamp) continue
        grid.stamps[body] = queryStamp
        out[count++] = body
      }
    }
  }
  return count
}
