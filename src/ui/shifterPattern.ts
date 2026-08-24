/**
 * The gear pattern: where every gear sits in the gate, and the proportions the
 * plate is drawn from.
 *
 * This is the single source of truth. src/data/shifter.json names the columns
 * and the side of the corridor each gear seats on; both the engagement rule
 * (shifterGate.ts) and the drawing (gateOverlay.ts) read it from here, so a
 * position number is never written down twice. Move a gear to another column
 * in the JSON and the channel moves with it, because the channel is derived
 * from the same list the rule walks.
 *
 * A column with no position on a side simply has no channel there -- which is
 * why the top of the reverse column comes out solid without anyone having to
 * paint over it.
 */
import { NEUTRAL_GEAR, REVERSE_GEAR } from '../vehicle/powertrain'

/** Side of the central corridor: -1 is up ("cima"), +1 is down ("baixo"). */
export type GateSide = -1 | 1

export interface ShifterPosition {
  /** Gear seated here. REVERSE_GEAR stands for "R". */
  readonly gear: number
  /** Column, counted from the left. */
  readonly column: number
  readonly side: GateSide
}

export interface ShifterPattern {
  readonly columns: number
  readonly positions: readonly ShifterPosition[]
}

// ------------------------------------------------------------------ loading

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readInteger(source: Record<string, unknown>, field: string, where: string): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new Error(`${where}: campo "${field}" deve ser um numero inteiro`)
  }
  return value
}

function readGear(source: Record<string, unknown>, where: string): number {
  const value = source['marcha']
  if (value === 'R') return REVERSE_GEAR
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new Error(`${where}: campo "marcha" deve ser um inteiro a partir de 1, ou "R"`)
  }
  return value
}

function readSide(source: Record<string, unknown>, where: string): GateSide {
  const value = source['lado']
  if (value === 'cima') return -1
  if (value === 'baixo') return 1
  throw new Error(`${where}: campo "lado" deve ser "cima" ou "baixo"`)
}

export function parseShifterPattern(raw: unknown): ShifterPattern {
  if (!isRecord(raw)) throw new Error('shifter.json: raiz deve ser um objeto')

  const columns = readInteger(raw, 'colunas', 'shifter.json')
  if (columns < 1) throw new Error('shifter.json: "colunas" deve ser pelo menos 1')

  // The rule in shifterGate.ts is built entirely around a corridor in the
  // middle -- leaving a gear means coming back to it, and neutral is being in
  // it. There is no second pattern to fall back on, so say so instead of
  // drawing something the gearbox would not obey.
  if (raw['corredorCentral'] !== true) {
    throw new Error('shifter.json: "corredorCentral" precisa ser true')
  }

  const rawPositions = raw['posicoes']
  if (!Array.isArray(rawPositions) || rawPositions.length === 0) {
    throw new Error('shifter.json: "posicoes" deve ser uma lista nao vazia')
  }

  const positions: ShifterPosition[] = []
  const seenSlots = new Set<string>()
  const seenGears = new Set<number>()
  for (let i = 0; i < rawPositions.length; i++) {
    const where = `shifter.json posicoes[${i}]`
    const entry: unknown = rawPositions[i]
    if (!isRecord(entry)) throw new Error(`${where}: deve ser um objeto`)

    const column = readInteger(entry, 'coluna', where)
    if (column < 0 || column >= columns) {
      throw new Error(`${where}: "coluna" ${column} esta fora de 0..${columns - 1}`)
    }
    const side = readSide(entry, where)
    const gear = readGear(entry, where)

    const slot = `${column}:${side}`
    if (seenSlots.has(slot)) throw new Error(`${where}: coluna ${column} ja tem uma marcha nesse lado`)
    if (seenGears.has(gear)) throw new Error(`${where}: a marcha aparece duas vezes no padrao`)
    seenSlots.add(slot)
    seenGears.add(gear)
    positions.push({ gear, column, side })
  }

  return { columns, positions }
}

export async function loadShifterPattern(url: string): Promise<ShifterPattern> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Falha ao carregar shifter.json (HTTP ${response.status})`)
  return parseShifterPattern((await response.json()) as unknown)
}

// ------------------------------------------------------------------ queries

/**
 * Which gear sits at a gate position, or null when there is nothing there.
 *
 * `lane` is the raw lever displacement: 0 is the corridor, which is always
 * neutral. A forward gear the fitted box does not have (a five-speed asked
 * for the sixth position) counts as nothing, exactly like an empty slot.
 */
export function gearAt(
  pattern: ShifterPattern,
  column: number,
  lane: number,
  forwardGears: number,
): number | null {
  if (lane === 0) return NEUTRAL_GEAR
  const side: GateSide = lane < 0 ? -1 : 1
  for (const position of pattern.positions) {
    if (position.column !== column || position.side !== side) continue
    if (position.gear === REVERSE_GEAR) return REVERSE_GEAR
    return position.gear <= forwardGears ? position.gear : null
  }
  return null
}

/** Where a gear sits in the gate, for putting the lever back where it belongs. */
export function gearSeat(
  pattern: ShifterPattern,
  gear: number,
): { column: number; lane: GateSide | 0 } {
  if (gear !== NEUTRAL_GEAR) {
    for (const position of pattern.positions) {
      if (position.gear === gear) return { column: position.column, lane: position.side }
    }
  }
  return { column: 0, lane: 0 }
}

// ----------------------------------------------------------------- geometry
//
// The plate's proportions, in abstract drawing units. Nothing here is a
// pixel: the SVG carries them as its viewBox and the layout scales the whole
// plate to whatever room the seat has. Column spacing is uniform, so a gear
// moved to another column lands exactly one spacing further along.

export const GATE_UNITS = {
  /** Distance between the centres of two neighbouring channels. */
  columnSpacing: 100,
  /** Width of every channel, corridor included -- they are one shape. */
  channelWidth: 34,
  /** Corridor centre to a fully seated gear. */
  laneReach: 84,
  /** Plate border left and right of the outermost column. */
  marginX: 56,
  /** Plate border above and below a seated gear. */
  marginY: 62,
  plateRadius: 34,
  /** Knob diameter: a channel plus enough for a thumb, well clear of the
   *  neighbouring column. */
  knobDiameter: 66,
  labelSize: 30,
} as const

export function plateWidthUnits(pattern: ShifterPattern): number {
  return (pattern.columns - 1) * GATE_UNITS.columnSpacing + GATE_UNITS.marginX * 2
}

export function plateHeightUnits(): number {
  return (GATE_UNITS.laneReach + GATE_UNITS.marginY) * 2
}

/** Width over height: what the layout fits the plate into its room with. */
export function plateAspect(pattern: ShifterPattern): number {
  return plateWidthUnits(pattern) / plateHeightUnits()
}

/** Centre of a (possibly fractional) column, in drawing units. */
export function columnCenterUnits(column: number): number {
  return GATE_UNITS.marginX + column * GATE_UNITS.columnSpacing
}

export function corridorYUnits(): number {
  return plateHeightUnits() / 2
}

/** Far end of a channel's round tip, measured from the corridor. */
export function channelTipUnits(): number {
  return GATE_UNITS.laneReach + GATE_UNITS.channelWidth / 2
}

/** Where a gear number sits: centred in the band between tip and plate edge. */
export function labelOffsetUnits(): number {
  return (channelTipUnits() + plateHeightUnits() / 2) / 2
}
