/**
 * How far down a pedal is, from where the finger is sitting on it.
 *
 * A real pedal is not linear and neither is what it is attached to: the first
 * centimetre of brake travel takes up the pads and barely slows the car, and
 * the last one locks the wheels. On a phone the whole pedal is about as long
 * as a thumb, so a straight mapping spends most of that thumb on force nobody
 * parking a car ever wants -- and leaves the gentle end, the only end that
 * matters when easing into a space, with a few pixels to work in.
 *
 * So the finger's position is put through a power curve: `travel^exponent`.
 * The bottom of the pedal then covers a small band of force with a lot of
 * room, and the top covers a large one with little -- which is exactly the
 * resolution a driver wants and the reverse of what a straight line gives.
 * At an exponent of 2.4 the lower third of the brake reaches about a twelfth
 * of full braking, and the pedal is still able to lock the wheels at the top.
 *
 * Both exponents live in src/data/controls.json, so the feel can be tuned
 * without touching this file.
 */
import { clamp } from '../core/math'

export interface PedalCurve {
  /** Power the throttle's finger position is raised to. */
  readonly throttleExponent: number
  /** Power the brake's finger position is raised to. */
  readonly brakeExponent: number
  /**
   * What the very edge of a pedal is still worth, 0..1. A touch that lands on
   * a pedal has to do something, or a pedal that is being held reads as one
   * that is not being touched at all.
   */
  readonly touchFloor: number
}

/**
 * Used only when the file cannot be read at all -- the game has to be
 * drivable before it has finished explaining what went wrong.
 */
export const DEFAULT_PEDAL_CURVE: PedalCurve = {
  throttleExponent: 1.9,
  brakeExponent: 2.4,
  touchFloor: 0.04,
}

/** A straight line is allowed; anything under it would be the wrong shape. */
const MIN_EXPONENT = 1
/** Past this the pedal is a switch: nothing happens, then everything does. */
const MAX_EXPONENT = 6
/** A floor larger than this would make a light touch a firm application. */
const MAX_TOUCH_FLOOR = 0.3

/**
 * How hard a pedal is being applied, from how far into its travel the finger
 * is. `travel` is 0 at the shallow edge and 1 at the far one.
 */
export function pedalResponse(travel: number, exponent: number, floor: number): number {
  const ratio = Math.pow(clamp(travel, 0, 1), exponent)
  return floor + (1 - floor) * ratio
}

function readObject(raw: unknown, where: string): Record<string, unknown> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error(`${where}: deve ser um objeto`)
  }
  return raw as Record<string, unknown>
}

function readRange(
  source: Record<string, unknown>,
  field: string,
  min: number,
  max: number,
  where: string,
): number {
  const value = source[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${where}: "${field}" deve ser um numero entre ${min} e ${max}`)
  }
  return value
}

export function parseControlsData(raw: unknown, where: string): PedalCurve {
  const root = readObject(raw, `${where}: raiz`)
  const pedals = readObject(root['pedals'], `${where}: "pedals"`)
  return {
    throttleExponent: readRange(
      pedals,
      'throttleExponent',
      MIN_EXPONENT,
      MAX_EXPONENT,
      `${where}.pedals`,
    ),
    brakeExponent: readRange(
      pedals,
      'brakeExponent',
      MIN_EXPONENT,
      MAX_EXPONENT,
      `${where}.pedals`,
    ),
    touchFloor: readRange(pedals, 'touchFloor', 0, MAX_TOUCH_FLOOR, `${where}.pedals`),
  }
}

export async function loadPedalCurve(url: string, where: string): Promise<PedalCurve> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Falha ao carregar ${where} (HTTP ${response.status})`)
  return parseControlsData((await response.json()) as unknown, where)
}
