/**
 * Where the on-screen controls live, and what each one is allowed to do.
 *
 * A layout belongs to one gearbox, never to the game as a whole. The three
 * transmissions do not have the same controls in front of them -- an H gate
 * is not two paddles is not a P R N D selector, and the manual is the only
 * one with a clutch to work -- so a size that suits one of them is the wrong
 * size for the other two. Each mode keeps its own placements, and switching
 * gearbox loads that mode's layout.
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
import { TRANSMISSION_MODES, type TransmissionMode } from '../vehicle/powertrain'

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
 * Every drawn piece of the touch layer that the opacity setting reaches: the
 * movable controls plus the volume bar, which sits beside them but is fixed
 * and so has no slot of its own.
 */
export type OpacitySlot = ControlSlot | 'volume'

export const OPACITY_SLOTS: readonly OpacitySlot[] = [...CONTROL_SLOTS, 'volume']

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

/**
 * How see-through the touch layer is, so it never becomes a wall between the
 * thumbs and the road under it. Steps of a fifth, the same shape as the wheel
 * turn options, from barely there to solid.
 */
export const CONTROL_OPACITY_OPTIONS: readonly number[] = [0.2, 0.4, 0.6, 0.8, 1]

export const DEFAULT_CONTROLS_OPACITY = 0.6

/** The next setting up, wrapping round to the most transparent. */
export function nextControlsOpacity(opacity: number): number {
  const index = CONTROL_OPACITY_OPTIONS.indexOf(nearestControlsOpacity(opacity))
  return CONTROL_OPACITY_OPTIONS[(index + 1) % CONTROL_OPACITY_OPTIONS.length]
}

/** The offered setting closest to a number, however that number arrived. */
export function nearestControlsOpacity(opacity: number): number {
  let best = DEFAULT_CONTROLS_OPACITY
  let distance = Number.POSITIVE_INFINITY
  for (const option of CONTROL_OPACITY_OPTIONS) {
    const gap = Math.abs(option - opacity)
    if (gap < distance) {
      distance = gap
      best = option
    }
  }
  return best
}

