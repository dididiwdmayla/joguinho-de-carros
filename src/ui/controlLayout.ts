/**
 * Where the on-screen controls live, and what each one is allowed to do.
 *
 * The built-in layout in touchLayout.ts is only a starting point. A phone has
 * fewer fingers than this car has controls -- holding the clutch, feeding the
 * throttle and steering at once is three thumbs' worth of work -- so every
 * control can be dragged somewhere else, resized, hidden, or told to latch:
 * pressed once to go down, pressed again to come back up. A latched clutch is
 * what makes the gear change possible with two hands.
 *
 * A placement is stored as a centre in viewport fractions and a multiplier
 * over the control's own default size, never as raw pixels: the layout then
 * survives a rotation, a resize, and a different phone.
 */
import { clamp } from '../core/math'

/**
 * The driving controls, and only those. The row of system buttons along the
 * top -- menu, control layer, debug, mute, fullscreen -- and the volume bar
 * beside them stay where they are: they are how the editor is reached, and a
 * control that can be moved on top of its own way out is a trap.
 */
export type ControlSlot =
  | 'steering'
  | 'throttle'
  | 'brake'
  | 'clutch'
  | 'handbrake'
  | 'gearbox'
  | 'mode'
  | 'ignition'

/** Every slot, in the order the editor walks them. */
export const CONTROL_SLOTS: readonly ControlSlot[] = [
  'steering',
  'throttle',
  'brake',
  'clutch',
  'handbrake',
  'gearbox',
  'mode',
  'ignition',
]

/** Name shown against a control while it is being moved. */
export const CONTROL_LABELS: Readonly<Record<ControlSlot, string>> = {
  steering: 'ESTERCAMENTO',
  throttle: 'ACELERADOR',
  brake: 'FREIO',
  clutch: 'EMBREAGEM',
  handbrake: 'FREIO DE MAO',
  gearbox: 'CAMBIO',
  mode: 'MODO',
  ignition: 'PARTIDA',
}

/**
 * Controls a tap can leave held. The gearbox is a drag rather than a press,
 * the mode selector and the starter already act once, and the volume bar
 * keeps its position by nature -- none of them has anything to latch.
 */
export const LATCHABLE_SLOTS: ReadonlySet<ControlSlot> = new Set<ControlSlot>([
  'steering',
  'throttle',
  'brake',
  'clutch',
  'handbrake',
])

/** Bar or wheel. The bar is the default: it is the more precise of the two. */
export type SteeringStyle = 'bar' | 'wheel'

/**
 * Turns of the wheel from one stop to the other, as the player may set it.
 *
 * It costs nothing but precision, which is why it lives under CONTROLE: a
 * quick rack and a slow one reach the same lock, they only ask for more or
 * less hand to get there. Three turns is what a real car without power
 * steering asks for; one and a half is what an arcade gives you.
 */
export const WHEEL_TURN_OPTIONS: readonly number[] = [1.5, 2, 2.5, 3]

export const DEFAULT_WHEEL_TURNS = 2

/** How far the wheel turns from centre to full lock [rad]. */
export function wheelMaxAngle(turns: number): number {
  return (turns * Math.PI * 2) / 2
}

/** The next setting up, wrapping round to the quickest. */
export function nextWheelTurns(turns: number): number {
  const index = WHEEL_TURN_OPTIONS.indexOf(nearestWheelTurns(turns))
  return WHEEL_TURN_OPTIONS[(index + 1) % WHEEL_TURN_OPTIONS.length]
}

/** The offered setting closest to a number, however that number arrived. */
export function nearestWheelTurns(turns: number): number {
  let best = DEFAULT_WHEEL_TURNS
  let distance = Number.POSITIVE_INFINITY
  for (const option of WHEEL_TURN_OPTIONS) {
    const gap = Math.abs(option - turns)
    if (gap < distance) {
      distance = gap
      best = option
    }
  }
  return best
}

/**
 * The setting as the menu shows it. The two ends are named rather than left
 * as numbers: "3.0" says nothing, "3.0 SIMULACAO" says what it is for.
 */
export function wheelTurnsLabel(turns: number): string {
  const value = turns.toFixed(1)
  if (turns <= WHEEL_TURN_OPTIONS[0]) return `${value} RAPIDO`
  if (turns >= WHEEL_TURN_OPTIONS[WHEEL_TURN_OPTIONS.length - 1]) return `${value} SIMULACAO`
  return value
}

export type PresetId = 'padrao' | 'canhoto' | 'compacto'

export const PRESET_IDS: readonly PresetId[] = ['padrao', 'canhoto', 'compacto']

export const PRESET_LABELS: Readonly<Record<PresetId, string>> = {
  padrao: 'PADRAO',
  canhoto: 'CANHOTO',
  compacto: 'COMPACTO',
}

/** How far a control may be shrunk or grown, as a factor of its default size. */
export const MIN_CONTROL_SCALE = 0.5
export const MAX_CONTROL_SCALE = 2.2

