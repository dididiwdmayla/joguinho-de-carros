/**
 * The half of the settings that changes how hard the game is.
 *
 * Kept apart from the control layout on purpose, and not only in the menu: a
 * player who moves a pedal and a player who fills the tank with alcohol are
 * doing two different things, and only one of them is choosing a difficulty.
 * Two settings, two storage keys, no chance of one restoring the other.
 */
import { resolveFuel, type FuelCatalog } from '../vehicle/fuel'
import { TRANSMISSION_MODES, type TransmissionMode } from '../vehicle/powertrain'

/**
 * How the car is handed over the very first time. Automatic: the game has to
 * be drivable before anyone has read which key changes the gearbox.
 */
export const DEFAULT_TRANSMISSION: TransmissionMode = 'automatic'

export interface VehicleSettings {
  /** Key into the fuel catalog. */
  fuel: string
  transmission: TransmissionMode
}

const STORAGE_KEY = 'joguinho.vehicle.v1'

/**
 * Reads the settings back, measured against the catalog that was actually
 * loaded: a fuel that has since been renamed or dropped costs the default
 * fuel, never a game that will not start.
 */
export function loadVehicleSettings(catalog: FuelCatalog): VehicleSettings {
  const settings: VehicleSettings = {
    fuel: catalog[0].id,
    transmission: DEFAULT_TRANSMISSION,
  }

  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return settings
  }
  if (raw === null) return settings

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return settings
  }
  if (typeof parsed !== 'object' || parsed === null) return settings
  const source = parsed as Record<string, unknown>

  const fuel = source['fuel']
  if (typeof fuel === 'string') settings.fuel = resolveFuel(catalog, fuel).id

  const transmission = source['transmission']
  if (
    typeof transmission === 'string' &&
    (TRANSMISSION_MODES as readonly string[]).includes(transmission)
  ) {
    settings.transmission = transmission as TransmissionMode
  }
  return settings
}

/** Storage can be full or forbidden; losing a setting must not lose the game. */
export function saveVehicleSettings(settings: VehicleSettings): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
  } catch (error: unknown) {
    console.warn('[joguinho] nao foi possivel salvar os ajustes do veiculo', error)
  }
}