export function controlsOpacityLabel(opacity: number): string {
  return `${Math.round(opacity * 100)}%`
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

/** One gearbox's worth of layout: where its controls sit, and under which preset. */
export interface ModeLayout {
  /** Only a label: the preset is materialised into placements when applied. */
  preset: PresetId
  placements: ControlPlacements
}

export interface ControlConfig {
  steeringStyle: SteeringStyle
  /** Turns from stop to stop, one of WHEEL_TURN_OPTIONS. */
  wheelTurns: number
  /**
   * One layout per gearbox. They are edited and stored apart, so resizing the
   * gate in manual leaves the automatic's selector exactly where it was.
   */
  layouts: Record<TransmissionMode, ModeLayout>
  /** How see-through the touch layer is, one of CONTROL_OPACITY_OPTIONS. */
  controlsOpacity: number
}

/** The layout in force for a gearbox. The only way one is ever reached. */
export function layoutFor(config: ControlConfig, mode: TransmissionMode): ModeLayout {
  return config.layouts[mode]
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

/** A gearbox's layout as the game ships it: the built-in one, untouched. */
export function emptyModeLayout(): ModeLayout {
  return { preset: 'padrao', placements: emptyPlacements() }
}

function emptyLayouts(): Record<TransmissionMode, ModeLayout> {
  const layouts = {} as Record<TransmissionMode, ModeLayout>
  for (const mode of TRANSMISSION_MODES) layouts[mode] = emptyModeLayout()
  return layouts
}

export function defaultControlConfig(): ControlConfig {
  return {
    steeringStyle: 'bar',
    wheelTurns: DEFAULT_WHEEL_TURNS,
    layouts: emptyLayouts(),
    controlsOpacity: DEFAULT_CONTROLS_OPACITY,
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
export function presetPlacements(
  preset: PresetId,
  centers: SlotCenters,
  /** What is on the screen right now: a preset moves controls, it never
   *  brings back one the mode or the player had put away. */
  hidden: Readonly<Record<ControlSlot, boolean>>,
): ControlPlacements {
  if (preset === 'padrao') return emptyPlacements()

  const placements = emptyPlacements()
  for (const slot of CONTROL_SLOTS) {
    const centre = centers[slot]
    if (preset === 'canhoto') {
      // Mirrored down the middle: everything that was under the right thumb
      // is now under the left one, and the other way round.
      placements[slot] = {
        x: 1 - centre.x,
        y: centre.y,
        scale: 1,
        hidden: hidden[slot],
        latch: false,
      }
      continue
    }
    // Compact: smaller, and pulled towards the edge each control already
    // leans on, so the middle of a small screen stays clear of the car.
    const side = centre.x < 0.5 ? -1 : 1
    placements[slot] = {
      x: clamp(centre.x + side * 0.06, 0.05, 0.95),
      y: clamp(centre.y + 0.03, 0.05, 0.95),
      scale: 0.78,
      hidden: hidden[slot],
      latch: false,
    }
  }
  return placements
}

// ------------------------------------------------------------------ storage

const STORAGE_KEY = 'joguinho.controls.v2'
/**
 * The single shared layout this game used to save, before a layout belonged
 * to one gearbox. Read once, spread across all three modes, and never written
 * again: a player who had arranged their controls keeps that arrangement in
 * whichever mode they open next, and can then pull the other two apart.
 */
const LEGACY_STORAGE_KEY = 'joguinho.controls.v1'

function readStored(key: string): Record<string, unknown> | null {
  let raw: string | null = null
  try {
    raw = window.localStorage.getItem(key)
  } catch {
    return null
  }
  if (raw === null) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  return parsed as Record<string, unknown>
}

/**
 * Reads back a saved layout. Every field is checked: a layout written by an
 * older build, or edited by hand, must never be able to leave a control
 * off-screen or the game unable to start. Anything unreadable falls back to
 * the default for that field alone.
 */
export function loadControlConfig(): ControlConfig {
  const config = defaultControlConfig()
  const source = readStored(STORAGE_KEY) ?? readStored(LEGACY_STORAGE_KEY)
  if (source === null) return config

  if (source['steeringStyle'] === 'wheel' || source['steeringStyle'] === 'bar') {
    config.steeringStyle = source['steeringStyle']
  }
  const wheelTurns = source['wheelTurns']
  if (typeof wheelTurns === 'number' && Number.isFinite(wheelTurns)) {
    // Snapped rather than trusted: a build with a different set of settings,
    // or a hand-edited file, still has to land on one this one offers.
    config.wheelTurns = nearestWheelTurns(wheelTurns)
  }
  const controlsOpacity = source['controlsOpacity']
  if (typeof controlsOpacity === 'number' && Number.isFinite(controlsOpacity)) {
    // Snapped rather than trusted, same reasoning as wheelTurns above.
    config.controlsOpacity = nearestControlsOpacity(controlsOpacity)
  }

  const layouts = source['layouts']
  if (typeof layouts === 'object' && layouts !== null) {
    const record = layouts as Record<string, unknown>
    for (const mode of TRANSMISSION_MODES) config.layouts[mode] = readModeLayout(record[mode])
    return config
  }

  // No per-mode layouts in the file: it was written before they existed, so
  // whatever single layout it holds becomes the starting point of all three.
  const shared = readModeLayout(source)
  for (const mode of TRANSMISSION_MODES) config.layouts[mode] = cloneModeLayout(shared)
  return config
}

function readModeLayout(value: unknown): ModeLayout {
  const layout = emptyModeLayout()
  if (typeof value !== 'object' || value === null) return layout
  const source = value as Record<string, unknown>

  const preset = source['preset']
  if (typeof preset === 'string' && (PRESET_IDS as readonly string[]).includes(preset)) {
    layout.preset = preset as PresetId
  }

  const placements = source['placements']
  if (typeof placements === 'object' && placements !== null) {
    const record = placements as Record<string, unknown>
    for (const slot of CONTROL_SLOTS) {
      layout.placements[slot] = readPlacement(record[slot], slot)
    }
  }
  return layout
}

/** A layout of its own, so two modes seeded from one file never share objects. */
function cloneModeLayout(layout: ModeLayout): ModeLayout {
  const copy = emptyModeLayout()
  copy.preset = layout.preset
  for (const slot of CONTROL_SLOTS) {
    const placement = layout.placements[slot]
    copy.placements[slot] = placement === null ? null : { ...placement }
  }
  return copy
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
