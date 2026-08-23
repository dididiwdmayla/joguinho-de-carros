/**
 * Engine sound is data too. Everything about how the car sounds lives in a
 * JSON file so it can be tuned by ear without touching a line of code, and the
 * synthesiser reads it exactly the way the physics reads the car file.
 *
 * Nothing here knows about Web Audio: the wave names are our own spelling, and
 * `engineAudio` is the only module that maps them onto the browser's.
 */

/** Wave shapes an engine harmonic may use. */
export type EngineWave = 'sawtooth' | 'square' | 'triangle' | 'sine'

const WAVES: readonly EngineWave[] = ['sawtooth', 'square', 'triangle', 'sine']

export interface HarmonicParams {
  /** Multiple of the firing frequency this oscillator sits on. */
  readonly ratio: number
  readonly wave: EngineWave
  /** Relative amplitude, 1 being the loudest harmonic. */
  readonly gain: number
  /**
   * Offset in cents. Use it sparingly and only on a quiet harmonic: a detuned
   * oscillator beats against the partials of the ones below it, and on a
   * loud one that beat is a slow wobble in the idle instead of a shimmer.
   */
  readonly detune: number
}

export interface EngineAudioParams {
  /** Cylinder count; sets the firing frequency together with the rpm. */
  readonly cylinders: number
  /** Level of the whole engine bus, before the mute. */
  readonly masterGain: number
  readonly harmonics: readonly HarmonicParams[]
  /** Filtered noise layer: the body that keeps it from sounding like a synth. */
  readonly noise: {
    readonly gain: number
    /** Band centre as a multiple of the firing frequency. */
    readonly centreRatio: number
    readonly minHz: number
    readonly maxHz: number
    readonly q: number
  }
  /** Brightness: the cut-off opens up with throttle, which reads as load. */
  readonly lowpass: {
    readonly baseHz: number
    /** How much further the cut-off opens at full throttle [Hz]. */
    readonly loadHz: number
    /** Cut-off never falls below this many harmonics, so the tone stays. */
    readonly minHarmonic: number
    readonly q: number
    readonly maxHz: number
  }
  readonly gain: {
    /** Floor while the engine runs: idle is never silent. */
    readonly idle: number
    /** Added at the rev limiter. */
    readonly rpmSpan: number
    /** Added at full throttle. */
    readonly loadSpan: number
  }
  /** Bright noise laid over the top while the driven wheels are spinning. */
  readonly spin: {
    readonly gain: number
    readonly centreHz: number
    readonly q: number
    /** Surface slip at which the layer reaches full volume [m/s]. */
    readonly slipReference: number
  }
  /** Signature of a clutch being slipped: muffled, with a slow beat in it. */
  readonly clutch: {
    /** Slip below this is not audible [rpm]. */
    readonly minDeltaRpm: number
    /** Slip at which the effect is at full strength [rpm]. */
    readonly fullDeltaRpm: number
    /** Engagement at which the plates are rubbing hard enough to be heard. */
    readonly biteReference: number
    /** Depth of the beat, as a fraction of the engine's own level. */
    readonly depth: number
    /** How far the cut-off drops when fully slipping, 1 being no change. */
    readonly muffle: number
    readonly minHz: number
    readonly maxHz: number
  }
  readonly shift: {
    /** Fraction of the level dropped while the gearbox cuts torque. */
    readonly gainDrop: number
  }
  /** The death: a fast fall with one last cough in it. */
  readonly stall: {
    readonly duration: number
    /** Where in the fall the cough lands, 0..1. */
    readonly coughAt: number
    readonly coughWidth: number
    /** How much rpm the cough gives back, as a fraction. */
    readonly coughRpm: number
    /** How much level the cough gives back, as a fraction. */
    readonly coughGain: number
  }
  /**
   * Time constants of the parameter ramps [s]. Nothing is ever assigned
   * straight onto an audio parameter -- that is what makes an audible click.
   */
  readonly smoothing: {
    readonly frequency: number
    readonly gain: number
    readonly filter: number
  }
}

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

/** Reads a whole block of numbers that must all be present and >= `minimum`. */
function readBlock<K extends string>(
  raw: unknown,
  where: string,
  fields: readonly K[],
  minimum: number,
): Record<K, number> {
  const source = readObject(raw, where)
  const values = {} as Record<K, number>
  for (const field of fields) values[field] = readNumber(source, field, where, minimum)
  return values
}

function parseHarmonics(raw: unknown, where: string): HarmonicParams[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`${where}: "harmonics" precisa de ao menos um oscilador`)
  }
  return raw.map((entry: unknown, index: number): HarmonicParams => {
    const at = `${where}.harmonics[${index}]`
    const source = readObject(entry, at)
    const wave = source['wave']
    if (typeof wave !== 'string' || !WAVES.includes(wave as EngineWave)) {
      throw new Error(`${at}: "wave" deve ser um de ${WAVES.join(', ')}`)
    }
    return {
      ratio: readNumber(source, 'ratio', at, Number.MIN_VALUE),
      wave: wave as EngineWave,
      gain: readNumber(source, 'gain', at, 0),
      detune: readNumber(source, 'detune', at, -1200),
    }
  })
}

function parseEngineAudioParams(raw: unknown, where: string): EngineAudioParams {
  const source = readObject(raw, `${where}: raiz`)
  return {
    cylinders: readNumber(source, 'cylinders', where, 1),
    masterGain: readNumber(source, 'masterGain', where, 0),
    harmonics: parseHarmonics(source['harmonics'], where),
    noise: readBlock(
      source['noise'],
      `${where}.noise`,
      ['gain', 'centreRatio', 'minHz', 'maxHz', 'q'],
      0,
    ),
    lowpass: readBlock(
      source['lowpass'],
      `${where}.lowpass`,
      ['baseHz', 'loadHz', 'minHarmonic', 'q', 'maxHz'],
      0,
    ),
    gain: readBlock(source['gain'], `${where}.gain`, ['idle', 'rpmSpan', 'loadSpan'], 0),
    spin: readBlock(
      source['spin'],
      `${where}.spin`,
      ['gain', 'centreHz', 'q', 'slipReference'],
      Number.MIN_VALUE,
    ),
    clutch: readBlock(
      source['clutch'],
      `${where}.clutch`,
      ['minDeltaRpm', 'fullDeltaRpm', 'biteReference', 'depth', 'muffle', 'minHz', 'maxHz'],
      Number.MIN_VALUE,
    ),
    shift: readBlock(source['shift'], `${where}.shift`, ['gainDrop'], 0),
    stall: readBlock(
      source['stall'],
      `${where}.stall`,
      ['duration', 'coughAt', 'coughWidth', 'coughRpm', 'coughGain'],
      Number.MIN_VALUE,
    ),
    // A ramp of zero seconds is an assignment, and an assignment is a click.
    smoothing: readBlock(
      source['smoothing'],
      `${where}.smoothing`,
      ['frequency', 'gain', 'filter'],
      Number.MIN_VALUE,
    ),
  }
}

export async function loadEngineAudioParams(
  url: string,
  where: string,
): Promise<EngineAudioParams> {
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Falha ao carregar ${where} (HTTP ${response.status})`)
  return parseEngineAudioParams((await response.json()) as unknown, where)
}