export interface ControlPlacement {
  /** Centre of the control, as a fraction of the viewport. */
  x: number
  y: number
  /** Multiplier over the control's default size. */
  scale: number
  hidden: boolean
  /** Press once to hold, press again to release. */
  latch: boolean
}

/** A null placement means "wherever the built-in layout puts it". */
export type ControlPlacements = Record<ControlSlot, ControlPlacement | null>

export interface ControlConfig {
  steeringStyle: SteeringStyle
  /** Turns from stop to stop, one of WHEEL_TURN_OPTIONS. */
  wheelTurns: number
  /** Only a label: the preset is materialised into placements when applied. */
  preset: PresetId
  placements: ControlPlacements
}

export function emptyPlacements(): ControlPlacements {
  return {
    steering: null,
    throttle: null,
    brake: null,
    clutch: null,
    handbrake: null,
    gearbox: null,
    mode: null,
    ignition: null,
  }
}

export function defaultControlConfig(): ControlConfig {
  return {
    steeringStyle: 'bar',
    wheelTurns: DEFAULT_WHEEL_TURNS,
    preset: 'padrao',
    placements: emptyPlacements(),
  }
}

// ------------------------------------------------------------------ presets

/** Default centres of every slot, in viewport fractions. */
export type SlotCenters = Readonly<Record<ControlSlot, { x: number; y: number }>>

/**
 * Turns a preset into real placements, measured against the layout the game
 * would have used anyway. Materialising rather than deriving it every frame
 * is what lets a preset be used as a starting point and then adjusted.
 */
export function presetPlacements(preset: PresetId, centers: SlotCenters): ControlPlacements {
  if (preset === 'padrao') return emptyPlacements()

  const placements = emptyPlacements()
  for (const slot of CONTROL_SLOTS) {
    const centre = centers[slot]
    if (preset === 'canhoto') {
      // Mirrored down the middle: everything that was under the right thumb
      // is now under the left one, and the other way round.
      placements[slot] = { x: 1 - centre.x, y: centre.y, scale: 1, hidden: false, latch: false }
      continue
    }
    // Compact: smaller, and pulled towards the edge each control already
    // leans on, so the middle of a small screen stays clear of the car.
    const side = centre.x < 0.5 ? -1 : 1
    placements[slot] = {
      x: clamp(centre.x + side * 0.06, 0.05, 0.95),
      y: clamp(centre.y + 0.03, 0.05, 0.95),
      scale: 0.78,
      hidden: false,
      latch: false,
    }
  }
  return placements
}

// ------------------------------------------------------------------ storage

const STORAGE_KEY = 'joguinho.controls.v1'

/**
 * Reads back a saved layout. Every field is checked: a layout written by an
 * older build, or edited by hand, must never be able to leave a control
 * off-screen or the game unable to start. Anything unreadable falls back to
 * the default for that field alone.
 */
export function loadControlConfig(): ControlConfig {
  const config = defaultControlConfig()
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(STORAGE_KEY)
  } catch {
    return config
  }
  if (raw === null) return config

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return config
  }
  if (typeof parsed !== 'object' || parsed === null) return config
  const source = parsed as Record<string, unknown>

  if (source['steeringStyle'] === 'wheel' || source['steeringStyle'] === 'bar') {
    config.steeringStyle = source['steeringStyle']
  }
  const wheelTurns = source['wheelTurns']
  if (typeof wheelTurns === 'number' && Number.isFinite(wheelTurns)) {
    // Snapped rather than trusted: a build with a different set of settings,
    // or a hand-edited file, still has to land on one this one offers.
    config.wheelTurns = nearestWheelTurns(wheelTurns)
  }
  const preset = source['preset']
  if (typeof preset === 'string' && (PRESET_IDS as readonly string[]).includes(preset)) {
    config.preset = preset as PresetId
  }

  const placements = source['placements']
  if (typeof placements === 'object' && placements !== null) {
    const record = placements as Record<string, unknown>
    for (const slot of CONTROL_SLOTS) {
      config.placements[slot] = readPlacement(record[slot], slot)
    }
  }
  return config
}

function readPlacement(value: unknown, slot: ControlSlot): ControlPlacement | null {
  if (typeof value !== 'object' || value === null) return null
  const source = value as Record<string, unknown>
  const x = source['x']
  const y = source['y']
  const scale = source['scale']
  if (typeof x !== 'number' || !Number.isFinite(x)) return null
  if (typeof y !== 'number' || !Number.isFinite(y)) return null
  return {
    x: clamp(x, 0, 1),
    y: clamp(y, 0, 1),
    scale:
      typeof scale === 'number' && Number.isFinite(scale)
        ? clamp(scale, MIN_CONTROL_SCALE, MAX_CONTROL_SCALE)
        : 1,
    hidden: source['hidden'] === true,
    latch: source['latch'] === true && LATCHABLE_SLOTS.has(slot),
  }
}

/** Storage can be full or forbidden; losing the layout must not lose the game. */
export function saveControlConfig(config: ControlConfig): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  } catch (error: unknown) {
    console.warn('[joguinho] nao foi possivel salvar o layout dos controles', error)
  }
}
