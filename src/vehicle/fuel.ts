/**
 * Fuel types.
 *
 * A fuel is not a behaviour, it is a handful of numbers. Each type overwrites
 * part of the engine it is poured into and is then out of the way: what comes
 * out of `applyFuel` is an ordinary set of car parameters, indistinguishable
 * from one somebody authored by hand.
 *
 * That is the whole design. The engine never learns that fuel exists, so there
 * is not a single test for a fuel type anywhere in the physics -- and adding a
 * fourth one is a matter of adding four numbers to fuels.json.
 */
import { validatePowertrain, type CarParams, type PowertrainParams } from './carParams'

export interface FuelParams {
  /** Key in fuels.json, and what is written to storage. */
  readonly id: string
  /** Name for the menu. */
  readonly label: string
  /** One line saying what driving on it is like. */
  readonly hint: string
  /** Below this, a loaded engine dies [rpm]. */
  readonly stallRpm: number
  /** Speed the idle governor holds [rpm]. */
  readonly idleRpm: number
  /** Scales the whole torque curve [-]. */
  readonly torqueMultiplier: number
  /** Added to `stallRpm` while the engine is cold [rpm]. */
  readonly coldStallBonus: number
  /** Rev ceiling of its own, when it has one [rpm]; null keeps the car's. */
  readonly maxRpm: number | null
}

/** Every fuel, in the order they are offered. */
export type FuelCatalog = readonly FuelParams[]

/**
 * The entry the player asked for, or the first one. A stored id that no
 * longer exists must cost a default fuel, never a game that will not start.
 */
export function resolveFuel(catalog: FuelCatalog, id: string): FuelParams {
  for (const fuel of catalog) if (fuel.id === id) return fuel
  return catalog[0]
}

/** The fuel after this one, wrapping round. */
export function nextFuelId(catalog: FuelCatalog, id: string): string {
  const index = catalog.findIndex((fuel) => fuel.id === id)
  return catalog[(index + 1) % catalog.length].id
}

/**
 * Pours a fuel into a car and hands back the car it makes.
 *
 * Always applied to the car as it was authored, never to a car that already
 * has a fuel in it: overwriting is only safe from a known starting point.
 *
 * A ceiling lower than the one the car was geared for takes the gearbox down
 * with it, in proportion. Left alone, an automatic told to change gear at
 * 5200 rpm in an engine that stops at 4500 would simply never change gear.
 */
export function applyFuel(car: CarParams, fuel: FuelParams): CarParams {
  const base = car.powertrain
  const maxRpm = fuel.maxRpm ?? base.maxRpm
  const revScale = maxRpm / base.maxRpm

  const powertrain: PowertrainParams = {
    ...base,
    stallRpm: fuel.stallRpm,
    idleRpm: fuel.idleRpm,
    coldStallBonus: fuel.coldStallBonus,
    maxRpm,
    upshiftRpm: base.upshiftRpm * revScale,
    downshiftRpm: base.downshiftRpm * revScale,
    autoEngageRpm: base.autoEngageRpm * revScale,
    autoLaunchRpm: base.autoLaunchRpm * revScale,
    torqueCurve: base.torqueCurve.map((point) => ({
      rpm: point.rpm,
      torque: point.torque * fuel.torqueMultiplier,
    })),
  }
  validatePowertrain(powertrain, `combustivel "${fuel.id}"`)
  return { ...car, powertrain }
}

// ------------------------------------------------------------------ parsing

function readObject(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${where}: deve ser um objeto`)
  }
  return raw as Record<string, unknown>
}

function readNumber(
  source: Record<string, unknown>,
  field: string,
  where: string,
  minimum: number,
): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) {
    throw new Error(`${where}: "${field}" deve ser um numero >= ${minimum}`)
  }
  return value
}

function readText(source: Record<string, unknown>, field: string, where: string): string {
  const value = source[field]
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${where}: "${field}" deve ser uma string nao vazia`)
  }
  return value
}

function parseFuel(id: string, raw: unknown): FuelParams {
  const where = `fuels.json: "${id}"`
  const source = readObject(raw, where)
  const maxRpm = source['maxRpm']
  if (maxRpm !== undefined && (typeof maxRpm !== 'number' || !Number.isFinite(maxRpm) || maxRpm <= 0)) {
    throw new Error(`${where}: "maxRpm" deve ser um numero positivo quando presente`)
  }
  const fuel: FuelParams = {
    id,
    label: readText(source, 'label', where),
    hint: readText(source, 'hint', where),
    stallRpm: readNumber(source, 'stallRpm', where, 1),
    idleRpm: readNumber(source, 'idleRpm', where, 1),
    torqueMultiplier: readNumber(source, 'torqueMultiplier', where, 0.01),
    coldStallBonus: readNumber(source, 'coldStallBonus', where, 0),
    maxRpm: maxRpm === undefined ? null : maxRpm,
  }
  if (fuel.stallRpm + fuel.coldStallBonus >= fuel.idleRpm) {
    throw new Error(`${where}: "stallRpm" + "coldStallBonus" precisa ser menor que "idleRpm"`)
  }
  return fuel
}

/**
 * The catalog, in the order the file lists it -- which is the order the menu
 * offers, so the file is also where that is decided.
 */
export function parseFuelCatalog(raw: unknown, where: string): FuelCatalog {
  const source = readObject(raw, where)
  const catalog: FuelParams[] = []
  for (const id of Object.keys(source)) catalog.push(parseFuel(id, source[id]))
  if (catalog.length === 0) throw new Error(`${where}: nenhum combustivel definido`)
  return catalog
}

export async function loadFuelCatalog(url: string, where: string): Promise<FuelCatalog> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Falha ao carregar ${where} (HTTP ${response.status})`)
  return parseFuelCatalog((await response.json()) as unknown, where)
}
